import { LlamaCppError } from "./types";

/**
 * Thrown when a model returns an empty response (null/empty/whitespace content
 * with no tool calls and no reasoning content).
 * Used internally by the retry wrapper to trigger retry attempts.
 */
export class EmptyResponseError extends LlamaCppError {
  constructor(message = "Model returned empty response", cause?: unknown) {
    super(message, cause);
    this.name = "EmptyResponseError";
  }
}
