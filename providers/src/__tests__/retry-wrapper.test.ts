import { describe, it, expect, vi, afterEach } from "vitest";
import { withRetry } from "../retry-wrapper";
import type { LanguageModelV1, LanguageModelV1CallOptions } from "ai";
import { EmptyResponseError } from "../empty-response-error";

const testCallOptions: LanguageModelV1CallOptions = {
  inputFormat: "messages",
  mode: { type: "regular" },
  prompt: [],
};

function makeBaseModel(
  overrides: Partial<LanguageModelV1> = {},
): LanguageModelV1 {
  return {
    specificationVersion: "v1",
    provider: "test-provider",
    modelId: "test-model",
    doGenerate: vi.fn(),
    doStream: vi.fn(),
    ...overrides,
  } as LanguageModelV1;
}

function makeGenerateResult(text: string | undefined) {
  return {
    content:
      text != null && text.length > 0 ? [{ type: "text" as const, text }] : [],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { promptTokens: 10, completionTokens: 5 },
    rawCall: { rawPrompt: null, rawSettings: {} },
  };
}

function makeToolCallResult() {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: "1",
        toolName: "test",
        input: {},
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage: { promptTokens: 10, completionTokens: 5 },
    rawCall: { rawPrompt: null, rawSettings: {} },
  };
}

function makeStreamResult(parts: Array<{ type: string; textDelta?: string }>) {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const p of parts) {
          controller.enqueue(p);
        }
        controller.close();
      },
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  };
}

function makeStreamResultFinite(parts: Array<Record<string, unknown>>) {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const p of parts) {
          controller.enqueue(p);
        }
        controller.close();
      },
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  };
}

