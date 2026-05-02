import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONTEXT_LENGTHS,
  DEFAULT_TIMEOUT_MS,
  MODEL_SUPPORTS_VISION,
  REASONING_LEVEL_MAP,
} from "../constants";
import { LlamaCppError, LlamaCppParsingError } from "../types";
import type { Qwen36ModelId, Gemma4ModelId } from "../types";

describe("Types and Constants", () => {
  it("should have correct default context lengths", () => {
    expect(DEFAULT_CONTEXT_LENGTHS["Qwen/Qwen3.6-35B-A3B"]).toBe(262144);
    expect(DEFAULT_CONTEXT_LENGTHS["Qwen/Qwen3.6-27B"]).toBe(131072);
    expect(
      DEFAULT_CONTEXT_LENGTHS["TrevorJS/gemma-4-26B-A4B-it-uncensored"],
    ).toBe(262144);
  });

  it("should have correct vision support flags", () => {
    expect(MODEL_SUPPORTS_VISION["Qwen/Qwen3.6-35B-A3B"]).toBe(true);
    expect(MODEL_SUPPORTS_VISION["Qwen/Qwen3.6-27B"]).toBe(false);
    expect(
      MODEL_SUPPORTS_VISION["TrevorJS/gemma-4-26B-A4B-it-uncensored"],
    ).toBe(true);
  });

  it("should have correct reasoning level mappings", () => {
    expect(REASONING_LEVEL_MAP.none).toBe(false);
    expect(REASONING_LEVEL_MAP.high).toBe(true);
    expect(REASONING_LEVEL_MAP["provider-default"]).toBe(true);
  });

  it("should have correct default timeout", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120000);
  });

  it("should create LlamaCppError with correct name", () => {
    const error = new LlamaCppError("test error");
    expect(error.name).toBe("LlamaCppError");
    expect(error.message).toBe("test error");
  });

  it("should create LlamaCppParsingError with field info", () => {
    const error = new LlamaCppParsingError(
      "parse failed",
      "toolCalls",
      "{bad",
      new Error("json error"),
    );
    expect(error.name).toBe("LlamaCppParsingError");
    expect(error.fieldName).toBe("toolCalls");
    expect(error.fieldValue).toBe("{bad");
  });

  // Type-level tests (compile-time)
  it("should accept valid Qwen36 model IDs", () => {
    const validIds: Qwen36ModelId[] = [
      "Qwen/Qwen3.6-35B-A3B",
      "Qwen/Qwen3.6-27B",
    ];
    expect(validIds).toHaveLength(2);
  });

  it("should accept valid Gemma4 model ID", () => {
    const validId: Gemma4ModelId = "TrevorJS/gemma-4-26B-A4B-it-uncensored";
    expect(validId).toBe("TrevorJS/gemma-4-26B-A4B-it-uncensored");
  });
});
