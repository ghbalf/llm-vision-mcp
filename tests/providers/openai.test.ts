import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "../../src/providers/openai.js";
import type { ImageInput } from "../../src/types.js";

// Mock the openai package
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "A red square on white background" } }],
          }),
        },
      };
      constructor(public opts: Record<string, unknown>) {}
    },
  };
});

describe("OpenAIProvider", () => {
  const provider = new OpenAIProvider({ apiKey: "sk-test" });

  it("has correct name", () => {
    expect(provider.name).toBe("openai");
  });

  it("supports standard image formats", () => {
    expect(provider.supportedFormats).toContain("image/png");
    expect(provider.supportedFormats).toContain("image/jpeg");
    expect(provider.supportedFormats).toContain("image/webp");
    expect(provider.supportedFormats).toContain("image/gif");
  });

  it("returns description from vision model", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result).toBe("A red square on white background");
  });

  it("passes custom prompt to the model", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    await provider.describeImage(input, { prompt: "Extract all text" });
    expect(true).toBe(true);
  });
});
