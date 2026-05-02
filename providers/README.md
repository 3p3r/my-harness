# @my-harness/providers

Vercel AI SDK language model providers for a local llama.cpp inference fleet.

Wraps `@ai-sdk/openai-compatible` with custom `transformRequestBody` to inject `chat_template_kwargs` (reasoning toggle) into every request. Drop-in compatible with `generateText`, `streamText`, and other AI SDK primitives.

## Installation

```bash
npm install @my-harness/providers
```

Requires Node 20+ and the `ai` package (^4.0.0).

## Quick Start

### Qwen36 Provider (coding + research)

```typescript
import { generateText } from 'ai';
import { createQwen36Provider } from '@my-harness/providers';

const qwen = createQwen36Provider({
  modelId: 'Qwen/Qwen3.6-35B-A3B',
  baseURL: 'http://192.168.1.95:8010/v1',
});

const { text } = await generateText({
  model: qwen,
  prompt: 'Write a binary search in Rust.',
});
```

### Gemma4 Provider (thinking)

```typescript
import { streamText } from 'ai';
import { createGemma4Provider } from '@my-harness/providers';

const gemma = createGemma4Provider({
  baseURL: 'http://192.168.1.114:8000/v1',
});

const result = await streamText({
  model: gemma,
  prompt: 'Explain the halting problem.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

## Configuration

### createQwen36Provider

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `modelId` | `Qwen36ModelId` | Yes | — | `'Qwen/Qwen3.6-35B-A3B'` or `'Qwen/Qwen3.6-27B'` |
| `baseURL` | `string` | Yes | — | llama.cpp OpenAI-compatible endpoint (e.g., `http://host:port/v1`) |
| `enableThinking` | `boolean` | No | `true` | Passes `chat_template_kwargs.enable_thinking` to llama.cpp. Set `false` to disable reasoning output. |

### createGemma4Provider

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `baseURL` | `string` | Yes | — | llama.cpp OpenAI-compatible endpoint (e.g., `http://host:port/v1`) |
| `enableThinking` | `boolean` | No | `true` | Passes `chat_template_kwargs.enable_thinking` to llama.cpp. Set `false` to disable reasoning output. |

The Gemma4 provider always uses model ID `TrevorJS/gemma-4-26B-A4B-it-uncensored`.

## Feature Support

| Model | Vision | Reasoning | Tool Calls | Context Length |
|-------|--------|-----------|------------|----------------|
| Qwen3.6-35B-A3B | Yes | Yes | Yes | 262,144 |
| Qwen3.6-27B | No | Yes | Yes | 131,072 |
| Gemma-4-26B | Yes | Yes | Yes | 262,144 |

**Vision note:** The Qwen3.6-27B instance (deezx) runs with `--no-mmproj`, so it cannot process images. Use Qwen3.6-35B-A3B or Gemma-4-26B for multimodal prompts.

## Reasoning Toggle

Both providers default `enableThinking` to `true`. This maps directly to llama.cpp's `chat_template_kwargs.enable_thinking` and controls whether the model produces structured reasoning output alongside its final response.

Set `enableThinking: false` to skip reasoning and get direct responses:

```typescript
const qwen = createQwen36Provider({
  modelId: 'Qwen/Qwen3.6-35B-A3B',
  baseURL: 'http://192.168.1.95:8010/v1',
  enableThinking: false,
});
```

## Error Handling

Two custom error classes are exported for error handling:

- **`LlamaCppError`** — Base error for llama.cpp communication failures. Includes an optional `cause` property.
- **`LlamaCppParsingError`** — Thrown when response parsing fails. Includes `fieldName`, `fieldValue`, and `cause` properties for debugging.

```typescript
import { LlamaCppError, LlamaCppParsingError } from '@my-harness/providers';

try {
  // ...
} catch (err) {
  if (err instanceof LlamaCppParsingError) {
    console.error(`Parse failed on ${err.fieldName}:`, err.fieldValue);
  } else if (err instanceof LlamaCppError) {
    console.error('Provider error:', err.message);
  }
}
```

## Development

```bash
npm run build      # Compile TypeScript to dist/
npm test           # Run vitest test suite
npm run typecheck  # TypeScript type check (no emit)
```
