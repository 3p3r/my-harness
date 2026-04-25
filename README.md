# Local Inference Fleet

This repo holds the compose files, router config, templates, and smoke tests for the local four-host inference fleet.

## Fleet Overview

| Host | Role | Direct API | Model | Capacity | Best use |
| --- | --- | --- | --- | --- | --- |
| `deez1` | Coding | `http://192.168.1.95:8010/v1` | `Qwen/Qwen3.6-35B-A3B` | 4 shared slots, `262144` context pool | Coding, tool use, long-context code work |
| `deez2` | Thinking | `http://192.168.1.114:8000/v1`, `http://192.168.1.114:8001/v1` | `TrevorJS/gemma-4-26B-A4B-it-uncensored` | 4 total slots across two endpoints, `262144` context per endpoint | Multimodal prompts and long-context reasoning |
| `deezx` | Research | `http://192.168.1.161:8000/v1`, `http://192.168.1.161:8001/v1` | `Qwen/Qwen3-14B` | 2 lanes, `32768` context per lane | Fast short-window research and tool use |
| `deezr` | Router | `http://192.168.1.85:4000/v1` | LiteLLM aliases | Routes to the backend nodes | Main user-facing entry point on the LAN |

`deezr` is LAN-only and does not require a master key in the current setup.

## Router Aliases

| Alias | Backing node | Use it for |
| --- | --- | --- |
| `thinking` | `deez2` | Multimodal and long-context work with no-think default |
| `thinking-deep` | `deez2` | Explicit reasoning-enabled Gemma lane |
| `opus` | `deez2` | Compatibility alias for `thinking-deep` |
| `coding` | `deez1` | Coding, tool use, and long-context code tasks |
| `coder` | `deez1` | Compatibility alias for `coding` |
| `research` | `deezx` | Fast short-window research and tool use |
| `haiku` | `deezx` | Compatibility alias for `research` |

## Repo Layout

| Host | Remote deploy dir | Source in this repo | Required host state |
| --- | --- | --- | --- |
| `deez1` | `/opt/deez1` | [deez1/docker-compose.yaml](deez1/docker-compose.yaml), [deez1/tool_chat_template_qwen3coder.jinja](deez1/tool_chat_template_qwen3coder.jinja) | `/root/models/qwen-gguf-strix/Qwen3.6-35B-A3B-Q8_0.gguf` |
| `deez2` | `/opt/deez2` | [deez2/docker-compose.yaml](deez2/docker-compose.yaml) | Writable Hugging Face cache at `/root/.cache/huggingface` |
| `deezx` | `/opt/deezx` | [deezx/docker-compose.yaml](deezx/docker-compose.yaml), [deezx/tool_chat_template_qwen3coder.jinja](deezx/tool_chat_template_qwen3coder.jinja) | `/root/models/qwen3-14b-gguf/Qwen_Qwen3-14B-Q8_0.gguf` |
| `deezr` | `/opt/deezr` | [deezr/docker-compose.yaml](deezr/docker-compose.yaml), [deezr/config.yaml](deezr/config.yaml) | `config.yaml` stored beside the compose file |

## Current TPS Snapshot

Measured on `2026-04-25` with direct backend `/v1/chat/completions` requests using `temperature=0`, `cache_prompt=false`, `max_tokens=96`, `warmups=1`, `slot_runs=3`, and `node_runs=3`.

These are direct node measurements. `deezr` is not listed because it routes requests but does not generate tokens itself.

### Node Throughput

| Node | Slots | Avg decode tok/s | Avg wall tok/s |
| --- | --- | --- | --- |
| `deez1` | `4` | `126.27` | `102.30` |
| `deez2` | `4` | `84.88` | `69.84` |
| `deezx` | `2` | `102.74` | `99.25` |

### Slot Throughput

| Node | Endpoint | Slot | Avg tok/s |
| --- | --- | --- | --- |
| `deez1` | `192.168.1.95:8010` | `0` | `52.64` |
| `deez1` | `192.168.1.95:8010` | `1` | `52.60` |
| `deez1` | `192.168.1.95:8010` | `2` | `52.64` |
| `deez1` | `192.168.1.95:8010` | `3` | `52.61` |
| `deez2` | `192.168.1.114:8000` | `0` | `45.67` |
| `deez2` | `192.168.1.114:8000` | `1` | `45.73` |
| `deez2` | `192.168.1.114:8001` | `0` | `45.63` |
| `deez2` | `192.168.1.114:8001` | `1` | `45.71` |
| `deezx` | `192.168.1.161:8000` | `0` | `51.67` |
| `deezx` | `192.168.1.161:8001` | `0` | `51.05` |

The current snapshot shows `deezx` holding its isolated slot speed most cleanly under load, `deez1` offering the highest total coding throughput, and `deez2` providing the slowest tokens-per-second under full contention.

## Deploy Or Refresh

1. Copy the matching repo subdirectory to `/opt/deez1`, `/opt/deez2`, `/opt/deezx`, or `/opt/deezr`.
2. Confirm the model or cache path for that host exists.
3. Start the backend nodes first: `deez1`, `deez2`, then `deezx`.
4. Start `deezr` last.
5. After changing [deezr/config.yaml](deezr/config.yaml), reload the router with `docker compose up -d --force-recreate litellm-proxy`.
6. Re-run the smoke tests and the benchmark.
