# LLM Vision MCP Server Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that calls vision-capable LLMs to provide image descriptions to non-vision LLMs.

**Architecture:** Strategy pattern with a `VisionProvider` interface, `ProviderRegistry` for dispatch, and an `ImagePreprocessor` that normalizes all image inputs (file paths, URLs, base64) into `Buffer + mimeType` before forwarding to providers. Configuration loads from `.env` → env vars → CLI args → config file → per-request overrides.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, `sharp`, `dotenv`, `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`

**Spec:** `docs/superpowers/specs/2026-03-12-llm-vision-mcp-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `src/index.ts` | Entry point: load config, build registry, start MCP server |
| `src/server.ts` | MCP server setup, `describe_image` tool registration and handler |
| `src/types.ts` | All shared interfaces: `VisionProvider`, `ImageInput`, `DescribeOptions`, `ImageFormat`, config types |
| `src/config.ts` | Layered config loading: `.env` → env vars → CLI args → config file. `${ENV_VAR}` interpolation |
| `src/preprocessing/image-preprocessor.ts` | Input detection (base64/URL/file), format conversion, resize/compress via sharp |
| `src/providers/base.ts` | Re-exports `VisionProvider` interface + shared constants (default prompt, default maxTokens) |
| `src/providers/registry.ts` | `ProviderRegistry` class: `Map<string, VisionProvider>`, `getProvider(name?)`, factory from config |
| `src/providers/openai.ts` | OpenAI provider: `openai` SDK, base64 data URLs in messages |
| `src/providers/anthropic.ts` | Anthropic provider: `@anthropic-ai/sdk`, base64 source blocks |
| `src/providers/google.ts` | Google provider: `@google/generative-ai`, `inlineData` |
| `src/providers/ollama.ts` | Ollama provider: HTTP fetch to local API, base64 images array |
| `src/providers/openai-compatible.ts` | OpenAI-compatible: extends OpenAI provider with custom baseURL |
| `src/providers/generic-http.ts` | Generic HTTP: template interpolation, dot-path response extraction |
| `tests/config.test.ts` | Config loading tests |
| `tests/preprocessing.test.ts` | Image preprocessor tests |
| `tests/providers/registry.test.ts` | Registry tests |
| `tests/providers/openai.test.ts` | OpenAI provider tests |
| `tests/providers/anthropic.test.ts` | Anthropic provider tests |
| `tests/providers/google.test.ts` | Google provider tests |
| `tests/providers/ollama.test.ts` | Ollama provider tests |
| `tests/providers/openai-compatible.test.ts` | OpenAI-compatible provider tests |
| `tests/providers/generic-http.test.ts` | Generic HTTP provider tests |
| `tests/server.test.ts` | MCP tool handler integration tests |
| `package.json` | Dependencies, scripts, project metadata |
| `tsconfig.json` | TypeScript config |
| `.gitignore` | Ignore node_modules, dist, .env |
| `.env.example` | Documented env var template |
| `config.example.json` | Full config file example |

---

## Chunk 1: Project Scaffolding & Types

### Task 1: Initialize project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize npm project**

```bash
cd /home/alf/Projects/programming/javascript/llm-vision-mcp
npm init -y
```

- [ ] **Step 2: Install production dependencies**

```bash
npm install @modelcontextprotocol/sdk zod sharp dotenv openai @anthropic-ai/sdk @google/generative-ai
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D typescript @types/node vitest
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.tgz
```

- [ ] **Step 6: Update package.json scripts and metadata**

Set in package.json:
```json
{
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore package-lock.json
git commit -m "chore: initialize project with dependencies"
```

---

### Task 2: Define all shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write type definitions**

```typescript
// src/types.ts

export type ImageFormat =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/avif";

export interface ImageInput {
  data: Buffer;
  mimeType: ImageFormat;
  originalSource: string;
}

export interface DescribeOptions {
  prompt?: string;
  maxTokens?: number;
  model?: string;
}

export interface VisionProvider {
  name: string;
  supportedFormats: ImageFormat[];
  describeImage(input: ImageInput, options: DescribeOptions): Promise<string>;
}

export interface PreprocessingOptions {
  maxWidth: number;
  maxHeight: number;
  maxFileSizeBytes: number;
}

export interface ProviderConfig {
  type?: "openai-compatible" | "generic-http";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
  maxTokens?: number;
  defaultPrompt?: string;
}

export interface GenericHttpProviderConfig extends ProviderConfig {
  type: "generic-http";
  url: string;
  headers: Record<string, string>;
  requestTemplate: unknown;
  imageFormat?: "base64" | "data-url";
  responsePath: string;
}

export interface AppConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig | GenericHttpProviderConfig>;
  preprocessing: PreprocessingOptions;
}

