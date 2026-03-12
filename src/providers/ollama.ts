import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, ProviderConfig } from "../types.js";
import { DEFAULT_PROMPT, DEFAULT_MAX_TOKENS, OLLAMA_DEFAULT_TIMEOUT_MS } from "../types.js";

export class OllamaProvider implements VisionProvider {
  name = "ollama";
  supportedFormats: ImageFormat[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  private baseUrl: string;
  private defaultModel: string;
  private timeout: number;
  private maxTokens: number;
  private defaultPrompt: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.defaultModel = config.model ?? "llava";
    this.timeout = config.timeout ?? OLLAMA_DEFAULT_TIMEOUT_MS;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
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
          options: { num_predict: options.maxTokens ?? this.maxTokens },
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
