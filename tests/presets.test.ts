import { describe, it, expect } from "vitest";
import { PRESETS, getPreset } from "../src/presets.js";

describe("PRESETS table", () => {
  it("includes the moonshot preset with the expected shape", () => {
    const preset = PRESETS.moonshot;
    expect(preset).toBeDefined();
    expect(preset.baseUrl).toBe("https://api.moonshot.ai/v1/");
    expect(preset.defaultModel).toBe("kimi-k2.5");
    expect(preset.envKey).toBe("MOONSHOT_API_KEY");
    expect(preset.envModel).toBe("MOONSHOT_MODEL");
    expect(preset.envBaseUrl).toBe("MOONSHOT_BASE_URL");
  });

  it("getPreset returns undefined for unknown names", () => {
    expect(getPreset("not-a-preset")).toBeUndefined();
  });

  it("getPreset returns the entry for known names", () => {
    const preset = getPreset("moonshot");
    expect(preset?.envKey).toBe("MOONSHOT_API_KEY");
  });
});

describe("PRESETS structural invariants", () => {
  const EXPECTED_PRESET_NAMES = [
    "moonshot",
    "zai",
    "qwen",
    "nvidia",
    "groq",
    "together",
    "deepinfra",
    "xai",
  ];

  it("contains exactly the expected preset names", () => {
    const actual = Object.keys(PRESETS).sort();
    const expected = [...EXPECTED_PRESET_NAMES].sort();
    expect(actual).toEqual(expected);
  });

  it("every preset has all five required fields as non-empty strings", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      for (const field of ["baseUrl", "defaultModel", "envKey", "envModel", "envBaseUrl"] as const) {
        expect(typeof preset[field], `${name}.${field}`).toBe("string");
        expect(preset[field].length, `${name}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it("every preset baseUrl parses as a valid URL", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      expect(() => new URL(preset.baseUrl), `${name}.baseUrl`).not.toThrow();
    }
  });

  it("no two presets share the same envKey", () => {
    const keys = Object.values(PRESETS).map((p) => p.envKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("envModel and envBaseUrl share the same prefix as envKey", () => {
    // envKey = "MOONSHOT_API_KEY" -> prefix = "MOONSHOT"
    // Expect envModel = "MOONSHOT_MODEL", envBaseUrl = "MOONSHOT_BASE_URL"
    for (const [name, preset] of Object.entries(PRESETS)) {
      expect(preset.envKey, `${name}.envKey`).toMatch(/_API_KEY$/);
      const prefix = preset.envKey.replace(/_API_KEY$/, "");
      expect(preset.envModel, `${name}.envModel`).toBe(`${prefix}_MODEL`);
      expect(preset.envBaseUrl, `${name}.envBaseUrl`).toBe(`${prefix}_BASE_URL`);
    }
  });

  it("uses vendor-published SDK conventions for non-uniform envKey names", () => {
    // Alibaba/Qwen uses DASHSCOPE_* per their SDK convention.
    expect(PRESETS.qwen.envKey).toBe("DASHSCOPE_API_KEY");
    // Zhipu AI rebranded to Z.ai — use the new vendor name, not the old ZHIPUAI_*.
    expect(PRESETS.zai.envKey).toBe("ZAI_API_KEY");
  });
});
