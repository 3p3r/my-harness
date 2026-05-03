import type { LanguageModelV1 } from "ai";
import { createQwen36Provider } from "./qwen36-provider";
import { createGemma4Provider } from "./gemma4-provider";
import { withConcurrencyLimit } from "./queue-wrapper";

function makeProvider(model: LanguageModelV1) {
  return {
    languageModel: () => model,
  };
}

function makeProviderById(fn: (modelId: string) => LanguageModelV1) {
  return {
    languageModel: (modelId: string) => fn(modelId),
  };
}

type ProviderOptions = { slots?: number };

function wrapWithSlots(
  model: LanguageModelV1,
  options?: ProviderOptions,
): LanguageModelV1 {
  if (options?.slots != null && options.slots > 0) {
    return withConcurrencyLimit(model, { maxConcurrency: options.slots });
  }
  return model;
}

export function deez1_8010(options?: ProviderOptions) {
  return makeProvider(
    wrapWithSlots(
      createQwen36Provider({
        modelId: "Qwen/Qwen3.6-35B-A3B",
        baseURL: "http://192.168.1.95:8010/v1",
        enableThinking: false,
      }),
      options,
    ),
  );
}

export function deez2_8000(options?: ProviderOptions) {
  return makeProviderById((modelId) => {
    const enableThinking = modelId === "thinking-deep";
    return wrapWithSlots(
      createGemma4Provider({
        baseURL: "http://192.168.1.114:8000/v1",
        enableThinking,
      }),
      options,
    );
  });
}

export function deez2_8001(options?: ProviderOptions) {
  return makeProvider(
    wrapWithSlots(
      createGemma4Provider({
        baseURL: "http://192.168.1.114:8001/v1",
        enableThinking: false,
      }),
      options,
    ),
  );
}

export function deezx_8000(options?: ProviderOptions) {
  return makeProvider(
    wrapWithSlots(
      createQwen36Provider({
        modelId: "Qwen/Qwen3.6-27B",
        baseURL: "http://192.168.1.161:8000/v1",
        enableThinking: false,
      }),
      options,
    ),
  );
}

export function deezx_8001(options?: ProviderOptions) {
  return makeProvider(
    wrapWithSlots(
      createQwen36Provider({
        modelId: "Qwen/Qwen3.6-27B",
        baseURL: "http://192.168.1.161:8001/v1",
        enableThinking: false,
      }),
      options,
    ),
  );
}

type OpenCodeProviderOptions = ProviderOptions & { name?: string };

type ProviderSDK = {
  languageModel:
    | ((modelId: string) => LanguageModelV1)
    | (() => LanguageModelV1);
};

const providerFactories: Record<
  string,
  (opts?: ProviderOptions) => ProviderSDK
> = {
  deez1_8010,
  deez2_8000,
  deez2_8001,
  deezx_8000,
  deezx_8001,
};

export function createProvider(opts: OpenCodeProviderOptions = {}) {
  const { name, ...options } = opts;
  if (!name) {
    throw new Error("Provider name is required");
  }
  const factory = providerFactories[name];
  if (!factory) {
    throw new Error(
      `Unknown provider "${name}". Available: ${Object.keys(providerFactories).join(", ")}`,
    );
  }
  return factory(options);
}
