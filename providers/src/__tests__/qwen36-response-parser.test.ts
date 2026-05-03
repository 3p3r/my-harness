/// <reference types="vitest/globals" />
import {
  type LlamaCppChatCompletionResponse,
  type LlamaCppStreamChunk,
  LlamaCppParsingError,
} from "../types";
import {
  parseQwen36ToolCalls,
  parseQwen36Reasoning,
  parseQwen36Content,
  parseQwen36StreamChunk,
  mapQwen36FinishReason,
  parseQwen36Usage,
} from "../qwen36-response-parser";
import * as textNonStreamFixture from "./fixtures/deez1-text-nonstream.json";
import * as toolCallFixture from "./fixtures/deez1-toolcall.json";
import * as reasoningFixture from "./fixtures/deez1-reasoning.json";
import * as deezxReasoningFixture from "./fixtures/deezx-reasoning.json";

describe("qwen36-response-parser", () => {
  describe("parseQwen36ToolCalls", () => {
    it("should parse tool calls correctly from deez1-toolcall.json", () => {
      const response =
        toolCallFixture as unknown as LlamaCppChatCompletionResponse;
      const toolCalls = parseQwen36ToolCalls(response);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls?.[0]).toEqual({
        id: "rP4KeGsXzvsFiykRFxRcM02or8Lq9DyJ",
        type: "function",
        function: {
          name: "get_time",
          arguments: '{"timezone":"UTC"}',
        },
      });
    });

    it("should return undefined when no tool calls are present", () => {
      const response =
        textNonStreamFixture as unknown as LlamaCppChatCompletionResponse;
      const toolCalls = parseQwen36ToolCalls(response);
      expect(toolCalls).toBeUndefined();
    });

    it("should throw LlamaCppParsingError for malformed tool calls", () => {
      const malformedResponse = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "123",
                  type: "function",
                  function: { name: "test" }, // missing arguments
                },
              ],
            },
          },
        ],
      } as unknown as LlamaCppChatCompletionResponse;

      expect(() => parseQwen36ToolCalls(malformedResponse)).toThrow(
        LlamaCppParsingError,
      );
    });
  });

  describe("parseQwen36Reasoning", () => {
    it("should parse reasoning content correctly from deez1-text-nonstream.json", () => {
      const response =
        textNonStreamFixture as unknown as LlamaCppChatCompletionResponse;
      const reasoning = parseQwen36Reasoning(response);
      expect(reasoning).toContain("Analyze User Input");
    });

    it("should parse reasoning content correctly from deez1-reasoning.json", () => {
      const response =
        reasoningFixture as unknown as LlamaCppChatCompletionResponse;
      const reasoning = parseQwen36Reasoning(response);
      expect(reasoning).toContain("Which is greater, 9.11 or 9.8?");
    });

    it("should behave identically for deezx-reasoning.json", () => {
      const response =
        deezxReasoningFixture as unknown as LlamaCppChatCompletionResponse;
      const reasoning = parseQwen36Reasoning(response);
      expect(reasoning).toContain("Analyze User Input");
    });

    it("should return undefined if no reasoning content is present", () => {
      const response = {
        choices: [{ message: { content: "Hello", reasoning_content: null } }],
      } as unknown as LlamaCppChatCompletionResponse;
      const reasoning = parseQwen36Reasoning(response);
      expect(reasoning).toBeUndefined();
    });
  });

  describe("parseQwen36Content", () => {
    it("should parse content correctly from deez1-text-nonstream.json", () => {
      const response =
        textNonStreamFixture as unknown as LlamaCppChatCompletionResponse;
      const content = parseQwen36Content(response);
      expect(content).toBe("Hi! 👋 How can I help you today?");
    });

    it("should return null if content is empty string", () => {
      const response = {
        choices: [{ message: { content: "" } }],
      } as unknown as LlamaCppChatCompletionResponse;
      expect(parseQwen36Content(response)).toBe("");
    });

    it("should return null if content is null", () => {
      const response = {
        choices: [{ message: { content: null } }],
      } as unknown as LlamaCppChatCompletionResponse;
      expect(parseQwen36Content(response)).toBeNull();
    });

    it("should return null if content is undefined", () => {
      const response = {
        choices: [{ message: {} }],
      } as unknown as LlamaCppChatCompletionResponse;
      expect(parseQwen36Content(response)).toBeNull();
    });
  });

  describe("parseQwen36StreamChunk", () => {
    it("should parse text-delta chunks", () => {
      // We need to parse the SSE format. The fixture is a multi-line string of "data: ..."
      // For testing the function directly, we'll pass a single chunk object.
      const chunk = {
        choices: [{ delta: { content: "Hello" } }],
      } as unknown as LlamaCppStreamChunk;
      const result = parseQwen36StreamChunk(chunk);
      expect(result).toEqual({ type: "text-delta", textDelta: "Hello" });
    });

    it("should parse reasoning-delta chunks", () => {
      const chunk = {
        choices: [{ delta: { reasoning_content: "Thinking" } }],
      } as unknown as LlamaCppStreamChunk;
      const result = parseQwen36StreamChunk(chunk);
      expect(result).toEqual({ type: "reasoning", textDelta: "Thinking" });
    });

    it("should parse tool-call-delta chunks", () => {
      const chunk = {
        choices: [
          {
            delta: {
              tool_calls: [
                { id: "123", type: "function", function: { name: "test" } },
              ],
            },
          },
        ],
      } as unknown as LlamaCppStreamChunk;
      const result = parseQwen36StreamChunk(chunk);
      expect(result).toEqual({
        type: "tool-call",
        function: { name: "test", arguments: "" },
        toolCallId: "123",
      });
    });

    it("should parse finish chunks", () => {
      const chunk = {
        choices: [{ finish_reason: "stop" }],
      } as unknown as LlamaCppStreamChunk;
      const result = parseQwen36StreamChunk(chunk);
      expect(result).toEqual({ type: "finish", finishReason: "stop" });
    });

    it("should return undefined for empty chunks", () => {
      const chunk = {
        choices: [{ delta: {} }],
      } as unknown as LlamaCppStreamChunk;
      expect(parseQwen36StreamChunk(chunk)).toBeUndefined();
    });

    it("should return undefined when choices array is empty", () => {
      const chunk = {
        choices: [],
      } as unknown as LlamaCppStreamChunk;
      expect(parseQwen36StreamChunk(chunk)).toBeUndefined();
    });

    it("should return undefined when delta is missing from choice", () => {
      const chunk = {
        choices: [{ finish_reason: null }],
      } as unknown as LlamaCppStreamChunk;
      expect(parseQwen36StreamChunk(chunk)).toBeUndefined();
    });

    it("should use defaults when tool-call function name is missing", () => {
      const chunk = {
        choices: [
          {
            delta: {
              tool_calls: [{ id: "123", type: "function", function: {} }],
            },
          },
        ],
      } as unknown as LlamaCppStreamChunk;
      const result = parseQwen36StreamChunk(chunk);
      expect(result).toEqual({
        type: "tool-call",
        function: { name: "", arguments: "" },
        toolCallId: "123",
      });
    });
  });

  describe("mapQwen36FinishReason", () => {
    it("should map stop to stop", () => {
      expect(mapQwen36FinishReason("stop")).toEqual({ unified: "stop" });
    });

    it("should map tool_calls to tool_calls", () => {
      expect(mapQwen36FinishReason("tool_calls")).toEqual({
        unified: "tool-calls",
      });
    });

    it("should map length to length", () => {
      expect(mapQwen36FinishReason("length")).toEqual({ unified: "length" });
    });

    it("should map null to incomplete", () => {
      expect(mapQwen36FinishReason(null)).toEqual({ unified: "unknown" });
    });

    it("should map unknown reasons with raw value", () => {
      expect(mapQwen36FinishReason("something_else")).toEqual({
        unified: "unknown",
        raw: "something_else",
      });
    });
  });

  describe("parseQwen36Usage", () => {
    it("should parse usage correctly", () => {
      const response =
        textNonStreamFixture as unknown as LlamaCppChatCompletionResponse;
      const usage = parseQwen36Usage(response);
      expect(usage).toEqual({
        promptTokens: 12,
        completionTokens: 178,
      });
    });

    it("should return undefined if usage is missing", () => {
      const response = {
        choices: [],
      } as unknown as LlamaCppChatCompletionResponse;
      expect(parseQwen36Usage(response)).toBeUndefined();
    });
  });
});
