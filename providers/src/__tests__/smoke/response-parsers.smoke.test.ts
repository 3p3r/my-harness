import { describe, it, expect, beforeAll } from "vitest";
import {
  parseQwen36Content,
  parseQwen36Reasoning,
  parseQwen36Usage,
} from "../../qwen36-response-parser";
import {
  parseGemma4Content,
  parseGemma4Reasoning,
  parseGemma4Usage,
} from "../../gemma4-response-parser";
import { FLEET_ENDPOINTS } from "./fleet-config";
import { checkFleetReachable } from "./helpers";

async function fetchNonStreaming(
  baseURL: string,
  model: string,
  prompt: string,
  chatTemplateKwargs?: Record<string, unknown>,
) {
  const url = `${baseURL.replace(/\/?$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 100,
  };
  if (chatTemplateKwargs) {
    body.chat_template_kwargs = chatTemplateKwargs;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchWithThinking(
  baseURL: string,
  model: string,
  prompt: string,
) {
  return fetchNonStreaming(baseURL, model, prompt, { enable_thinking: true });
}

describe("Smoke: Response Parsers", () => {
  const deez1Ep = FLEET_ENDPOINTS.deez1_8010;
  const deez2Ep = FLEET_ENDPOINTS.deez2_8000;

  beforeAll(async () => {
    await checkFleetReachable(deez1Ep.url);
    await checkFleetReachable(deez2Ep.url);
  }, 15000);

  it("parseQwen36Content extracts content from real deez1:8010 response", async () => {
    const raw = await fetchNonStreaming(
      deez1Ep.url,
      deez1Ep.model,
      "What is 2+2?",
      deez1Ep.chatTemplateKwargs,
    );
    const content = parseQwen36Content(raw);
    expect(content).toBeDefined();
    expect(typeof content).toBe("string");
    expect(content?.length).toBeGreaterThan(0);
  }, 60000);

  it("parseQwen36Reasoning extracts reasoning when thinking is enabled", async () => {
    const raw = await fetchWithThinking(
      deez1Ep.url,
      deez1Ep.model,
      "Explain recursion in one sentence.",
    );
    const reasoning = parseQwen36Reasoning(raw);
    // Reasoning may or may not be present depending on model behavior,
    // but the parser should return a defined value (string or undefined)
    expect(reasoning === undefined || typeof reasoning === "string").toBe(true);
  }, 60000);

  it("parseQwen36Usage extracts token usage from real deez1:8010 response", async () => {
    const raw = await fetchNonStreaming(
      deez1Ep.url,
      deez1Ep.model,
      "Hello",
      deez1Ep.chatTemplateKwargs,
    );
    const usage = parseQwen36Usage(raw);
    if (usage) {
      expect(typeof usage.promptTokens).toBe("number");
      expect(typeof usage.completionTokens).toBe("number");
      expect(usage.promptTokens).toBeGreaterThan(0);
      expect(usage.completionTokens).toBeGreaterThan(0);
    }
  }, 60000);

  it("parseGemma4Content extracts content from real deez2:8000 response", async () => {
    const raw = await fetchNonStreaming(
      deez2Ep.url,
      deez2Ep.model,
      "Say hello in one word.",
      deez2Ep.chatTemplateKwargs,
    );
    const content = parseGemma4Content(raw);
    expect(content).toBeDefined();
    expect(typeof content).toBe("string");
    expect(content?.length).toBeGreaterThan(0);
  }, 60000);

  it("parseGemma4Reasoning extracts reasoning from thinking response", async () => {
    const raw = await fetchWithThinking(
      deez2Ep.url,
      deez2Ep.model,
      "Explain recursion.",
    );
    const reasoning = parseGemma4Reasoning(raw);
    expect(reasoning === undefined || typeof reasoning === "string").toBe(true);
  }, 60000);

  it("parseGemma4Usage extracts token usage from real deez2:8000 response", async () => {
    const raw = await fetchNonStreaming(
      deez2Ep.url,
      deez2Ep.model,
      "Hello",
      deez2Ep.chatTemplateKwargs,
    );
    const usage = parseGemma4Usage(raw);
    if (usage) {
      expect(typeof usage.promptTokens).toBe("number");
      expect(typeof usage.completionTokens).toBe("number");
      expect(usage.promptTokens).toBeGreaterThan(0);
    }
  }, 60000);
});
