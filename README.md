# llm-vision-mcp

An MCP server that gives vision capabilities to any LLM. It accepts images (file paths, URLs, or base64) and sends them to a vision-capable LLM, returning text descriptions that non-vision LLMs can use.

## Providers

| Provider | Default Model | Use Case |
|---|---|---|
| **OpenAI** | gpt-4o | General-purpose vision |
| **Anthropic** | claude-sonnet-4-latest | Detailed image analysis |
| **Google** | gemini-2.0-flash | Fast, cost-effective vision |
| **Ollama** | llava | Local/private inference |
| **OpenAI-compatible** | User-configured | DeepSeek, Qwen-VL, Together, etc. |
| **Generic HTTP** | N/A | Any API with custom request/response mapping |

## Quick Start

```bash
npm install
npm run build
```

### Option 1: CLI arguments (simplest)

```bash
node dist/index.js --provider openai --openai-api-key sk-...
```

### Option 2: Environment variables

```bash
cp .env.example .env
# Edit .env with your API keys
node dist/index.js
```

### Option 3: Config file (multi-provider)

```bash
cp config.example.json vision-config.json
# Edit vision-config.json
VISION_CONFIG_PATH=./vision-config.json node dist/index.js
```

## MCP Client Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": [
        "/absolute/path/to/llm-vision-mcp/dist/index.js",
        "--provider", "openai",
        "--openai-api-key", "sk-..."
      ]
    }
  }
}
```

### Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": [
        "/absolute/path/to/llm-vision-mcp/dist/index.js",
        "--provider", "openai",
        "--openai-api-key", "sk-..."
      ]
    }
  }
}
```

## Prompt: `vision_instructions`

The server registers an MCP prompt called `vision_instructions` that teaches the LLM when and how to use the `describe_image` tool. MCP clients that support prompts can inject this into the LLM's context so it automatically calls the tool whenever it encounters image paths, URLs, or base64 data — rather than guessing what an image contains.

## Tool: `describe_image`

Sends an image to a vision LLM and returns a text description.

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `image` | Yes | File path, URL, or base64-encoded image data |
| `prompt` | No | Custom instruction (default: "Describe this image in detail.") |
| `provider` | No | Override the default provider |
| `model` | No | Override the provider's default model |

### Image Input Formats

- **File path**: `/home/user/photo.png` or `./images/chart.jpg`
- **URL**: `https://example.com/image.png`
- **Base64 data URL**: `data:image/png;base64,iVBOR...`
- **Raw base64**: Long base64 string (auto-detected)

### Examples

```
"Describe this screenshot" + image: "/tmp/screenshot.png"
"Extract all text from this image" + image: "https://example.com/document.png"
"What data does this chart show?" + image: "data:image/png;base64,..."
```

### Usage reporting

When the provider returns token counts, a second `text` content block is appended with `Usage: <in> in / <out> out / <total> total tokens`. Batch results (see `describe_images`) also include aggregated `totalUsage`.

## Tool: `describe_images`

Describes multiple images in a single batched call. Each item may override the batch-level `prompt`, `provider`, and `model`. Results come back in input order. Per-provider concurrency limits are honored.

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `items` | Yes | Array of 1–100 items, each with its own `image` and optional `prompt`/`provider`/`model` |
| `prompt` | No | Default prompt for items without their own |
| `provider` | No | Default provider for items without their own |
| `model` | No | Default model for items without their own |
| `concurrency` | No | Override the per-provider concurrency cap |

### Example call

```json
{
  "items": [
    { "image": "/tmp/a.png" },
    { "image": "https://example.com/b.png", "prompt": "Extract text" }
  ],
  "prompt": "Describe this image in detail."
}
```

### Sample result

```json
{
  "results": [
    { "index": 0, "text": "A cat sitting on a desk.", "usage": { "inputTokens": 812, "outputTokens": 17, "totalTokens": 829 } },
    { "index": 1, "text": "Invoice header reading 'ACME Corp'." }
  ],
  "totalUsage": { "inputTokens": 812, "outputTokens": 17, "totalTokens": 829 }
}
```

Failed items appear with an `error` field instead of `text`; the batch itself does not fail.

### Retry behavior

Transient errors — 429, 5xx, and network failures — are retried up to 3 times with exponential backoff. Configure via the top-level `retry` block (`maxAttempts`, `baseDelayMs`); per-provider `retry` overrides the global default.

## Configuration

Configuration sources are loaded in this order (later overrides earlier):

1. `.env` file
2. Environment variables
3. CLI arguments
4. Config file (`vision-config.json`)
5. Per-request `provider` and `model` parameters

### CLI Arguments

