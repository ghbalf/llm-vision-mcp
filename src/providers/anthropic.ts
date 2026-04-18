import Anthropic from "@anthropic-ai/sdk";
import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, ProviderConfig, VisionResult } from "../types.js";
import { DEFAULT_PROMPT, DEFAULT_MAX_TOKENS, DEFAULT_PROVIDER_TIMEOUT_MS } from "../types.js";

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

  async describeImage(input: ImageInput, options: DescribeOptions): Promise<VisionResult> {
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
    const text = textBlock && "text" in textBlock ? textBlock.text : "";
    const u = response.usage;
    const usage = u
      ? {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          totalTokens: u.input_tokens + u.output_tokens,
        }
      : undefined;
    return { text, usage };
  }
}
