import type { PreprocessingOptions, UsageInfo, VisionProvider } from "./types.js";
import type { ProviderRegistry } from "./providers/registry.js";
import { resolveImage, preprocessImage } from "./preprocessing/image-preprocessor.js";

export class Semaphore {
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error(`Semaphore max must be >= 1, got ${max}`);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

export interface BatchItem {
  image: string;
  prompt?: string;
  provider?: string;
  model?: string;
}

export interface BatchArgs {
  items: BatchItem[];
  prompt?: string;
  provider?: string;
  model?: string;
  concurrency?: number;
}

export interface BatchDefaults {
  concurrency: number;
  perProviderConcurrency?: Record<string, number>;
}

export interface BatchSuccess {
  index: number;
  description: string;
  usage?: UsageInfo;
}

export interface BatchFailure {
  index: number;
  image: string;
  error: string;
}

export interface BatchResult {
  summary: { succeeded: number; failed: number };
  totalUsage?: UsageInfo;
  results: Array<BatchSuccess | BatchFailure>;
}

function resolveProviderName(
  itemProvider: string | undefined,
  batchProvider: string | undefined,
  registryDefault: string,
): string {
  return itemProvider ?? batchProvider ?? registryDefault;
}

async function processOne(
  index: number,
  item: BatchItem,
  args: BatchArgs,
  registry: ProviderRegistry,
  preprocessingOptions: PreprocessingOptions,
): Promise<BatchSuccess | BatchFailure> {
  try {
    const providerName = item.provider ?? args.provider;
    const provider: VisionProvider = registry.getProvider(providerName);
    const raw = await resolveImage(item.image);
    const image = await preprocessImage(raw, provider.supportedFormats, preprocessingOptions);
    const result = await provider.describeImage(image, {
      prompt: item.prompt ?? args.prompt,
      model: item.model ?? args.model,
    });
    return { index, description: result.text, usage: result.usage };
  } catch (err) {
    return {
      index,
      image: item.image,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getSemaphoreFor(
  providerName: string,
  semaphores: Map<string, Semaphore>,
  defaultConcurrency: number,
  perProvider?: Record<string, number>,
): Semaphore {
  let sem = semaphores.get(providerName);
  if (!sem) {
    const cap = perProvider?.[providerName] ?? defaultConcurrency;
    sem = new Semaphore(cap);
    semaphores.set(providerName, sem);
  }
  return sem;
}

export async function describeImagesBatch(
  args: BatchArgs,
  registry: ProviderRegistry,
  preprocessingOptions: PreprocessingOptions,
  defaults: BatchDefaults,
): Promise<BatchResult> {
  const effectiveConcurrency = args.concurrency ?? defaults.concurrency;
  const semaphores = new Map<string, Semaphore>();
  const defaultName = registry.getDefaultProviderName();

  const tasks = args.items.map((item, index) => {
    const providerName = resolveProviderName(item.provider, args.provider, defaultName);
    const sem = getSemaphoreFor(
      providerName,
      semaphores,
      effectiveConcurrency,
      defaults.perProviderConcurrency,
    );
    return sem.run(() => processOne(index, item, args, registry, preprocessingOptions));
  });

  const results = await Promise.all(tasks);
  const succeeded = results.filter((r): r is BatchSuccess => !("error" in r));
  const failed = results.length - succeeded.length;

  const totalsUsable = succeeded.filter((r): r is BatchSuccess & { usage: UsageInfo } => !!r.usage);
  const totalUsage =
    totalsUsable.length > 0
      ? totalsUsable.reduce(
          (acc, r) => ({
            inputTokens: acc.inputTokens + r.usage.inputTokens,
            outputTokens: acc.outputTokens + r.usage.outputTokens,
            totalTokens: acc.totalTokens + r.usage.totalTokens,
          }),
          { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        )
      : undefined;

  return {
    summary: { succeeded: succeeded.length, failed },
    ...(totalUsage ? { totalUsage } : {}),
    results,
  };
}
