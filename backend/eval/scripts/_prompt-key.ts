import { createInterface } from "node:readline";
import { Writable } from "node:stream";

export async function promptForApiKey(label = "OpenAI API key"): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `${label} is not set and stdin is not a TTY; cannot prompt interactively. Set OPENAI_API_KEY for this command only (e.g. 'OPENAI_API_KEY=sk-... npm run gold:generate') and it will not be persisted.`,
    );
  }

  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const rl = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });

  process.stdout.write(`${label} (input hidden): `);

  const answer = await new Promise<string>((resolve) => {
    rl.question("", (value) => resolve(value));
  });

  rl.close();
  process.stdout.write("\n");

  const trimmed = answer.trim();
  if (!trimmed) {
    throw new Error(`${label} was empty.`);
  }
  return trimmed;
}

export async function getApiKey(): Promise<string> {
  const fromEnv = process.env.OPENAI_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return promptForApiKey();
}
