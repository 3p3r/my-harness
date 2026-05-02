import {
  type LlamaCppChatCompletionResponse,
  type LlamaCppStreamChunk,
  LlamaCppParsingError,
} from "./types";

/**
 * Parse tool calls from a non-streaming llama.cpp response.
 * Returns undefined if no tool calls are present.
 */
export function parseQwen36ToolCalls(response: LlamaCppChatCompletionResponse):
  | Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>
  | undefined {
  const toolCalls = response.choices[0]?.message?.tool_calls;
  if (!toolCalls || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map((tc) => {
    if (!tc.id || !tc.function?.name || tc.function.arguments === undefined) {
      throw new LlamaCppParsingError("Malformed tool call", "tool_calls", tc);
    }
    return {
      id: tc.id,
      type: "function",
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    };
  });
}

/**
 * Parse reasoning content from a non-streaming llama.cpp response.
 * Returns undefined if no reasoning content is present.
 */
export function parseQwen36Reasoning(
  response: LlamaCppChatCompletionResponse,
): string | undefined {
  return response.choices[0]?.message?.reasoning_content ?? undefined;
}

/**
 * Parse regular text content from a non-streaming llama.cpp response.
 * Returns null if content is empty or null.
 */
export function parseQwen36Content(
  response: LlamaCppChatCompletionResponse,
): string | null {
  const content = response.choices[0]?.message?.content;
  return content === undefined ? null : content;
}

/**
 * Parse a single SSE stream chunk from llama.cpp.
 */
export function parseQwen36StreamChunk(chunk: LlamaCppStreamChunk):
  | { type: "text-delta"; textDelta: string }
  | { type: "reasoning"; textDelta: string }
  | {
      type: "tool-call";
      function: { name: string; arguments: string };
      toolCallId: string;
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
    return { type: "reasoning", textDelta: delta.reasoning_content };
  }

  if (delta.tool_calls && delta.tool_calls.length > 0) {
    // In streaming, tool_calls is an array of partials
    const first = delta.tool_calls[0];
    if (first?.id) {
      return {
        type: "tool-call",
        function: {
          name: first.function?.name ?? "",
          arguments: first.function?.arguments ?? "",
        },
        toolCallId: first.id,
      };
    }
  }

  return undefined;
}

/**
 * Map llama.cpp finish reason to a unified format.
 */
export function mapQwen36FinishReason(reason: string | null): {
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
 * Extract usage stats from a non-streaming response.
 */
export function parseQwen36Usage(
  response: LlamaCppChatCompletionResponse,
): { promptTokens: number; completionTokens: number } | undefined {
  const usage = response.usage;
  if (!usage) return undefined;

  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
  };
}
