import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaProvider } from "../../src/providers/ollama.js";
import type { ImageInput } from "../../src/types.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OllamaProvider", () => {
  const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "llava" });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct name", () => {
    expect(provider.name).toBe("ollama");
  });

  it("returns description from local model", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: { content: "A cute cat sitting on a table" },
      }),
    });

    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result.text).toBe("A cute cat sitting on a table");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps prompt_eval_count and eval_count to VisionResult.usage", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: { content: "described" },
        prompt_eval_count: 50,
        eval_count: 10,
      }),
    });
    const provider = new OllamaProvider({});
    const input: ImageInput = {
      data: Buffer.from("fake"),
      mimeType: "image/png",
      originalSource: "t.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 10, totalTokens: 60 });
  });

  it("returns usage: undefined when counts missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: { content: "no counts" } }),
    });
    const provider = new OllamaProvider({});
    const input: ImageInput = {
      data: Buffer.from("fake"),
      mimeType: "image/png",
      originalSource: "t.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result.usage).toBeUndefined();
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    await expect(provider.describeImage(input, {})).rejects.toThrow("Ollama API error: 500");
  });
});
