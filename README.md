# Local Inference Fleet

This repo holds the compose files, router config, and templates for the local four-host inference fleet.

## Fleet Overview

| Host | Role | Direct API | Model | Capacity | Best use |
| --- | --- | --- | --- | --- | --- |
| `deez1` | Coding | `http://192.168.1.95:8000/v1`, `http://192.168.1.95:8001/v1` | `TrevorJS/gemma-4-26B-A4B-it-uncensored` | 4 total slots across two endpoints, `262144` context per endpoint | Coding, tool use, long-context code work |
| `deez2` | Thinking | `http://192.168.1.114:8000/v1`, `http://192.168.1.114:8001/v1` | `TrevorJS/gemma-4-26B-A4B-it-uncensored` | 4 total slots across two endpoints, `262144` context per endpoint | Multimodal prompts and long-context reasoning |
| `deezx` | Research | `http://192.168.1.161:8000/v1`, `http://192.168.1.161:8001/v1` | `Qwen/Qwen3.6-27B` | 2 lanes, `131072` context per lane | Native-long-context research and tool use |
| `deezr` | Router | `http://192.168.1.85:4000/v1` | LiteLLM aliases | Routes to the backend nodes | Main user-facing entry point on the LAN |

`deezr` is LAN-only and does not require a master key in the current setup.

## Router Aliases

The router maps OpenCode model names to backend model groups via `deezr/config.yaml`:

| Alias | LiteLLM group | Backing node | Backend model |
| --- | --- | --- | --- |
| `my-opus` | `geminis` | `deez1` + `deez2` | `TrevorJS/gemma-4-26B-A4B-it-uncensored` (8 slots across both nodes, 262k context, multimodal) |
| `my-haiku` | `smaller-qwens` | `deezx` | `Qwen/Qwen3.6-27B` (2 lanes, 131k context each) |

These are the only model names the router recognizes in the current config. Legacy aliases (`coding`, `coder`, `thinking`, `thinking-deep`, `opus`, `research`, `haiku`) have been removed.

## Repo Layout

| Host | Remote deploy dir | Source in this repo | Required host state |
| --- | --- | --- | --- |
| `deez1` | `/opt/deez1` | [deez1/docker-compose.yaml](deez1/docker-compose.yaml) | Writable Hugging Face cache at `/root/.cache/huggingface` |
| `deez2` | `/opt/deez2` | [deez2/docker-compose.yaml](deez2/docker-compose.yaml) | Writable Hugging Face cache at `/root/.cache/huggingface` |
| `deezx` | `/opt/deezx` | [deezx/docker-compose.yaml](deezx/docker-compose.yaml), [deezx/tool_chat_template_qwen3coder.jinja](deezx/tool_chat_template_qwen3coder.jinja) | `/root/models/qwen3.6-27b-gguf/Qwen_Qwen3.6-27B-Q4_K_M.gguf` |
| `deezr` | `/opt/deezr` | [deezr/docker-compose.yaml](deezr/docker-compose.yaml), [deezr/config.yaml](deezr/config.yaml) | `config.yaml` stored beside the compose file |

## Current TPS Snapshot

Measured on `2026-04-26` with direct backend `/v1/chat/completions` requests using `temperature=0`, `cache_prompt=false`, `max_tokens=96`, `warmups=1`, `slot_runs=3`, and `node_runs=3`.

The current llama.cpp profile also enables `--spec-type ngram-map-k`, `--cache-reuse 256`, and `--no-mmap` on the Gemma and Qwen nodes. The standard benchmark keeps `cache_prompt=false`, so these tables mostly reflect decode-side changes and intentionally do not include prompt-cache wins.

These are direct node measurements. `deezr` is not listed because it routes requests but does not generate tokens itself.

### Node Throughput

| Node | Slots | Avg decode tok/s | Avg wall tok/s |
| --- | --- | --- | --- |
| `deez1` | `4` | `125.52` | `99.24` |
| `deez2` | `4` | `82.57` | `70.18` |
| `deezx` | `2` | `97.21` | `88.74` |

### Slot Throughput

| Node | Endpoint | Slot | Avg tok/s |
| --- | --- | --- | --- |
| `deez1` | `192.168.1.95:8010` | `0` | `52.47` |
| `deez1` | `192.168.1.95:8010` | `1` | `52.51` |
| `deez1` | `192.168.1.95:8010` | `2` | `52.53` |
| `deez1` | `192.168.1.95:8010` | `3` | `52.11` |
| `deez2` | `192.168.1.114:8000` | `0` | `44.00` |
| `deez2` | `192.168.1.114:8000` | `1` | `45.76` |
| `deez2` | `192.168.1.114:8001` | `0` | `45.77` |
| `deez2` | `192.168.1.114:8001` | `1` | `45.71` |
| `deezx` | `192.168.1.161:8000` | `0` | `42.86` |
| `deezx` | `192.168.1.161:8001` | `0` | `39.89` |

A follow-up long-prefix probe with `cache_prompt=true` and a shared `20k`-token prefix showed the new cache-reuse path collapsing prompt time on the second request from about `35.8s -> 4.0s` on `deez1`, `22.6s -> 0.34s` on `deez2`, and `16.7s -> 1.0s` on `deezx` while keeping decode speed flat.

The current snapshot reflects the pre-migration setup where `deez1` ran Qwen 35B. `deez1` has since been migrated to Gemma 4 (matching `deez2`). Updated benchmarks are pending.

## Deploy Or Refresh

1. Copy the matching repo subdirectory to `/opt/deez1`, `/opt/deez2`, `/opt/deezx`, or `/opt/deezr`.
2. Confirm the model or cache path for that host exists.
3. Start the backend nodes first: `deez1`, `deez2`, then `deezx`.
4. Start `deezr` last.
5. After changing [deezr/config.yaml](deezr/config.yaml), reload the router with `docker compose up -d --force-recreate litellm-proxy`.
6. Re-run the benchmark.
