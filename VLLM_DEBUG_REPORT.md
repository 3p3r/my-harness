# vLLM Debug And Stabilization Report

## Scope

This report documents the full remote debugging and stabilization session for two LAN hosts:

- `deez1` at `192.168.1.95`
- `deez2` at `192.168.1.114`

Both hosts are AMD Strix Halo systems running Ubuntu 24.04 with ROCm and vLLM ROCm containers.

This report was reconstructed from:

- the saved VS Code Copilot transcript for this session,
- the session summaries captured during the run,
- live validation performed at the end of the session,
- the final working launch commands and runtime outputs.

The goal of the session was to get the requested model combination running as stably as possible, at the highest viable quantization and context settings that would actually hold on the hardware without crashing.

## Final Commands Table

The table below starts from the original launch intent and shows the final commands that actually worked.

| Host | Original target / launch intent | Final command that worked | Result |
| --- | --- | --- | --- |
| `deez1` | `Qwen/Qwen3.6-35B-A3B-FP8` via `vllm/vllm-openai-rocm:v0.19.1`, originally tested with `--max-model-len 8192`, `--reasoning-parser qwen3`, `--enforce-eager`, text-only mode | Fallback to `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` on `vllm/vllm-openai-rocm:v0.19.1`, with `--max-model-len 262144`, `--language-model-only`, `--skip-mm-profiling` | Worked and served on port `8000` before shutdown |
| `deez2` | `OBLITERATUS/gemma-4-E4B-it-OBLITERATED` via `vllm/vllm-openai-rocm:gemma4`, originally as a repo-id launch with multimodal limits | Exact model served from local repaired path `/root/models/gemma-obliterated-patched` on `vllm/vllm-openai-rocm:gemma4`, with `--max-model-len 131072`, `--language-model-only`, `--skip-mm-profiling` | Worked and served on port `8000` before shutdown |

## Exact Final Commands

### `deez1` final working Qwen command

```bash
token=$(sed -n 's/^export HF_TOKEN="\(.*\)"$/\1/p' /root/.bashrc | head -n1)

docker run -d --name qwen-vllm \
  --network host --ipc host --privileged \
  --cap-add=CAP_SYS_ADMIN --cap-add=SYS_PTRACE \
  --device=/dev/kfd --device=/dev/dri --device=/dev/mem \
  --security-opt seccomp=unconfined --shm-size 16G \
  -v /root/.cache/huggingface:/root/.cache/huggingface \
  -e HF_TOKEN="$token" \
  -e HUGGING_FACE_HUB_TOKEN="$token" \
  vllm/vllm-openai-rocm:v0.19.1 \
  cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit \
  --host 0.0.0.0 --port 8000 \
  --tensor-parallel-size 1 \
  --gpu-memory-utilization 0.92 \
  --max-model-len 262144 \
  --language-model-only \
  --skip-mm-profiling \
  --served-model-name cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
```

### `deez2` final working Gemma command

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
  --gpu-memory-utilization 0.92 \
  --max-model-len 131072 \
  --language-model-only \
  --skip-mm-profiling \
  --served-model-name OBLITERATUS/gemma-4-E4B-it-OBLITERATED
```

## Final Outcome Summary

### What was achieved

- `deez1` ended in a working state with `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` serving successfully.
- `deez1` was validated at `max_model_len=262144`.
- `deez2` ended in a working state with the exact `OBLITERATUS/gemma-4-E4B-it-OBLITERATED` model serving successfully from a repaired local model directory.
- `deez2` was validated at `max_model_len=131072`.

### What did not become possible

- The exact original `Qwen/Qwen3.6-35B-A3B-FP8` target did not become runnable on this stack.
- The blocker was not just a missing file or a bad launch flag. It was a platform/backend limitation combined with ROCm instability specific to this setup and, later, a separate multimodal profiling OOM path on the AWQ fallback before text-only mode was enforced.

### Why the final launches were text-only

Both final working commands use:

- `--language-model-only`
- `--skip-mm-profiling`

This was intentional. The multimodal towers were the source of either startup-time memory blowups or unnecessary initialization overhead for the requested serving objective. Text-only mode was the stable path that allowed both systems to remain online and answer inference requests.

## End-State Verification

At the end of the session, after the working configurations had been validated, both hosts were explicitly shut down so that no vLLM servers remained running.

Final verification performed:

- `docker ps` returned no running containers on `deez1`
- `docker ps` returned no running containers on `deez2`
- `curl http://127.0.0.1:8000/health` returned `000` on both hosts after shutdown

