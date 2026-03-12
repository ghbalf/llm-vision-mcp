import { describe, it, expect, vi } from "vitest";
import { handleDescribeImage } from "../src/server.js";
import type { VisionProvider, ImageInput, DescribeOptions } from "../src/types.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { DEFAULT_PREPROCESSING } from "../src/types.js";

function makeFakeProvider(name: string, response: string): VisionProvider {
  return {
    name,
    supportedFormats: ["image/png", "image/jpeg"],
    describeImage: vi.fn().mockResolvedValue(response),
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
