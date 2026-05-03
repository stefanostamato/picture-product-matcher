import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ApiKeyProvider, useApiKey } from "./apiKey";

describe("ApiKeyProvider / useApiKey", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;

  beforeEach(() => {
    // Surface any accidental persistence by spying on storage setters.
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: originalSessionStorage,
      configurable: true,
    });
  });

  it("starts with an empty key and updates via setApiKey", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ApiKeyProvider>{children}</ApiKeyProvider>
    );
    const { result } = renderHook(() => useApiKey(), { wrapper });
    expect(result.current.apiKey).toBe("");
    act(() => result.current.setApiKey("k1"));
    expect(result.current.apiKey).toBe("k1");
  });

  it("does not write the key to localStorage or sessionStorage", () => {
    const writes: Array<{ store: string; key: string; value: string }> = [];
    const trap = (storeName: string) => ({
      setItem(key: string, value: string) {
        writes.push({ store: storeName, key, value });
      },
      getItem() {
        return null;
      },
      removeItem() {},
      clear() {},
      key() {
        return null;
      },
      length: 0,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: trap("local"),
      configurable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: trap("session"),
      configurable: true,
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ApiKeyProvider>{children}</ApiKeyProvider>
    );
    const { result } = renderHook(() => useApiKey(), { wrapper });
    act(() => result.current.setApiKey("super-secret"));

    expect(writes).toEqual([]);
  });

  it("throws when used outside the provider", () => {
    // React logs caught errors; silence to keep test output clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useApiKey())).toThrow(
        /must be used inside an <ApiKeyProvider>/,
      );
    } finally {
      errSpy.mockRestore();
    }
  });
});
