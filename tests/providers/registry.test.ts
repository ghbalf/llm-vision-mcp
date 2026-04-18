import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.js";
import type { VisionProvider, ImageInput, DescribeOptions } from "../../src/types.js";

function makeFakeProvider(name: string): VisionProvider {
  return {
    name,
    supportedFormats: ["image/png", "image/jpeg"],
    async describeImage(_input: ImageInput, _options: DescribeOptions) {
      return { text: `described by ${name}` };
    },
  };
}

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider", () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai"));
    expect(registry.getProvider("openai").name).toBe("openai");
  });

  it("returns default provider when no name given", () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai"));
    registry.register(makeFakeProvider("anthropic"));
    expect(registry.getProvider().name).toBe("openai");
  });

  it("throws on unknown provider", () => {
    const registry = new ProviderRegistry("openai");
    expect(() => registry.getProvider("nonexistent")).toThrow("Unknown provider: nonexistent");
  });

  it("throws when default provider not registered", () => {
    const registry = new ProviderRegistry("openai");
    expect(() => registry.getProvider()).toThrow();
  });

  it("lists registered providers", () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai"));
    registry.register(makeFakeProvider("anthropic"));
    expect(registry.listProviders()).toEqual(["openai", "anthropic"]);
  });
});
