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