```
--provider <name>              Default provider
--openai-api-key <key>         OpenAI API key
--anthropic-api-key <key>      Anthropic API key
--google-api-key <key>         Google API key
--ollama-base-url <url>        Ollama URL (default: http://localhost:11434)
--ollama-model <model>         Ollama model (default: llava)
--model <model>                Default model for the default provider
--timeout <ms>                 Request timeout for the default provider
--ollama-timeout <ms>          Request timeout for Ollama (default: 120000)
--api-key <key>                API key for the default provider (generic)
--base-url <url>               Base URL for the default provider (generic)
--config <path>                Path to config file
```

### Environment Variables

```bash
VISION_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llava
VISION_TIMEOUT_MS=60000          # default provider timeout
OLLAMA_TIMEOUT_MS=300000         # bump for slow local models
VISION_CONFIG_PATH=./vision-config.json

# Preset providers (see "Preset Providers" section for the full list)
VISION_DEFAULT_PROVIDER=moonshot
MOONSHOT_API_KEY=sk-...
# Optional: MOONSHOT_MODEL=kimi-k2.6, MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
```

### Preset Providers

For 8 major OpenAI-compatible vision vendors, llm-vision-mcp ships with built-in preset defaults. Set `VISION_DEFAULT_PROVIDER=<name>` plus the vendor's standard API key env var — nothing else required. Optionally override the default model and base URL with `<VENDOR>_MODEL` / `<VENDOR>_BASE_URL`.

| Preset name | Base URL | Default model | API key env var |
|-------------|----------|---------------|-----------------|
| `moonshot` | `https://api.moonshot.ai/v1/` | `kimi-k2.5` | `MOONSHOT_API_KEY` |
| `zai` | `https://api.z.ai/api/paas/v4/` | `glm-4.5v` | `ZAI_API_KEY` |
| `qwen` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/` | `qwen3-vl-plus` | `DASHSCOPE_API_KEY` |
| `nvidia` | `https://integrate.api.nvidia.com/v1/` | `meta/llama-3.2-11b-vision-instruct` | `NVIDIA_API_KEY` |
| `groq` | `https://api.groq.com/openai/v1/` | `meta-llama/llama-4-scout-17b-16e-instruct` | `GROQ_API_KEY` |
| `together` | `https://api.together.xyz/v1/` | `meta-llama/Llama-Vision-Free` | `TOGETHER_API_KEY` |
| `deepinfra` | `https://api.deepinfra.com/v1/openai/` | `meta-llama/Llama-3.2-11B-Vision-Instruct` | `DEEPINFRA_API_KEY` |
| `xai` | `https://api.x.ai/v1/` | `grok-4.20-0309-non-reasoning` | `XAI_API_KEY` |

**Region notes:**
- **zai** — default `baseUrl` is the international endpoint (`api.z.ai`). Users in mainland China should override: `ZAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4/` (and use their `bigmodel.cn`-issued key as `ZAI_API_KEY`).
- **qwen** — default `baseUrl` is the Singapore international endpoint. Users in mainland China should override: `DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/`.

**Quickstart with Moonshot:**

```bash
export VISION_DEFAULT_PROVIDER=moonshot
export MOONSHOT_API_KEY=sk-...
llm-vision-mcp
```

