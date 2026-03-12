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
  [key: string]: unknown;
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

  const providerList = registry.listProviders().join(", ");

  server.prompt(
    "vision_instructions",
    "Instructions for using the vision tool to understand images",
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "You have access to a vision tool called `describe_image` that can analyze images for you.",
              "Use it whenever you encounter:",
              "- File paths to images (e.g., /path/to/image.png, ./screenshot.jpg)",
              "- URLs pointing to images (e.g., https://example.com/photo.png)",
              "- Base64-encoded image data (e.g., data:image/png;base64,...)",
              "- Any user request that involves understanding, describing, or extracting information from an image",
              "",
              "The tool accepts an `image` parameter (the path, URL, or base64 data) and an optional `prompt` parameter",
              "to focus the analysis (e.g., \"extract all text\", \"describe the chart data\", \"what colors are used\").",
              "",
              `Available vision providers: ${providerList}.`,
              "You can optionally specify a `provider` or `model` parameter to override the defaults.",
              "",
              "When a user shares an image or mentions one, always call `describe_image` to understand its content",
              "before responding — do not guess or assume what the image contains.",
            ].join("\n"),
          },
        },
      ],
    }),
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
