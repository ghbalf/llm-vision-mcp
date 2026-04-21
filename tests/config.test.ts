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

  describe("timeout flags and env vars", () => {
    it("reads VISION_TIMEOUT_MS into the default provider's timeout", () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.VISION_TIMEOUT_MS = "45000";
      const config = loadConfig([]);
      expect(config.providers.openai?.timeout).toBe(45000);
    });

    it("applies VISION_TIMEOUT_MS to the configured default provider, not openai by default", () => {
      process.env.VISION_DEFAULT_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.VISION_TIMEOUT_MS = "30000";
      const config = loadConfig([]);
      expect(config.providers.anthropic?.timeout).toBe(30000);
    });

    it("reads OLLAMA_TIMEOUT_MS into ollama's timeout", () => {
      process.env.OLLAMA_BASE_URL = "http://localhost:11434";
      process.env.OLLAMA_TIMEOUT_MS = "300000";
      const config = loadConfig([]);
      expect(config.providers.ollama?.timeout).toBe(300000);
    });

    it("creates an ollama entry when only OLLAMA_TIMEOUT_MS is set", () => {
      process.env.OLLAMA_TIMEOUT_MS = "300000";
      const config = loadConfig([]);
      expect(config.providers.ollama?.timeout).toBe(300000);
      expect(config.providers.ollama?.baseUrl).toBe("http://localhost:11434");
    });

    it("--timeout overrides VISION_TIMEOUT_MS", () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.VISION_TIMEOUT_MS = "45000";
      const config = loadConfig(["--timeout", "90000"]);
      expect(config.providers.openai?.timeout).toBe(90000);
    });

    it("--ollama-timeout overrides OLLAMA_TIMEOUT_MS", () => {
      process.env.OLLAMA_TIMEOUT_MS = "120000";
      const config = loadConfig(["--ollama-timeout", "600000"]);
      expect(config.providers.ollama?.timeout).toBe(600000);
    });

    it("ignores non-numeric timeout values", () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.VISION_TIMEOUT_MS = "not-a-number";
      const config = loadConfig([]);
      expect(config.providers.openai?.timeout).toBeUndefined();
    });
  });

  describe("generic CLI flags", () => {
    it("--api-key sets apiKey on the default provider", () => {
      process.env.VISION_DEFAULT_PROVIDER = "openai";
      const config = loadConfig(["--provider", "openai", "--api-key", "sk-test"]);
      expect(config.providers.openai?.apiKey).toBe("sk-test");
    });

    it("--base-url sets baseUrl on the default provider", () => {
      process.env.OPENAI_API_KEY = "sk-env";
      const config = loadConfig(["--base-url", "https://gateway.example.com/v1"]);
      expect(config.providers.openai?.baseUrl).toBe("https://gateway.example.com/v1");
    });

    it("--api-key applies after --provider is resolved", () => {
      process.env.VISION_DEFAULT_PROVIDER = "anthropic";
      const config = loadConfig(["--provider", "openai", "--api-key", "sk-openai"]);
      expect(config.defaultProvider).toBe("openai");
      expect(config.providers.openai?.apiKey).toBe("sk-openai");
      // Did not leak onto anthropic
      expect(config.providers.anthropic?.apiKey).toBeUndefined();
    });

    it("--api-key wins when both --openai-api-key and --api-key are passed", () => {
      const config = loadConfig([
        "--provider", "openai",
        "--openai-api-key", "sk-vendor-specific",
        "--api-key", "sk-generic-wins",
      ]);
      expect(config.providers.openai?.apiKey).toBe("sk-generic-wins");
    });
  });
});
