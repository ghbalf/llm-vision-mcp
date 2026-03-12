import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "../../src/providers/anthropic.js";
import type { ImageInput } from "../../src/types.js";

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "A landscape with mountains" }],
        }),
      };
      constructor(public opts: Record<string, unknown>) {}
    },
  };
});

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider({ apiKey: "sk-ant-test" });

  it("has correct name", () => {
    expect(provider.name).toBe("anthropic");
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
    expect(result).toBe("A landscape with mountains");
  });
});
