import { describe, it, expect, vi } from "vitest";
import { Semaphore, describeImagesBatch } from "../src/batch.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { DEFAULT_PREPROCESSING } from "../src/types.js";
import type { VisionProvider } from "../src/types.js";

describe("Semaphore", () => {
  it("allows up to max concurrent runs", async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const work = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    };
    await Promise.all(Array.from({ length: 5 }, () => sem.run(work)));
    expect(peak).toBe(2);
  });

  it("returns the result of the wrapped function", async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => 42)).resolves.toBe(42);
  });

  it("releases the slot even when the function throws", async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // If the slot wasn't released, this would hang.
    await expect(sem.run(async () => "ok")).resolves.toBe("ok");
  });
});

const DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function makeProvider(name: string, impl: VisionProvider["describeImage"]): VisionProvider {
  return { name, supportedFormats: ["image/png", "image/jpeg"], describeImage: impl };
}

describe("describeImagesBatch", () => {
  it("describes multiple items and returns results with indices", async () => {
    const registry = new ProviderRegistry("p");
    registry.register(
      makeProvider("p", vi.fn(async (_i, o) => ({ text: `desc:${o.prompt}`, usage: undefined }))),
    );
    const result = await describeImagesBatch(
      {
        items: [
          { image: DATA_URL, prompt: "one" },
          { image: DATA_URL, prompt: "two" },
        ],
      },
      registry,
      DEFAULT_PREPROCESSING,
      { concurrency: 2 },
    );
    expect(result.summary).toEqual({ succeeded: 2, failed: 0 });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ index: 0, description: "desc:one" });
    expect(result.results[1]).toMatchObject({ index: 1, description: "desc:two" });
  });

  it("records partial failures without failing the whole batch", async () => {
    const registry = new ProviderRegistry("p");
    const impl = vi.fn(async (_i: unknown, o: { prompt?: string }) => {
      if (o.prompt === "bad") throw new Error("oh no");
      return { text: "ok", usage: undefined };
    });
    registry.register(makeProvider("p", impl));
    const result = await describeImagesBatch(
      {
        items: [
          { image: DATA_URL, prompt: "good" },
          { image: DATA_URL, prompt: "bad" },
          { image: DATA_URL, prompt: "good" },
        ],
      },
      registry,
      DEFAULT_PREPROCESSING,
      { concurrency: 1 },
    );
    expect(result.summary).toEqual({ succeeded: 2, failed: 1 });
    const failure = result.results.find((r) => "error" in r);
    expect(failure).toMatchObject({ index: 1, error: expect.stringContaining("oh no") });
  });

  it("aggregates totalUsage over successful items only", async () => {
    const registry = new ProviderRegistry("p");
    const impl = vi.fn(async (_i: unknown, o: { prompt?: string }) => {
      if (o.prompt === "bad") throw new Error("nope");
      return { text: "ok", usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } };
    });
    registry.register(makeProvider("p", impl));
    const result = await describeImagesBatch(
      {
        items: [
          { image: DATA_URL, prompt: "good" },
          { image: DATA_URL, prompt: "bad" },
          { image: DATA_URL, prompt: "good" },
        ],
      },
      registry,
      DEFAULT_PREPROCESSING,
      { concurrency: 2 },
    );
    expect(result.totalUsage).toEqual({ inputTokens: 200, outputTokens: 20, totalTokens: 220 });
  });

  it("resolves provider/prompt from item then batch then default", async () => {
    const registry = new ProviderRegistry("a");
    const aImpl = vi.fn(async (_i: unknown, o: { prompt?: string }) => ({ text: `A:${o.prompt}`, usage: undefined }));
    const bImpl = vi.fn(async (_i: unknown, o: { prompt?: string }) => ({ text: `B:${o.prompt}`, usage: undefined }));
    registry.register(makeProvider("a", aImpl));
    registry.register(makeProvider("b", bImpl));
    const result = await describeImagesBatch(
      {
        prompt: "batch-prompt",
        items: [
          { image: DATA_URL },
          { image: DATA_URL, provider: "b", prompt: "override" },
        ],
      },
      registry,
      DEFAULT_PREPROCESSING,
      { concurrency: 2 },
    );
    expect(result.results[0]).toMatchObject({ description: "A:batch-prompt" });
    expect(result.results[1]).toMatchObject({ description: "B:override" });
  });

  it("applies per-provider concurrency independently", async () => {
    const registry = new ProviderRegistry("a");
    let aRunning = 0, aPeak = 0;
    let bRunning = 0, bPeak = 0;
    registry.register(
      makeProvider("a", async () => {
        aRunning++;
        aPeak = Math.max(aPeak, aRunning);
        await new Promise((r) => setTimeout(r, 20));
        aRunning--;
        return { text: "a", usage: undefined };
      }),
    );
    registry.register(
      makeProvider("b", async () => {
        bRunning++;
        bPeak = Math.max(bPeak, bRunning);
        await new Promise((r) => setTimeout(r, 20));
        bRunning--;
        return { text: "b", usage: undefined };
      }),
    );
    await describeImagesBatch(
      {
        items: [
          { image: DATA_URL, provider: "a" },
          { image: DATA_URL, provider: "a" },
          { image: DATA_URL, provider: "a" },
          { image: DATA_URL, provider: "b" },
          { image: DATA_URL, provider: "b" },
        ],
      },
      registry,
      DEFAULT_PREPROCESSING,
      { concurrency: 2, perProviderConcurrency: { a: 2, b: 1 } },
    );
    expect(aPeak).toBe(2);
    expect(bPeak).toBe(1);
  });

  it("shares a semaphore for items using registry default and items naming default explicitly", async () => {
    const registry = new ProviderRegistry("p");
    let running = 0, peak = 0;
    registry.register(
      makeProvider("p", async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return { text: "ok", usage: undefined };
      }),
    );
    await describeImagesBatch(
      {
        items: [
          { image: DATA_URL, provider: "p" },
          { image: DATA_URL },
          { image: DATA_URL, provider: "p" },
          { image: DATA_URL },
        ],
      },
      registry,
      DEFAULT_PREPROCESSING,
      { concurrency: 2, perProviderConcurrency: { p: 1 } },
    );
    expect(peak).toBe(1);
  });
});
