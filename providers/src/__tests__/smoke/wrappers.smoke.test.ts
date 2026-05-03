import { describe, it, expect, beforeAll } from "vitest";
import type { LanguageModelV1 } from "ai";
import { createQwen36Provider } from "../../qwen36-provider";
import { withRetry } from "../../retry-wrapper";
import { withConcurrencyLimit } from "../../queue-wrapper";
import { FLEET_ENDPOINTS } from "./fleet-config";
import { checkFleetReachable } from "./helpers";
import type { Qwen36ModelId } from "../../types";

type TestModel = LanguageModelV1 & {
  doGenerate: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text?: string }>;
  }>;
};

describe("Smoke: Retry + Queue Wrappers", () => {
  const endpoint = FLEET_ENDPOINTS.deez1_8010;
  const modelId = endpoint.model as Qwen36ModelId;

  beforeAll(async () => {
    await checkFleetReachable(endpoint.url);
  }, 10000);

  it("withRetry wraps a real model call and returns valid response", async () => {
    const model = createQwen36Provider({
      modelId,
      baseURL: endpoint.url,
      enableThinking: false,
    });

    const retriedModel = withRetry(model, {
      maxAttempts: 2,
      startingDelay: 100,
    });

    const result = await (retriedModel as unknown as TestModel).doGenerate({
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
  }, 120000);

  it("withConcurrencyLimit wraps model and returns valid response", async () => {
    const model = createQwen36Provider({
      modelId,
      baseURL: endpoint.url,
      enableThinking: false,
    });

    const queuedModel = withConcurrencyLimit(model, { maxConcurrency: 1 });

    const result = await (queuedModel as unknown as TestModel).doGenerate({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Say hi." }],
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toBeDefined();
  }, 90000);

  it("concurrency limit of 1 allows serial execution of multiple requests", async () => {
    const model = createQwen36Provider({
      modelId,
      baseURL: endpoint.url,
      enableThinking: false,
    });

    const queuedModel = withConcurrencyLimit(model, { maxConcurrency: 1 });

    const result1 = await (queuedModel as unknown as TestModel).doGenerate({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Say apple." }],
        },
      ],
    });
    expect(result1.content).toBeDefined();

    const result2 = await (queuedModel as unknown as TestModel).doGenerate({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Say banana." }],
        },
      ],
    });
    expect(result2.content).toBeDefined();
  }, 120000);
});
