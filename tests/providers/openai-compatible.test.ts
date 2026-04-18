import { describe, it, expect, vi } from "vitest";
import { OpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import type { ImageInput } from "../../src/types.js";

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "DeepSeek description" } }],
          }),
        },
      };
      constructor(public opts: Record<string, unknown>) {}
    },
  };
});

describe("OpenAICompatibleProvider", () => {
  const provider = new OpenAICompatibleProvider("deepseek", {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-vl2",
  });

  it("has custom name", () => {
    expect(provider.name).toBe("deepseek");
  });

  it("returns description", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result.text).toBe("DeepSeek description");
  });
});
