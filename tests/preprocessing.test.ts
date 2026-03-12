import { describe, it, expect } from "vitest";
import { detectInputType, resolveImage, preprocessImage } from "../src/preprocessing/image-preprocessor.js";

describe("detectInputType", () => {
  it("detects data URL", () => {
    expect(detectInputType("data:image/png;base64,iVBOR...")).toBe("data-url");
  });

  it("detects http URL", () => {
    expect(detectInputType("https://example.com/img.png")).toBe("url");
  });

  it("detects file path", () => {
    expect(detectInputType("/home/user/photo.png")).toBe("file");
  });

  it("detects relative file path", () => {
    expect(detectInputType("./images/photo.jpg")).toBe("file");
  });

  it("detects file path with dots and slashes (not base64)", () => {
    expect(detectInputType("images/my.photo.png")).toBe("file");
  });
});

describe("resolveImage", () => {
  it("resolves data URL to buffer and mimeType", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const result = await resolveImage(dataUrl);
    expect(result.mimeType).toBe("image/png");
    expect(result.originalSource).toBe("data-url");
    expect(Buffer.isBuffer(result.data)).toBe(true);
  });

  it("resolves local file to buffer", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sharp = (await import("sharp")).default;

    const dir = join(process.cwd(), "tests", "fixtures");
    mkdirSync(dir, { recursive: true });
    const fixturePath = join(dir, "test.png");
    const buf = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    writeFileSync(fixturePath, buf);

    const result = await resolveImage(fixturePath);
    expect(result.mimeType).toBe("image/png");
    expect(result.originalSource).toBe(fixturePath);
  });

  it("throws on nonexistent file", async () => {
    await expect(resolveImage("/nonexistent/file.png")).rejects.toThrow();
  });
});

describe("preprocessImage", () => {
  it("resizes image exceeding maxWidth", async () => {
    const sharp = (await import("sharp")).default;
    const bigBuf = await sharp({ create: { width: 4000, height: 2000, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    const input = { data: bigBuf, mimeType: "image/png" as const, originalSource: "test" };
    const result = await preprocessImage(input, ["image/png"], { maxWidth: 2048, maxHeight: 2048, maxFileSizeBytes: 20 * 1024 * 1024 });
    const meta = await sharp(result.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(2048);
  });

  it("converts unsupported format to PNG", async () => {
    const sharp = (await import("sharp")).default;
    const webpBuf = await sharp({ create: { width: 10, height: 10, channels: 3, background: "green" } })
      .webp()
      .toBuffer();
    const input = { data: webpBuf, mimeType: "image/webp" as const, originalSource: "test" };
    const result = await preprocessImage(input, ["image/png", "image/jpeg"], { maxWidth: 2048, maxHeight: 2048, maxFileSizeBytes: 20 * 1024 * 1024 });
    expect(result.mimeType).toBe("image/png");
  });
});
