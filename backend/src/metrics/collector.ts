export type StageStop = () => void;

export type MetricsResult = {
  latencyMs: number;
  stagesRan: string[];
};

export type Metrics = {
  stage: (name: string) => StageStop;
  finalize: () => MetricsResult;
};

export function createMetrics(): Metrics {
  const stagesRan: string[] = [];
  let totalLatencyMs = 0;

  function stage(name: string): StageStop {
    const startedAt = now();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const elapsed = now() - startedAt;
      totalLatencyMs += elapsed;
      stagesRan.push(name);
    };
  }

  function finalize(): MetricsResult {
    return {
      latencyMs: totalLatencyMs,
      stagesRan: [...stagesRan],
    };
  }

  return { stage, finalize };
}

function now(): number {
  return Date.now();
}
