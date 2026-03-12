# LLM Vision MCP Server — Design Spec

## Purpose

An MCP server that bridges vision-capable LLMs with non-vision LLMs. It accepts images (file paths, URLs, or base64) and sends them to a configurable vision LLM provider, returning text descriptions that any LLM can consume.

## Requirements

- **Multi-provider support:** OpenAI, Anthropic, Google, Ollama, OpenAI-compatible (Chinese LLMs), and generic HTTP
- **Flexible image input:** File paths, URLs, and base64-encoded data
- **Image preprocessing:** Resize, compress, and format conversion based on provider constraints
- **Layered configuration:** `.env` files, environment variables, config file, and per-request overrides
- **Extensible:** Designed so adding new tools (OCR, chart analysis, image comparison) is straightforward

## Architecture

### Strategy Pattern

Each provider implements a `VisionProvider` interface. A `ProviderRegistry` maps provider names to instances. The MCP tool handler resolves the provider, preprocesses the image, and delegates.

```
MCP Tool → ImagePreprocessor → ProviderRegistry → VisionProvider
```

### Project Structure

```
llm-vision-mcp/
├── src/
│   ├── index.ts                  # Entry point, starts MCP server
│   ├── server.ts                 # Server setup, tool registration
│   ├── types.ts                  # Shared types & interfaces
│   ├── config.ts                 # Config loading (env + file)
│   ├── preprocessing/
│   │   └── image-preprocessor.ts # Resize, compress, format convert
│   └── providers/
│       ├── base.ts               # VisionProvider interface
│       ├── registry.ts           # Provider registry
│       ├── openai.ts
│       ├── anthropic.ts
│       ├── google.ts
│       ├── ollama.ts
│       ├── openai-compatible.ts  # DeepSeek, Qwen-VL, Together, etc.
│       └── generic-http.ts       # Raw HTTP escape hatch
├── .env.example
├── config.example.json
├── package.json
├── tsconfig.json
└── .gitignore
```

## Core Interface

```typescript
interface VisionProvider {
  name: string;
  supportedFormats: ImageFormat[];
  describeImage(input: ImageInput, options: DescribeOptions): Promise<string>;
}

interface ImageInput {
  data: Buffer;
  mimeType: string;
  originalSource: string;
}

interface DescribeOptions {
  prompt?: string;
  maxTokens?: number;
  model?: string;
}

type ImageFormat = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif";
```

Images are always normalized to `Buffer + mimeType` before reaching providers. Providers never deal with input format differences.

## Image Preprocessing Pipeline

Three stages in order:

1. **Input resolution** — Detect input type and resolve to `Buffer + mimeType`
2. **Format conversion** — Convert unsupported formats (e.g., WEBP → PNG) based on provider's `supportedFormats`
3. **Size optimization** — Resize and compress if image exceeds provider limits

### Input Type Detection

The `image` string is classified using this priority order:

1. **Base64 data URL** — Starts with `data:image/`. Extract mimeType from header, decode the base64 payload.
2. **Raw base64** — Does not contain `/` or `\` path separators, does not contain `.` (excludes file paths/URLs), and is at least 100 characters of valid base64 charset. After decoding, validate that the first bytes match known image magic bytes (PNG: `89504E47`, JPEG: `FFD8FF`, GIF: `47494638`, WEBP: `52494646`). If magic bytes don't match, fall through to file path detection.
3. **URL** — Starts with `http://` or `https://`. Fetch with a **30-second timeout** and **50MB download size limit**. Only `http:` and `https:` schemes are allowed (no `file://`). Detect mimeType from `Content-Type` header, falling back to magic bytes.
4. **File path** — Everything else. Resolve relative to CWD. Read from disk. Detect mimeType from file extension, falling back to magic bytes. No path sandboxing is applied — the MCP server runs with the permissions of its host process, and file access control is the host's responsibility (consistent with how MCP servers operate).

```typescript
interface PreprocessingOptions {
  maxWidth?: number;         // Default: 2048
  maxHeight?: number;        // Default: 2048
  maxFileSizeBytes?: number; // Default: 20MB
}
```

Uses **sharp** for image processing (native libvips bindings, handles all common formats).

Each provider declares its constraints (max dimensions, supported formats, max file size). The preprocessor adapts automatically — when a provider doesn't support the input format, it converts to PNG as the universal fallback.

### Default Prompt

When no `prompt` is provided in the tool call, providers use: **"Describe this image in detail."** This can be overridden per-provider in the config file via a `defaultPrompt` field.

## Provider Implementations

| Provider | SDK / Method | Default Model | Notes |
|---|---|---|---|
| OpenAI | `openai` npm package | `gpt-4o` | Images as base64 data URLs in message content |
| Anthropic | `@anthropic-ai/sdk` | `claude-sonnet-4-latest` | Images as base64 `source` blocks |
| Google | `@google/generative-ai` | `gemini-2.0-flash` | `inlineData` with base64 + mimeType |
| Ollama | HTTP to local API | `llava` | `POST /api/chat` with base64 `images` array |
| OpenAI-Compatible | OpenAI SDK with custom `baseURL` | User-configured | DeepSeek, Qwen-VL, Together, etc. |
| Generic HTTP | Raw `fetch` | N/A | User-defined URL, headers, request/response templates |

### OpenAI-Compatible Provider

Reuses the OpenAI provider logic with a configurable base URL and API key. Most Chinese LLM providers expose this exact interface.

### Generic HTTP Provider

Full escape hatch with template-based request construction:

