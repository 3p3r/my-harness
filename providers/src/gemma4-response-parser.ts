import {
  type LlamaCppChatCompletionResponse,
  type LlamaCppStreamChunk,
  LlamaCppParsingError,
} from "./types";

/**
 * Parse tool calls from non-streaming response.
 * Returns the array of tool calls if present, otherwise undefined.
 */
export function parseGemma4ToolCalls(response: LlamaCppChatCompletionResponse):
  | Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>
  | undefined {
  const message = response.choices[0]?.message;
  if (!message) {
    throw new LlamaCppParsingError(
      "No message found in response",
      "choices[0].message",
      response.choices,
    );
  }
  return message.tool_calls;
}

/**
 * Parse reasoning content from non-streaming response.
 * Returns the reasoning string if present, otherwise undefined.
 */
export function parseGemma4Reasoning(
  response: LlamaCppChatCompletionResponse,
): string | undefined {
  const message = response.choices[0]?.message;
  if (!message) {
    throw new LlamaCppParsingError(
      "No message found in response",
      "choices[0].message",
      response.choices,
    );
  }
  return message.reasoning_content ?? undefined;
}

/**
 * Parse regular text content from non-streaming response.
 * Returns the content string if present, or null if empty.
 */
export function parseGemma4Content(
  response: LlamaCppChatCompletionResponse,
): string | null {
  const message = response.choices[0]?.message;
  if (!message) {
    throw new LlamaCppParsingError(
      "No message found in response",
      "choices[0].message",
      response.choices,
    );
  }
  return message.content;
}

/**
 * Parse a single SSE stream chunk.
 * Maps the delta to a unified type for easier consumption.
 */
export function parseGemma4StreamChunk(chunk: LlamaCppStreamChunk):
  | { type: "text-delta"; textDelta: string }
  | { type: "reasoning-delta"; reasoningDelta: string }
  | {
      type: "tool-call-delta";
      toolCallDelta: {
        type: "function";
        function: { name: string; arguments: string };
        id: string;
      };
    }
  | { type: "finish"; finishReason: string }
  | undefined {
  const choice = chunk.choices[0];
  if (!choice) return undefined;

  if (choice.finish_reason) {
    return { type: "finish", finishReason: choice.finish_reason };
  }

  const delta = choice.delta;
  if (!delta) return undefined;

  if (delta.content !== undefined && delta.content !== null) {
    return { type: "text-delta", textDelta: delta.content };
  }

  if (
    delta.reasoning_content !== undefined &&
    delta.reasoning_content !== null
  ) {
    return { type: "reasoning-delta", reasoningDelta: delta.reasoning_content };
  }

  if (delta.tool_calls && delta.tool_calls.length > 0) {
    // In streaming, tool_calls is an array of partials
    // We take the first one as the delta for simplicity in this parser
    const firstToolCall = delta.tool_calls[0];
    if (firstToolCall?.id) {
      return {
        type: "tool-call-delta",
        toolCallDelta: {
          type: "function",
          function: {
            name: firstToolCall.function?.name ?? "",
            arguments: firstToolCall.function?.arguments ?? "",
          },
          id: firstToolCall.id,
        },
      };
    }
  }

  return undefined;
}

/**
 * Map llama.cpp finish reason to v1 format.
 */
export function mapGemma4FinishReason(reason: string | null): {
  unified: string;
  raw?: string;
} {
  if (!reason) {
    return { unified: "unknown" };
  }

  switch (reason) {
    case "stop":
      return { unified: "stop" };
    case "tool_calls":
      return { unified: "tool-calls" };
    case "length":
      return { unified: "length" };
    default:
      return { unified: "unknown", raw: reason };
  }
}

/**
 * Extract usage stats.
 */
export function parseGemma4Usage(
  response: LlamaCppChatCompletionResponse,
): { promptTokens: number; completionTokens: number } | undefined {
  if (!response.usage) return undefined;
  return {
    promptTokens: response.usage.prompt_tokens,
    completionTokens: response.usage.completion_tokens,
  };
}
