import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "../../src/providers/anthropic.js";
import type { ImageInput } from "../../src/types.js";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "A friendly dog" }],
    usage: { input_tokens: 200, output_tokens: 25 },
  }),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

describe("AnthropicProvider", () => {
  beforeEach(() => mockCreate.mockClear());

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
    expect(result.text).toBe("A friendly dog");
  });

  it("maps SDK usage to VisionResult.usage", async () => {
    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    const input: ImageInput = {
      data: Buffer.from("fake"),
      mimeType: "image/png",
      originalSource: "t.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 25, totalTokens: 225 });
  });

  it("returns usage: undefined when SDK response lacks usage", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "no usage" }],
    });
    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    const input: ImageInput = {
      data: Buffer.from("fake"),
      mimeType: "image/png",
      originalSource: "t.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result.usage).toBeUndefined();
  });
});
