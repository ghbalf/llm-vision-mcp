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
