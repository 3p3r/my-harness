# vLLM Quantization Push Report

## Scope

This report covers the follow-on optimization pass after the initial stabilization work.

The goals in this phase were:

- push Qwen above the previously working Q4-class fallback,
- keep Dockerized serving on the hosts,
- preserve exact Gemma where possible,
- restore and validate Gemma multimodal behavior,
- explore non-ROCm backend options if they offered a better quantization outcome without unacceptable speed loss.

This report is separate from the original stabilization report in [VLLM_DEBUG_REPORT.md](/home/sep/my-harness/VLLM_DEBUG_REPORT.md).

## Summary Of What Changed

### `deez2`

`deez2` was upgraded from a text-only exact Gemma serving path to a multimodal exact Gemma path, and that multimodal path was then pushed upward in context length.

Validated milestones reached on `deez2` during this phase:

- exact Gemma multimodal healthy at `32768`
- exact Gemma multimodal healthy at `65536`
- exact Gemma multimodal healthy at `131072`

### `deez1`

`deez1` moved from the previously working `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` vLLM ROCm baseline toward higher-precision GGUF variants under `llama.cpp` Vulkan.

Work completed in this phase:

- confirmed Vulkan `llama.cpp` container support on-host,
- identified Strix-tuned GGUF candidates,
- established a Q4 vLLM performance baseline for comparison,
- attempted `Q6_K` first as a practical high-quality intermediate,
- then pivoted to the explicitly requested `Q8_0` target,
- completed the `Q8_0` Vulkan benchmark successfully,
- verified that the corrected `Q8_0` runtime remained healthy after benchmarking.

## Key Constraints And Decisions

### Why `llama.cpp` Vulkan was introduced

The earlier stable Qwen path on `deez1` was:

- ROCm vLLM
- AWQ 4-bit
- text-only mode

That was stable, but it did not satisfy the new quantization target.

The most relevant alternative for higher quantization on this hardware was the Strix-focused GGUF path benchmarked for:

- `gfx1151`
- Vulkan
- `llama.cpp`

Vulkan support was confirmed by pulling and running:

```text
ghcr.io/ggml-org/llama.cpp:server-vulkan
```

The container loaded:

- Vulkan backend from `libggml-vulkan.so`
- CPU backend from `libggml-cpu-zen4.so`

### Why `Q6_K` was tried before `Q8_0`

The user requested that Q4 was not acceptable and also allowed at most about a `10%` token-speed regression if backends changed.

The Strix model card for the tuned GGUF repo indicated:

- `Q4_K_M`: described as the production sweet spot
- `Q6_K`: higher quality and still materially faster than `Q8_0`
- `Q8_0`: near-lossless reference but noticeably slower

That made `Q6_K` the first practical test candidate, but after the user explicitly stated that `Q8` was what had been promised, the active target was raised again to `Q8_0`.

## Backend And Artifact Discovery

### Host backend facts

On both hosts:

- ROCm device path available: yes
- `/dev/kfd`: present
- `/dev/dri/renderD128`: present
- `rocminfo`: present
- host-reported VRAM: `68719476736` bytes
- GPU arch: `gfx1151`

Later validation showed that this `68719476736`-byte figure matches a broader platform memory split: Linux currently sees only about `62 GiB` of normal system RAM on both hosts while firmware reserves another roughly `64.26 GiB` high-memory region before the OS boots. In other words, the current platform state is effectively `64 GB usable system RAM + ~64 GB firmware-reserved/graphics-addressable memory`, not `128 GB fully usable system RAM`.

On the hosts at probe time:

- `vulkaninfo`: not installed as a host command

That did not block Vulkan use inside containers.

### Candidate GGUF variants discovered

Two main Qwen GGUF sources were inspected:

- `0xSero/Qwen3.6-35B-A3B-GGUF-Strix`
- `bartowski/Qwen_Qwen3.6-35B-A3B-GGUF`

The Strix repo exposed these relevant variants:

- `Qwen3.6-35B-A3B-Q6_K.gguf`
- `Qwen3.6-35B-A3B-Q8_0.gguf`

The exact sizes resolved during this work were:

- Strix `Q6_K`: `28514152480` bytes
- Strix `Q8_0`: `36903139360` bytes

The Strix repo notes also stated approximate benchmark guidance on Vulkan for `gfx1151`, with `Q8_0` presented as near-lossless but slower than `Q6_K` and Q4-class variants.

## `deez1` Detailed Work

### Baseline retained for comparison

Before changing backends, the old working Q4-class baseline on `deez1` was re-run and measured.

Baseline configuration:

- container: `vllm/vllm-openai-rocm:v0.19.1`
- model: `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`
- text-only mode
- `--skip-mm-profiling`
- `--max-model-len 32768` for the benchmark run

