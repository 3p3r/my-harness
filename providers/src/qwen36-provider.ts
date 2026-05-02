import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV1 } from "ai";
import type { Qwen36ModelId, RetryConfig, QueueConfig } from "./types";
import { DEFAULT_RETRY_CONFIG, DEFAULT_QUEUE_CONFIG } from "./constants";
import { withRetry } from "./retry-wrapper";
import { withConcurrencyLimit } from "./queue-wrapper";

/**
 * Configuration for the Qwen3.6 provider.
 *
 * @example
 * ```ts
 * const qwen = createQwen36Provider({
 *   modelId: 'Qwen/Qwen3.6-35B-A3B',
 *   baseURL: 'http://192.168.1.95:8010/v1',
 * });
 * ```
 */
export interface Qwen36ProviderConfig {
  /** Model identifier: `'Qwen/Qwen3.6-35B-A3B'` or `'Qwen/Qwen3.6-27B'`. */
  modelId: Qwen36ModelId;
  /** llama.cpp OpenAI-compatible endpoint URL. */
  baseURL: string;
  /** Enable reasoning output via `chat_template_kwargs.enable_thinking`. Defaults to `true`. */
  enableThinking?: boolean;
  /** Retry configuration for empty responses. */
  retry?: RetryConfig;
  /** Queue configuration for concurrency limiting. */
  queue?: QueueConfig;
}

/**
 * Create a Qwen3.6 language model provider.
 *
 * Wraps `@ai-sdk/openai-compatible` with a custom request transformer that injects
 * `chat_template_kwargs.enable_thinking` into every chat completion request.
 *
 * @param config - Provider configuration including model ID and endpoint URL.
 * @returns A `LanguageModelV1` instance compatible with Vercel AI SDK primitives.
 *
 * @example
 * ```ts
 * import { generateText } from 'ai';
 * import { createQwen36Provider } from '@my-harness/providers';
 *
 * const qwen = createQwen36Provider({
 *   modelId: 'Qwen/Qwen3.6-35B-A3B',
 *   baseURL: 'http://192.168.1.95:8010/v1',
 * });
 *
 * const { text } = await generateText({ model: qwen, prompt: 'Hello' });
 * ```
 */
export function createQwen36Provider(
  config: Qwen36ProviderConfig,
): LanguageModelV1 {
  const provider = createOpenAICompatible({
    name: "llama-cpp-qwen36",
    baseURL: config.baseURL,
    transformRequestBody: (args) => ({
      ...args,
      chat_template_kwargs: {
        enable_thinking: config.enableThinking ?? true,
      },
    }),
  });

  let model = provider.languageModel(
    config.modelId,
  ) as unknown as LanguageModelV1;

  if (config.queue) {
    const queueConfig = { ...DEFAULT_QUEUE_CONFIG, ...config.queue };
    model = withConcurrencyLimit(model, queueConfig);
  }

  if (config.retry) {
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
    model = withRetry(model, retryConfig);
  }

  return model;
}
