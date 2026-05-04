import type { Request, Response, NextFunction, RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";

const DEFAULT_ADMIN_PASSWORD = "admin";

/**
 * Resolve the password the middleware will compare against. An empty-string
 * env var is treated the same as "unset" so an accidental `ADMIN_PASSWORD=`
 * line in `.env` doesn't silently grant a free-for-all.
 */
export function getExpectedPassword(): string {
  const raw = process.env.ADMIN_PASSWORD;
  if (typeof raw !== "string" || raw.length === 0) {
    return DEFAULT_ADMIN_PASSWORD;
  }
  return raw;
}

const requireAdminPassword: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const supplied = req.header("x-admin-password");

  if (typeof supplied !== "string" || supplied.length === 0) {
    res.status(401).json({
      code: "ADMIN_AUTH_REQUIRED",
      message: "Admin password required.",
    });
    return;
  }

  const expected = getExpectedPassword();

  if (!constantTimeStringEqual(supplied, expected)) {
    // Note: never include `supplied` in the response — even via error
    // formatting — to avoid reflecting attacker-controlled bytes.
    res.status(401).json({
      code: "ADMIN_AUTH_INVALID",
      message: "Invalid admin password.",
    });
    return;
  }

  next();
};

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on length mismatch, which itself leaks length
  // via the throw vs. compare branch. Short-circuit safely first; the length
  // of the expected password is not a secret worth defending against.
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export default requireAdminPassword;
