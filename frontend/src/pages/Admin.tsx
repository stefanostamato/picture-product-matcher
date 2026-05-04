import { useCallback, useEffect, useState } from "react";
import type { AdminConfig, HistoryRow } from "shared/wire";
import {
  AdminClientError,
  getAdminConfig,
  getAdminHistory,
} from "../lib/api/adminClient";
import { AdminAuthProvider, useAdminAuth } from "../lib/state/adminAuth";
import { AdminLogin } from "../components/AdminLogin";
import { AdminConfigForm } from "../components/AdminConfigForm";
import { AdminHistoryTable } from "../components/AdminHistoryTable";

interface FetchState {
  loading: boolean;
  config: AdminConfig | null;
  history: HistoryRow[];
  error: string | null;
}

const INITIAL_FETCH: FetchState = {
  loading: true,
  config: null,
  history: [],
  error: null,
};

function isAuthError(err: unknown): boolean {
  return (
    err instanceof AdminClientError &&
    (err.code === "ADMIN_AUTH_INVALID" ||
      err.code === "ADMIN_AUTH_REQUIRED" ||
      err.status === 401)
  );
}

function AdminInner() {
  const { password, logout } = useAdminAuth();
  const [state, setState] = useState<FetchState>(INITIAL_FETCH);

  const reload = useCallback(
    async (pw: string) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const [config, history] = await Promise.all([
          getAdminConfig(pw),
          getAdminHistory(pw),
        ]);
        setState({
          loading: false,
          config,
          history: history.rows,
          error: null,
        });
      } catch (err) {
        if (isAuthError(err)) {
          logout();
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to load admin data.";
        setState((s) => ({ ...s, loading: false, error: message }));
      }
    },
    [logout],
  );

  useEffect(() => {
    if (password === null) {
      setState(INITIAL_FETCH);
      return;
    }
    void reload(password);
  }, [password, reload]);

  if (password === null) {
    return (
      <main className="page admin-page">
        <header>
          <h1>Admin</h1>
        </header>
        <AdminLogin onAuthed={() => {}} />
      </main>
    );
  }

  return (
    <main className="page admin-page">
      <header className="admin-header">
        <h1>Admin</h1>
        <button type="button" className="admin-logout" onClick={logout}>
          Log out
        </button>
      </header>

      {state.error !== null && (
        <div className="banner banner-error" role="alert">
          {state.error}
        </div>
      )}

      <section className="admin-section">
        <h2>Configuration</h2>
        {state.config !== null ? (
          <AdminConfigForm
            initial={state.config}
            password={password}
            onSaved={(next) =>
              setState((s) => ({ ...s, config: next, error: null }))
            }
          />
        ) : (
          <p className="empty">{state.loading ? "Loading..." : "—"}</p>
        )}
      </section>

      <section className="admin-section">
        <h2>Eval history</h2>
        {state.loading && state.config === null ? (
          <p className="empty">Loading...</p>
        ) : (
          <AdminHistoryTable rows={state.history} />
        )}
      </section>
    </main>
  );
}

export function Admin() {
  return (
    <AdminAuthProvider>
      <AdminInner />
    </AdminAuthProvider>
  );
}
