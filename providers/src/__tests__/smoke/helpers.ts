import type { LanguageModelV1 } from "ai";
import type { Qwen36ModelId } from "../../types";
import { createQwen36Provider } from "../../qwen36-provider";
import { createGemma4Provider } from "../../gemma4-provider";
import type { FleetEndpoint } from "./fleet-config";

type TestModel = LanguageModelV1 & {
  doGenerate: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text?: string }>;
  }>;
  doStream: (params: Record<string, unknown>) => Promise<{
    stream: AsyncIterable<{
      type: string;
      text?: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
  }>;
};

const MESSAGES_PROMPT = [
  { role: "user", content: [{ type: "text", text: "Say hello in one word." }] },
] as const;

const GENERATE_OPTS = {
  inputFormat: "messages",
  mode: { type: "regular" },
} as const;

export function createProviderForEndpoint(
  endpoint: FleetEndpoint,
  enableThinking = false,
): LanguageModelV1 {
  if (endpoint.type === "qwen36") {
    return createQwen36Provider({
      modelId: endpoint.model as Qwen36ModelId,
      baseURL: endpoint.url,
      enableThinking,
    });
  }
  return createGemma4Provider({
    baseURL: endpoint.url,
    enableThinking,
  });
}

export async function checkFleetReachable(url: string): Promise<void> {
  const modelsUrl = `${url.replace(/\/v1\/?$/, "")}/v1/models`;
  const response = await fetch(modelsUrl);
  if (!response.ok) {
    throw new Error(`Fleet endpoint ${url} returned HTTP ${response.status}`);
  }
}

export async function extractContent(model: LanguageModelV1): Promise<string> {
  const result = await (model as unknown as TestModel).doGenerate({
    ...GENERATE_OPTS,
    prompt: MESSAGES_PROMPT,
  });
  if (!result.content?.[0]?.text) {
    return "";
  }
  return result.content[0].text;
}

export async function streamContent(model: LanguageModelV1): Promise<string[]> {
  const chunks: string[] = [];
  const result = await (model as unknown as TestModel).doStream({
    ...GENERATE_OPTS,
    prompt: MESSAGES_PROMPT,
  });
  for await (const chunk of result.stream) {
    if (chunk.type === "text-delta" && chunk.text) {
      chunks.push(chunk.text);
    }
  }
  return chunks;
}