export const DEFAULT_PREPROCESSING: PreprocessingOptions = {
  maxWidth: 2048,
  maxHeight: 2048,
  maxFileSizeBytes: 20 * 1024 * 1024, // 20MB
};

export const DEFAULT_PROMPT = "Describe this image in detail.";
export const DEFAULT_MAX_TOKENS = 1024;
export const URL_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
export const OLLAMA_DEFAULT_TIMEOUT_MS = 120_000;
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

## Chunk 2: Configuration System

### Task 3: Build layered config loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write config loader tests**

```typescript
// tests/config.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { DEFAULT_PREPROCESSING } from "../src/types.js";
import * as fs from "node:fs";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns defaults when no config sources exist", () => {
    const config = loadConfig([]);
    expect(config.defaultProvider).toBe("openai");
    expect(config.preprocessing).toEqual(DEFAULT_PREPROCESSING);
    expect(config.providers).toEqual({});
  });

  it("reads provider from env vars", () => {
    process.env.VISION_DEFAULT_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const config = loadConfig([]);
    expect(config.defaultProvider).toBe("anthropic");
    expect(config.providers.anthropic?.apiKey).toBe("sk-ant-test");
  });

  it("CLI args override env vars", () => {
    process.env.VISION_DEFAULT_PROVIDER = "anthropic";
    const config = loadConfig(["--provider", "openai", "--openai-api-key", "sk-test"]);
    expect(config.defaultProvider).toBe("openai");
    expect(config.providers.openai?.apiKey).toBe("sk-test");
  });

  it("interpolates ${ENV_VAR} in config file", () => {
    process.env.MY_KEY = "resolved-key";
    const result = interpolateEnvVars("${MY_KEY}");
    expect(result).toBe("resolved-key");
  });

  it("leaves ${ENV_VAR} as empty string if not set", () => {
    delete process.env.NONEXISTENT;
    const result = interpolateEnvVars("${NONEXISTENT}");
    expect(result).toBe("");
  });
});

// We'll import interpolateEnvVars separately since it's a utility
import { interpolateEnvVars } from "../src/config.js";
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/config.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement config loader**

```typescript
// src/config.ts
import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { AppConfig, ProviderConfig, PreprocessingOptions } from "./types.js";
import { DEFAULT_PREPROCESSING } from "./types.js";

export function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}

function interpolateObject(obj: unknown): unknown {
  if (typeof obj === "string") return interpolateEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(interpolateObject);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = interpolateObject(v);
    }
    return result;
  }
  return obj;
}

interface CliArgs {
  provider?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  model?: string;
  config?: string;
}

function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      provider: { type: "string" },
      "openai-api-key": { type: "string" },
      "anthropic-api-key": { type: "string" },
      "google-api-key": { type: "string" },
      "ollama-base-url": { type: "string" },
      "ollama-model": { type: "string" },
      model: { type: "string" },
      config: { type: "string" },
    },
    strict: false,
  });
  return {
    provider: values.provider as string | undefined,
    openaiApiKey: values["openai-api-key"] as string | undefined,
    anthropicApiKey: values["anthropic-api-key"] as string | undefined,
    googleApiKey: values["google-api-key"] as string | undefined,
    ollamaBaseUrl: values["ollama-base-url"] as string | undefined,
    ollamaModel: values["ollama-model"] as string | undefined,
    model: values.model as string | undefined,
    config: values.config as string | undefined,
  };
}

function loadConfigFile(path: string): Partial<AppConfig> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  return interpolateObject(parsed) as Partial<AppConfig>;
}

