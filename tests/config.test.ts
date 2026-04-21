import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, interpolateEnvVars } from "../src/config.js";
import { DEFAULT_PREPROCESSING } from "../src/types.js";

import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  describe("preset resolution (happy path)", () => {
    it("synthesizes an OpenAI-compatible provider entry from env vars when default is a preset name", () => {
      process.env.VISION_DEFAULT_PROVIDER = "moonshot";
      process.env.MOONSHOT_API_KEY = "sk-moonshot-test";
      const config = loadConfig([]);
      expect(config.providers.moonshot).toBeDefined();
      expect(config.providers.moonshot?.type).toBe("openai-compatible");
      expect(config.providers.moonshot?.apiKey).toBe("sk-moonshot-test");
      expect(config.providers.moonshot?.baseUrl).toBe("https://api.moonshot.ai/v1/");
      expect(config.providers.moonshot?.model).toBe("kimi-k2.5");
    });

    it("synthesizes a preset entry via CLI flags (--provider + --api-key)", () => {
      const config = loadConfig(["--provider", "moonshot", "--api-key", "sk-cli-test"]);
      expect(config.providers.moonshot?.apiKey).toBe("sk-cli-test");
      expect(config.providers.moonshot?.baseUrl).toBe("https://api.moonshot.ai/v1/");
      expect(config.providers.moonshot?.model).toBe("kimi-k2.5");
      expect(config.providers.moonshot?.type).toBe("openai-compatible");
    });

    it("no-ops when the default provider is not a preset name", () => {
      process.env.VISION_DEFAULT_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "sk-openai";
      const config = loadConfig([]);
      // openai is a builtin, not a preset — the helper should not synthesize
      // an openai-compatible entry here.
      expect(config.providers.openai?.type).toBeUndefined();
    });

    it("no-ops when the preset is named but no API key is available anywhere", () => {
      process.env.VISION_DEFAULT_PROVIDER = "moonshot";
      delete process.env.MOONSHOT_API_KEY;
      const config = loadConfig([]);
      expect(config.providers.moonshot).toBeUndefined();
    });

    it("preserves maxTokens, defaultPrompt, and other existing ProviderConfig fields when synthesizing", () => {
      // Scenario: user has a partial config file entry and MOONSHOT_API_KEY in env.
      // The helper fills baseUrl/model from the preset but must NOT drop fields
      // the file set (maxTokens, defaultPrompt, retry, concurrency, timeout).
      process.env.VISION_DEFAULT_PROVIDER = "moonshot";
      process.env.MOONSHOT_API_KEY = "sk-test";

      // Stage a pre-existing partial entry by way of the config file path. The
      // most direct way without a fixture is to invoke loadConfig via CLI flags
      // that land into providers.moonshot, then rely on the helper's spread.
      // Here we simulate by setting fields that CLI plumbing would set.
      // Since the CLI path only writes apiKey/baseUrl/model/timeout, we use
      // --timeout to seed a survival field, and assert timeout survives alongside
      // the synthesized baseUrl and model. For maxTokens/defaultPrompt which
      // don't have CLI flags, we write a temporary config file fixture.

      const dir = mkdtempSync(join(tmpdir(), "vision-preset-"));
      const cfgPath = join(dir, "vision-config.json");
      writeFileSync(
        cfgPath,
        JSON.stringify({
          providers: {
            moonshot: {
              maxTokens: 2048,
              defaultPrompt: "Describe terse.",
              retry: { maxAttempts: 5 },
              concurrency: 2,
            },
          },
        }),
      );

      try {
        const config = loadConfig(["--config", cfgPath]);
        expect(config.providers.moonshot?.apiKey).toBe("sk-test");
        expect(config.providers.moonshot?.baseUrl).toBe("https://api.moonshot.ai/v1/");
        expect(config.providers.moonshot?.model).toBe("kimi-k2.5");
        expect(config.providers.moonshot?.maxTokens).toBe(2048);
        expect(config.providers.moonshot?.defaultPrompt).toBe("Describe terse.");
        expect(config.providers.moonshot?.retry).toEqual({ maxAttempts: 5 });
        expect(config.providers.moonshot?.concurrency).toBe(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("preset resolution (env overrides)", () => {
    beforeEach(() => {
      process.env.VISION_DEFAULT_PROVIDER = "moonshot";
      process.env.MOONSHOT_API_KEY = "sk-test";
    });

    it("MOONSHOT_MODEL overrides the preset's default model", () => {
      process.env.MOONSHOT_MODEL = "kimi-k2.6";
      const config = loadConfig([]);
      expect(config.providers.moonshot?.model).toBe("kimi-k2.6");
    });

    it("MOONSHOT_BASE_URL overrides the preset's default base URL", () => {
      process.env.MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1";
      const config = loadConfig([]);
      expect(config.providers.moonshot?.baseUrl).toBe("https://api.moonshot.cn/v1");
    });

    it("--model beats MOONSHOT_MODEL", () => {
      // Both the env value and the CLI value are distinct from the preset
      // default (kimi-k2.5), so this test catches both "env wins over CLI"
      // regressions AND "preset always wins" regressions.
      process.env.MOONSHOT_MODEL = "kimi-k2.6";
      const config = loadConfig(["--model", "kimi-custom-vision"]);
      expect(config.providers.moonshot?.model).toBe("kimi-custom-vision");
    });

    it("--base-url beats MOONSHOT_BASE_URL", () => {
      process.env.MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1";
      const config = loadConfig(["--base-url", "https://gateway.example.com/v1"]);
      expect(config.providers.moonshot?.baseUrl).toBe("https://gateway.example.com/v1");
    });

    it("--api-key beats MOONSHOT_API_KEY", () => {
      const config = loadConfig(["--api-key", "sk-cli"]);
      expect(config.providers.moonshot?.apiKey).toBe("sk-cli");
    });
  });

  describe("preset resolution (file entry interaction)", () => {
    let configDir: string;
    let configPath: string;

    beforeEach(() => {
      configDir = mkdtempSync(join(tmpdir(), "vision-config-"));
      configPath = join(configDir, "vision-config.json");
      process.env.VISION_DEFAULT_PROVIDER = "moonshot";
      process.env.MOONSHOT_API_KEY = "sk-env-key";
    });

    afterEach(() => {
      rmSync(configDir, { recursive: true, force: true });
    });

    it("partial file entry (apiKey only) gets preset gaps filled in for baseUrl and model", () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          providers: {
            moonshot: { apiKey: "sk-file-key" },
          },
        }),
      );
      const config = loadConfig(["--config", configPath]);
      expect(config.providers.moonshot?.apiKey).toBe("sk-file-key");
      expect(config.providers.moonshot?.baseUrl).toBe("https://api.moonshot.ai/v1/");
      expect(config.providers.moonshot?.model).toBe("kimi-k2.5");
      expect(config.providers.moonshot?.type).toBe("openai-compatible");
    });

    it("full file entry wins on all its explicit fields", () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          providers: {
            moonshot: {
              type: "openai-compatible",
              apiKey: "sk-file-key",
              baseUrl: "https://custom.example.com/v1",
              model: "custom-model",
            },
          },
        }),
      );
      const config = loadConfig(["--config", configPath]);
      expect(config.providers.moonshot?.type).toBe("openai-compatible");
      expect(config.providers.moonshot?.apiKey).toBe("sk-file-key");
      expect(config.providers.moonshot?.baseUrl).toBe("https://custom.example.com/v1");
      expect(config.providers.moonshot?.model).toBe("custom-model");
    });

    it("file entry with type: generic-http under a preset name is respected (not clobbered)", () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          providers: {
            moonshot: {
              type: "generic-http",
              url: "https://custom.example.com/vision",
              headers: { "X-Custom": "yes" },
              requestTemplate: { image: "{{image}}", prompt: "{{prompt}}" },
              responsePath: "result.text",
            },
          },
        }),
      );
      const config = loadConfig(["--config", configPath]);
      // Helper must early-return on type !== "openai-compatible" and preserve
      // every generic-http field, not just the type marker.
      expect(config.providers.moonshot).toMatchObject({
        type: "generic-http",
        url: "https://custom.example.com/vision",
        headers: { "X-Custom": "yes" },
        requestTemplate: { image: "{{image}}", prompt: "{{prompt}}" },
        responsePath: "result.text",
      });
    });
  });
});
