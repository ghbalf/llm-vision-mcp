import { describe, it, expect, vi } from "vitest";
import { handleDescribeImage, handleDescribeImages } from "../src/server.js";
import type { VisionProvider, ImageInput, DescribeOptions } from "../src/types.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { DEFAULT_PREPROCESSING } from "../src/types.js";

function makeFakeProvider(name: string, response: string): VisionProvider {
  return {
    name,
    supportedFormats: ["image/png", "image/jpeg"],
    describeImage: vi.fn().mockResolvedValue({ text: response }),
  };
}

describe("handleDescribeImage", () => {
  it("returns text content from provider", async () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai", "A beautiful sunset"));

    const result = await handleDescribeImage(
      { image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==" },
      registry,
      DEFAULT_PREPROCESSING,
    );

    expect(result.content[0]).toEqual({ type: "text", text: "A beautiful sunset" });
  });

  it("returns error for invalid image", async () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai", ""));

    const result = await handleDescribeImage(
      { image: "/nonexistent/path.png" },
      registry,
      DEFAULT_PREPROCESSING,
    );

    expect(result.isError).toBe(true);
  });

  it("uses specified provider", async () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai", "OpenAI response"));
    registry.register(makeFakeProvider("anthropic", "Anthropic response"));

    const result = await handleDescribeImage(
      {
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        provider: "anthropic",
      },
      registry,
      DEFAULT_PREPROCESSING,
    );

    expect(result.content[0]).toEqual({ type: "text", text: "Anthropic response" });
  });
});

function makeProviderWithUsage(name: string, text: string, usage?: { inputTokens: number; outputTokens: number; totalTokens: number }): VisionProvider {
  return {
    name,
    supportedFormats: ["image/png", "image/jpeg"],
    describeImage: vi.fn().mockResolvedValue({ text, usage }),
  };
}

describe("handleDescribeImage usage content block", () => {
  const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

  it("appends a usage content block when usage present", async () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeProviderWithUsage("openai", "hello", { inputTokens: 10, outputTokens: 5, totalTokens: 15 }));
    const result = await handleDescribeImage({ image: DATA_URL }, registry, DEFAULT_PREPROCESSING);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: "text", text: "hello" });
    expect(result.content[1]).toEqual({ type: "text", text: "Usage: 10 in / 5 out / 15 total tokens" });
  });

  it("omits the usage block when usage is undefined", async () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeProviderWithUsage("openai", "hello"));
    const result = await handleDescribeImage({ image: DATA_URL }, registry, DEFAULT_PREPROCESSING);
    expect(result.content).toHaveLength(1);
  });
});

describe("handleDescribeImages", () => {
  const DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

  it("returns JSON summary in a single content block", async () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai", "hello"));
    const result = await handleDescribeImages(
      { items: [{ image: DATA_URL }, { image: DATA_URL }] },
      registry,
      DEFAULT_PREPROCESSING,
      { concurrency: 2 },
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const payload = JSON.parse(result.content[0].text);
    expect(payload.summary).toEqual({ succeeded: 2, failed: 0 });
    expect(payload.results).toHaveLength(2);
  });

  it("includes totalUsage in JSON when providers report usage", async () => {
    const registry = new ProviderRegistry("openai");
    registry.register(
      makeProviderWithUsage("openai", "ok", { inputTokens: 50, outputTokens: 10, totalTokens: 60 }),
    );
    const result = await handleDescribeImages(
      { items: [{ image: DATA_URL }, { image: DATA_URL }] },
      registry,
      DEFAULT_PREPROCESSING,
      { concurrency: 2 },
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.totalUsage).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  });
});