This left both Geekoms idle for on-demand launch later.

## Environment And Host Facts

### Host inventory

- `deez1`: Ubuntu 24.04, kernel `6.17.0-22-generic`
- `deez2`: Ubuntu 24.04, kernel `6.17.0-22-generic`
- Docker: `29.4.1`
- Host ROCm version: `7.2.2`
- GPU marketing name as seen through ROCm: AMD Strix Halo integrated Radeon 8060S class device
- GPU architecture: `gfx1151`
- GPU device id: `0x1586`

### Important capacity note

During probing, the useful GPU-visible capacity reported through ROCm/HIP was about `64 GiB`, not a discrete `128 GiB VRAM` pool. This mattered directly for vLLM KV-cache sizing and model feasibility. The retail product marketing may advertise `128 GB` as unified system memory potential, but the relevant runtime budget for the GPU process path was the HIP-reported effective capacity, not the marketing sheet.

### vLLM images used

- `deez1`: `vllm/vllm-openai-rocm:v0.19.1`
- `deez2`: `vllm/vllm-openai-rocm:gemma4`

## Host-Level Remediation

This was the most important infrastructure fix in the entire session.

### Symptom that forced the host-level fix

Before the final model work could stabilize, both hosts showed ROCm-level failure behavior, including GPU memory access faults and page faults even on operations small enough that model-size explanations no longer made sense.

The decisive sign was that the issue reproduced below the level of a large model launch.

### Kernel parameter change

Both hosts had `/etc/default/grub` changed to include:

```bash
amdgpu.cwsr_enable=0
```

This was applied through the normal bootloader path and then committed with:

```bash
update-grub
```

### Firmware rollback

Both hosts received older known-good MES firmware overrides under:

- `/lib/firmware/updates/amdgpu/gc_11_5_1_mes1.bin`
- `/lib/firmware/updates/amdgpu/gc_11_5_1_mes_2.bin`

The original override files were backed up in host-local backup directories.

### Initramfs rebuild and reboot sequence

After the firmware override files were installed, the following path was used:

```bash
update-initramfs -u -k all
update-grub
reboot
```

### MES firmware versions before and after

Before the fix, both hosts booted bad MES firmware values:

- `MES feature version: 0x00000083`
- `MES_KIQ: 0x0000006f`

After rollback, both hosts booted the corrected values:

- `MES feature version: 0x0000006e`
- `MES_KIQ: 0x0000006c`

### Torch validation after remediation

After the host fix, GPU compute was revalidated on `deez1` using `/root/amd-torch`.

Two specific validations were called out:

- a tiny `a.zero_()` write on GPU memory
- a `2048x2048` GPU matmul

Both passed after the firmware rollback, which confirmed that the ROCm platform itself was no longer fundamentally broken.

## Authentication And Hugging Face Handling

### Initial issue

The user stated that `HF_TOKEN` existed in each box's `.bashrc`. That was true, but non-interactive command paths and Docker launches were not inheriting it reliably.

### What was learned

- `HF_TOKEN` in `/root/.bashrc` alone was insufficient for the non-interactive container paths used here.
- The containers emitted unauthenticated Hugging Face warnings until this was fixed.

### Corrective actions

The token was handled in three ways:

1. Read directly from `/root/.bashrc` with `sed` during launch wrappers.
2. Written into the standard Hugging Face token cache path:

   ```text
   /root/.cache/huggingface/token
   ```

3. Passed explicitly into containers as:

   - `HF_TOKEN`
   - `HUGGING_FACE_HUB_TOKEN`

This removed the earlier rate-limit and unauthenticated access warnings during the successful runs.

## Detailed Chronology

The sections below document the session in step order, including what was attempted, what failed, what changed, and what eventually worked.

### Phase 1: Access, automation, and host probing

