import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { AdminConfig, AdminConfigUpdate } from "shared/wire";
import {
  AdminClientError,
  resetAdminConfig,
  updateAdminConfig,
} from "../lib/api/adminClient";

interface AdminConfigFormProps {
  initial: AdminConfig;
  password: string;
  onSaved?: (next: AdminConfig) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function diffConfig(
  initial: AdminConfig,
  current: AdminConfig,
): AdminConfigUpdate {
  const patch: Record<string, unknown> = {};
  (Object.keys(current) as Array<keyof AdminConfig>).forEach((key) => {
    if (current[key] !== initial[key]) {
      patch[key] = current[key];
    }
  });
  return patch as AdminConfigUpdate;
}

export function AdminConfigForm({
  initial,
  password,
  onSaved,
}: AdminConfigFormProps) {
  const [base, setBase] = useState<AdminConfig>(initial);
  const [draft, setDraft] = useState<AdminConfig>(initial);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const ids = {
    topK: useId(),
    rerank: useId(),
    visionModel: useId(),
    visionPrompt: useId(),
    rerankModel: useId(),
    rerankPrompt: useId(),
    rerankTopN: useId(),
  };

  const update = <K extends keyof AdminConfig>(
    key: K,
    value: AdminConfig[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const updateNumber = (key: "topK" | "rerankTopN", raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    update(key, Number.isFinite(parsed) ? parsed : 0);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const patch = diffConfig(base, draft);
    if (Object.keys(patch).length === 0) {
      setStatus({ kind: "success", message: "No changes to save." });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const next = await updateAdminConfig(password, patch);
      setBase(next);
      setDraft(next);
      setStatus({ kind: "success", message: "Saved." });
      onSaved?.(next);
    } catch (err) {
      const message =
        err instanceof AdminClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed.";
      setStatus({ kind: "error", message });
    }
  }

  async function handleReset() {
    if (!window.confirm("Reset all admin config to defaults?")) return;
    setStatus({ kind: "saving" });
    try {
      const next = await resetAdminConfig(password);
      setBase(next);
      setDraft(next);
      setStatus({ kind: "success", message: "Reset to defaults." });
      onSaved?.(next);
    } catch (err) {
      const message =
        err instanceof AdminClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Reset failed.";
      setStatus({ kind: "error", message });
    }
  }

  const saving = status.kind === "saving";
  const rerankDisabled = !draft.rerank;

  return (
    <form className="admin-config-form" onSubmit={handleSubmit}>
      <fieldset className="admin-fieldset">
        <legend>Search</legend>

        <label className="field" htmlFor={ids.topK}>
          <span>Top K</span>
          <input
            id={ids.topK}
            type="number"
            min={1}
            max={100}
            value={draft.topK}
            onChange={(e) => updateNumber("topK", e.target.value)}
          />
        </label>

        <label className="field" htmlFor={ids.visionModel}>
          <span>Vision model</span>
          <input
            id={ids.visionModel}
            type="text"
            value={draft.visionModel}
            onChange={(e) => update("visionModel", e.target.value)}
          />
        </label>

        <label className="field" htmlFor={ids.visionPrompt}>
          <span>Vision prompt</span>
          <textarea
            id={ids.visionPrompt}
            rows={6}
            value={draft.visionPrompt}
            onChange={(e) => update("visionPrompt", e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Rerank</legend>

        <label className="field field-checkbox" htmlFor={ids.rerank}>
          <input
            id={ids.rerank}
            type="checkbox"
            checked={draft.rerank}
            onChange={(e) => update("rerank", e.target.checked)}
          />
          <span>Rerank</span>
        </label>

        <label className="field" htmlFor={ids.rerankModel}>
          <span>Rerank model</span>
          <input
            id={ids.rerankModel}
            type="text"
            value={draft.rerankModel}
            disabled={rerankDisabled}
            onChange={(e) => update("rerankModel", e.target.value)}
          />
        </label>

        <label className="field" htmlFor={ids.rerankPrompt}>
          <span>Rerank prompt</span>
          <textarea
            id={ids.rerankPrompt}
            rows={6}
            value={draft.rerankPrompt}
            disabled={rerankDisabled}
            onChange={(e) => update("rerankPrompt", e.target.value)}
          />
        </label>

        <label className="field" htmlFor={ids.rerankTopN}>
          <span>Rerank top N</span>
          <input
            id={ids.rerankTopN}
            type="number"
            min={1}
            max={50}
            value={draft.rerankTopN}
            disabled={rerankDisabled}
            onChange={(e) => updateNumber("rerankTopN", e.target.value)}
          />
        </label>
      </fieldset>

      <div className="admin-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          className="admin-reset"
          onClick={handleReset}
          disabled={saving}
        >
          Reset to defaults
        </button>
      </div>

      {status.kind === "success" && (
        <p className="admin-status admin-status-ok" role="status">
          {status.message}
        </p>
      )}
      {status.kind === "error" && (
        <p className="admin-status admin-status-error" role="alert">
          {status.message}
        </p>
      )}
    </form>
  );
}
