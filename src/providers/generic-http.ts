import type { VisionProvider, ImageInput, DescribeOptions, ImageFormat, GenericHttpProviderConfig, UsageInfo, VisionResult } from "../types.js";
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
    if (typeof config.url !== "string" || config.url.length === 0) {
      throw new Error(`GenericHttpProvider "${name}": config.url must be a non-empty string`);
    }
    if (typeof config.responsePath !== "string" || config.responsePath.length === 0) {
      throw new Error(
        `GenericHttpProvider "${name}": config.responsePath must be a non-empty string`,
      );
    }
    if (config.requestTemplate === null || config.requestTemplate === undefined) {
      throw new Error(`GenericHttpProvider "${name}": config.requestTemplate is required`);
    }

    this.name = name;
    this.config = config;
    this.timeout = config.timeout ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.defaultPrompt = config.defaultPrompt ?? DEFAULT_PROMPT;
  }

  async describeImage(input: ImageInput, options: DescribeOptions): Promise<VisionResult> {
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
      const text = extractByPath(data, this.config.responsePath);
      let usage: UsageInfo | undefined;
      if (this.config.usagePath) {
        const raw = extractByPath(data, this.config.usagePath);
        if (raw !== "") {
          const total = Number(raw);
          if (Number.isFinite(total)) {
            usage = { inputTokens: 0, outputTokens: 0, totalTokens: total };
          }
        }
      }
      return { text, usage };
    } finally {
      clearTimeout(timeout);
    }
  }
}