1. Verified local automation options.
2. Found `python3` available locally and initially explored `pexpect` / Python-based SSH automation.
3. Confirmed host resolution for `deez1` and `deez2`.
4. Tried multiple SSH automation patterns.
5. Determined that the cleanest reliable non-interactive route was `SSH_ASKPASS` with a temporary helper script that prints a literal single-space password.
6. Also explored interactive persistent SSH sessions, but that path was unreliable because the literal single-space password did not survive the terminal bridge consistently.
7. Converged on shell-based `SSH_ASKPASS` as the stable remote execution method.

### Phase 2: Initial environment inspection

8. Probed both hosts for:
   - OS and kernel version
   - Docker version
   - device nodes under `/dev/kfd` and `/dev/dri`
   - ROCm visibility
   - VRAM and memory state
   - installed vLLM images
   - Hugging Face cache presence
9. Confirmed both hosts could run the vLLM ROCm containers and that containerized PyTorch could see a ROCm device.
10. Noted that the device name string in some early probes was blank even when the GPU was visible, which reinforced that the runtime was fragile.

### Phase 3: First direct model launch failures

#### `deez1` original FP8 Qwen attempt

11. Launched `Qwen/Qwen3.6-35B-A3B-FP8` through `vllm/vllm-openai-rocm:v0.19.1`.
12. The launch resolved model config and entered engine initialization.
13. It then failed with a ROCm GPU page fault:

```text
Memory access fault by GPU node-1 ... Reason: Page not present or supervisor privilege.
```

14. This produced `RuntimeError: Engine core initialization failed` in vLLM.

#### `deez2` original Gemma repo-id attempt

15. Launched `OBLITERATUS/gemma-4-E4B-it-OBLITERATED` with `--limit-mm-per-prompt image=2,audio=1,video=1`.
16. The image rejected that argument format outright.
17. vLLM expected JSON for that image build, not the comma form originally tried.

### Phase 4: Determining whether `deez1` was broken globally or only on FP8 Qwen

18. Ran a tiny baseline smoke test on `deez1` with a small Qwen model.
19. The small-model path still reproduced the same GPU page fault during engine startup.
20. That demonstrated the issue was broader than the exact FP8 target and pointed to host/platform instability.

### Phase 5: Host-level ROCm and firmware stabilization

21. Shifted focus from vLLM flags to the underlying ROCm platform.
22. Identified bad MES firmware behavior on Strix Halo.
23. Applied the firmware rollback and kernel parameter fix described above.
24. Rebuilt initramfs, updated grub, and rebooted.
25. Re-validated host GPU compute using the standalone AMD torch environment.
26. Confirmed the host-level crash path was gone.

This was the turning point. Everything after this depended on the host fix.

### Phase 6: Re-evaluating the exact Qwen FP8 path

27. After host recovery, re-tested and investigated whether the exact `Qwen/Qwen3.6-35B-A3B-FP8` target could be made to run.
28. Determined that the current `gfx1151` + ROCm + vLLM stack did not provide a viable FP8 MoE backend for that exact target.
29. Stopped spending time re-proving that unsupported path.

### Phase 7: Qwen fallback selection

30. Switched to the nearest viable fallback:

```text
cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
```

31. Quantization in vLLM identified as `compressed-tensors`.
32. Began using the Hugging Face cache on `deez1` to stage this model.

### Phase 8: Hugging Face cache and download repair for Qwen AWQ

33. Observed that Qwen downloads were incomplete and, at points, very slow due to authentication not being passed into containers correctly.
34. Ensured token availability as described earlier.
35. Confirmed final presence of all five Qwen blob files in the cache.
36. Restored the snapshot symlink layout so the snapshot contained all five `model-0000X-of-00005.safetensors` entries again.
37. Learned an important failure mode here:

- copying partial Hugging Face blob files directly into snapshot files and resuming them as if they were final files was unsafe,
- that approach created files larger than signed content lengths,
- those files were not trustworthy.

38. Avoided continuing down that unsafe resume path.

### Phase 9: Qwen AWQ multimodal OOM

