import { backOff } from "exponential-backoff";
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import type { RetryConfig } from "./types";
import { EmptyResponseError } from "./empty-response-error";
import { DEFAULT_RETRY_CONFIG } from "./constants";

type LanguageModelV1StreamResult = Awaited<
  ReturnType<LanguageModelV1["doStream"]>
>;

function isGenerateResultEmpty(
  result: Awaited<ReturnType<LanguageModelV1["doGenerate"]>>,
): boolean {
  const content = (result as Record<string, unknown>).content as
    | Array<{ type: string; text?: string; [key: string]: unknown }>
    | undefined;
  if (content == null || content.length === 0) return true;
  for (const part of content) {
    if (part.type === "text" && (part.text ?? "").trim().length > 0) {
      return false;
    }
    if (part.type === "reasoning" && (part.text ?? "").trim().length > 0) {
      return false;
    }
    if (part.type === "tool-call") {
      return false;
    }
  }
  return true;
}

function hasStreamContent(chunks: LanguageModelV1StreamPart[]): boolean {
  for (const chunk of chunks) {
    if (chunk.type === "text-delta" && chunk.textDelta.trim().length > 0) {
      return true;
    }
    if (chunk.type === "tool-call" || chunk.type === "tool-call-delta") {
      return true;
    }
    if (chunk.type === "reasoning" && chunk.textDelta.trim().length > 0) {
      return true;
    }
  }
  return false;
}

export function withRetry(
  model: LanguageModelV1,
  config?: RetryConfig,
): LanguageModelV1 {
  const merged = { ...DEFAULT_RETRY_CONFIG, ...config };

  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,

    supportsUrl: model.supportsUrl,
    defaultObjectGenerationMode: model.defaultObjectGenerationMode,
    supportsStructuredOutputs: model.supportsStructuredOutputs,

    async doGenerate(options: LanguageModelV1CallOptions) {
      return backOff(
        async () => {
          const result = await model.doGenerate(options);
          if (isGenerateResultEmpty(result)) {
            throw new EmptyResponseError();
          }
          return result;
        },
        {
          numOfAttempts: merged.maxAttempts,
          startingDelay: merged.startingDelay,
          timeMultiple: merged.timeMultiple,
          jitter: merged.jitter,
          retry: (e: unknown) => e instanceof EmptyResponseError,
        },
      );
    },

    // PERF: doStream retry buffers entire stream content before emitting to caller
    async doStream(
      options: LanguageModelV1CallOptions,
    ): Promise<LanguageModelV1StreamResult> {
      return backOff(
        async (): Promise<LanguageModelV1StreamResult> => {
          const streamResult = await model.doStream(options);
          const reader = streamResult.stream.getReader();
          const chunks: LanguageModelV1StreamPart[] = [];

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
          }

          if (!hasStreamContent(chunks)) {
            throw new EmptyResponseError("Model returned empty stream");
          }

          return {
            ...streamResult,
            stream: new ReadableStream<LanguageModelV1StreamPart>({
              start(controller) {
                for (const chunk of chunks) {
                  controller.enqueue(chunk);
                }
                controller.close();
              },
            }),
          };
        },
        {
          numOfAttempts: merged.maxAttempts,
          startingDelay: merged.startingDelay,
          timeMultiple: merged.timeMultiple,
          jitter: merged.jitter,
          retry: (e: unknown) => e instanceof EmptyResponseError,
        },
      );
    },
  };
}
