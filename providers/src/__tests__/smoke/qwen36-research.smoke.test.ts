import { describe, it, expect, beforeAll } from "vitest";
import type { LanguageModelV1 } from "ai";
import { createQwen36Provider } from "../../qwen36-provider";
import { FLEET_ENDPOINTS } from "./fleet-config";
import { checkFleetReachable } from "./helpers";
import type { Qwen36ModelId } from "../../types";

type TestModel = LanguageModelV1 & {
  doGenerate: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text?: string }>;
  }>;
  doStream: (params: Record<string, unknown>) => Promise<{
    stream: AsyncIterable<{ type: string; text?: string }>;
  }>;
};

describe("Smoke: Qwen36 Research (deezx:8000 + deezx:8001)", () => {
  const endpoint = FLEET_ENDPOINTS.deezx_8000;
  const altEndpoint = FLEET_ENDPOINTS.deezx_8001;
  const modelId = endpoint.model as Qwen36ModelId;

  beforeAll(async () => {
    await checkFleetReachable(endpoint.url);
    await checkFleetReachable(altEndpoint.url);
  }, 15000);

  it("doGenerate on deezx:8000 returns content", async () => {
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
          content: [
            {
              type: "text",
              text: "What is the capital of France? Answer in one word.",
            },
          ],
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(typeof result.content[0].text).toBe("string");
    expect(result.content[0].text?.length).toBeGreaterThan(0);
  }, 90000);

  it("doStream on deezx:8000 yields text chunks", async () => {
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
  }, 90000);

  it("doGenerate on deezx:8001 (alternate lane) returns content", async () => {
    const model = createQwen36Provider({
      modelId,
      baseURL: altEndpoint.url,
      enableThinking: false,
    });

    const result = await (model as unknown as TestModel).doGenerate({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Say goodbye in one word." }],
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toBeDefined();
  }, 90000);
});
