import type { VisionProvider } from "./base.js";

export class ProviderRegistry {
  private providers = new Map<string, VisionProvider>();

  constructor(private defaultProviderName: string) {}

  register(provider: VisionProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name?: string): VisionProvider {
    const providerName = name ?? this.defaultProviderName;
    const provider = this.providers.get(providerName);
    if (!provider) {
      const available = this.listProviders().join(", ") || "none";
      throw new Error(`Unknown provider: ${providerName}. Available: ${available}`);
    }
    return provider;
  }

  listProviders(): string[] {
    return [...this.providers.keys()];
  }
}
