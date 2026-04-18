import { describe, it, expect } from "vitest";
import { Semaphore } from "../src/batch.js";

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
