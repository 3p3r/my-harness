import { describe, it, expect, beforeAll } from "vitest";
import type { LanguageModelV1 } from "ai";
import { createGemma4Provider } from "../../gemma4-provider";
import { FLEET_ENDPOINTS } from "./fleet-config";
import { checkFleetReachable } from "./helpers";

type TestModel = LanguageModelV1 & {
  doGenerate: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text?: string; reasoning?: string }>;
  }>;
  doStream: (params: Record<string, unknown>) => Promise<{
    stream: AsyncIterable<{ type: string; text?: string }>;
  }>;
};

describe("Smoke: Gemma4 Provider (deez2:8000 + deez2:8001)", () => {
  const endpoint = FLEET_ENDPOINTS.deez2_8000;
  const altEndpoint = FLEET_ENDPOINTS.deez2_8001;

  beforeAll(async () => {
    await checkFleetReachable(endpoint.url);
    await checkFleetReachable(altEndpoint.url);
  }, 15000);

  it("doGenerate on deez2:8000 returns content", async () => {
    const model = createGemma4Provider({
      baseURL: endpoint.url,
      enableThinking: false,
    });

    const result = await (model as unknown as TestModel).doGenerate({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Say hello in one word." }],
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(typeof result.content[0].text).toBe("string");
    expect(result.content[0].text?.length).toBeGreaterThan(0);
  }, 60000);

  it("doStream on deez2:8000 yields text chunks", async () => {
    const model = createGemma4Provider({
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

  it("doGenerate on deez2:8001 (alternate port) returns content", async () => {
    const model = createGemma4Provider({
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
  }, 60000);

  it("doGenerate with enableThinking returns content", async () => {
    const model = createGemma4Provider({
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
