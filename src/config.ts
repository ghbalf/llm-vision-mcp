import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { AppConfig, ProviderConfig, PreprocessingOptions } from "./types.js";
import { DEFAULT_PREPROCESSING } from "./types.js";
import { PRESETS } from "./presets.js";

export function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}

function interpolateObject(obj: unknown): unknown {
  if (typeof obj === "string") return interpolateEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(interpolateObject);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = interpolateObject(v);
    }
    return result;
  }
  return obj;
}

interface CliArgs {
  provider?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  model?: string;
  config?: string;
  timeout?: number;
  ollamaTimeout?: number;
  apiKey?: string;
  baseUrl?: string;
}

function parsePositiveMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      provider: { type: "string" },
      "openai-api-key": { type: "string" },
      "anthropic-api-key": { type: "string" },
      "google-api-key": { type: "string" },
      "ollama-base-url": { type: "string" },
      "ollama-model": { type: "string" },
      model: { type: "string" },
      config: { type: "string" },
      timeout: { type: "string" },
      "ollama-timeout": { type: "string" },
      "api-key": { type: "string" },
      "base-url": { type: "string" },
    },
    strict: false,
  });
  return {
    provider: values.provider as string | undefined,
    openaiApiKey: values["openai-api-key"] as string | undefined,
    anthropicApiKey: values["anthropic-api-key"] as string | undefined,
    googleApiKey: values["google-api-key"] as string | undefined,
    ollamaBaseUrl: values["ollama-base-url"] as string | undefined,
    ollamaModel: values["ollama-model"] as string | undefined,
    model: values.model as string | undefined,
    config: values.config as string | undefined,
    timeout: parsePositiveMs(values.timeout as string | undefined),
    ollamaTimeout: parsePositiveMs(values["ollama-timeout"] as string | undefined),
    apiKey: values["api-key"] as string | undefined,
    baseUrl: values["base-url"] as string | undefined,
  };
}

function loadConfigFile(path: string): Partial<AppConfig> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  return interpolateObject(parsed) as Partial<AppConfig>;
}

function applyPresetDefaults(config: AppConfig): void {
  const name = config.defaultProvider;
  const preset = PRESETS[name];
  if (!preset) return;
  const existing = config.providers[name];
  // Respect an explicit non-OpenAI-compatible type set via config file.
  if (existing?.type && existing.type !== "openai-compatible") return;
  const apiKey = existing?.apiKey ?? process.env[preset.envKey];
  if (!apiKey) return;
  config.providers[name] = {
    type: "openai-compatible",
    apiKey,
    baseUrl: existing?.baseUrl ?? process.env[preset.envBaseUrl] ?? preset.baseUrl,
    model: existing?.model ?? process.env[preset.envModel] ?? preset.defaultModel,
    ...(existing?.timeout !== undefined ? { timeout: existing.timeout } : {}),
    ...(existing?.retry !== undefined ? { retry: existing.retry } : {}),
    ...(existing?.concurrency !== undefined ? { concurrency: existing.concurrency } : {}),
  };
}

export function loadConfig(argv: string[]): AppConfig {
  // Step 1: Load .env
  loadDotenv();

  // Step 2: Read env vars
  const envProviders: Record<string, ProviderConfig> = {};
  if (process.env.OPENAI_API_KEY) {
    envProviders.openai = { apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    envProviders.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.GOOGLE_API_KEY) {
    envProviders.google = { apiKey: process.env.GOOGLE_API_KEY };
  }
  const envOllamaTimeout = parsePositiveMs(process.env.OLLAMA_TIMEOUT_MS);
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL || envOllamaTimeout !== undefined) {
    envProviders.ollama = {
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model: process.env.OLLAMA_MODEL,
      ...(envOllamaTimeout !== undefined ? { timeout: envOllamaTimeout } : {}),
    };
  }

  const envDefaultProvider = process.env.VISION_DEFAULT_PROVIDER ?? "openai";
  const envTimeout = parsePositiveMs(process.env.VISION_TIMEOUT_MS);
  if (envTimeout !== undefined && envProviders[envDefaultProvider]) {
    envProviders[envDefaultProvider] = {
      ...envProviders[envDefaultProvider],
      timeout: envTimeout,
    };
  }

  let config: AppConfig = {
    defaultProvider: envDefaultProvider,
    providers: envProviders,
    preprocessing: { ...DEFAULT_PREPROCESSING },
  };

  // Step 3: CLI args override env vars
  const cli = parseCli(argv);
  if (cli.provider) config.defaultProvider = cli.provider;
  if (cli.openaiApiKey) {
    config.providers.openai = { ...config.providers.openai, apiKey: cli.openaiApiKey };
  }
  if (cli.anthropicApiKey) {
    config.providers.anthropic = { ...config.providers.anthropic, apiKey: cli.anthropicApiKey };
  }
  if (cli.googleApiKey) {
    config.providers.google = { ...config.providers.google, apiKey: cli.googleApiKey };
  }
  if (cli.ollamaBaseUrl || cli.ollamaModel || cli.ollamaTimeout !== undefined) {
    config.providers.ollama = {
      ...config.providers.ollama,
      baseUrl: cli.ollamaBaseUrl ?? config.providers.ollama?.baseUrl ?? "http://localhost:11434",
      model: cli.ollamaModel ?? config.providers.ollama?.model,
      ...(cli.ollamaTimeout !== undefined
        ? { timeout: cli.ollamaTimeout }
        : config.providers.ollama?.timeout !== undefined
          ? { timeout: config.providers.ollama.timeout }
          : {}),
    };
  }
  if (cli.model) {
    const defaultProv = config.defaultProvider;
    config.providers[defaultProv] = { ...config.providers[defaultProv], model: cli.model };
  }
  if (cli.apiKey) {
    const defaultProv = config.defaultProvider;
    config.providers[defaultProv] = {
      ...config.providers[defaultProv],
      apiKey: cli.apiKey,
    };
  }
  if (cli.baseUrl) {
    const defaultProv = config.defaultProvider;
    config.providers[defaultProv] = {
      ...config.providers[defaultProv],
      baseUrl: cli.baseUrl,
    };
  }
  if (cli.timeout !== undefined) {
    const defaultProv = config.defaultProvider;
    config.providers[defaultProv] = {
      ...config.providers[defaultProv],
      timeout: cli.timeout,
    };
  }

  // Step 4: Config file (highest priority for provider settings)
  const configPath = cli.config ?? process.env.VISION_CONFIG_PATH;
  if (configPath) {
    const fileConfig = loadConfigFile(resolve(configPath));
    if (fileConfig.defaultProvider) config.defaultProvider = fileConfig.defaultProvider;
    if (fileConfig.providers) {
      config.providers = { ...config.providers, ...fileConfig.providers };
    }
    if (fileConfig.preprocessing) {
      config.preprocessing = { ...config.preprocessing, ...fileConfig.preprocessing };
    }
  }

  applyPresetDefaults(config);

  return config;
}