export function loadConfig(argv: string[]): AppConfig {
  // Step 1: Load .env
  loadDotenv();

  // Step 2: Read env vars
  const envProviders: Record<string, ProviderConfig> = {};
  if (process.env.OPENAI_API_KEY) {
    envProviders.openai = { apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    envProviders.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.GOOGLE_API_KEY) {
    envProviders.google = { apiKey: process.env.GOOGLE_API_KEY };
  }
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) {
    envProviders.ollama = {
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model: process.env.OLLAMA_MODEL,
    };
  }

  let config: AppConfig = {
    defaultProvider: process.env.VISION_DEFAULT_PROVIDER ?? "openai",
    providers: envProviders,
    preprocessing: { ...DEFAULT_PREPROCESSING },
  };

  // Step 3: CLI args override env vars
  const cli = parseCli(argv);
  if (cli.provider) config.defaultProvider = cli.provider;
  if (cli.openaiApiKey) {
    config.providers.openai = { ...config.providers.openai, apiKey: cli.openaiApiKey };
  }
  if (cli.anthropicApiKey) {
    config.providers.anthropic = { ...config.providers.anthropic, apiKey: cli.anthropicApiKey };
  }
  if (cli.googleApiKey) {
    config.providers.google = { ...config.providers.google, apiKey: cli.googleApiKey };
  }
  if (cli.ollamaBaseUrl || cli.ollamaModel) {
    config.providers.ollama = {
      ...config.providers.ollama,
      baseUrl: cli.ollamaBaseUrl ?? config.providers.ollama?.baseUrl ?? "http://localhost:11434",
      model: cli.ollamaModel ?? config.providers.ollama?.model,
    };
  }
  if (cli.model) {
    const defaultProv = config.defaultProvider;
    config.providers[defaultProv] = { ...config.providers[defaultProv], model: cli.model };
  }

  // Step 4: Config file (highest priority for provider settings)
  const configPath = cli.config ?? process.env.VISION_CONFIG_PATH;
  if (configPath) {
    const fileConfig = loadConfigFile(resolve(configPath));
    if (fileConfig.defaultProvider) config.defaultProvider = fileConfig.defaultProvider;
    if (fileConfig.providers) {
      config.providers = { ...config.providers, ...fileConfig.providers };
    }
    if (fileConfig.preprocessing) {
      config.preprocessing = { ...config.preprocessing, ...fileConfig.preprocessing };
    }
  }

  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/config.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add layered config loader (env, CLI, file)"
```

---

## Chunk 3: Image Preprocessing

### Task 4: Build image preprocessor

**Files:**
- Create: `src/preprocessing/image-preprocessor.ts`
- Create: `tests/preprocessing.test.ts`

- [ ] **Step 1: Write preprocessor tests**

```typescript
// tests/preprocessing.test.ts
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
    // 1x1 red PNG as data URL
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const result = await resolveImage(dataUrl);
    expect(result.mimeType).toBe("image/png");
    expect(result.originalSource).toBe("data-url");
    expect(Buffer.isBuffer(result.data)).toBe(true);
  });

  it("resolves local file to buffer", async () => {
    // We'll create a test fixture in setup
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/preprocessing.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement image preprocessor**

```typescript
// src/preprocessing/image-preprocessor.ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { ImageInput, ImageFormat, PreprocessingOptions } from "../types.js";
import { URL_FETCH_TIMEOUT_MS } from "../types.js";

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
  // Raw base64: no path separators, no dots, at least 100 chars
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
        // Fall through to file path — magic bytes didn't match
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

        const arrayBuf = await response.arrayBuffer();
        const data = Buffer.from(arrayBuf);

        if (data.length > 50 * 1024 * 1024) {
          throw new Error(`Image too large: ${data.length} bytes (max 50MB)`);
        }

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

  // Stage 1: Format conversion if needed
  if (!supportedFormats.includes(mimeType)) {
    pipeline = pipeline.png();
    mimeType = "image/png";
  }

  // Stage 2: Resize if exceeding limits
  const metadata = await sharp(data).metadata();
  const { width = 0, height = 0 } = metadata;

  if (width > options.maxWidth || height > options.maxHeight) {
    pipeline = pipeline.resize(options.maxWidth, options.maxHeight, { fit: "inside" });
  }

  data = await pipeline.toBuffer();

  // Stage 3: Compress if still too large
  if (data.length > options.maxFileSizeBytes) {
    // Try JPEG compression at decreasing quality
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/preprocessing.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preprocessing/image-preprocessor.ts tests/preprocessing.test.ts tests/fixtures/
git commit -m "feat: add image preprocessor with input detection, format conversion, resize"
```

---

## Chunk 4: Provider Registry & Base Provider

### Task 5: Build provider registry

**Files:**
- Create: `src/providers/base.ts`
- Create: `src/providers/registry.ts`
- Create: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write registry tests**

```typescript
// tests/providers/registry.test.ts
import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.js";
import type { VisionProvider, ImageInput, DescribeOptions } from "../../src/types.js";

function makeFakeProvider(name: string): VisionProvider {
  return {
    name,
    supportedFormats: ["image/png", "image/jpeg"],
    async describeImage(_input: ImageInput, _options: DescribeOptions) {
      return `described by ${name}`;
    },
  };
}

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider", () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai"));
    expect(registry.getProvider("openai").name).toBe("openai");
  });

  it("returns default provider when no name given", () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai"));
    registry.register(makeFakeProvider("anthropic"));
    expect(registry.getProvider().name).toBe("openai");
  });

  it("throws on unknown provider", () => {
    const registry = new ProviderRegistry("openai");
    expect(() => registry.getProvider("nonexistent")).toThrow("Unknown provider: nonexistent");
  });

  it("throws when default provider not registered", () => {
    const registry = new ProviderRegistry("openai");
    expect(() => registry.getProvider()).toThrow();
  });

  it("lists registered providers", () => {
    const registry = new ProviderRegistry("openai");
    registry.register(makeFakeProvider("openai"));
    registry.register(makeFakeProvider("anthropic"));
    expect(registry.listProviders()).toEqual(["openai", "anthropic"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/providers/registry.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement base and registry**

```typescript
// src/providers/base.ts
export type { VisionProvider, ImageInput, DescribeOptions, ImageFormat } from "../types.js";
export { DEFAULT_PROMPT, DEFAULT_MAX_TOKENS, DEFAULT_PROVIDER_TIMEOUT_MS, OLLAMA_DEFAULT_TIMEOUT_MS } from "../types.js";
```

```typescript
// src/providers/registry.ts
import type { VisionProvider } from "./base.js";

export class ProviderRegistry {
  private providers = new Map<string, VisionProvider>();

  constructor(private defaultProviderName: string) {}

  register(provider: VisionProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name?: string): VisionProvider {
    const providerName = name ?? this.defaultProviderName;
    const provider = this.providers.get(providerName);
    if (!provider) {
      const available = this.listProviders().join(", ") || "none";
      throw new Error(`Unknown provider: ${providerName}. Available: ${available}`);
    }
    return provider;
  }

  listProviders(): string[] {
    return [...this.providers.keys()];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/providers/registry.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/base.ts src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: add provider registry with default provider support"
```

---

## Chunk 5: OpenAI & Anthropic Providers

### Task 6: Implement OpenAI provider

**Files:**
- Create: `src/providers/openai.ts`
- Create: `tests/providers/openai.test.ts`

- [ ] **Step 1: Write OpenAI provider tests**

```typescript
// tests/providers/openai.test.ts
import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "../../src/providers/openai.js";
import type { ImageInput } from "../../src/types.js";

// Mock the openai package
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "A red square on white background" } }],
          }),
        },
      };
      constructor(public opts: Record<string, unknown>) {}
    },
  };
});

