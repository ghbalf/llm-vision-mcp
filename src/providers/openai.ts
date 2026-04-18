import OpenAI from "openai";
import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, ProviderConfig, VisionResult } from "../types.js";
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

  async describeImage(input: ImageInput, options: DescribeOptions): Promise<VisionResult> {
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

    const text = response.choices[0]?.message?.content ?? "";
    const u = response.usage;
    const usage = u
      ? {
          inputTokens: u.prompt_tokens,
          outputTokens: u.completion_tokens,
          totalTokens: u.total_tokens,
        }
      : undefined;
    return { text, usage };
  }
}
