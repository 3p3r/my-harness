import { describe, it, expect, vi } from "vitest";
import { withConcurrencyLimit } from "../queue-wrapper";
import type { LanguageModelV1, LanguageModelV1CallOptions } from "ai";

const testCallOptions: LanguageModelV1CallOptions = {
  inputFormat: "messages",
  mode: { type: "regular" },
  prompt: [],
};

type ContentPart = { type: string; text?: string };

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

function makeResolveControlled(): {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
} {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeResult(text: string) {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { promptTokens: 10, completionTokens: 5 },
    rawCall: { rawPrompt: null, rawSettings: {} },
  };
}

function getText(result: unknown): string {
  const parts = (result as { content: ContentPart[] }).content;
  const textPart = parts.find((p) => p.type === "text");
  return textPart?.text ?? "";
}

function getFinishReason(result: unknown): string {
  return (result as { finishReason: { unified: string } }).finishReason.unified;
}

describe("withConcurrencyLimit", () => {
  it("forwards specificationVersion, provider, modelId from base model", () => {
    const base = makeBaseModel({
      provider: "my-provider",
      modelId: "my-model",
    });
    const wrapped = withConcurrencyLimit(base);
    expect(wrapped.specificationVersion).toBe("v1");
    expect(wrapped.provider).toBe("my-provider");
    expect(wrapped.modelId).toBe("my-model");
  });

  it("processes normally when slot is free (doGenerate)", async () => {
    const doGenerate = vi.fn().mockResolvedValue(makeResult("real response"));
    const base = makeBaseModel({ doGenerate });
    const wrapped = withConcurrencyLimit(base, { maxConcurrency: 1 });

    const result = await wrapped.doGenerate(testCallOptions);
    expect(getText(result)).toBe("real response");
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it("returns synthetic response when at capacity (doGenerate)", async () => {
    const controlled = makeResolveControlled();
    const doGenerate = vi.fn().mockReturnValue(controlled.promise);
    const base = makeBaseModel({ doGenerate });
    const wrapped = withConcurrencyLimit(base, { maxConcurrency: 1 });

    const firstPromise = wrapped.doGenerate(testCallOptions);

    const secondResult = await wrapped.doGenerate(testCallOptions);

    expect(getText(secondResult)).toBe(
      "Prompt queued. Capacity busy, will process in FIFO order.",
    );
    expect(getFinishReason(secondResult)).toBe("stop");
    expect(
      (secondResult as { usage: { promptTokens: number } }).usage.promptTokens,
    ).toBe(0);

    controlled.resolve(makeResult("real from first"));
    const firstResult = await firstPromise;
    expect(getText(firstResult)).toBe("real from first");
  });

  it("returns synthetic stream when at capacity (doStream)", async () => {
    const controlled = makeResolveControlled();
    const doStream = vi.fn().mockReturnValue(controlled.promise);
    const base = makeBaseModel({ doStream });
    const wrapped = withConcurrencyLimit(base, { maxConcurrency: 1 });

    wrapped.doStream(testCallOptions);

    const secondResult = await wrapped.doStream(testCallOptions);

    const reader = (
      secondResult as { stream: ReadableStream }
    ).stream.getReader();
    const chunks: Record<string, unknown>[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Record<string, unknown>);
    }

    const textChunks = chunks.filter((c) => c.type === "text-delta");
    expect(textChunks.length).toBe(1);
    expect((textChunks[0] as { textDelta: string }).textDelta).toBe(
      "Prompt queued. Capacity busy, will process in FIFO order.",
    );
    expect(chunks.some((c) => c.type === "finish")).toBe(true);
  });

  it("releases slot after successful doGenerate", async () => {
    const doGenerate = vi
      .fn()
      .mockResolvedValueOnce(makeResult("first"))
      .mockResolvedValueOnce(makeResult("second"));
    const base = makeBaseModel({ doGenerate });
    const wrapped = withConcurrencyLimit(base, { maxConcurrency: 1 });

    const first = await wrapped.doGenerate(testCallOptions);
    expect(getText(first)).toBe("first");

    const second = await wrapped.doGenerate(testCallOptions);
    expect(getText(second)).toBe("second");

    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it("releases slot after errored doGenerate", async () => {
    const error = new Error("model crash");
    const doGenerate = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(makeResult("after error"));
    const base = makeBaseModel({ doGenerate });
    const wrapped = withConcurrencyLimit(base, { maxConcurrency: 1 });

    await expect(wrapped.doGenerate(testCallOptions)).rejects.toThrow(
      "model crash",
    );

    const second = await wrapped.doGenerate(testCallOptions);
    expect(getText(second)).toBe("after error");
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it("respects custom maxConcurrency", async () => {
    const c1 = makeResolveControlled();
    const c2 = makeResolveControlled();
    let callIndex = 0;
    const doGenerate = vi.fn().mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return c1.promise;
      if (callIndex === 2) return c2.promise;
      return Promise.resolve(makeResult("third"));
    });
    const base = makeBaseModel({ doGenerate });
    const wrapped = withConcurrencyLimit(base, { maxConcurrency: 2 });

    wrapped.doGenerate(testCallOptions);
    wrapped.doGenerate(testCallOptions);

    const result3 = await wrapped.doGenerate(testCallOptions);
    expect(getText(result3)).toContain("queued");

    c1.resolve(makeResult("first"));
    c2.resolve(makeResult("second"));
  });

  it("uses custom queuedMessage", async () => {
    const controlled = makeResolveControlled();
    const doGenerate = vi.fn().mockReturnValue(controlled.promise);
    const base = makeBaseModel({ doGenerate });
    const wrapped = withConcurrencyLimit(base, {
      maxConcurrency: 1,
      queuedMessage: "Custom: server busy",
    });

    wrapped.doGenerate(testCallOptions);
    const result = await wrapped.doGenerate(testCallOptions);
    expect(getText(result)).toBe("Custom: server busy");
  });

  it("defaults to maxConcurrency 1 when no config provided", async () => {
    const controlled = makeResolveControlled();
    const doGenerate = vi.fn().mockReturnValue(controlled.promise);
    const base = makeBaseModel({ doGenerate });
    const wrapped = withConcurrencyLimit(base);

    wrapped.doGenerate(testCallOptions);
    const result = await wrapped.doGenerate(testCallOptions);
    expect(getText(result)).toBe(
      "Prompt queued. Capacity busy, will process in FIFO order.",
    );
  });

  it("releases slot after errored doStream (finally block)", async () => {
    const error = new Error("stream crash");
    const doStream = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "text-delta", textDelta: "after error" });
            c.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      } as unknown as ReturnType<LanguageModelV1["doStream"]>);
    const base = makeBaseModel({ doStream });
    const wrapped = withConcurrencyLimit(base, { maxConcurrency: 1 });

    await expect(wrapped.doStream(testCallOptions)).rejects.toThrow(
      "stream crash",
    );

    const result = await wrapped.doStream(testCallOptions);
    expect(doStream).toHaveBeenCalledTimes(2);
    const reader = (result as { stream: ReadableStream }).stream.getReader();
    const chunks: Record<string, unknown>[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Record<string, unknown>);
    }
    const textChunks = chunks.filter((c) => c.type === "text-delta");
    expect(textChunks.length).toBe(1);
    expect((textChunks[0] as { textDelta: string }).textDelta).toBe(
      "after error",
    );
  });
});
