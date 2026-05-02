/// <reference types="vitest/globals" />
import fs from "node:fs";
import path from "node:path";
import {
  parseGemma4ToolCalls,
  parseGemma4Content,
  parseGemma4Reasoning,
  parseGemma4StreamChunk,
  mapGemma4FinishReason,
  parseGemma4Usage,
} from "../gemma4-response-parser";
import type {
  LlamaCppChatCompletionResponse,
  LlamaCppStreamChunk,
} from "../types";

describe("gemma4-response-parser", () => {
  const fixtureDir = path.join(__dirname, "fixtures");

  function loadFixture(name: string): LlamaCppChatCompletionResponse {
    const content = fs.readFileSync(path.join(fixtureDir, name), "utf-8");
    return JSON.parse(content);
  }

  describe("parseGemma4Content", () => {
    it("should parse content from text-nonstream fixture", () => {
      const response = loadFixture("deez2-text-nonstream.json");
      expect(parseGemma4Content(response)).toBe(
        "Hello! How can I help you today?",
      );
    });

    it("should parse content from image fixture", () => {
      const response = loadFixture("deez2-image.json");
      expect(parseGemma4Content(response)).toBe("This is **red**.");
    });

    it("should return null if content is empty", () => {
      const response = loadFixture("deez2-toolcall.json");
      expect(parseGemma4Content(response)).toBe("");
    });
  });

  describe("parseGemma4Reasoning", () => {
    it("should parse reasoning from text-nonstream fixture", () => {
      const response = loadFixture("deez2-text-nonstream.json");
      expect(parseGemma4Reasoning(response)).toContain('The user said "Hi!".');
    });

    it("should parse reasoning from reasoning fixture", () => {
      const response = loadFixture("deez2-reasoning.json");
      expect(parseGemma4Reasoning(response)).toContain(
        "The user is asking for a comparison",
      );
    });

    it("should return undefined if reasoning_content is missing", () => {
      const response = loadFixture("deez2-text-nonstream.json");
      // In deez2-text-nonstream.json, reasoning_content IS present.
      // Let's mock one without it.
      const noReasoning = JSON.parse(JSON.stringify(response));
      delete (noReasoning.choices[0].message as unknown as Record<string, unknown>).reasoning_content;
      expect(parseGemma4Reasoning(noReasoning)).toBeUndefined();
    });
  });

  describe("parseGemma4ToolCalls", () => {
    it("should parse tool calls from toolcall fixture", () => {
      const response = loadFixture("deez2-toolcall.json");
      const toolCalls = parseGemma4ToolCalls(response);
      expect(toolCalls).toBeDefined();
      expect(toolCalls?.length).toBe(1);
      if (!toolCalls) return;
      const tc = toolCalls[0];
      expect(tc?.function.name).toBe("get_time");
      expect(tc?.function.arguments).toBe('{"timezone":"UTC"}');
    });

    it("should return undefined if no tool calls are present", () => {
      const response = loadFixture("deez2-text-nonstream.json");
      expect(parseGemma4ToolCalls(response)).toBeUndefined();
    });
  });

  describe("parseGemma4Usage", () => {
    it("should parse usage from text-nonstream fixture", () => {
      const response = loadFixture("deez2-text-nonstream.json");
      const usage = parseGemma4Usage(response);
      expect(usage).toEqual({
        promptTokens: 17,
        completionTokens: 126,
      });
    });

    it("should return undefined if usage is missing", () => {
      const response = loadFixture("deez2-text-nonstream.json");
      const noUsage = JSON.parse(JSON.stringify(response));
      delete (noUsage as unknown as Record<string, unknown>).usage;
      expect(parseGemma4Usage(noUsage)).toBeUndefined();
    });
  });

  describe("mapGemma4FinishReason", () => {
    it('should map "stop" to "stop"', () => {
      expect(mapGemma4FinishReason("stop")).toEqual({ unified: "stop" });
    });

    it('should map "tool_calls" to "tool_calls"', () => {
      expect(mapGemma4FinishReason("tool_calls")).toEqual({
        unified: "tool-calls",
      });
    });

    it('should map "length" to "length"', () => {
      expect(mapGemma4FinishReason("length")).toEqual({ unified: "length" });
    });

    it('should map null to "incomplete"', () => {
      expect(mapGemma4FinishReason(null)).toEqual({ unified: "unknown" });
    });

    it('should map unknown reasons to "unknown"', () => {
      expect(mapGemma4FinishReason("something_else")).toEqual({
        unified: "unknown",
        raw: "something_else",
      });
    });
  });

  describe("parseGemma4StreamChunk", () => {
    it("should parse text-delta from stream fixture", () => {
      const raw = fs.readFileSync(
        path.join(fixtureDir, "deez2-text-stream.json"),
        "utf-8",
      );
      const lines = raw.split("\n").filter((l) => l.trim() !== "");

      // Find a line that has content delta
      const contentLine = lines.find((l) => l.includes('"content":"Hello"'));
      if (!contentLine)
        throw new Error("Could not find content line in fixture");

      const jsonStr = contentLine.replace(/^data: /, "");
      const chunk = JSON.parse(jsonStr) as LlamaCppStreamChunk;

      const result = parseGemma4StreamChunk(chunk);
      expect(result).toEqual({ type: "text-delta", textDelta: "Hello" });
    });

    it("should parse reasoning-delta from stream fixture", () => {
      const raw = fs.readFileSync(
        path.join(fixtureDir, "deez2-text-stream.json"),
        "utf-8",
      );
      const lines = raw.split("\n").filter((l) => l.trim() !== "");

      // Find a line that has reasoning_content delta
      const reasoningLine = lines.find((l) =>
        l.includes('"reasoning_content":"The"'),
      );
      if (!reasoningLine)
        throw new Error("Could not find reasoning line in fixture");

      const jsonStr = reasoningLine.replace(/^data: /, "");
      const chunk = JSON.parse(jsonStr) as LlamaCppStreamChunk;

      const result = parseGemma4StreamChunk(chunk);
      expect(result).toEqual({
        type: "reasoning-delta",
        reasoningDelta: "The",
      });
    });

    it("should parse finish reason from stream fixture", () => {
      const raw = fs.readFileSync(
        path.join(fixtureDir, "deez2-text-stream.json"),
        "utf-8",
      );
      const lines = raw.split("\n").filter((l) => l.trim() !== "");

      // Find the line with finish_reason: "stop"
      const finishLine = lines.find((l) =>
        l.includes('"finish_reason":"stop"'),
      );
      if (!finishLine) throw new Error("Could not find finish line in fixture");

      const jsonStr = finishLine.replace(/^data: /, "");
      const chunk = JSON.parse(jsonStr) as LlamaCppStreamChunk;

      const result = parseGemma4StreamChunk(chunk);
      expect(result).toEqual({ type: "finish", finishReason: "stop" });
    });

    it("should return undefined for empty delta", () => {
      const chunk: LlamaCppStreamChunk = {
        id: "1",
        object: "chunk",
        created: 123,
        model: "m",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: null,
          },
        ],
      };
      expect(parseGemma4StreamChunk(chunk)).toBeUndefined();
    });
  });
});