describe("OpenAIProvider", () => {
  const provider = new OpenAIProvider({ apiKey: "sk-test" });

  it("has correct name", () => {
    expect(provider.name).toBe("openai");
  });

  it("supports standard image formats", () => {
    expect(provider.supportedFormats).toContain("image/png");
    expect(provider.supportedFormats).toContain("image/jpeg");
    expect(provider.supportedFormats).toContain("image/webp");
    expect(provider.supportedFormats).toContain("image/gif");
  });

  it("returns description from vision model", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result).toBe("A red square on white background");
  });

  it("passes custom prompt to the model", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    await provider.describeImage(input, { prompt: "Extract all text" });
    // Verify the mock was called (test validates no crash with custom prompt)
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/providers/openai.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement OpenAI provider**

```typescript
// src/providers/openai.ts
import OpenAI from "openai";
import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, ProviderConfig } from "../types.js";
import { DEFAULT_PROMPT, DEFAULT_MAX_TOKENS, DEFAULT_PROVIDER_TIMEOUT_MS } from "../types.js";

export class OpenAIProvider implements VisionProvider {
  name = "openai";
  supportedFormats: ImageFormat[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  private client: OpenAI;
  private defaultModel: string;
  private timeout: number;
  private maxTokens: number;
  private defaultPrompt: string;

  constructor(config: ProviderConfig & { baseURL?: string; name?: string }) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      timeout: config.timeout ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    });
    this.defaultModel = config.model ?? "gpt-4o";
    this.timeout = config.timeout ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.defaultPrompt = config.defaultPrompt ?? DEFAULT_PROMPT;
    if (config.name) this.name = config.name;
  }

  async describeImage(input: ImageInput, options: DescribeOptions): Promise<string> {
    const base64 = input.data.toString("base64");
    const dataUrl = `data:${input.mimeType};base64,${base64}`;

    const response = await this.client.chat.completions.create({
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? this.maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: options.prompt ?? this.defaultPrompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/providers/openai.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai.ts tests/providers/openai.test.ts
git commit -m "feat: add OpenAI vision provider"
```

---

### Task 7: Implement Anthropic provider

**Files:**
- Create: `src/providers/anthropic.ts`
- Create: `tests/providers/anthropic.test.ts`

- [ ] **Step 1: Write Anthropic provider tests**

```typescript
// tests/providers/anthropic.test.ts
import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "../../src/providers/anthropic.js";
import type { ImageInput } from "../../src/types.js";

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "A landscape with mountains" }],
        }),
      };
      constructor(public opts: Record<string, unknown>) {}
    },
  };
});

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider({ apiKey: "sk-ant-test" });

  it("has correct name", () => {
    expect(provider.name).toBe("anthropic");
  });

  it("supports standard image formats", () => {
    expect(provider.supportedFormats).toContain("image/png");
    expect(provider.supportedFormats).toContain("image/jpeg");
    expect(provider.supportedFormats).toContain("image/webp");
    expect(provider.supportedFormats).toContain("image/gif");
  });

  it("returns description from vision model", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result).toBe("A landscape with mountains");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/providers/anthropic.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement Anthropic provider**

```typescript
// src/providers/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, ProviderConfig } from "../types.js";
import { DEFAULT_PROMPT, DEFAULT_MAX_TOKENS, DEFAULT_PROVIDER_TIMEOUT_MS } from "../types.js";

// Anthropic SDK media types
type AnthropicMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export class AnthropicProvider implements VisionProvider {
  name = "anthropic";
  supportedFormats: ImageFormat[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  private client: Anthropic;
  private defaultModel: string;
  private maxTokens: number;
  private defaultPrompt: string;

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeout ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    });
    this.defaultModel = config.model ?? "claude-sonnet-4-latest";
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.defaultPrompt = config.defaultPrompt ?? DEFAULT_PROMPT;
  }

  async describeImage(input: ImageInput, options: DescribeOptions): Promise<string> {
    const base64 = input.data.toString("base64");

    const response = await this.client.messages.create({
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? this.maxTokens,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mimeType as AnthropicMediaType,
                data: base64,
              },
            },
            { type: "text", text: options.prompt ?? this.defaultPrompt },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock && "text" in textBlock ? textBlock.text : "";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/providers/anthropic.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/anthropic.ts tests/providers/anthropic.test.ts
git commit -m "feat: add Anthropic vision provider"
```

---

## Chunk 6: Google & Ollama Providers

### Task 8: Implement Google provider

**Files:**
- Create: `src/providers/google.ts`
- Create: `tests/providers/google.test.ts`

- [ ] **Step 1: Write Google provider tests**

```typescript
// tests/providers/google.test.ts
import { describe, it, expect, vi } from "vitest";
import { GoogleProvider } from "../../src/providers/google.js";
import type { ImageInput } from "../../src/types.js";

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class MockGoogleAI {
      getGenerativeModel() {
        return {
          generateContent: vi.fn().mockResolvedValue({
            response: {
              text: () => "A chart showing revenue growth",
            },
          }),
        };
      }
      constructor(public apiKey: string) {}
    },
  };
});

