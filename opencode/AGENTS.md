# Fleet Inference Harness

All inference routes through `http://deezr:4000/v1`. The router maps two model names to backend nodes:

| Model | Backend | Slots | Context | Best for |
|-------|---------|-------|---------|----------|
| `my-opus` | deez1 + deez2 (Gemma 4 26B) | **8** | 262k | Multimodal, reasoning, coding |
| `my-haiku` | deezx (Qwen3.6 27B) | **2** | 131k | Research, tool use |

## Hard rules

1. **Never exceed per-model slot limits.** `my-haiku` has only 2 slots — leave headroom. Mix models across parallel agents to spread load.
2. **Fleet is slow.** Per-request latency ranges from seconds to 30+ minutes at the high end. Nodes sleep after 1h idle; first wake-up takes extra seconds. Cold boot: 5-30 min.
3. **All sub-agents consume fleet slots.** Only Sisyphus (orchestrator) is remote. Every `task()`, explore, librarian, and category agent burns a slot.
4. **Retries amplify load.** Router has `num_retries: 2`. If you see timeouts, reduce concurrency — don't retry harder.
5. **Git is denied** for all sub-agents. Only the orchestrator runs git.
6. **Never poll for results**, the sub agents will notify you when they're done. Polling causes unnecessary load and can lead to cascading failures.
7. **Cache-prompt is fast.** Repeated long prefixes get 5-10x speedup. Reuse conversation prefixes when possible.
