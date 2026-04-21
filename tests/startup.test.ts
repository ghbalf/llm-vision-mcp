import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateDefaultProvider, buildRegistry } from "../src/index.js";
import { loadConfig } from "../src/config.js";

describe("validateDefaultProvider", () => {
  it("returns silently when defaultProvider is in the registered list", () => {
    expect(() =>
      validateDefaultProvider("openai", ["openai", "anthropic"]),
    ).not.toThrow();
  });

  it("throws with a helpful message when defaultProvider is unknown", () => {
    expect(() => validateDefaultProvider("fopenai", ["openai"])).toThrow(
      /Unknown provider "fopenai"/,
    );
  });

  it("error message lists known presets and builtins", () => {
    let caught: Error | undefined;
    try {
      validateDefaultProvider("typo", ["openai"]);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    const msg = caught!.message;
    // Presets mentioned:
    expect(msg).toContain("moonshot");
    expect(msg).toContain("zai");
    expect(msg).toContain("xai");
    // Builtins mentioned:
    expect(msg).toContain("openai");
    expect(msg).toContain("anthropic");
    expect(msg).toContain("google");
    expect(msg).toContain("ollama");
  });

  it("handles an empty registered list (no providers configured)", () => {
    expect(() => validateDefaultProvider("nosuchprovider", [])).toThrow(
      /Unknown provider "nosuchprovider"/,
    );
  });

  it("throws a preset-specific message when defaultProvider is a known preset but not registered", () => {
    let caught: Error | undefined;
    try {
      validateDefaultProvider("moonshot", ["openai"]);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("Preset \"moonshot\"");
    expect(caught!.message).toContain("MOONSHOT_API_KEY");
    // Should NOT list all presets/builtins — the problem is specific.
    expect(caught!.message).not.toContain("Known presets:");
  });

  it("throws a builtin-specific message when defaultProvider is a known builtin but not registered", () => {
    let caught: Error | undefined;
    try {
      validateDefaultProvider("anthropic", ["openai"]);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("Builtin provider \"anthropic\"");
    expect(caught!.message).toContain("ANTHROPIC_API_KEY");
  });
});

describe("buildRegistry end-to-end from preset-synthesized config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("constructs an OpenAICompatibleProvider for a preset-named default", () => {
    process.env.VISION_DEFAULT_PROVIDER = "moonshot";
    process.env.MOONSHOT_API_KEY = "sk-test";
    const config = loadConfig([]);
    const registry = buildRegistry(config);

    expect(registry.listProviders()).toContain("moonshot");
    const provider = registry.getProvider("moonshot");
    // The wrapped provider's name is preserved from the underlying provider.
    expect(provider.name).toBe("moonshot");
    // Sanity: the provider supports standard image formats (inherited from OpenAIProvider).
    expect(provider.supportedFormats).toContain("image/png");
  });
});
