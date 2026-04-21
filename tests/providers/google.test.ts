import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIFetchError,
} from "@google/generative-ai";
import { GoogleProvider } from "../../src/providers/google.js";
import { isRetryable } from "../../src/retry.js";
import type { ImageInput } from "../../src/types.js";

const { mockGenerateContent, mockGetGenerativeModel } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn().mockResolvedValue({
    response: {
      text: () => "A chart showing revenue growth",
      usageMetadata: {
        promptTokenCount: 300,
        candidatesTokenCount: 42,
        totalTokenCount: 342,
      },
    },
  }),
  mockGetGenerativeModel: vi.fn(() => ({ generateContent: vi.fn() })),
}));

vi.mock("@google/generative-ai", async () => {
  const actual = await vi.importActual<typeof import("@google/generative-ai")>(
    "@google/generative-ai",
  );
  return {
    ...actual,
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
    expect(result.text).toBe("A chart showing revenue growth");
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

  it("maps usageMetadata to VisionResult.usage", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake"),
      mimeType: "image/png",
      originalSource: "t.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 42, totalTokens: 342 });
  });

  it("returns usage: undefined when usageMetadata missing", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => "no usage" },
    });
    const input: ImageInput = {
      data: Buffer.from("fake"),
      mimeType: "image/png",
      originalSource: "t.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result.usage).toBeUndefined();
  });

  describe("retry adapter", () => {
    const input: ImageInput = {
      data: Buffer.from("fake"),
      mimeType: "image/png",
      originalSource: "t.png",
    };

    it("translates GoogleGenerativeAIAbortError to an AbortError the retry wrapper recognizes", async () => {
      const abortErr = new GoogleGenerativeAIAbortError("timed out");
      mockGenerateContent.mockRejectedValueOnce(abortErr);

      let caught: unknown;
      try {
        await provider.describeImage(input, {});
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      expect((caught as Error).name).toBe("AbortError");
      expect(isRetryable(caught)).toBe(true);
      expect((caught as { cause?: unknown }).cause).toBe(abortErr);
    });

    it("passes GoogleGenerativeAIFetchError through unchanged (already has .status)", async () => {
      const fetchErr = new GoogleGenerativeAIFetchError(
        "rate limited",
        429,
        "Too Many Requests",
      );
      mockGenerateContent.mockRejectedValueOnce(fetchErr);

      let caught: unknown;
      try {
        await provider.describeImage(input, {});
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(fetchErr);
      expect(isRetryable(caught)).toBe(true);
    });

    it("does not translate non-Google errors", async () => {
      const generic = new Error("boom");
      mockGenerateContent.mockRejectedValueOnce(generic);

      let caught: unknown;
      try {
        await provider.describeImage(input, {});
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(generic);
    });
  });
});
