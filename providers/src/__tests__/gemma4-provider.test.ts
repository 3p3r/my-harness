import { vi, describe, it, expect, afterEach } from "vitest";
import type { LanguageModelV1 } from "ai";
import {
  createGemma4Provider,
  type Gemma4ProviderConfig,
} from "../gemma4-provider";

type TestModel = LanguageModelV1 & {
  provider: string;
  modelId: string;
  doGenerate: (params: Record<string, unknown>) => Promise<unknown>;
  doStream: (params: Record<string, unknown>) => Promise<unknown>;
};

describe("createGemma4Provider", () => {
  const config: Gemma4ProviderConfig = {
    baseURL: "http://localhost:8000",
    enableThinking: true,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return a valid LanguageModelV1 object", async () => {
    const model = createGemma4Provider(config);
    expect(model).toBeDefined();
    expect(["v1", "v3"]).toContain(model.specificationVersion);
  });

  it("should call fetch with correct parameters", async () => {
    const model = createGemma4Provider(config);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([["x-request-id", "test-123"]]),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: "chatcmpl-123",
            object: "chat.completion",
            created: 1677652288,
            model: "TrevorJS/gemma-4-26B-A4B-it-uncensored",
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
          model: "TrevorJS/gemma-4-26B-A4B-it-uncensored",
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
    const configWithNoThinking: Gemma4ProviderConfig = {
      ...config,
      enableThinking: false,
    };
    const model = createGemma4Provider(configWithNoThinking);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([["x-request-id", "test-123"]]),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: "chatcmpl-123",
            object: "chat.completion",
            created: 1677652288,
            model: "TrevorJS/gemma-4-26B-A4B-it-uncensored",
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
          model: "TrevorJS/gemma-4-26B-A4B-it-uncensored",
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
});