Measured baseline result:

- `128` completion tokens in `8.56` seconds

This is the reference number used for later comparison.

### Vulkan container validation

The following image was pulled and verified on `deez1`:

```text
ghcr.io/ggml-org/llama.cpp:server-vulkan
```

This confirmed that the Vulkan backend path was available and could be used without first installing host-side developer tooling.

### `Q6_K` phase

The first higher-quant path attempted on `deez1` used:

- `0xSero/Qwen3.6-35B-A3B-GGUF-Strix`
- `Qwen3.6-35B-A3B-Q6_K.gguf`
- `llama.cpp` Vulkan server
- `-ngl 999`
- `-fa 1`
- `-ctk q8_0`
- `-ctv q8_0`
- `-ub 2048`
- `-b 2048`

The download was initially interrupted by:

```text
curl: (18) transfer closed with 9983180077 bytes remaining to read
```

That did not invalidate the path. The file on disk was resumable and was resumed successfully with `curl -C -`.

The resumed transfer completed to the exact expected size:

```text
28514152480 bytes
```

After the `Q6_K` file finished, the user explicitly reaffirmed that `Q8` was the true promised target, so the active deez1 target changed again before settling on the `Q6_K` benchmark as the final answer.

### `Q8_0` phase

The active `deez1` target was then raised to:

- `Qwen3.6-35B-A3B-Q8_0.gguf`

Expected exact file size:

```text
36903139360 bytes
```

The `Q8_0` pipeline was launched with:

- resumable `curl -C -`
- explicit exact-size checks
- automatic `llama.cpp` Vulkan launch after download
- automatic completion benchmark after server readiness

The first `Q8_0` launch failed immediately because `tokenizer.json` was incorrectly passed to:

```text
--chat-template-file
```

That file is not a Jinja chat template. `llama.cpp` rejected it with a template parse error and exited before serving.

After removing the bad template wiring, the corrected `Q8_0` Vulkan launch succeeded.

Final verified `Q8_0` results on `deez1`:

- file downloaded to exact expected size: `36903139360` bytes
- health endpoint: `200`
- container state after benchmark: still running
- observed runtime context per slot: `262144`
- benchmark run 1: `128` tokens in `3.58s`, `37.88` tokens/s
- benchmark run 2: `128` tokens in `3.43s`, `39.39` tokens/s

Relative to the earlier Q4 baseline of `128` tokens in `8.56s`, the verified `Q8_0` Vulkan path was substantially faster rather than slower.

### Deez1 runtime configuration under test

The `llama.cpp` Vulkan server launch under test was:

```bash
docker run -d --name qwen-llama \
  --network host --ipc host \
  --device=/dev/dri --group-add video \
  -v /root/models/qwen-gguf-strix:/models \
  ghcr.io/ggml-org/llama.cpp:server-vulkan \
  -m /models/Qwen3.6-35B-A3B-Q8_0.gguf \
  -ngl 999 -fa 1 -ctk q8_0 -ctv q8_0 -ub 2048 -b 2048 \
  --host 0.0.0.0 --port 8010
```

This corrected launch relied on the model's built-in chat template discovery instead of forcing a broken template file.

## `deez2` Detailed Work

### New hard requirement from user

The user clarified that:

```text
My Gemma host MUST have multi modal ON, text only Gemma is not usable to me
```

That changed the requirement materially. The prior exact Gemma success from the first report was text-only, and therefore no longer sufficient.

### Multimodal relaunch strategy

The relaunch path retained the exact local model directory while turning image support back on:

- model path: `/root/models/gemma-obliterated-patched`
- image modality enabled with:

```text
--limit-mm-per-prompt '{"image":1,"audio":0,"video":0}'
```

- multimodal profiling still skipped:

```text
--skip-mm-profiling
```

Skipping multimodal profiling remained important because earlier multimodal profiling behavior had been one of the major instability sources in the overall session.

### Validated multimodal milestones

#### `32768`

The first successful exact multimodal relaunch was done at:

- `--max-model-len 32768`

This came up healthy.

An initial inline data-URL image test failed, but that turned out to be a bad test payload, not a model failure.

Once the image payload was corrected, multimodal serving worked.

#### `65536`

The next successful exact multimodal relaunch was done at:

- `--max-model-len 65536`
- `--max-num-seqs 16`

This run:

- reached health,
- reported `max_model_len: 65536`,
- served a real image request successfully.

Measured image request result at `65536`:

- response time: `4.48` seconds
- response: a correct short description of the test image

#### `131072`

The next successful exact multimodal relaunch was done at:

- `--max-model-len 131072`
- `--max-num-seqs 4`

This run:

