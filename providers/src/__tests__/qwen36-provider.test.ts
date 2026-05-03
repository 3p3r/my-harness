import { vi, describe, it, expect, afterEach } from "vitest";
import type { LanguageModelV1 } from "ai";
import {
  createQwen36Provider,
  type Qwen36ProviderConfig,
} from "../qwen36-provider";
import { reorderSystemFirst } from "../constants";

type TestModel = LanguageModelV1 & {
  provider: string;
  modelId: string;
  doGenerate: (params: Record<string, unknown>) => Promise<unknown>;
  doStream: (params: Record<string, unknown>) => Promise<unknown>;
};

describe("createQwen36Provider", () => {
  const config: Qwen36ProviderConfig = {
    modelId: "Qwen/Qwen3.6-35B-A3B",
    baseURL: "http://localhost:8010",
    enableThinking: true,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return a valid LanguageModelV1 object", async () => {
    const model = createQwen36Provider(config);
    expect(model).toBeDefined();
    expect(["v1", "v3"]).toContain(model.specificationVersion);
  });

  it("should call fetch with correct parameters", async () => {
    const model = createQwen36Provider(config);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([["x-request-id", "test-123"]]),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: "chatcmpl-123",
            object: "chat.completion",
            created: 1677652288,
            model: config.modelId,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Hello" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          }),
        ),
      json: () =>
        Promise.resolve({
          id: "chatcmpl-123",
          object: "chat.completion",
          created: 1677652288,
          model: config.modelId,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
    });

    vi.stubGlobal("fetch", fetchSpy);

    await (model as unknown as TestModel).doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
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
    const configWithNoThinking: Qwen36ProviderConfig = {
      ...config,
      enableThinking: false,
    };
    const model = createQwen36Provider(configWithNoThinking);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([["x-request-id", "test-123"]]),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: "chatcmpl-123",
            object: "chat.completion",
            created: 1677652288,
            model: config.modelId,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Hello" },
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
          model: config.modelId,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello" },
              finish_reason: "stop",
            },
          ],
        }),
    });

    vi.stubGlobal("fetch", fetchSpy);

    await (model as unknown as TestModel).doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
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

  describe("reorderSystemFirst (pure function)", () => {
    it("returns undefined for undefined input", () => {
      expect(reorderSystemFirst(undefined)).toBeUndefined();
    });

    it("returns single message as-is", () => {
      const msgs = [{ role: "user", content: "hello" }];
      expect(reorderSystemFirst(msgs)).toBe(msgs);
    });

    it("returns already-ordered messages unchanged (identity)", () => {
      const msgs = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ];
      expect(reorderSystemFirst(msgs)).toBe(msgs);
    });

    it("moves system message to position 0 when it is not first", () => {
      const msgs = [
        { role: "user", content: "Hi" },
        { role: "system", content: "You are helpful." },
      ];
      const result = reorderSystemFirst(msgs) as Array<{
        role?: string;
        [key: string]: unknown;
      }>;
      expect(result[0].role).toBe("system");
      expect(result[1].role).toBe("user");
    });

    it("moves developer message to position 0", () => {
      const msgs = [
        { role: "user", content: "Hi" },
        { role: "developer", content: "System instruction" },
      ];
      const result = reorderSystemFirst(msgs) as Array<{
        role?: string;
        [key: string]: unknown;
      }>;
      expect(result[0].role).toBe("developer");
      expect(result[1].role).toBe("user");
    });

    it("preserves relative order among system messages", () => {
      const msgs = [
        { role: "assistant", content: "Hi!" },
        { role: "system", content: "First" },
        { role: "system", content: "Second" },
        { role: "user", content: "Hello" },
      ];
      const result = reorderSystemFirst(msgs) as Array<{
        role?: string;
        [key: string]: unknown;
      }>;
      expect(result[0]).toEqual({ role: "system", content: "First" });
      expect(result[1]).toEqual({ role: "system", content: "Second" });
    });

    it("preserves relative order among non-system messages", () => {
      const msgs = [
        { role: "system", content: "S1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "U1" },
        { role: "assistant", content: "A2" },
        { role: "system", content: "S2" },
      ];
      const result = reorderSystemFirst(msgs) as Array<{
        role?: string;
        [key: string]: unknown;
      }>;
      expect(result[0]).toEqual({ role: "system", content: "S1" });
      expect(result[1]).toEqual({ role: "system", content: "S2" });
      expect(result[2]).toEqual({ role: "assistant", content: "A1" });
      expect(result[3]).toEqual({ role: "user", content: "U1" });
      expect(result[4]).toEqual({ role: "assistant", content: "A2" });
    });

    it("returns unchanged when all messages are system", () => {
      const msgs = [
        { role: "system", content: "A" },
        { role: "system", content: "B" },
      ];
      expect(reorderSystemFirst(msgs)).toBe(msgs);
    });

    it("returns unchanged when no system messages exist", () => {
      const msgs = [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ];
      expect(reorderSystemFirst(msgs)).toBe(msgs);
    });
  });
});
