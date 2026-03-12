import { OpenAIProvider } from "./openai.js";
import type { ProviderConfig } from "../types.js";

export class OpenAICompatibleProvider extends OpenAIProvider {
  constructor(name: string, config: ProviderConfig) {
    super({
      ...config,
      baseURL: config.baseUrl,
      name,
    });
  }
}