39. Once the AWQ model cache was complete, the next real blocker emerged.
40. The container no longer just stalled or waited on files. It failed during engine initialization with a multimodal profiling-time OOM:

```text
torch.OutOfMemoryError: HIP out of memory. Tried to allocate 256.00 GiB.
```

41. The stack traced into the multimodal encoder path during `determine_available_memory -> profile_run`.
42. This was not a host crash anymore. It was a model/runtime configuration problem in the vision tower path.

### Phase 10: Discovery of the right multimodal controls

43. Searched the installed vLLM package in the ROCm image for exact multimodal flag names.
44. Confirmed the presence of these relevant controls:

- `--limit-mm-per-prompt`
- `--mm-processor-kwargs`
- `--video-pruning-rate`
- `--skip-mm-profiling`
- `--language-model-only`

45. Inspected the source and confirmed the key semantics:

- all-zero multimodal limits disable tower components,
- encoder cache is not initialized when all non-text modalities are disabled,
- `--skip-mm-profiling` skips multimodal memory profiling at startup.

46. This analysis directly informed the final Qwen launch strategy.

### Phase 11: Gemma exact-model preparation from local files

47. In parallel with Qwen AWQ work, the exact Gemma path on `deez2` became the best chance of getting a live server first.
48. The repo-id path was insufficient because the model repo was missing processor assets expected by vLLM.
49. Created a local exact-model directory:

```text
/root/models/gemma-obliterated-patched
```

50. Populated it with config, tokenizer, processor assets, index, and weight shards.
51. Replaced slow sequential downloading with parallel `wget -c`.
52. For the long pole shard, switched to a custom range-split downloader using concurrent `curl -r` requests.
53. Detected corruption when one background single-stream download and one multi-range reconstruction overlapped.
54. Rebuilt corrupted shards from known-good prefixes plus fresh ranged tails.
55. Verified repaired shards by exact upstream `sha256` and byte size.
56. Later found one additional corrupted shard (`model-00002-of-00007.safetensors`) and replaced it fully with a clean verified download.

### Phase 12: Gemma exact local-path launch at 32k

57. After all shards were clean, launched Gemma from `/model` using the local directory bind mount.
58. First successful exact-model serving used:

- local-path launch,
- `--language-model-only`,
- `--skip-mm-profiling`,
- `--max-model-len 32768`.

59. The initial 32k startup took a long compile/warmup path, but eventually reached healthy serving.
60. Health and `/v1/models` succeeded.
61. A completion request succeeded.

### Phase 13: Qwen final stabilization at high context

62. Restarted `deez1` AWQ Qwen with:

- `--language-model-only`
- `--skip-mm-profiling`

63. This removed the multimodal profiling OOM path.
64. The server came up successfully.
65. Health passed.
66. `/v1/models` reported the server online.
67. Completion requests succeeded.
68. Inspected model metadata and determined the model ceiling was much higher than the original 8k startup target.
69. Raised `max_model_len` to `262144`.
70. Re-ran startup.
71. The model successfully initialized KV cache for `262144` and reached healthy serving.
72. Final validation at `262144` succeeded.

### Phase 14: Gemma final retune to 131072

73. Inspected Gemma config and found text-side `max_position_embeddings` of `131072`.
74. The successful 32k run reported enough KV capacity that `131072` looked feasible.
75. Restarted Gemma at `131072`.
76. The high-context run stayed alive, loaded weights, and entered long cold compile/warmup.
77. Because polling was noisy, switched to a log-follow readiness watcher and a retrying health probe.
78. Eventually observed the decisive line:

```text
Starting vLLM server on http://0.0.0.0:8000
```

79. Health and `/v1/models` succeeded.
80. Final validation at `131072` succeeded.

## What Worked

### Host/platform fixes that worked

- rolling back MES firmware
- adding `amdgpu.cwsr_enable=0`
- rebuilding initramfs and rebooting
- validating with low-level torch GPU tests before returning to vLLM

### Authentication fixes that worked

- reading `HF_TOKEN` directly from `/root/.bashrc`
- writing `/root/.cache/huggingface/token`
- explicitly passing `HF_TOKEN` and `HUGGING_FACE_HUB_TOKEN` into Docker

