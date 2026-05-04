import { useId, useState } from "react";
import type { FormEvent } from "react";
import { AdminClientError, getAdminConfig } from "../lib/api/adminClient";
import { useAdminAuth } from "../lib/state/adminAuth";

interface AdminLoginProps {
  onAuthed: () => void;
}

export function AdminLogin({ onAuthed }: AdminLoginProps) {
  const { setPassword } = useAdminAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await getAdminConfig(value);
      setPassword(value);
      onAuthed();
    } catch (err) {
      if (
        err instanceof AdminClientError &&
        err.code === "ADMIN_AUTH_INVALID"
      ) {
        setError("Incorrect password");
      } else {
        setError("Could not sign in. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="admin-login" onSubmit={handleSubmit}>
      <label className="field" htmlFor={inputId}>
        <span>Admin password</span>
        <input
          id={inputId}
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? "Signing in..." : "Sign in"}
      </button>
      {error !== null && (
        <p data-testid="admin-login-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
