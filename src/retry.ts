import type { RetryConfig } from "./types.js";
import { DEFAULT_RETRY } from "./types.js";

export { DEFAULT_RETRY };

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

function getStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const direct = (err as { status?: unknown }).status;
  if (typeof direct === "number") return direct;
  const nested = (err as { response?: { status?: unknown } }).response?.status;
  if (typeof nested === "number") return nested;
  return undefined;
}

function isNetworkError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return true;
  const name = (err as { name?: unknown }).name;
  if (name === "AbortError") return true;
  if (err instanceof TypeError && /fetch failed|network/i.test((err as Error).message)) return true;
  return false;
}

export function isRetryable(err: unknown): boolean {
  const status = getStatus(err);
  if (status !== undefined) {
    return status === 429 || (status >= 500 && status < 600);
  }
  return isNetworkError(err);
}

function getRetryAfterMs(err: unknown, maxDelayMs: number): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const headers =
    (err as { headers?: Record<string, string> }).headers ??
    (err as { response?: { headers?: Record<string, string> } }).response?.headers;
  if (!headers) return undefined;
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(Math.round(seconds * 1000), maxDelayMs);
}

function computeBackoff(attempt: number, config: RetryConfig): number {
  const base = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
  const jitter = 1 + (Math.random() * 2 - 1) * config.jitterFactor;
  return Math.max(0, Math.round(base * jitter));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === config.maxAttempts || !isRetryable(err)) throw err;
      const retryAfter = getRetryAfterMs(err, config.maxDelayMs);
      const delayMs = retryAfter ?? computeBackoff(attempt, config);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