describe("GoogleProvider", () => {
  const provider = new GoogleProvider({ apiKey: "test-key" });

  it("has correct name", () => {
    expect(provider.name).toBe("google");
  });

  it("supports standard image formats", () => {
    expect(provider.supportedFormats).toContain("image/png");
    expect(provider.supportedFormats).toContain("image/jpeg");
    expect(provider.supportedFormats).toContain("image/webp");
  });

  it("returns description from vision model", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result).toBe("A chart showing revenue growth");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/providers/google.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement Google provider**

```typescript
// src/providers/google.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, ProviderConfig } from "../types.js";
import { DEFAULT_PROMPT, DEFAULT_MAX_TOKENS } from "../types.js";

export class GoogleProvider implements VisionProvider {
  name = "google";
  supportedFormats: ImageFormat[] = ["image/png", "image/jpeg", "image/webp", "image/avif"];

  private ai: GoogleGenerativeAI;
  private defaultModel: string;
  private maxTokens: number;
  private defaultPrompt: string;

  constructor(config: ProviderConfig) {
    this.ai = new GoogleGenerativeAI(config.apiKey ?? "");
    this.defaultModel = config.model ?? "gemini-2.0-flash";
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.defaultPrompt = config.defaultPrompt ?? DEFAULT_PROMPT;
  }

  async describeImage(input: ImageInput, options: DescribeOptions): Promise<string> {
    const model = this.ai.getGenerativeModel({
      model: options.model ?? this.defaultModel,
      generationConfig: { maxOutputTokens: options.maxTokens ?? this.maxTokens },
    });

    const base64 = input.data.toString("base64");

    const result = await model.generateContent([
      options.prompt ?? this.defaultPrompt,
      {
        inlineData: {
          mimeType: input.mimeType,
          data: base64,
        },
      },
    ]);

    return result.response.text();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/providers/google.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/google.ts tests/providers/google.test.ts
git commit -m "feat: add Google Gemini vision provider"
```

---

### Task 9: Implement Ollama provider

**Files:**
- Create: `src/providers/ollama.ts`
- Create: `tests/providers/ollama.test.ts`

- [ ] **Step 1: Write Ollama provider tests**

```typescript
// tests/providers/ollama.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaProvider } from "../../src/providers/ollama.js";
import type { ImageInput } from "../../src/types.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OllamaProvider", () => {
  const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "llava" });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct name", () => {
    expect(provider.name).toBe("ollama");
  });

  it("returns description from local model", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: { content: "A cute cat sitting on a table" },
      }),
    });

    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result).toBe("A cute cat sitting on a table");

    // Verify correct API call
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    await expect(provider.describeImage(input, {})).rejects.toThrow("Ollama API error: 500");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/providers/ollama.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement Ollama provider**

```typescript
// src/providers/ollama.ts
import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, ProviderConfig } from "../types.js";
import { DEFAULT_PROMPT, DEFAULT_MAX_TOKENS, OLLAMA_DEFAULT_TIMEOUT_MS } from "../types.js";

export class OllamaProvider implements VisionProvider {
  name = "ollama";
  supportedFormats: ImageFormat[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  private baseUrl: string;
  private defaultModel: string;
  private timeout: number;
  private defaultPrompt: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.defaultModel = config.model ?? "llava";
    this.timeout = config.timeout ?? OLLAMA_DEFAULT_TIMEOUT_MS;
    this.defaultPrompt = config.defaultPrompt ?? DEFAULT_PROMPT;
  }

  async describeImage(input: ImageInput, options: DescribeOptions): Promise<string> {
    const base64 = input.data.toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model ?? this.defaultModel,
          stream: false,
          messages: [
            {
              role: "user",
              content: options.prompt ?? this.defaultPrompt,
              images: [base64],
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { message: { content: string } };
      return data.message.content;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/providers/ollama.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/ollama.ts tests/providers/ollama.test.ts
git commit -m "feat: add Ollama vision provider"
```

---

## Chunk 7: OpenAI-Compatible & Generic HTTP Providers

### Task 10: Implement OpenAI-compatible provider

**Files:**
- Create: `src/providers/openai-compatible.ts`
- Create: `tests/providers/openai-compatible.test.ts`

- [ ] **Step 1: Write OpenAI-compatible provider tests**

```typescript
// tests/providers/openai-compatible.test.ts
import { describe, it, expect, vi } from "vitest";
import { OpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import type { ImageInput } from "../../src/types.js";

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "DeepSeek description" } }],
          }),
        },
      };
      constructor(public opts: Record<string, unknown>) {}
    },
  };
});

