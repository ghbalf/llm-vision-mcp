import { describe, it, expect, vi } from "vitest";
import { GoogleProvider } from "../../src/providers/google.js";
import type { ImageInput } from "../../src/types.js";

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class MockGoogleAI {
      getGenerativeModel() {
        return {
          generateContent: vi.fn().mockResolvedValue({
            response: {
              text: () => "A chart showing revenue growth",
            },
          }),
        };
      }
      constructor(public apiKey: string) {}
    },
  };
});

describe("GoogleProvider", () => {
  const provider = new GoogleProvider({ apiKey: "test-key" });

  it("has correct name", () => {
    expect(provider.name).toBe("google");
  });

  it("supports standard image formats", () => {
    expect(provider.supportedFormats).toContain("image/png");
    expect(provider.supportedFormats).toContain("image/jpeg");
    expect(provider.supportedFormats).toContain("image/webp");
  });

  it("returns description from vision model", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result).toBe("A chart showing revenue growth");
  });
});
