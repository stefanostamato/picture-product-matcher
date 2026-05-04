import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AdminAuthProvider, useAdminAuth } from "./adminAuth";

const STORAGE_KEY = "adminPassword";

describe("AdminAuthProvider / useAdminAuth", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("hydrates the password from sessionStorage on mount", () => {
    sessionStorage.setItem(STORAGE_KEY, "saved-pw");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AdminAuthProvider>{children}</AdminAuthProvider>
    );
    const { result } = renderHook(() => useAdminAuth(), { wrapper });
    expect(result.current.password).toBe("saved-pw");
  });

  it("returns null when sessionStorage has no entry", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AdminAuthProvider>{children}</AdminAuthProvider>
    );
    const { result } = renderHook(() => useAdminAuth(), { wrapper });
    expect(result.current.password).toBeNull();
  });

  it("setPassword writes to sessionStorage", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AdminAuthProvider>{children}</AdminAuthProvider>
    );
    const { result } = renderHook(() => useAdminAuth(), { wrapper });

    act(() => result.current.setPassword("new-pw"));

    expect(result.current.password).toBe("new-pw");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("new-pw");
  });

  it("logout clears the password from state and sessionStorage", () => {
    sessionStorage.setItem(STORAGE_KEY, "saved-pw");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AdminAuthProvider>{children}</AdminAuthProvider>
    );
    const { result } = renderHook(() => useAdminAuth(), { wrapper });
    expect(result.current.password).toBe("saved-pw");

    act(() => result.current.logout());

    expect(result.current.password).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("setPassword(null) clears the storage entry", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AdminAuthProvider>{children}</AdminAuthProvider>
    );
    const { result } = renderHook(() => useAdminAuth(), { wrapper });

    act(() => result.current.setPassword("a-pw"));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("a-pw");
    act(() => result.current.setPassword(null));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.password).toBeNull();
  });

  it("throws when used outside the provider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useAdminAuth())).toThrow(
        /must be used inside an <AdminAuthProvider>/,
      );
    } finally {
      errSpy.mockRestore();
    }
  });
});
