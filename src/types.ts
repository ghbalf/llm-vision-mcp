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
