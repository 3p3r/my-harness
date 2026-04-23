# vLLM Checkpoint Report

## Current State

This is the short checkpoint snapshot of the currently verified serving commands.

- `deez1` is serving Qwen through `llama.cpp` Vulkan on port `8010`.
- `deez2` is serving exact multimodal Gemma through vLLM ROCm on port `8000`.

## `deez1` Current Command

Model:

- `0xSero/Qwen3.6-35B-A3B-GGUF-Strix`
- `Qwen3.6-35B-A3B-Q8_0.gguf`

Command:

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

Parameter notes:

- `--network host`: exposes the server directly on the host network.
- `--ipc host`: avoids tight shared-memory limits during model runtime.
- `--device=/dev/dri`: passes the GPU render device into the container for Vulkan.
- `--group-add video`: ensures the container process can access the GPU device nodes.
- `-v /root/models/qwen-gguf-strix:/models`: mounts the cached GGUF model directory.
- `-m /models/Qwen3.6-35B-A3B-Q8_0.gguf`: selects the verified `Q8_0` model file.
- `-ngl 999`: offloads as many layers as possible to the GPU.
- `-fa 1`: enables flash attention in the current tested runtime path.
- `-ctk q8_0`: uses `q8_0` K-cache quantization.
- `-ctv q8_0`: uses `q8_0` V-cache quantization.
- `-ub 2048`: sets the micro-batch style work buffer used by this serving path.
- `-b 2048`: sets the main batch size used by the server.
- `--host 0.0.0.0`: listens on all host interfaces.
- `--port 8010`: serves Qwen on port `8010`.

Important note:

- do not pass `tokenizer.json` to `--chat-template-file`; that caused the failed first `Q8_0` launch.

## `deez2` Current Command

Model:

- exact `OBLITERATUS/gemma-4-E4B-it-OBLITERATED`
- local model path: `/root/models/gemma-obliterated-patched`

Command:

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

Parameter notes:

- `--network host`: exposes the OpenAI-compatible API directly on the host.
- `--ipc host`: reduces shared-memory bottlenecks.
- `--privileged`: keeps the current verified ROCm container permissions aligned with the working path.
- `--cap-add=CAP_SYS_ADMIN` and `--cap-add=SYS_PTRACE`: preserve the permission set used by the stable Gemma launch.
- `--device=/dev/kfd`: exposes the ROCm compute interface.
- `--device=/dev/dri`: exposes GPU render nodes.
- `--device=/dev/mem`: preserves the exact tested hardware access path.
- `--security-opt seccomp=unconfined`: avoids seccomp restrictions that can interfere with this ROCm path.
- `--shm-size 16G`: provides large shared memory for vLLM runtime behavior.
- `-v /root/models/gemma-obliterated-patched:/model:ro`: mounts the repaired exact Gemma model directory read-only.
- `vllm/vllm-openai-rocm:gemma4`: uses the Gemma-specific ROCm vLLM image that worked here.
- `/model`: serves the mounted local model directory instead of pulling from a repo ID.
- `--host 0.0.0.0`: listens on all host interfaces.
- `--port 8000`: serves Gemma on port `8000`.
- `--tensor-parallel-size 1`: keeps the working single-GPU configuration.
- `--gpu-memory-utilization 0.90`: caps allocator pressure below full VRAM saturation.
- `--max-model-len 131072`: uses the highest currently verified exact multimodal context size.
- `--max-num-seqs 4`: keeps concurrency at the stable setting used for `131072` context.
- `--limit-mm-per-prompt '{"image":1,"audio":0,"video":0}'`: keeps multimodal enabled while constraining each request to one image and no audio or video.
- `--skip-mm-profiling`: avoids the multimodal profiling path that was associated with earlier instability.
- `--served-model-name OBLITERATUS/gemma-4-E4B-it-OBLITERATED`: publishes the exact model name through the API.

## API Endpoints

- `deez1` Qwen health: `http://deez1:8010/health`
- `deez1` Qwen completion: `http://deez1:8010/completion`
- `deez2` Gemma health: `http://deez2:8000/health`
- `deez2` Gemma chat completions: `http://deez2:8000/v1/chat/completions`