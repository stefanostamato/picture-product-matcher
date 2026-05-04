import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface AdminAuthContextValue {
  password: string | null;
  setPassword: (next: string | null) => void;
  logout: () => void;
}

const STORAGE_KEY = "adminPassword";

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function readInitialPassword(): string | null {
  // Guard SSR / test envs without a real sessionStorage.
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [password, setPasswordState] = useState<string | null>(() =>
    readInitialPassword(),
  );

  const setPassword = useCallback((next: string | null) => {
    setPasswordState(next);
    if (typeof sessionStorage === "undefined") return;
    try {
      if (next === null) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort persistence; ignore quota / privacy-mode failures.
    }
  }, []);

  const logout = useCallback(() => setPassword(null), [setPassword]);

  const value = useMemo(
    () => ({ password, setPassword, logout }),
    [password, setPassword, logout],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used inside an <AdminAuthProvider>");
  }
  return ctx;
}
