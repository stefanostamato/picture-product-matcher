import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { runPipeline } from "../pipeline/run.js";
import { getProvider } from "../providers/index.js";
import { searchCatalog } from "../catalog/index.js";
import { getConfig } from "../config/store.js";
import { createMetrics } from "../metrics/collector.js";
import { mapErrorToResponse, RequestValidationError } from "./errors.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Multer is configured for a single in-memory file part named "image". Memory
// storage keeps the bytes around as a Buffer the pipeline can hand straight
// to the provider — no disk, no temp files, no key-leaking debug paths.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(
      new RequestValidationError({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: `Unsupported image type: ${file.mimetype}.`,
      }),
    );
  },
});

const uploadSingle = upload.single("image");

/**
 * Register `POST /search` on the given Express app. The handler is wired
 * inside `createApp()` so supertest can drive it without binding a port.
 */
export function registerSearchRoute(app: Express): void {
  app.post("/search", (req, res, next) => {
    uploadSingle(req, res, (uploadErr: unknown) => {
      if (uploadErr) {
        handleError(uploadErr, req, res);
        return;
      }
      handleSearch(req, res).catch(next);
    });
  });

  // Fallback in case `next(err)` ever bubbles out of the handler. Express's
  // default error page would otherwise leak a stack trace.
  app.use(
    (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
      handleError(err, req, res);
    },
  );
}

async function handleSearch(req: Request, res: Response): Promise<void> {
  const apiKey = readApiKey(req);
  if (!apiKey) {
    throw new RequestValidationError({
      code: "MISSING_API_KEY",
      message: "Missing x-api-key header.",
    });
  }

  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    throw new RequestValidationError({
      code: "MISSING_IMAGE",
      message: "Missing image file part.",
    });
  }

  const promptField = (req.body as Record<string, unknown> | undefined)?.prompt;
  const prompt = typeof promptField === "string" && promptField.length > 0
    ? promptField
    : undefined;

  try {
    const response = await runPipeline(
      {
        image: file.buffer,
        mimeType: file.mimetype,
        prompt,
        apiKey,
      },
      {
        provider: getProvider(getConfig().provider),
        searchCatalog,
        getConfig,
        createMetrics,
      },
    );
    res.status(200).json(response);
  } catch (error) {
    handleError(error, req, res);
  }
}

function handleError(error: unknown, req: Request, res: Response): void {
  if (res.headersSent) return;

  const apiKey = readApiKey(req);

  // Translate multer's own size-limit error into our typed validation error
  // so the mapper produces the right `ApiError`.
  const normalized = normalizeMulterError(error);
  const { status, body } = mapErrorToResponse(normalized, apiKey);

  if (status >= 500) {
    const scrubbed = scrubError(error, apiKey);
    console.error(`[search] ${status} ${body.code}:`, scrubbed);
  }

  res.status(status).json(body);
}

function scrubError(error: unknown, apiKey: string | undefined): unknown {
  if (!(error instanceof Error)) return error;
  const upstream = error as {
    code?: unknown;
    upstreamStatus?: unknown;
    upstreamCode?: unknown;
  };
  const extras: Record<string, unknown> = {};
  if (typeof upstream.code === "string") extras.code = upstream.code;
  if (typeof upstream.upstreamStatus === "number")
    extras.upstreamStatus = upstream.upstreamStatus;
  if (typeof upstream.upstreamCode === "string")
    extras.upstreamCode = upstream.upstreamCode;
  if (!apiKey) {
    return { name: error.name, message: error.message, ...extras, stack: error.stack };
  }
  const message = error.message.split(apiKey).join("[redacted]");
  const stack = error.stack?.split(apiKey).join("[redacted]");
  return { name: error.name, message, ...extras, stack };
}

function normalizeMulterError(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    (error as { name?: string }).name === "MulterError"
  ) {
    const code = (error as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      return new RequestValidationError({
        code: "IMAGE_TOO_LARGE",
        message: "Image exceeds the 8MB limit.",
      });
    }
  }
  return error;
}

function readApiKey(req: Request): string | undefined {
  const raw = req.header("x-api-key");
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
