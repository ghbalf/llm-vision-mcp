import { describe, it, expect, vi, beforeEach } from "vitest";
import { GenericHttpProvider, interpolateTemplate, extractByPath } from "../../src/providers/generic-http.js";
import type { ImageInput, GenericHttpProviderConfig } from "../../src/types.js";

describe("interpolateTemplate", () => {
  it("replaces {{image}} placeholder", () => {
    const template = { image: "{{image}}", prompt: "{{prompt}}" };
    const result = interpolateTemplate(template, {
      image: "base64data",
      prompt: "describe this",
      mimeType: "image/png",
    });
    expect(result).toEqual({ image: "base64data", prompt: "describe this" });
  });

  it("replaces mid-string placeholders", () => {
    const template = { header: "Image type: {{mimeType}}" };
    const result = interpolateTemplate(template, {
      image: "data",
      prompt: "describe",
      mimeType: "image/png",
    });
    expect(result).toEqual({ header: "Image type: image/png" });
  });

  it("handles nested objects", () => {
    const template = { outer: { inner: "{{prompt}}" } };
    const result = interpolateTemplate(template, {
      image: "data",
      prompt: "hello",
      mimeType: "image/png",
    });
    expect(result).toEqual({ outer: { inner: "hello" } });
  });

  it("handles arrays", () => {
    const template = { items: ["{{image}}", "{{prompt}}"] };
    const result = interpolateTemplate(template, {
      image: "data",
      prompt: "hello",
      mimeType: "image/png",
    });
    expect(result).toEqual({ items: ["data", "hello"] });
  });
});

describe("extractByPath", () => {
  it("extracts nested value", () => {
    const obj = { choices: [{ message: { content: "hello" } }] };
    expect(extractByPath(obj, "choices.0.message.content")).toBe("hello");
  });

  it("returns empty string for missing path", () => {
    expect(extractByPath({}, "a.b.c")).toBe("");
  });

  it("handles simple top-level key", () => {
    expect(extractByPath({ result: "ok" }, "result")).toBe("ok");
  });
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GenericHttpProvider", () => {
  const config: GenericHttpProviderConfig = {
    type: "generic-http",
    url: "https://api.example.com/vision",
    headers: { Authorization: "Bearer test" },
    requestTemplate: { image: "{{image}}", prompt: "{{prompt}}" },
    imageFormat: "base64",
    responsePath: "result.text",
  };

  const provider = new GenericHttpProvider("custom", config);

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has custom name", () => {
    expect(provider.name).toBe("custom");
  });

  it("sends request and extracts response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { text: "Custom description" } }),
    });

    const input: ImageInput = {
      data: Buffer.from("image-bytes"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, { prompt: "describe" });
    expect(result.text).toBe("Custom description");
  });

  it("throws on construction when url is missing", () => {
    const bad = { ...config, url: "" };
    expect(() => new GenericHttpProvider("bad", bad)).toThrow(/url/i);
  });

  it("throws on construction when responsePath is missing", () => {
    const bad = { ...config, responsePath: "" };
    expect(() => new GenericHttpProvider("bad", bad)).toThrow(/responsePath/i);
  });

  it("throws on construction when requestTemplate is null/undefined", () => {
    const bad = { ...config, requestTemplate: undefined };
    expect(() => new GenericHttpProvider("bad", bad)).toThrow(/requestTemplate/i);
  });

  it("uses data-url format when configured", async () => {
    const dataUrlConfig: GenericHttpProviderConfig = { ...config, imageFormat: "data-url" };
    const dataUrlProvider = new GenericHttpProvider("custom2", dataUrlConfig);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { text: "ok" } }),
    });

    const input: ImageInput = {
      data: Buffer.from("image-bytes"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    await dataUrlProvider.describeImage(input, {});

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.image).toMatch(/^data:image\/png;base64,/);
  });
});

describe("GenericHttpProvider usage", () => {
  const config: GenericHttpProviderConfig = {
    type: "generic-http",
    url: "https://api.example.com/vision",
    headers: { Authorization: "Bearer test" },
    requestTemplate: { image: "{{image}}", prompt: "{{prompt}}" },
    imageFormat: "base64",
    responsePath: "result.text",
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns usage: undefined when no usagePath configured", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { text: "ok" }, tokens: { total: 99 } }),
    });
    const p = new GenericHttpProvider("custom", config);
    const result = await p.describeImage(
      { data: Buffer.from("x"), mimeType: "image/png", originalSource: "t.png" },
      {},
    );
    expect(result.usage).toBeUndefined();
  });

  it("extracts totalTokens via usagePath", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { text: "ok" }, tokens: { total: 99 } }),
    });
    const p = new GenericHttpProvider("custom", { ...config, usagePath: "tokens.total" });
    const result = await p.describeImage(
      { data: Buffer.from("x"), mimeType: "image/png", originalSource: "t.png" },
      {},
    );
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 99 });
  });

  it("returns usage: undefined when usagePath is configured but field missing in response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { text: "ok" } }),
    });
    const p = new GenericHttpProvider("custom", { ...config, usagePath: "tokens.total" });
    const result = await p.describeImage(
      { data: Buffer.from("x"), mimeType: "image/png", originalSource: "t.png" },
      {},
    );
    expect(result.usage).toBeUndefined();
  });
});
