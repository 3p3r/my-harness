import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import type { QueueConfig } from "./types";
import { DEFAULT_QUEUE_CONFIG } from "./constants";

type LanguageModelV1StreamResult = Awaited<
  ReturnType<LanguageModelV1["doStream"]>
>;

function createSyntheticStream(
  message: string,
  streamResult?: LanguageModelV1StreamResult,
): LanguageModelV1StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV1StreamPart>({
      start(controller) {
        controller.enqueue({ type: "text-delta", textDelta: message });
        controller.enqueue({
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 0, completionTokens: 0 },
        });
        controller.close();
      },
    }),
    rawCall: streamResult?.rawCall ?? {
      rawPrompt: null,
      rawSettings: {},
    },
  };
}

export function withConcurrencyLimit(
  model: LanguageModelV1,
  config?: QueueConfig,
): LanguageModelV1 {
  const merged = { ...DEFAULT_QUEUE_CONFIG, ...config };
  let activeCount = 0;

  const syntheticGenerateResult: Awaited<
    ReturnType<LanguageModelV1["doGenerate"]>
  > = {
    content: [{ type: "text", text: merged.queuedMessage }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { promptTokens: 0, completionTokens: 0 },
    rawCall: { rawPrompt: null, rawSettings: {} },
  } as unknown as Awaited<ReturnType<LanguageModelV1["doGenerate"]>>;

  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,

    supportsUrl: model.supportsUrl,
    defaultObjectGenerationMode: model.defaultObjectGenerationMode,
    supportsStructuredOutputs: model.supportsStructuredOutputs,

    async doGenerate(options: LanguageModelV1CallOptions) {
      if (activeCount >= merged.maxConcurrency) {
        return syntheticGenerateResult;
      }
      activeCount++;
      try {
        return await model.doGenerate(options);
      } finally {
        activeCount--;
      }
    },

    async doStream(
      options: LanguageModelV1CallOptions,
    ): Promise<LanguageModelV1StreamResult> {
      if (activeCount >= merged.maxConcurrency) {
        return createSyntheticStream(merged.queuedMessage);
      }
      activeCount++;
      try {
        return await model.doStream(options);
      } finally {
        activeCount--;
      }
    },
  };
}
