import { describe, it, expect } from "vitest";
import { PRESETS, getPreset } from "../src/presets.js";

describe("PRESETS table", () => {
  it("includes the moonshot preset with the expected shape", () => {
    const preset = PRESETS.moonshot;
    expect(preset).toBeDefined();
    expect(preset.baseUrl).toBe("https://api.moonshot.ai/v1");
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