describe("withRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards specificationVersion, provider, modelId from base model", () => {
    const base = makeBaseModel({
      provider: "my-provider",
      modelId: "my-model",
    });
    const wrapped = withRetry(base);
    expect(wrapped.specificationVersion).toBe("v1");
    expect(wrapped.provider).toBe("my-provider");
    expect(wrapped.modelId).toBe("my-model");
  });

  it("does not retry on successful doGenerate with text content", async () => {
    const doGenerate = vi
      .fn()
      .mockResolvedValue(makeGenerateResult("Hello world"));
    const base = makeBaseModel({ doGenerate });
    const wrapped = withRetry(base, { maxAttempts: 5, startingDelay: 1 });

    const result = await wrapped.doGenerate(testCallOptions);
    expect(doGenerate).toHaveBeenCalledTimes(1);
    const content = result as {
      content: Array<{ type: string; text?: string }>;
    };
    expect(content.content[0].text).toBe("Hello world");
  });

  it("retries on empty text content and succeeds", async () => {
    const doGenerate = vi
      .fn()
      .mockResolvedValueOnce(makeGenerateResult(""))
      .mockResolvedValueOnce(makeGenerateResult(undefined))
      .mockResolvedValueOnce(makeGenerateResult("Success at last"));

    const base = makeBaseModel({ doGenerate });
    const wrapped = withRetry(base, { maxAttempts: 5, startingDelay: 1 });

    const result = await wrapped.doGenerate(testCallOptions);
    expect(doGenerate).toHaveBeenCalledTimes(3);
    const content = result as {
      content: Array<{ type: string; text?: string }>;
    };
    expect(content.content[0].text).toBe("Success at last");
  });

  it("retries on whitespace-only text content", async () => {
    const doGenerate = vi
      .fn()
      .mockResolvedValueOnce(makeGenerateResult("   \n  "))
      .mockResolvedValueOnce(makeGenerateResult("real content"));

    const base = makeBaseModel({ doGenerate });
    const wrapped = withRetry(base, { maxAttempts: 5, startingDelay: 1 });

    const result = await wrapped.doGenerate(testCallOptions);
    expect(doGenerate).toHaveBeenCalledTimes(2);
    const content = result as {
      content: Array<{ type: string; text?: string }>;
    };
    expect(content.content[0].text).toBe("real content");
  });

  it("throws EmptyResponseError after exhausting all attempts", async () => {
    const doGenerate = vi.fn().mockResolvedValue(makeGenerateResult(""));
    const base = makeBaseModel({ doGenerate });
    const wrapped = withRetry(base, { maxAttempts: 3, startingDelay: 1 });

    await expect(wrapped.doGenerate(testCallOptions)).rejects.toThrow(
      EmptyResponseError,
    );
    expect(doGenerate).toHaveBeenCalledTimes(3);
  });

  it("does not retry on network errors (non-EmptyResponseError)", async () => {
    const networkError = new Error("Connection refused");
    const doGenerate = vi.fn().mockRejectedValue(networkError);
    const base = makeBaseModel({ doGenerate });
    const wrapped = withRetry(base, { maxAttempts: 5, startingDelay: 1 });

    await expect(wrapped.doGenerate(testCallOptions)).rejects.toThrow(
      "Connection refused",
    );
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it("does not retry when tool calls are present (even with empty text)", async () => {
    const doGenerate = vi.fn().mockResolvedValue(makeToolCallResult());
    const base = makeBaseModel({ doGenerate });
    const wrapped = withRetry(base, { maxAttempts: 5, startingDelay: 1 });

    const result = await wrapped.doGenerate(testCallOptions);
    expect(doGenerate).toHaveBeenCalledTimes(1);
    const content = result as { content: Array<{ type: string }> };
    expect(content.content.length).toBeGreaterThanOrEqual(1);
  });

  it("respects custom retry config values", async () => {
    const doGenerate = vi.fn().mockResolvedValue(makeGenerateResult(""));
    const base = makeBaseModel({ doGenerate });
    const wrapped = withRetry(base, { maxAttempts: 2, startingDelay: 1 });

    await expect(wrapped.doGenerate(testCallOptions)).rejects.toThrow(
      EmptyResponseError,
    );
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it("uses DEFAULT_RETRY_CONFIG when no config provided", async () => {
    const doGenerate = vi.fn().mockResolvedValue(makeGenerateResult(""));
    const base = makeBaseModel({ doGenerate });
    const wrapped = withRetry(base);

    await expect(wrapped.doGenerate(testCallOptions)).rejects.toThrow(
      EmptyResponseError,
    );
    expect(doGenerate).toHaveBeenCalledTimes(5);
  });

  it("retries doStream on empty stream and succeeds on replay", async () => {
    const emptyStream = makeStreamResult([]);
    const textStream = makeStreamResult([
      { type: "text-delta", textDelta: "Hello" },
      { type: "text-delta", textDelta: " World" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0 },
      },
    ]);

    const doStream = vi
      .fn()
      .mockResolvedValueOnce(emptyStream)
      .mockResolvedValueOnce(textStream);
    const base = makeBaseModel({ doStream });
    const wrapped = withRetry(base, { maxAttempts: 5, startingDelay: 1 });

    const result = await wrapped.doStream(testCallOptions);
    expect(doStream).toHaveBeenCalledTimes(2);

    const reader = result.stream.getReader();
    const chunks: Record<string, unknown>[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const textChunks = chunks.filter(
      (c) => (c as { type: string }).type === "text-delta",
    );
    expect(textChunks.length).toBeGreaterThan(0);
  });

  it("doStream exhausts retries on empty streams", async () => {
    const emptyStream = makeStreamResult([]);
    const doStream = vi.fn().mockResolvedValue(emptyStream);
    const base = makeBaseModel({ doStream });
    const wrapped = withRetry(base, { maxAttempts: 3, startingDelay: 1 });

    await expect(wrapped.doStream(testCallOptions)).rejects.toThrow(
      EmptyResponseError,
    );
    expect(doStream).toHaveBeenCalledTimes(3);
  });

  it("doStream does not retry when tool calls present in stream", async () => {
    const toolCallStream = makeStreamResultFinite([
      {
        type: "tool-call-delta",
        toolCallType: "function",
        toolCallId: "1",
        toolName: "test",
        argsTextDelta: "{}",
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        usage: { promptTokens: 0, completionTokens: 0 },
      },
    ]);
    const doStream = vi.fn().mockResolvedValue(toolCallStream);
    const base = makeBaseModel({ doStream });
    const wrapped = withRetry(base, { maxAttempts: 5, startingDelay: 1 });

    const result = await wrapped.doStream(testCallOptions);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });
});
