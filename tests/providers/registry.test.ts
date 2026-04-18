import { describe, it, expect, vi } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.js";
import type { VisionProvider, ImageInput, DescribeOptions } from "../../src/types.js";
import { DEFAULT_RETRY } from "../../src/types.js";

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

describe("ProviderRegistry retry wrapping", () => {
  it("retries a provider that throws 500 then succeeds", async () => {
    vi.useFakeTimers();
    const call = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValue({ text: "ok", usage: undefined });

    const raw: VisionProvider = {
      name: "flaky",
      supportedFormats: ["image/png"],
      describeImage: call,
    };
    const registry = new ProviderRegistry("flaky", {
      ...DEFAULT_RETRY,
      jitterFactor: 0,
      baseDelayMs: 1,
    });
    registry.register(raw);
    const p = registry.getProvider("flaky").describeImage(
      { data: Buffer.from(""), mimeType: "image/png", originalSource: "t" },
      {},
    );
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ text: "ok", usage: undefined });
    expect(call).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("uses per-provider retry override when present", async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockRejectedValue({ status: 500 });
    const raw: VisionProvider = {
      name: "noretry",
      supportedFormats: ["image/png"],
      describeImage: call,
    };
    const registry = new ProviderRegistry("noretry", DEFAULT_RETRY);
    registry.register(raw, { maxAttempts: 1 });
    const p = registry.getProvider().describeImage(
      { data: Buffer.from(""), mimeType: "image/png", originalSource: "t" },
      {},
    );
    await expect(p).rejects.toEqual({ status: 500 });
    expect(call).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
