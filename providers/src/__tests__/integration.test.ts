import { vi, describe, it, expect, afterEach } from "vitest";
import type { LanguageModelV1 } from "ai";
import { createQwen36Provider } from "../qwen36-provider";
import type { Qwen36ModelId } from "../types";
import { createGemma4Provider } from "../gemma4-provider";

type TestModel = LanguageModelV1 & {
  provider: string;
  modelId: string;
  doGenerate: (params: Record<string, unknown>) => Promise<unknown>;
  doStream: (params: Record<string, unknown>) => Promise<unknown>;
};

describe("Providers Integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockFetchResponse = (modelId: string, content: string = "Hello") => ({
    ok: true,
    headers: new Map(),
    text: () =>
      Promise.resolve(
        JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion",
          created: 1677652288,
          model: modelId,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
        }),
      ),
    json: () =>
      Promise.resolve({
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: modelId,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
      }),
  });

  describe("Qwen36 Provider", () => {
    const modelIds: Qwen36ModelId[] = [
      "Qwen/Qwen3.6-35B-A3B",
      "Qwen/Qwen3.6-27B",
    ];

    it.each(modelIds)("should work with modelId: %s", async (modelId) => {
      const config = {
        modelId,
        baseURL: "http://localhost:8010",
        enableThinking: true,
      };
      const model = createQwen36Provider(config);

      // 1. Verify LanguageModelV1 properties
      expect(["v1", "v3"]).toContain(model.specificationVersion);
      // We use (model as any) because these might not be in the official LanguageModelV1 interface
      expect((model as unknown as TestModel).provider).toBe(
        "llama-cpp-qwen36.chat",
      );
      expect((model as unknown as TestModel).modelId).toBe(modelId);
      expect(typeof model.doGenerate).toBe("function");
      expect(typeof model.doStream).toBe("function");

      // 2. Verify API call
      const fetchSpy = vi.fn().mockResolvedValue(mockFetchResponse(modelId));
      vi.stubGlobal("fetch", fetchSpy);

      await (model as unknown as TestModel).doGenerate({
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/chat/completions"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"chat_template_kwargs":{"enable_thinking":true}',
          ),
        }),
      );
    });

    it("should handle disabled thinking", async () => {
      const modelId = "Qwen/Qwen3.6-35B-A3B" as Qwen36ModelId;
      const config = {
        modelId,
        baseURL: "http://localhost:8010",
        enableThinking: false,
      };
      const model = createQwen36Provider(config);

      const fetchSpy = vi.fn().mockResolvedValue(mockFetchResponse(modelId));
      vi.stubGlobal("fetch", fetchSpy);

      await (model as unknown as TestModel).doGenerate({
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"chat_template_kwargs":{"enable_thinking":false}',
          ),
        }),
      );
    });

    it("should handle fetch failures", async () => {
      const modelId = "Qwen/Qwen3.6-35B-A3B" as Qwen36ModelId;
      const config = {
        modelId,
        baseURL: "http://localhost:8010",
      };
      const model = createQwen36Provider(config);

      const fetchSpy = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        (model as unknown as TestModel).doGenerate({
          inputFormat: "messages",
          mode: { type: "regular" },
          prompt: [
            { role: "user", content: [{ type: "text", text: "Hello" }] },
          ],
        }),
      ).rejects.toThrow("Network error");
    });
  });

  describe("Gemma4 Provider", () => {
    const modelId = "TrevorJS/gemma-4-26B-A4B-it-uncensored";

    it("should work with default configuration", async () => {
      const config = {
        baseURL: "http://localhost:8000",
        enableThinking: true,
      };
      const model = createGemma4Provider(config);

      // 1. Verify LanguageModelV1 properties
      expect(["v1", "v3"]).toContain(model.specificationVersion);
      expect((model as unknown as TestModel).provider).toBe(
        "llama-cpp-gemma4.chat",
      );
      expect((model as unknown as TestModel).modelId).toBe(modelId);
      expect(typeof model.doGenerate).toBe("function");
      expect(typeof model.doStream).toBe("function");

      // 2. Verify API call
      const fetchSpy = vi.fn().mockResolvedValue(mockFetchResponse(modelId));
      vi.stubGlobal("fetch", fetchSpy);

      await (model as unknown as TestModel).doGenerate({
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/chat/completions"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"chat_template_kwargs":{"enable_thinking":true}',
          ),
        }),
      );
    });

    it("should handle disabled thinking", async () => {
      const config = {
        baseURL: "http://localhost:8000",
        enableThinking: false,
      };
      const model = createGemma4Provider(config);

      const fetchSpy = vi.fn().mockResolvedValue(mockFetchResponse(modelId));
      vi.stubGlobal("fetch", fetchSpy);

      await (model as unknown as TestModel).doGenerate({
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"chat_template_kwargs":{"enable_thinking":false}',
          ),
        }),
      );
    });

    it("should handle fetch failures", async () => {
      const config = {
        baseURL: "http://localhost:8000",
      };
      const model = createGemma4Provider(config);

      const fetchSpy = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        (model as unknown as TestModel).doGenerate({
          inputFormat: "messages",
          mode: { type: "regular" },
          prompt: [
            {
              role: "user",
              content: [{ type: "text", text: "Hello" }],
            },
          ],
        }),
      ).rejects.toThrow("Network error");
    });
  });

  describe("Retry + Queue Composition", () => {
    const normalResponse = (content: string = "Hello") =>
      mockFetchResponse("test-model", content);

    it("Qwen provider with retry config returns valid LanguageModelV1", () => {
      const model = createQwen36Provider({
        modelId: "Qwen/Qwen3.6-35B-A3B",
        baseURL: "http://localhost:8010",
        retry: { maxAttempts: 3, startingDelay: 1 },
      });

      expect(["v1", "v3"]).toContain(model.specificationVersion);
      expect(typeof model.doGenerate).toBe("function");
      expect(typeof model.doStream).toBe("function");
    });

    it("Qwen provider with queue config returns valid LanguageModelV1", () => {
      const model = createQwen36Provider({
        modelId: "Qwen/Qwen3.6-35B-A3B",
        baseURL: "http://localhost:8010",
        queue: { maxConcurrency: 2 },
      });

      expect(["v1", "v3"]).toContain(model.specificationVersion);
      expect(typeof model.doGenerate).toBe("function");
      expect(typeof model.doStream).toBe("function");
    });

    it("Qwen provider with both retry and queue configs works", () => {
      const model = createQwen36Provider({
        modelId: "Qwen/Qwen3.6-35B-A3B",
        baseURL: "http://localhost:8010",
        retry: { maxAttempts: 3 },
        queue: { maxConcurrency: 1 },
      });

      expect(["v1", "v3"]).toContain(model.specificationVersion);
      expect(typeof model.doGenerate).toBe("function");
      expect(typeof model.doStream).toBe("function");
    });

    it("Gemma provider with both configs works", () => {
      const model = createGemma4Provider({
        baseURL: "http://localhost:8000",
        retry: { maxAttempts: 2 },
        queue: { maxConcurrency: 1, queuedMessage: "Server busy" },
      });

      expect(["v1", "v3"]).toContain(model.specificationVersion);
      expect(typeof model.doGenerate).toBe("function");
      expect(typeof model.doStream).toBe("function");
    });

    it("provider without retry/queue still works (backwards compatible)", async () => {
      const model = createQwen36Provider({
        modelId: "Qwen/Qwen3.6-27B",
        baseURL: "http://localhost:8010",
      });

      const fetchSpy = vi
        .fn()
        .mockResolvedValue(normalResponse("backwards compat"));
      vi.stubGlobal("fetch", fetchSpy);

      const result = await (model as unknown as TestModel).doGenerate({
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });

      const resultObj = result as {
        content: Array<{ type: string; text?: string }>;
      };
      expect(resultObj.content[0].text).toBe("backwards compat");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("retry triggers on empty API response in composed provider", async () => {
      const model = createQwen36Provider({
        modelId: "Qwen/Qwen3.6-35B-A3B",
        baseURL: "http://localhost:8010",
        retry: { maxAttempts: 3, startingDelay: 1 },
      });

      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(mockFetchResponse("test", ""))
        .mockResolvedValueOnce(mockFetchResponse("test", ""))
        .mockResolvedValueOnce(
          mockFetchResponse("test", "Success after retry"),
        );
      vi.stubGlobal("fetch", fetchSpy);

      const result = await (model as unknown as TestModel).doGenerate({
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });

      const resultObj = result as {
        content: Array<{ type: string; text?: string }>;
      };
      expect(resultObj.content[0].text).toBe("Success after retry");
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });
});
