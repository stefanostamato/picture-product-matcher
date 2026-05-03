import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface ApiKeyContextValue {
  apiKey: string;
  setApiKey: (next: string) => void;
}

const ApiKeyContext = createContext<ApiKeyContextValue | null>(null);

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState("");
  const value = useMemo(() => ({ apiKey, setApiKey }), [apiKey]);
  return (
    <ApiKeyContext.Provider value={value}>{children}</ApiKeyContext.Provider>
  );
}

export function useApiKey(): ApiKeyContextValue {
  const ctx = useContext(ApiKeyContext);
  if (!ctx) {
    throw new Error("useApiKey must be used inside an <ApiKeyProvider>");
  }
  return ctx;
}
