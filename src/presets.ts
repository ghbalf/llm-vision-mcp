import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface Preset {
  baseUrl: string;
  defaultModel: string;
  envKey: string;
  envModel: string;
  envBaseUrl: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "presets.json"), "utf-8");
export const PRESETS: Record<string, Preset> = JSON.parse(raw);

export function getPreset(name: string): Preset | undefined {
  return PRESETS[name];
}
