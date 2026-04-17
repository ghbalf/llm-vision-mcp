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

  it("detects raw base64 for long base64-only string", () => {
    const b64 = "A".repeat(120);
    expect(detectInputType(b64)).toBe("raw-base64");
  });

  it("does not detect raw-base64 for short strings", () => {
    expect(detectInputType("AAAA")).toBe("file");
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

  it("resolves raw base64 PNG via magic-byte detection", async () => {
    // PNG magic (8 bytes) + zero padding. Encodes to 136 base64 chars with no '/' or '.',
    // so it satisfies detectInputType's raw-base64 rules. We're testing resolveImage's
    // magic-byte detection path, not full PNG decoding.
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(92),
    ]);
    const b64 = buf.toString("base64");

    expect(detectInputType(b64)).toBe("raw-base64");
    const result = await resolveImage(b64);
    expect(result.mimeType).toBe("image/png");
    expect(result.originalSource).toBe("base64");
    expect(Buffer.isBuffer(result.data)).toBe(true);
  });

  it("falls back to file path when raw-base64 has no valid magic bytes", async () => {
    // 100+ char pure-base64 string whose decoded bytes are "aaaa..." — not a known image format.
    const b64 = Buffer.from("a".repeat(100)).toString("base64");
    expect(detectInputType(b64)).toBe("raw-base64");
    await expect(resolveImage(b64)).rejects.toThrow();
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
