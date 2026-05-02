import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV1 } from "ai";

/**
 * Configuration for the Gemma4 provider.
 *
 * @example
 * ```ts
 * const gemma = createGemma4Provider({
 *   baseURL: 'http://192.168.1.114:8000/v1',
 * });
 * ```
 */
export interface Gemma4ProviderConfig {
  /** llama.cpp OpenAI-compatible endpoint URL. */
  baseURL: string;
  /** Enable reasoning output via `chat_template_kwargs.enable_thinking`. Defaults to `true`. */
  enableThinking?: boolean;
}

/**
 * Create a Gemma4 language model provider.
 *
 * Wraps `@ai-sdk/openai-compatible` with a custom request transformer that injects
 * `chat_template_kwargs.enable_thinking` into every chat completion request.
 * Always uses model `TrevorJS/gemma-4-26B-A4B-it-uncensored`.
 *
 * @param config - Provider configuration including endpoint URL.
 * @returns A `LanguageModelV1` instance compatible with Vercel AI SDK primitives.
 *
 * @example
 * ```ts
 * import { streamText } from 'ai';
 * import { createGemma4Provider } from '@my-harness/providers';
 *
 * const gemma = createGemma4Provider({
 *   baseURL: 'http://192.168.1.114:8000/v1',
 * });
 *
 * const result = await streamText({ model: gemma, prompt: 'Hello' });
 * ```
 */
export function createGemma4Provider(
  config: Gemma4ProviderConfig,
): LanguageModelV1 {
  const provider = createOpenAICompatible({
    name: "llama-cpp-gemma4",
    baseURL: config.baseURL,
    transformRequestBody: (args) => ({
      ...args,
      chat_template_kwargs: {
        enable_thinking: config.enableThinking ?? true,
      },
    }),
  });

  return provider.languageModel(
    "TrevorJS/gemma-4-26B-A4B-it-uncensored",
  ) as unknown as LanguageModelV1;
}
