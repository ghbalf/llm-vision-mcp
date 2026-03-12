import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { ImageInput, ImageFormat, PreprocessingOptions } from "../types.js";
import { URL_FETCH_TIMEOUT_MS } from "../types.js";

const MAX_URL_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50MB

const MAGIC_BYTES: Record<string, ImageFormat> = {
  "89504e47": "image/png",
  "ffd8ff": "image/jpeg",
  "47494638": "image/gif",
  "52494646": "image/webp",
};

function detectMimeFromBytes(data: Buffer): ImageFormat | undefined {
  const hex = data.subarray(0, 4).toString("hex").toLowerCase();
  for (const [magic, mime] of Object.entries(MAGIC_BYTES)) {
    if (hex.startsWith(magic)) return mime;
  }
  // AVIF uses ISOBMFF container: "ftyp" at offset 4, "avif" at offset 8
  if (data.length >= 12) {
    const ftyp = data.subarray(4, 8).toString("ascii");
    const brand = data.subarray(8, 12).toString("ascii");
    if (ftyp === "ftyp" && brand === "avif") return "image/avif";
  }
  return undefined;
}

const EXTENSION_MAP: Record<string, ImageFormat> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

function mimeFromExtension(filePath: string): ImageFormat | undefined {
  const ext = filePath.toLowerCase().match(/\.[a-z]+$/)?.[0];
  return ext ? EXTENSION_MAP[ext] : undefined;
}

export type InputType = "data-url" | "raw-base64" | "url" | "file";

export function detectInputType(image: string): InputType {
  if (image.startsWith("data:image/")) return "data-url";
  if (image.startsWith("http://") || image.startsWith("https://")) return "url";
  if (
    image.length >= 100 &&
    !image.includes("/") &&
    !image.includes("\\") &&
    !image.includes(".") &&
    /^[A-Za-z0-9+/=]+$/.test(image)
  ) {
    return "raw-base64";
  }
  return "file";
}

export async function resolveImage(image: string): Promise<ImageInput> {
  const type = detectInputType(image);

  switch (type) {
    case "data-url": {
      const match = image.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) throw new Error("Invalid data URL format");
      const mimeType = match[1] as ImageFormat;
      const data = Buffer.from(match[2], "base64");
      return { data, mimeType, originalSource: "data-url" };
    }

    case "raw-base64": {
      const data = Buffer.from(image, "base64");
      const mimeType = detectMimeFromBytes(data);
      if (!mimeType) {
        return resolveFilePath(image);
      }
      return { data, mimeType, originalSource: "base64" };
    }

    case "url": {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(image, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching image: ${image}`);

        // Early size check from Content-Length header
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_URL_DOWNLOAD_BYTES) {
          throw new Error(`Image too large: ${contentLength} bytes (max 50MB)`);
        }

        // Stream with size limit to protect against missing/lying Content-Length
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        const reader = response.body?.getReader();
        if (!reader) throw new Error(`No response body from URL: ${image}`);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_URL_DOWNLOAD_BYTES) {
            reader.cancel();
            throw new Error(`Image too large: exceeded 50MB during download`);
          }
          chunks.push(value);
        }

        const data = Buffer.concat(chunks);

        const contentType = response.headers.get("content-type");
        let mimeType: ImageFormat | undefined;
        if (contentType && contentType.startsWith("image/")) {
          mimeType = contentType.split(";")[0].trim() as ImageFormat;
        }
        mimeType ??= detectMimeFromBytes(data);
        if (!mimeType) throw new Error(`Could not determine image type from URL: ${image}`);

        return { data, mimeType, originalSource: image };
      } finally {
        clearTimeout(timeout);
      }
    }

    case "file":
      return resolveFilePath(image);
  }
}

async function resolveFilePath(filePath: string): Promise<ImageInput> {
  const resolved = resolve(filePath);
  const data = await readFile(resolved);
  const mimeType = mimeFromExtension(resolved) ?? detectMimeFromBytes(data);
  if (!mimeType) throw new Error(`Could not determine image type: ${resolved}`);
  return { data, mimeType, originalSource: resolved };
}

export async function preprocessImage(
  input: ImageInput,
  supportedFormats: ImageFormat[],
  options: PreprocessingOptions,
): Promise<ImageInput> {
  let { data, mimeType } = input;
  let pipeline = sharp(data);

  // Read metadata from the same pipeline instance (avoids decoding twice)
  const metadata = await pipeline.metadata();
  const { width = 0, height = 0 } = metadata;

  // Stage 1: Format conversion if needed
  if (!supportedFormats.includes(mimeType)) {
    // Re-create pipeline since metadata() consumed it
    pipeline = sharp(data).png();
    mimeType = "image/png";
  }

  if (width > options.maxWidth || height > options.maxHeight) {
    pipeline = pipeline.resize(options.maxWidth, options.maxHeight, { fit: "inside" });
  }

  data = await pipeline.toBuffer();

  // Stage 3: Compress if still too large
  if (data.length > options.maxFileSizeBytes) {
    for (const quality of [80, 60, 40, 20]) {
      data = await sharp(data).jpeg({ quality }).toBuffer();
      mimeType = "image/jpeg";
      if (data.length <= options.maxFileSizeBytes) break;
    }
    if (data.length > options.maxFileSizeBytes) {
      throw new Error(
        `Image still too large after compression: ${data.length} bytes (max ${options.maxFileSizeBytes})`,
      );
    }
  }

  return { data, mimeType, originalSource: input.originalSource };
}
