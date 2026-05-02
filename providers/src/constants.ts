/**
 * Default context lengths (in tokens) for each supported model.
 */
export const DEFAULT_CONTEXT_LENGTHS: Record<string, number> = {
  "Qwen/Qwen3.6-35B-A3B": 262144,
  "Qwen/Qwen3.6-27B": 131072,
  "TrevorJS/gemma-4-26B-A4B-it-uncensored": 262144,
};

/**
 * Default request timeout in milliseconds (2 minutes).
 */
export const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Vision support flags per model.
 *
 * `Qwen/Qwen3.6-27B` is `false` because deezx runs with `--no-mmproj`.
 */
export const MODEL_SUPPORTS_VISION: Record<string, boolean> = {
  "Qwen/Qwen3.6-35B-A3B": true,
  "Qwen/Qwen3.6-27B": false,
  "TrevorJS/gemma-4-26B-A4B-it-uncensored": true,
};

import type { LlamaCppReasoningLevel } from "./types";

/**
 * Maps Vercel AI SDK v4 reasoning levels to llama.cpp `enable_thinking`.
 *
 * Only `'none'` maps to `false`; all other levels enable thinking.
 */
export const REASONING_LEVEL_MAP: Record<LlamaCppReasoningLevel, boolean> = {
  "provider-default": true,
  none: false,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
};
