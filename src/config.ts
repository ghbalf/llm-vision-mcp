import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { AppConfig, ProviderConfig, PreprocessingOptions } from "./types.js";
import { DEFAULT_PREPROCESSING } from "./types.js";

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
  };
}

function loadConfigFile(path: string): Partial<AppConfig> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  return interpolateObject(parsed) as Partial<AppConfig>;
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
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) {
    envProviders.ollama = {
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model: process.env.OLLAMA_MODEL,
    };
  }

  let config: AppConfig = {
    defaultProvider: process.env.VISION_DEFAULT_PROVIDER ?? "openai",
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
  if (cli.ollamaBaseUrl || cli.ollamaModel) {
    config.providers.ollama = {
      ...config.providers.ollama,
      baseUrl: cli.ollamaBaseUrl ?? config.providers.ollama?.baseUrl ?? "http://localhost:11434",
      model: cli.ollamaModel ?? config.providers.ollama?.model,
    };
  }
  if (cli.model) {
    const defaultProv = config.defaultProvider;
    config.providers[defaultProv] = { ...config.providers[defaultProv], model: cli.model };
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

  return config;
}
