export type ProviderName = "openai";

export type Config = {
  topK: number;
  rerank: boolean;
  provider: ProviderName;
  visionModel: string;
};

const defaults: Config = {
  topK: 20,
  rerank: false,
  provider: "openai",
  visionModel: "gpt-4o-mini",
};

let current: Config = { ...defaults };

export function getConfig(): Config {
  return { ...current };
}

export function setConfig(partial: Partial<Config>): Config {
  const next: Config = { ...current };
  for (const key of Object.keys(partial) as (keyof Config)[]) {
    const value = partial[key];
    if (value === undefined) continue;
    (next[key] as Config[typeof key]) = value as Config[typeof key];
  }
  current = next;
  return { ...current };
}

export function resetConfig(): void {
  current = { ...defaults };
}