**MCP host config example (Claude Desktop, Cursor, etc.):**

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": ["/path/to/llm-vision-mcp/dist/index.js"],
      "env": {
        "VISION_DEFAULT_PROVIDER": "moonshot",
        "MOONSHOT_API_KEY": "sk-..."
      }
    }
  }
}
```

Need multiple presets active at once, or pinned retry/concurrency settings per preset? See the [Provider Cookbook](#provider-cookbook) below for copy-paste config-file snippets.

### Config File

See [`config.example.json`](config.example.json) for a full example with all providers.

The config file supports `${ENV_VAR}` interpolation — API keys can reference environment variables so they never appear in the file.

### Provider Cookbook

Copy-paste JSON snippets for each preset vendor. Drop into your `vision-config.json` to pin settings, combine multiple providers, or override preset defaults. Keys stay in env vars via `${ENV_VAR}` interpolation.

#### Moonshot (Kimi)

```json
{
  "defaultProvider": "moonshot",
  "providers": {
    "moonshot": {
      "type": "openai-compatible",
      "baseUrl": "https://api.moonshot.ai/v1/",
      "apiKey": "${MOONSHOT_API_KEY}",
      "model": "kimi-k2.5"
    }
  }
}
```

#### Z.ai (Zhipu GLM) — international

```json
{
  "defaultProvider": "zai",
  "providers": {
    "zai": {
      "type": "openai-compatible",
      "baseUrl": "https://api.z.ai/api/paas/v4/",
      "apiKey": "${ZAI_API_KEY}",
      "model": "glm-4.5v"
    }
  }
}
```

#### Z.ai (Zhipu GLM) — China region

Same vendor, different endpoint and key:

```json
{
  "defaultProvider": "zai",
  "providers": {
    "zai": {
      "type": "openai-compatible",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4/",
      "apiKey": "${ZHIPUAI_API_KEY}",
      "model": "glm-4.5v"
    }
  }
}
```

#### Qwen (Alibaba DashScope) — international

```json
{
  "defaultProvider": "qwen",
  "providers": {
    "qwen": {
      "type": "openai-compatible",
      "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/",
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "qwen3-vl-plus"
    }
  }
}
```

#### NVIDIA NIM

```json
{
  "defaultProvider": "nvidia",
  "providers": {
    "nvidia": {
      "type": "openai-compatible",
      "baseUrl": "https://integrate.api.nvidia.com/v1/",
      "apiKey": "${NVIDIA_API_KEY}",
      "model": "meta/llama-3.2-11b-vision-instruct"
    }
  }
}
```

#### Groq

```json
{
  "defaultProvider": "groq",
  "providers": {
    "groq": {
      "type": "openai-compatible",
      "baseUrl": "https://api.groq.com/openai/v1/",
      "apiKey": "${GROQ_API_KEY}",
      "model": "meta-llama/llama-4-scout-17b-16e-instruct"
    }
  }
}
```

#### Together AI

```json
{
  "defaultProvider": "together",
  "providers": {
    "together": {
      "type": "openai-compatible",
      "baseUrl": "https://api.together.xyz/v1/",
      "apiKey": "${TOGETHER_API_KEY}",
      "model": "meta-llama/Llama-Vision-Free"
    }
  }
}
```

#### DeepInfra

```json
{
  "defaultProvider": "deepinfra",
  "providers": {
    "deepinfra": {
      "type": "openai-compatible",
      "baseUrl": "https://api.deepinfra.com/v1/openai/",
      "apiKey": "${DEEPINFRA_API_KEY}",
      "model": "meta-llama/Llama-3.2-11B-Vision-Instruct"
    }
  }
}
```

#### xAI (Grok)

```json
{
  "defaultProvider": "xai",
  "providers": {
    "xai": {
      "type": "openai-compatible",
      "baseUrl": "https://api.x.ai/v1/",
      "apiKey": "${XAI_API_KEY}",
      "model": "grok-4.20-0309-non-reasoning"
    }
  }
}
```

#### Multiple providers simultaneously

Register several providers at once, then call any of them per request via the MCP tool's `provider` parameter:

```json
{
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "gpt-4o"
    },
    "moonshot": {
      "type": "openai-compatible",
      "baseUrl": "https://api.moonshot.ai/v1/",
      "apiKey": "${MOONSHOT_API_KEY}",
      "model": "kimi-k2.5"
    },
    "zai": {
      "type": "openai-compatible",
      "baseUrl": "https://api.z.ai/api/paas/v4/",
      "apiKey": "${ZAI_API_KEY}",
      "model": "glm-4.5v"
    }
  }
}
```

### Custom Providers

#### OpenAI-compatible (DeepSeek, Qwen-VL, etc.)

Most Chinese LLM providers expose an OpenAI-compatible API:

```json
{
  "providers": {
    "deepseek": {
      "type": "openai-compatible",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "model": "deepseek-vl2"
    }
  }
}
```

#### Generic HTTP (any API)

For APIs with non-standard request/response formats:

```json
{
  "providers": {
    "custom": {
      "type": "generic-http",
      "url": "https://my-api.example.com/vision",
      "headers": { "Authorization": "Bearer ${API_KEY}" },
      "requestTemplate": {
        "image": "{{image}}",
        "prompt": "{{prompt}}",
        "type": "{{mimeType}}"
      },
      "imageFormat": "base64",
      "responsePath": "result.text"
    }
  }
}
```

Template placeholders: `{{image}}`, `{{prompt}}`, `{{mimeType}}`

`imageFormat`: `"base64"` (raw) or `"data-url"` (`data:image/png;base64,...`)

`responsePath`: Dot-notation path to extract the text from the JSON response (e.g., `choices.0.message.content`)

## Image Preprocessing

Images are automatically preprocessed before being sent to providers:

- **Format conversion**: Unsupported formats (e.g., WEBP for providers that don't support it) are converted to PNG
- **Resizing**: Images exceeding 2048x2048 are resized to fit (configurable)
- **Compression**: Images exceeding 20MB are JPEG-compressed at decreasing quality levels

Preprocessing options can be customized in the config file:

```json
{
  "preprocessing": {
    "maxWidth": 2048,
    "maxHeight": 2048,
    "maxFileSizeBytes": 20971520
  }
}
```

## Development

```bash
npm test              # Run tests
npm run test:watch    # Watch mode
npm run build         # Compile TypeScript
npm run dev           # Watch mode compilation
```

## License

ISC
