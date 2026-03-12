import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, interpolateEnvVars } from "../src/config.js";
import { DEFAULT_PREPROCESSING } from "../src/types.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns defaults when no config sources exist", () => {
    const config = loadConfig([]);
    expect(config.defaultProvider).toBe("openai");
    expect(config.preprocessing).toEqual(DEFAULT_PREPROCESSING);
    expect(config.providers).toEqual({});
  });

  it("reads provider from env vars", () => {
    process.env.VISION_DEFAULT_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const config = loadConfig([]);
    expect(config.defaultProvider).toBe("anthropic");
    expect(config.providers.anthropic?.apiKey).toBe("sk-ant-test");
  });

  it("CLI args override env vars", () => {
    process.env.VISION_DEFAULT_PROVIDER = "anthropic";
    const config = loadConfig(["--provider", "openai", "--openai-api-key", "sk-test"]);
    expect(config.defaultProvider).toBe("openai");
    expect(config.providers.openai?.apiKey).toBe("sk-test");
  });

  it("interpolates ${ENV_VAR} in config file", () => {
    process.env.MY_KEY = "resolved-key";
    const result = interpolateEnvVars("${MY_KEY}");
    expect(result).toBe("resolved-key");
  });

  it("leaves ${ENV_VAR} as empty string if not set", () => {
    delete process.env.NONEXISTENT;
    const result = interpolateEnvVars("${NONEXISTENT}");
    expect(result).toBe("");
  });
});
