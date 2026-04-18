import type { VisionProvider, RetryConfig } from "../types.js";
import { DEFAULT_RETRY } from "../types.js";
import { withRetry } from "../retry.js";

interface Entry {
  provider: VisionProvider;
  retry: RetryConfig;
}

function mergeRetry(base: RetryConfig, override?: Partial<RetryConfig>): RetryConfig {
  return { ...base, ...(override ?? {}) };
}

function wrap(entry: Entry): VisionProvider {
  return {
    name: entry.provider.name,
    supportedFormats: entry.provider.supportedFormats,
    describeImage: (input, options) =>
      withRetry(() => entry.provider.describeImage(input, options), entry.retry),
  };
}

export class ProviderRegistry {
  private entries = new Map<string, Entry>();
  private readonly baseRetry: RetryConfig;

  constructor(private defaultProviderName: string, baseRetry: RetryConfig = DEFAULT_RETRY) {
    this.baseRetry = baseRetry;
  }

  register(provider: VisionProvider, retryOverride?: Partial<RetryConfig>): void {
    this.entries.set(provider.name, {
      provider,
      retry: mergeRetry(this.baseRetry, retryOverride),
    });
  }

  getProvider(name?: string): VisionProvider {
    const providerName = name ?? this.defaultProviderName;
    const entry = this.entries.get(providerName);
    if (!entry) {
      const available = this.listProviders().join(", ") || "none";
      throw new Error(`Unknown provider: ${providerName}. Available: ${available}`);
    }
    return wrap(entry);
  }

  /** Returns the underlying provider without retry wrapping. For internal use (e.g. batch). */
  getRawProvider(name?: string): VisionProvider {
    const providerName = name ?? this.defaultProviderName;
    const entry = this.entries.get(providerName);
    if (!entry) {
      const available = this.listProviders().join(", ") || "none";
      throw new Error(`Unknown provider: ${providerName}. Available: ${available}`);
    }
    return entry.provider;
  }

  /** Returns the resolved retry config for a registered provider. */
  getRetryConfig(name?: string): RetryConfig {
    const providerName = name ?? this.defaultProviderName;
    const entry = this.entries.get(providerName);
    if (!entry) throw new Error(`Unknown provider: ${providerName}`);
    return entry.retry;
  }

  listProviders(): string[] {
    return [...this.entries.keys()];
  }
}
