import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { ProviderRegistry } from "./providers/registry.js";
import { OpenAIProvider } from "./providers/openai.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GoogleProvider } from "./providers/google.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { GenericHttpProvider } from "./providers/generic-http.js";
import { PRESETS } from "./presets.js";
import { DEFAULT_RETRY, DEFAULT_CONCURRENCY } from "./types.js";
import type { GenericHttpProviderConfig, ProviderConfig, VisionProvider } from "./types.js";

const BUILTIN_PROVIDERS = new Set(["openai", "anthropic", "google", "ollama"]);

const BUILTINS = ["openai", "anthropic", "google", "ollama"];

export function validateDefaultProvider(
  defaultProvider: string,
  registered: string[],
): void {
  if (registered.includes(defaultProvider)) return;
  const presetNames = Object.keys(PRESETS).join(", ");
  const builtinNames = BUILTINS.join(", ");
  throw new Error(
    `Unknown provider "${defaultProvider}".\n` +
      `  Known presets: ${presetNames}\n` +
      `  Known builtins: ${builtinNames}\n` +
      `  Or provide a vision-config.json entry for "${defaultProvider}".`,
  );
}

export function buildRegistry(config: ReturnType<typeof loadConfig>): ProviderRegistry {
  const baseRetry = { ...DEFAULT_RETRY, ...(config.retry ?? {}) };
  const registry = new ProviderRegistry(config.defaultProvider, baseRetry);

  for (const [name, providerConfig] of Object.entries(config.providers)) {
    try {
      const provider = createProvider(name, providerConfig);
      if (provider) registry.register(provider, providerConfig.retry);
    } catch (err) {
      console.error(`Warning: Failed to initialize provider "${name}":`, err);
    }
  }

  return registry;
}

function createProvider(name: string, config: ProviderConfig): VisionProvider | null {
  // Built-in providers: recognized by key name
  if (BUILTIN_PROVIDERS.has(name) && !config.type) {
    switch (name) {
      case "openai":
        return new OpenAIProvider(config);
      case "anthropic":
        return new AnthropicProvider(config);
      case "google":
        return new GoogleProvider(config);
      case "ollama":
        return new OllamaProvider(config);
    }
  }

  // Custom providers: require type field
  if (config.type === "openai-compatible") {
    return new OpenAICompatibleProvider(name, config);
  }
  if (config.type === "generic-http") {
    return new GenericHttpProvider(name, config as GenericHttpProviderConfig);
  }

  console.warn(`Warning: Provider "${name}" has no type field and is not a built-in provider. Skipping.`);
  return null;
}

async function main() {
  const config = loadConfig(process.argv.slice(2));
  const registry = buildRegistry(config);

  const providers = registry.listProviders();
  if (providers.length === 0) {
    console.error("Error: No providers configured. Set at least one API key or configure a provider.");
    process.exit(1);
  }

  try {
    validateDefaultProvider(config.defaultProvider, providers);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  console.error(`llm-vision-mcp: ${providers.length} provider(s) active: ${providers.join(", ")}`);
  console.error(`llm-vision-mcp: default provider: ${config.defaultProvider}`);

  const perProviderConcurrency: Record<string, number> = {};
  for (const [name, cfg] of Object.entries(config.providers)) {
    if (typeof cfg.concurrency === "number") perProviderConcurrency[name] = cfg.concurrency;
  }
  const batchDefaults = {
    concurrency: DEFAULT_CONCURRENCY,
    perProviderConcurrency,
  };
  const server = createServer(registry, config.preprocessing, batchDefaults);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
