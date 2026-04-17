import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleProvider } from "../../src/providers/google.js";
import type { ImageInput } from "../../src/types.js";

const { mockGenerateContent, mockGetGenerativeModel } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn().mockResolvedValue({
    response: { text: () => "A chart showing revenue growth" },
  }),
  mockGetGenerativeModel: vi.fn(() => ({ generateContent: vi.fn() })),
}));

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class MockGoogleAI {
      constructor(public apiKey: string) {}
      getGenerativeModel(modelParams: unknown, requestOptions?: unknown) {
        mockGetGenerativeModel(modelParams, requestOptions);
        return { generateContent: mockGenerateContent };
      }
    },
  };
});

describe("GoogleProvider", () => {
  beforeEach(() => {
    mockGenerateContent.mockClear();
    mockGetGenerativeModel.mockClear();
  });

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

  it("passes configured timeout to the Google SDK via requestOptions", async () => {
    const timedProvider = new GoogleProvider({ apiKey: "test-key", timeout: 12345 });
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    await timedProvider.describeImage(input, {});

    const lastCall = mockGetGenerativeModel.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual({ timeout: 12345 });
  });

  it("omits requestOptions when no timeout configured", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    await provider.describeImage(input, {});

    const lastCall = mockGetGenerativeModel.mock.calls.at(-1);
    expect(lastCall?.[1]).toBeUndefined();
  });
});