```typescript
interface GenericHttpConfig {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  requestTemplate: object;   // JSON template with {{image}}, {{prompt}}, {{mimeType}} placeholders
  imageFormat: "base64" | "data-url"; // How {{image}} is interpolated (default: "base64"):
                                       // "base64" → raw base64 string
                                       // "data-url" → "data:image/png;base64,..."
  responsePath: string;       // Dot-notation path with numeric indices for arrays.
                               // e.g., "choices.0.message.content"
                               // NOT full JSONPath — just simple dot traversal.
                               // Returns empty string if path doesn't resolve.
}

// Template interpolation rules:
// - Placeholders ({{image}}, {{prompt}}, {{mimeType}}) are replaced anywhere they appear
//   as a JSON string value — including mid-string (e.g., "Bearer {{token}}").
// - Replacement is recursive through nested objects and arrays.
// - {{prompt}} resolves to the default prompt if none was provided in the tool call.
// - {{mimeType}} resolves to the image's MIME type (e.g., "image/png").
```

## MCP Tool

### `describe_image`

```typescript
{
  name: "describe_image",
  description: "Sends an image to a vision-capable LLM and returns a text description",
  inputSchema: {
    type: "object",
    properties: {
      image: {
        type: "string",
        description: "File path, URL, or base64-encoded image data"
      },
      prompt: {
        type: "string",
        description: "Optional instruction for the vision model"
      },
      provider: {
        type: "string",
        description: "Vision provider to use. If omitted, uses the configured default"
      },
      model: {
        type: "string",
        description: "Override the provider's default model"
      }
    },
    required: ["image"]
  }
}
```

Designed so additional tools (`extract_text`, `analyze_chart`, `compare_images`) can be added later by registering new tool handlers that reuse the same provider/preprocessing infrastructure.

## Configuration

### Loading Order (later overrides earlier)

1. `.env` file (loaded via `dotenv` at startup)
2. Environment variables (override `.env`)
3. CLI arguments (override env vars)
4. Config file `vision-config.json` (with `${ENV_VAR}` interpolation)
5. Per-request overrides (provider/model params on tool calls)

### CLI Arguments

For simple single-provider setups, the server can be fully configured via command line flags — no files needed.

```
--provider <name>              Default provider (openai, anthropic, google, ollama)
--openai-api-key <key>         OpenAI API key
--anthropic-api-key <key>      Anthropic API key
--google-api-key <key>         Google API key
--ollama-base-url <url>        Ollama base URL (default: http://localhost:11434)
--ollama-model <model>         Ollama model (default: llava)
--model <model>                Default model for the default provider
--config <path>                Path to config file (overrides VISION_CONFIG_PATH)
```

This is especially useful in MCP client manifests like Claude Desktop's config:

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": [
        "dist/index.js",
        "--provider", "openai",
        "--openai-api-key", "sk-..."
      ]
    }
  }
}
```

CLI args are parsed with Node.js built-in `util.parseArgs` (no extra dependency needed).

### Environment Variables

```
VISION_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llava
VISION_CONFIG_PATH=./vision-config.json  # Resolved relative to CWD of the MCP server process
```

### Config File (`vision-config.json`)

```json
{
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "gpt-4o"
    },
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    },
    "google": {
      "apiKey": "${GOOGLE_API_KEY}"
    },
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "model": "llava"
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

Config file supports `${ENV_VAR}` interpolation so API keys never live in the file. For simple setups, CLI args or a `.env` file are sufficient; the config file is only needed for advanced multi-provider configurations.

### Provider Type Resolution in Config File

When loading providers from the config file:

- Built-in provider names (`openai`, `anthropic`, `google`, `ollama`) are recognized by key name — no `type` field needed.
- For custom entries, the `type` field is **required** and must be either `"openai-compatible"` or `"generic-http"`.
- If a key is not a built-in name and has no `type` field, the server logs a warning and skips that provider at startup.

## Error Handling

Structured MCP error responses for:

- **Provider authentication failures** — API key missing, invalid, or expired
- **Image too large** — Exceeds limits even after preprocessing
- **Unsupported image format** — Not a recognized image type
- **Network timeouts** — Provider or URL fetch took too long
- **Provider-specific errors** — Rate limits, content policy, model not found, etc.
- **Invalid configuration** — Missing API key, unknown provider name
- **Unknown provider requested** — Tool call specifies a provider not in the registry
- **Provider misconfigured** — Provider exists in config but is missing required fields (e.g., API key)

Each error includes a clear message the consuming LLM can relay to the user.

### Timeout Configuration

Default timeouts (configurable per-provider in config file):

- **Provider API calls:** 60 seconds (Ollama default: 120 seconds, since local models are slower)
- **URL image fetching:** 30 seconds
- Configurable via `timeout` field in provider config (in milliseconds): `{ "ollama": { "timeout": 180000 } }`

### Default `maxTokens`

When `maxTokens` is not specified in the tool call, providers use a default of **1024 tokens**. This can be overridden per-provider in the config file via a `maxTokens` field.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `openai` — OpenAI API client
- `@anthropic-ai/sdk` — Anthropic API client
- `@google/generative-ai` — Google Generative AI client
- `sharp` — Image preprocessing
- `dotenv` — `.env` file loading
- `typescript` — Language (dev dependency)

## Out of Scope (Future)

- Additional tools: `extract_text`, `analyze_chart`, `compare_images`
- Image caching / deduplication
- Streaming responses
- Batch image processing
- Provider fallback chains (try provider A, fall back to B on failure)