- reached health,
- reported `max_model_len: 131072`,
- served a real image request successfully.

Measured image request result at `131072`:

- response time: `4.34` seconds
- response: a correct short description of the test image

Later in-session re-verification also succeeded with an inline generated PNG payload, which returned:

```text
A red and blue flag with a yellow circle in the center.
```

That inline verification completed in:

- `1.48` seconds

This is the current best proven exact multimodal Gemma setting from this optimization pass.

### Current best exact multimodal Gemma command

```bash
docker run -d --name gemma-vllm \
  --network host --ipc host --privileged \
  --cap-add=CAP_SYS_ADMIN --cap-add=SYS_PTRACE \
  --device=/dev/kfd --device=/dev/dri --device=/dev/mem \
  --security-opt seccomp=unconfined --shm-size 16G \
  -v /root/models/gemma-obliterated-patched:/model:ro \
  vllm/vllm-openai-rocm:gemma4 \
  /model \
  --host 0.0.0.0 --port 8000 \
  --tensor-parallel-size 1 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 131072 \
  --max-num-seqs 4 \
  --limit-mm-per-prompt '{"image":1,"audio":0,"video":0}' \
  --skip-mm-profiling \
  --served-model-name OBLITERATUS/gemma-4-E4B-it-OBLITERATED
```

## Comparison Snapshot

### Best validated `deez1` baseline so far

- backend: ROCm vLLM
- model: `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`
- quant class: 4-bit AWQ fallback
- completion: `128` tokens
- elapsed: `8.56s`

Approximate throughput for this baseline:

- about `14.95` tokens/s

### Best validated `deez1` higher-quant state so far

- backend: Vulkan `llama.cpp`
- model: `0xSero/Qwen3.6-35B-A3B-GGUF-Strix`
- quant target: `Q8_0`
- health endpoint: `200`
- observed slot context: `262144`
- verified run 1: `128` tokens in `3.58s`
- verified run 2: `128` tokens in `3.43s`
- measured throughput range: `37.88` to `39.39` tokens/s
- status after benchmark: still serving

### Best validated `deez2` exact multimodal state so far

- backend: ROCm vLLM
- model: exact `OBLITERATUS/gemma-4-E4B-it-OBLITERATED`
- multimodal: image enabled
- `max_model_len`: `131072`
- image request validated: yes
- measured image request time: `4.34s`
- later inline-image re-validation: yes
- later inline-image re-validation time: `1.48s`

### Speed outcome

- user tolerance for backend switching: about `10%` slower at most
- observed result: `Q8_0` Vulkan was materially faster than the Q4 baseline
- conclusion: the verified `Q8_0` path met the quality target without violating the speed target

## What Worked In This Optimization Round

- validating Vulkan `llama.cpp` on `deez1`
- using the Strix-specific GGUF repo for better hardware relevance
- keeping Dockerized inference on-host rather than moving the workload locally
- restoring exact Gemma multimodal instead of accepting text-only Gemma
- pushing exact multimodal Gemma from `32768` to `65536` and then to `131072`
- using known-good remote image URLs for multimodal validation
- using inline image payloads to remove third-party fetch failures from multimodal verification
- resuming interrupted long GGUF downloads with `curl -C -`
- removing the invalid `--chat-template-file /models/tokenizer.json` argument from the Q8 launch
- validating that `Q8_0` stayed up and served successfully after benchmarking

## What Failed Or Changed Direction

- inline image data URL test for Gemma failed because the test payload itself was malformed, not because multimodal serving was broken
- a later Gemma re-check against an external Wikimedia image failed because the upstream URL returned `403 Forbidden` to the server fetch path, not because multimodal support regressed
- first long `Q6_K` download ended with `curl: (18)` and required a resume pass
- `Q6_K` was not accepted as the final destination once the user reaffirmed that `Q8` was the promised target
- the first `Q8_0` server launch failed because `tokenizer.json` was incorrectly passed as a chat template file

## Final Outcome

Final verified state at the end of this optimization round:

- `deez1`: `Qwen3.6-35B-A3B-Q8_0.gguf` is serving successfully under `llama.cpp` Vulkan in Docker
- `deez1`: verified throughput is about `37.88` to `39.39` tokens/s for `128` generated tokens
- `deez1`: this is substantially faster than the earlier Q4 vLLM baseline of about `14.95` tokens/s
- `deez1`: observed slot context is `262144`
- `deez2`: exact `OBLITERATUS/gemma-4-E4B-it-OBLITERATED` remains healthy with multimodal enabled
- `deez2`: exact multimodal serving is validated at `131072`
- `deez2`: a fresh inline image verification succeeded at the end of this work

On the evidence collected in this phase, the promised higher-quant target was reached and verified without sacrificing token speed.