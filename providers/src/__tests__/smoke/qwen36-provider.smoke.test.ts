import { describe, it, expect, beforeAll } from "vitest";
import type { LanguageModelV1 } from "ai";
import { createQwen36Provider } from "../../qwen36-provider";
import { FLEET_ENDPOINTS } from "./fleet-config";
import { checkFleetReachable } from "./helpers";
import type { Qwen36ModelId } from "../../types";

type TestModel = LanguageModelV1 & {
  doGenerate: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text?: string }>;
    finishReason?: string;
    usage?: { promptTokens: number; completionTokens: number };
  }>;
  doStream: (params: Record<string, unknown>) => Promise<{
    stream: AsyncIterable<{
      type: string;
      text?: string;
      textDelta?: string;
    }>;
  }>;
};

describe("Smoke: Qwen36 Provider (deez1:8010)", () => {
  const endpoint = FLEET_ENDPOINTS.deez1_8010;
  const modelId = endpoint.model as Qwen36ModelId;

  beforeAll(async () => {
    await checkFleetReachable(endpoint.url);
  }, 10000);

  it("doGenerate returns content for simple prompt", async () => {
    const model = createQwen36Provider({
      modelId,
      baseURL: endpoint.url,
      enableThinking: false,
    });

    const result = await (model as unknown as TestModel).doGenerate({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "What is 2+2? Answer in one word." }],
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(typeof result.content[0].text).toBe("string");
    expect(result.content[0].text?.length).toBeGreaterThan(0);
  }, 60000);

  it("doStream yields text chunks", async () => {
    const model = createQwen36Provider({
      modelId,
      baseURL: endpoint.url,
      enableThinking: false,
    });

    const result = await (model as unknown as TestModel).doStream({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Say hello." }],
        },
      ],
    });

    expect(result.stream).toBeDefined();

    let chunkCount = 0;
    for await (const chunk of result.stream) {
      chunkCount++;
      expect(chunk.type).toBeDefined();
    }
    expect(chunkCount).toBeGreaterThan(0);
  }, 60000);

  it("doGenerate with enableThinking sends chat_template_kwargs", async () => {
    const model = createQwen36Provider({
      modelId,
      baseURL: endpoint.url,
      enableThinking: true,
    });

    const result = await (model as unknown as TestModel).doGenerate({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Explain recursion in one sentence." },
          ],
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toBeDefined();
  }, 60000);
});
