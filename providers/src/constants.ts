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
import type { RetryConfig, QueueConfig } from "./types";

/**
 * Default retry configuration values.
 */
export const DEFAULT_RETRY_CONFIG: Readonly<Required<RetryConfig>> = {
  maxAttempts: 5,
  startingDelay: 200,
  timeMultiple: 2,
  jitter: "full",
} as const;

/**
 * Default queue configuration values.
 */
export const DEFAULT_QUEUE_CONFIG: Readonly<Required<QueueConfig>> = {
  maxConcurrency: 1,
  queuedMessage: "Prompt queued. Capacity busy, will process in FIFO order.",
} as const;

/**
 * Reorder messages so any system/developer messages are first.
 *
 * The Qwen3.6 Jinja chat template requires system messages at position 0.
 * If a system message appears elsewhere, llama.cpp raises:
 *   "System message must be at the beginning."
 *
 * This function preserves relative order among system messages and among
 * non-system messages. If messages are already correctly ordered, it returns
 * the array unchanged (identity for the common case).
 */
export function reorderSystemFirst(
  messages: Array<{ role?: string; [key: string]: unknown }> | undefined,
): Array<{ role?: string; [key: string]: unknown }> | undefined {
  if (!messages || messages.length < 2) return messages;

  let seenNonSystem = false;
  let needsReorder = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const role = msg.role;
    if (role === "system" || role === "developer") {
      if (seenNonSystem) {
        needsReorder = true;
        break;
      }
    } else {
      seenNonSystem = true;
    }
  }

  if (!needsReorder) return messages;

  const systemMsgs: Array<{ role?: string; [key: string]: unknown }> = [];
  const otherMsgs: Array<{ role?: string; [key: string]: unknown }> = [];

  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") {
      systemMsgs.push(m);
    } else {
      otherMsgs.push(m);
    }
  }

  return [...systemMsgs, ...otherMsgs];
}

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
