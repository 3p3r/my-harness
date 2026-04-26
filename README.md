# Local Inference Fleet

This repo holds the compose files, router config, templates, and smoke tests for the local four-host inference fleet.

## Fleet Overview

| Host | Role | Direct API | Model | Capacity | Best use |
| --- | --- | --- | --- | --- | --- |
| `deez1` | Coding | `http://192.168.1.95:8010/v1` | `Qwen/Qwen3.6-35B-A3B` | 4 shared slots, `262144` context pool | Coding, tool use, long-context code work |
| `deez2` | Thinking | `http://192.168.1.114:8000/v1`, `http://192.168.1.114:8001/v1` | `TrevorJS/gemma-4-26B-A4B-it-uncensored` | 4 total slots across two endpoints, `262144` context per endpoint | Multimodal prompts and long-context reasoning |
| `deezx` | Research | `http://192.168.1.161:8000/v1`, `http://192.168.1.161:8001/v1` | `Qwen/Qwen3.6-27B` | 2 lanes, `131072` context per lane | Native-long-context research and tool use |
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
| `research` | `deezx` | Native-long-context research and tool use |
| `haiku` | `deezx` | Compatibility alias for `research` |

## Repo Layout

| Host | Remote deploy dir | Source in this repo | Required host state |
| --- | --- | --- | --- |
| `deez1` | `/opt/deez1` | [deez1/docker-compose.yaml](deez1/docker-compose.yaml), [deez1/tool_chat_template_qwen3coder.jinja](deez1/tool_chat_template_qwen3coder.jinja) | `/root/models/qwen-gguf-strix/Qwen3.6-35B-A3B-Q8_0.gguf` |
| `deez2` | `/opt/deez2` | [deez2/docker-compose.yaml](deez2/docker-compose.yaml) | Writable Hugging Face cache at `/root/.cache/huggingface` |
| `deezx` | `/opt/deezx` | [deezx/docker-compose.yaml](deezx/docker-compose.yaml), [deezx/tool_chat_template_qwen3coder.jinja](deezx/tool_chat_template_qwen3coder.jinja) | `/root/models/qwen3.6-27b-gguf/Qwen_Qwen3.6-27B-Q4_K_M.gguf` |
| `deezr` | `/opt/deezr` | [deezr/docker-compose.yaml](deezr/docker-compose.yaml), [deezr/config.yaml](deezr/config.yaml) | `config.yaml` stored beside the compose file |

## Current TPS Snapshot

Measured on `2026-04-25` with direct backend `/v1/chat/completions` requests using `temperature=0`, `cache_prompt=false`, `max_tokens=96`, `warmups=1`, `slot_runs=3`, and `node_runs=3`.

These are direct node measurements. `deezr` is not listed because it routes requests but does not generate tokens itself.

### Node Throughput

| Node | Slots | Avg decode tok/s | Avg wall tok/s |
| --- | --- | --- | --- |
| `deez1` | `4` | `126.80` | `105.17` |
| `deez2` | `4` | `82.74` | `70.06` |
| `deezx` | `2` | `77.65` | `69.48` |

### Slot Throughput

| Node | Endpoint | Slot | Avg tok/s |
| --- | --- | --- | --- |
| `deez1` | `192.168.1.95:8010` | `0` | `52.37` |
| `deez1` | `192.168.1.95:8010` | `1` | `52.45` |
| `deez1` | `192.168.1.95:8010` | `2` | `52.46` |
| `deez1` | `192.168.1.95:8010` | `3` | `52.44` |
| `deez2` | `192.168.1.114:8000` | `0` | `44.10` |
| `deez2` | `192.168.1.114:8000` | `1` | `45.77` |
| `deez2` | `192.168.1.114:8001` | `0` | `45.75` |
| `deez2` | `192.168.1.114:8001` | `1` | `45.71` |
| `deezx` | `192.168.1.161:8000` | `0` | `39.11` |
| `deezx` | `192.168.1.161:8001` | `0` | `38.62` |

The current snapshot shows `deez1` still delivering the highest total coding throughput, `deez2` holding steady on multimodal reasoning, and `deezx` trading raw speed for a native `131072`-token research window on each 3090 lane.

## Deploy Or Refresh

1. Copy the matching repo subdirectory to `/opt/deez1`, `/opt/deez2`, `/opt/deezx`, or `/opt/deezr`.
2. Confirm the model or cache path for that host exists.
3. Start the backend nodes first: `deez1`, `deez2`, then `deezx`.
4. Start `deezr` last.
5. After changing [deezr/config.yaml](deezr/config.yaml), reload the router with `docker compose up -d --force-recreate litellm-proxy`.
6. Re-run the smoke tests and the benchmark.
