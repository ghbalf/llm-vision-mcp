import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, isRetryable, DEFAULT_RETRY } from "../src/retry.js";

describe("isRetryable", () => {
  it("retries 429", () => {
    expect(isRetryable({ status: 429 })).toBe(true);
  });
  it("retries 500/502/503/504", () => {
    for (const s of [500, 502, 503, 504]) {
      expect(isRetryable({ status: s })).toBe(true);
    }
  });
  it("does not retry 400/401/403/404", () => {
    for (const s of [400, 401, 403, 404]) {
      expect(isRetryable({ status: s })).toBe(false);
    }
  });
  it("retries on ECONNRESET", () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    expect(isRetryable(err)).toBe(true);
  });
  it("retries on AbortError (network abort)", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isRetryable(err)).toBe(true);
  });
  it("does not retry generic errors", () => {
    expect(isRetryable(new Error("something else"))).toBe(false);
  });
  it("reads .response.status", () => {
    expect(isRetryable({ response: { status: 503 } })).toBe(true);
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns first-attempt result without delay", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const p = withRetry(fn, DEFAULT_RETRY);
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429, resolves on attempt 2", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValue("ok");
    const p = withRetry(fn, { ...DEFAULT_RETRY, jitterFactor: 0 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry 400", async () => {
    const err = { status: 400, message: "bad" };
    const fn = vi.fn().mockRejectedValue(err);
    const p = withRetry(fn, DEFAULT_RETRY);
    await expect(p).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts maxAttempts and throws last error", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    const p = withRetry(fn, { ...DEFAULT_RETRY, jitterFactor: 0 });
    await vi.runAllTimersAsync();
    await expect(p).rejects.toEqual({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(DEFAULT_RETRY.maxAttempts);
  });

  it("honors Retry-After header (seconds)", async () => {
    const err = { status: 429, headers: { "retry-after": "2" } };
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok");
    const p = withRetry(fn, { ...DEFAULT_RETRY, jitterFactor: 0, maxDelayMs: 60_000 });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBe("ok");
  });

  it("clamps Retry-After to maxDelayMs", async () => {
    const err = { status: 429, headers: { "retry-after": "9999" } };
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok");
    const p = withRetry(fn, { ...DEFAULT_RETRY, jitterFactor: 0, maxDelayMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBe("ok");
  });
});