### Qwen-specific tactics that worked

- abandoning the unsupported exact FP8 path
- switching to `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`
- restoring a clean five-shard snapshot layout
- disabling multimodal tower loading with `--language-model-only`
- skipping multimodal profiling with `--skip-mm-profiling`
- raising final context to `262144`

### Gemma-specific tactics that worked

- serving from a local exact-model path instead of relying on the incomplete repo-id path
- repairing corrupted safetensor shards with exact hash verification
- binding the repaired model directory as `/model`
- using `--language-model-only`
- using `--skip-mm-profiling`
- bootstrapping at `32768`, then raising to `131072`

## What Did Not Work

### Access / automation dead ends

- interactive password feeding through persistent SSH terminals was unreliable because the literal single-space password was not consistently conveyed
- some long sync terminal wrapper invocations failed locally even when the same shell logic worked in async mode

### Qwen exact target dead ends

- exact `Qwen/Qwen3.6-35B-A3B-FP8` on this `gfx1151` stack
- small-model smoke tests before the host fix, which still page-faulted at the ROCm level

### Qwen AWQ dead ends before the final fix

- multimodal-enabled startup, which triggered the `256 GiB` profiling-time OOM
- unsafe direct resume from partial Hugging Face blobs into final snapshot files

### Gemma dead ends before the final fix

- repo-id launch relying on missing processor assets
- incorrect `--limit-mm-per-prompt` value format for the image used
- partially corrupted weight shards caused by overlapping resume strategies

## Original Failure Signatures Worth Preserving

### `deez1` early host/runtime signature

- ROCm GPU memory access faults
- engine initialization failures even before stable model runtime

### `deez1` exact Qwen FP8 signature

```text
Memory access fault by GPU node-1 ... Reason: Page not present or supervisor privilege.
RuntimeError: Engine core initialization failed.
```

### `deez1` AWQ multimodal signature

```text
torch.OutOfMemoryError: HIP out of memory. Tried to allocate 256.00 GiB.
```

### `deez2` early CLI signature

```text
argument --limit-mm-per-prompt: Value image=2,audio=1,video=1 cannot be converted
```

### `deez2` local weight corruption signature

```text
safetensors_rust.SafetensorError: Error while deserializing header: incomplete metadata, file not fully covered
```

## Files, Paths, And Artifacts Touched Remotely

### Boot configuration

- `/etc/default/grub`

### Firmware override paths

- `/lib/firmware/updates/amdgpu/gc_11_5_1_mes1.bin`
- `/lib/firmware/updates/amdgpu/gc_11_5_1_mes_2.bin`

### Firmware backup locations

- `/root/fw-backup-*`

### Hugging Face auth cache

- `/root/.cache/huggingface/token`

### Qwen cache root on `deez1`

- `/root/.cache/huggingface/hub/models--cyankiwi--Qwen3.6-35B-A3B-AWQ-4bit`

### Gemma exact local model root on `deez2`

- `/root/models/gemma-obliterated-patched`

## Final Practical Notes

### Why the final report says Qwen was a fallback

The final Qwen deployment was the closest stable supported configuration that actually worked on the hardware and software stack available during this session.

That fallback was necessary because:

- the exact FP8 target was not viable on this backend,
- the host platform needed firmware remediation before any serious model launch could stabilize,
- the AWQ fallback still required multimodal startup to be disabled to avoid a vision-encoder OOM.

### Why the final report says Gemma was exact

The final Gemma deployment was the exact requested model, not a fallback, but it only became viable after:

- patching in processor assets,
- creating a local model directory,
- downloading the full weights,
- repairing and hash-validating corrupted shards,
- launching from the local path rather than depending on remote repo loading.

## Final Verified State Before Shutdown

Immediately before the user-requested shutdown:

- `deez1` served `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` at `262144`
- `deez2` served `OBLITERATUS/gemma-4-E4B-it-OBLITERATED` at `131072`

Immediately after shutdown verification:

- no vLLM containers remained running on either host
- neither host responded on `http://127.0.0.1:8000/health`

This report therefore reflects both:

- the highest stable validated runtime state reached during the session, and
- the final idle state requested by the user.