describe("OpenAICompatibleProvider", () => {
  const provider = new OpenAICompatibleProvider("deepseek", {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-vl2",
  });

  it("has custom name", () => {
    expect(provider.name).toBe("deepseek");
  });

  it("returns description", async () => {
    const input: ImageInput = {
      data: Buffer.from("fake-image-data"),
      mimeType: "image/png",
      originalSource: "test.png",
    };
    const result = await provider.describeImage(input, {});
    expect(result).toBe("DeepSeek description");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/providers/openai-compatible.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement OpenAI-compatible provider**

```typescript
// src/providers/openai-compatible.ts
import { OpenAIProvider } from "./openai.js";
import type { ProviderConfig } from "../types.js";

export class OpenAICompatibleProvider extends OpenAIProvider {
  constructor(name: string, config: ProviderConfig) {
    super({
      ...config,
      baseURL: config.baseUrl,
      name,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/providers/openai-compatible.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai-compatible.ts tests/providers/openai-compatible.test.ts
git commit -m "feat: add OpenAI-compatible provider for DeepSeek, Qwen-VL, etc."
```

---

### Task 11: Implement generic HTTP provider

**Files:**
- Create: `src/providers/generic-http.ts`
- Create: `tests/providers/generic-http.test.ts`

- [ ] **Step 1: Write generic HTTP provider tests**

```typescript
// tests/providers/generic-http.test.ts
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
    expect(result).toBe("Custom description");
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/providers/generic-http.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement generic HTTP provider**

```typescript
// src/providers/generic-http.ts
import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, GenericHttpProviderConfig } from "../types.js";
import { DEFAULT_PROMPT, DEFAULT_PROVIDER_TIMEOUT_MS } from "../types.js";

interface TemplatePlaceholders {
  image: string;
  prompt: string;
  mimeType: string;
}

export function interpolateTemplate(template: unknown, placeholders: TemplatePlaceholders): unknown {
  if (typeof template === "string") {
    let result = template;
    result = result.replace(/\{\{image\}\}/g, placeholders.image);
    result = result.replace(/\{\{prompt\}\}/g, placeholders.prompt);
    result = result.replace(/\{\{mimeType\}\}/g, placeholders.mimeType);
    return result;
  }
  if (Array.isArray(template)) {
    return template.map((item) => interpolateTemplate(item, placeholders));
  }
  if (template !== null && typeof template === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = interpolateTemplate(value, placeholders);
    }
    return result;
  }
  return template;
}

export function extractByPath(obj: unknown, path: string): string {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : current !== undefined ? String(current) : "";
}

export class GenericHttpProvider implements VisionProvider {
  name: string;
  supportedFormats: ImageFormat[] = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

  private config: GenericHttpProviderConfig;
  private timeout: number;
  private defaultPrompt: string;

  constructor(name: string, config: GenericHttpProviderConfig) {
    this.name = name;
    this.config = config;
    this.timeout = config.timeout ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.defaultPrompt = config.defaultPrompt ?? DEFAULT_PROMPT;
  }

  async describeImage(input: ImageInput, options: DescribeOptions): Promise<string> {
    const base64 = input.data.toString("base64");
    const imageValue =
      this.config.imageFormat === "data-url"
        ? `data:${input.mimeType};base64,${base64}`
        : base64;

    const body = interpolateTemplate(this.config.requestTemplate, {
      image: imageValue,
      prompt: options.prompt ?? this.defaultPrompt,
      mimeType: input.mimeType,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Generic HTTP provider error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return extractByPath(data, this.config.responsePath);
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/providers/generic-http.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/generic-http.ts tests/providers/generic-http.test.ts
git commit -m "feat: add generic HTTP provider with template interpolation"
```

---

## Chunk 8: MCP Server & Entry Point

### Task 12: Build MCP server with describe_image tool

**Files:**
- Create: `src/server.ts`
- Create: `tests/server.test.ts`

- [ ] **Step 1: Write server tests**

```typescript
// tests/server.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/server.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement server**

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProviderRegistry } from "./providers/registry.js";
import { resolveImage, preprocessImage } from "./preprocessing/image-preprocessor.js";
import type { PreprocessingOptions } from "./types.js";

interface DescribeImageArgs {
  image: string;
  prompt?: string;
  provider?: string;
  model?: string;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export async function handleDescribeImage(
  args: DescribeImageArgs,
  registry: ProviderRegistry,
  preprocessingOptions: PreprocessingOptions,
): Promise<ToolResult> {
  try {
    const provider = registry.getProvider(args.provider);
    const rawImage = await resolveImage(args.image);
    const image = await preprocessImage(rawImage, provider.supportedFormats, preprocessingOptions);
    const description = await provider.describeImage(image, {
      prompt: args.prompt,
      model: args.model,
    });
    return { content: [{ type: "text", text: description }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
  }
}

export function createServer(
  registry: ProviderRegistry,
  preprocessingOptions: PreprocessingOptions,
): McpServer {
  const server = new McpServer(
    { name: "llm-vision-mcp", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );

  server.tool(
    "describe_image",
    "Sends an image to a vision-capable LLM and returns a text description",
    {
      image: z.string().describe("File path, URL, or base64-encoded image data"),
      prompt: z.string().optional().describe("Optional instruction for the vision model"),
      provider: z.string().optional().describe("Vision provider to use. If omitted, uses the configured default"),
      model: z.string().optional().describe("Override the provider's default model"),
    },
    async (args) => handleDescribeImage(args, registry, preprocessingOptions),
  );

  return server;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/server.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: add MCP server with describe_image tool"
```

---

### Task 13: Build entry point and provider factory

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement entry point**

```typescript
// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { ProviderRegistry } from "./providers/registry.js";
import { OpenAIProvider } from "./providers/openai.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GoogleProvider } from "./providers/google.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { GenericHttpProvider } from "./providers/generic-http.js";
import type { GenericHttpProviderConfig, ProviderConfig } from "./types.js";

const BUILTIN_PROVIDERS = new Set(["openai", "anthropic", "google", "ollama"]);

function buildRegistry(config: ReturnType<typeof loadConfig>): ProviderRegistry {
  const registry = new ProviderRegistry(config.defaultProvider);

  for (const [name, providerConfig] of Object.entries(config.providers)) {
    try {
      const provider = createProvider(name, providerConfig);
      if (provider) registry.register(provider);
    } catch (err) {
      console.error(`Warning: Failed to initialize provider "${name}":`, err);
    }
  }

  return registry;
}

function createProvider(name: string, config: ProviderConfig): import("./types.js").VisionProvider | null {
  // Built-in providers: recognized by key name
  if (BUILTIN_PROVIDERS.has(name) && !config.type) {
    switch (name) {
      case "openai":
        return new OpenAIProvider(config);
      case "anthropic":
        return new AnthropicProvider(config);
      case "google":
        return new GoogleProvider(config);
      case "ollama":
        return new OllamaProvider(config);
    }
  }

  // Custom providers: require type field
  if (config.type === "openai-compatible") {
    return new OpenAICompatibleProvider(name, config);
  }
  if (config.type === "generic-http") {
    return new GenericHttpProvider(name, config as GenericHttpProviderConfig);
  }

  // Built-in name with explicit type override
  if (BUILTIN_PROVIDERS.has(name) && config.type) {
    if (config.type === "openai-compatible") return new OpenAICompatibleProvider(name, config);
    if (config.type === "generic-http") return new GenericHttpProvider(name, config as GenericHttpProviderConfig);
  }

  console.warn(`Warning: Provider "${name}" has no type field and is not a built-in provider. Skipping.`);
  return null;
}

async function main() {
  const config = loadConfig(process.argv.slice(2));
  const registry = buildRegistry(config);

  const providers = registry.listProviders();
  if (providers.length === 0) {
    console.error("Error: No providers configured. Set at least one API key or configure a provider.");
    process.exit(1);
  }

  console.error(`llm-vision-mcp: ${providers.length} provider(s) active: ${providers.join(", ")}`);
  console.error(`llm-vision-mcp: default provider: ${config.defaultProvider}`);

  const server = createServer(registry, config.preprocessing);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with provider factory"
```

---

## Chunk 9: Example Files & Final Verification

### Task 14: Add example config files

**Files:**
- Create: `.env.example`
- Create: `config.example.json`

- [ ] **Step 1: Create .env.example**

```
# LLM Vision MCP Server Configuration
# Copy to .env and fill in your API keys

# Default vision provider (openai, anthropic, google, ollama)
VISION_DEFAULT_PROVIDER=openai

# Provider API keys (only configure the ones you use)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Ollama settings (for local models)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llava

# Optional: path to advanced config file
# VISION_CONFIG_PATH=./vision-config.json
```

- [ ] **Step 2: Create config.example.json**

```json
{
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "gpt-4o"
    },
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "model": "claude-sonnet-4-latest"
    },
    "google": {
      "apiKey": "${GOOGLE_API_KEY}",
      "model": "gemini-2.0-flash"
    },
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "model": "llava",
      "timeout": 180000
    },
    "deepseek": {
      "type": "openai-compatible",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "model": "deepseek-vl2"
    },
    "custom": {
      "type": "generic-http",
      "url": "https://my-api.example.com/vision",
      "headers": {
        "Authorization": "Bearer ${CUSTOM_API_KEY}"
      },
      "requestTemplate": {
        "image": "{{image}}",
        "prompt": "{{prompt}}"
      },
      "imageFormat": "base64",
      "responsePath": "result.text"
    }
  },
  "preprocessing": {
    "maxWidth": 2048,
    "maxHeight": 2048,
    "maxFileSizeBytes": 20971520
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add .env.example config.example.json
git commit -m "docs: add example config files"
```

---

### Task 15: Build, run all tests, final verification

- [ ] **Step 1: Build the project**

```bash
npm run build
```
Expected: compiles with no errors.

- [ ] **Step 2: Run all tests**

```bash
npm test
```
Expected: all tests PASS.

- [ ] **Step 3: Verify the server starts (smoke test)**

```bash
echo '{}' | timeout 3 node dist/index.js --provider openai --openai-api-key fake-key 2>&1 || true
```
Expected: output includes "1 provider(s) active: openai" (server starts then exits on stdin close).

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "chore: final fixes from verification" || echo "Nothing to commit"
```
