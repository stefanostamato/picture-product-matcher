import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMetrics } from "./collector.js";

describe("createMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records elapsed time per stage and lists stages in finalize order", () => {
    const metrics = createMetrics();

    const stopVision = metrics.stage("visionExtract");
    vi.advanceTimersByTime(40);
    stopVision();

    const stopQuery = metrics.stage("queryBuild");
    vi.advanceTimersByTime(10);
    stopQuery();

    const stopSearch = metrics.stage("catalogSearch");
    vi.advanceTimersByTime(50);
    stopSearch();

    const result = metrics.finalize();
    expect(result.stagesRan).toEqual(["visionExtract", "queryBuild", "catalogSearch"]);
    expect(result.latencyMs).toBe(100);
  });

  it("returns a stop function that is safe to call once", () => {
    const metrics = createMetrics();
    const stop = metrics.stage("only");
    vi.advanceTimersByTime(15);
    expect(() => stop()).not.toThrow();
    const result = metrics.finalize();
    expect(result.stagesRan).toEqual(["only"]);
    expect(result.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it("allows the same stage name to be timed twice and reports it twice in order", () => {
    const metrics = createMetrics();

    const stopFirst = metrics.stage("rerank");
    vi.advanceTimersByTime(5);
    stopFirst();

    const stopOther = metrics.stage("queryBuild");
    vi.advanceTimersByTime(5);
    stopOther();

    const stopSecond = metrics.stage("rerank");
    vi.advanceTimersByTime(5);
    stopSecond();

    const result = metrics.finalize();
    expect(result.stagesRan).toEqual(["rerank", "queryBuild", "rerank"]);
    expect(result.latencyMs).toBe(15);
  });

  it("finalize returns zero stages and zero latency when nothing was timed", () => {
    const metrics = createMetrics();
    const result = metrics.finalize();
    expect(result.stagesRan).toEqual([]);
    expect(result.latencyMs).toBe(0);
  });

  it("each createMetrics() call is an independent collector", () => {
    const a = createMetrics();
    const b = createMetrics();

    const stopA = a.stage("alpha");
    vi.advanceTimersByTime(10);
    stopA();

    const stopB = b.stage("beta");
    vi.advanceTimersByTime(20);
    stopB();

    expect(a.finalize().stagesRan).toEqual(["alpha"]);
    expect(b.finalize().stagesRan).toEqual(["beta"]);
  });

  it("a stage that has not been stopped is not included in stagesRan", () => {
    const metrics = createMetrics();
    metrics.stage("visionExtract");
    const stopQuery = metrics.stage("queryBuild");
    vi.advanceTimersByTime(7);
    stopQuery();
    const result = metrics.finalize();
    expect(result.stagesRan).toEqual(["queryBuild"]);
  });
});
