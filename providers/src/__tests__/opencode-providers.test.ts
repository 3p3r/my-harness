import { describe, it, expect } from "vitest";
import {
  deez1_8010,
  deez2_8000,
  deez2_8001,
  deezx_8000,
  deezx_8001,
} from "../opencode-providers";

describe("opencode-providers", () => {
  it("deez1_8010 returns provider wrapping Qwen36 on deez1:8010", () => {
    const p = deez1_8010();
    expect(typeof p.languageModel).toBe("function");
    const m = p.languageModel();
    expect(m.modelId).toBe("Qwen/Qwen3.6-35B-A3B");
  });

  it("deez2_8000 with modelId=thinking returns Gemma4 without thinking", () => {
    const p = deez2_8000();
    expect(typeof p.languageModel).toBe("function");
    const m = p.languageModel("thinking");
    expect(m.modelId).toBe("TrevorJS/gemma-4-26B-A4B-it-uncensored");
  });

  it("deez2_8000 with modelId=thinking-deep returns Gemma4 with enableThinking", () => {
    const p = deez2_8000();
    const m = p.languageModel("thinking-deep");
    expect(m.modelId).toBe("TrevorJS/gemma-4-26B-A4B-it-uncensored");
    expect(typeof m.doGenerate).toBe("function");
  });

  it("deez2_8001 returns provider wrapping Gemma4 on deez2:8001", () => {
    const p = deez2_8001();
    expect(typeof p.languageModel).toBe("function");
    const m = p.languageModel();
    expect(m.modelId).toBe("TrevorJS/gemma-4-26B-A4B-it-uncensored");
  });

  it("deezx_8000 returns provider wrapping Qwen36 27B on deezx:8000", () => {
    const p = deezx_8000();
    expect(typeof p.languageModel).toBe("function");
    const m = p.languageModel();
    expect(m.modelId).toBe("Qwen/Qwen3.6-27B");
  });

  it("deezx_8001 returns provider wrapping Qwen36 27B on deezx:8001", () => {
    const p = deezx_8001();
    expect(typeof p.languageModel).toBe("function");
    const m = p.languageModel();
    expect(m.modelId).toBe("Qwen/Qwen3.6-27B");
  });
});
