# vLLM Speed Tuning Report

## Scope

This pass treated the current verified model choices, quantization, and context settings as locked.

Constraints for this pass:

- no model downgrade
- no quantization downgrade
- no context reduction
- no loss of multimodal support on Gemma
- no accepted change that degraded single-request behavior or overall serving quality

## Locked Production State

### `deez1`

- backend: `llama.cpp` Vulkan
- model: `Qwen3.6-35B-A3B-Q8_0.gguf`
- command remains unchanged from the checkpoint report

Final verification during this pass:

- health: `200`
- `128` tokens in `2.84s`
- `52.27` tokens/s

### `deez2`

- backend: vLLM ROCm
- model: exact `OBLITERATUS/gemma-4-E4B-it-OBLITERATED`
- multimodal: still enabled
- context: still `131072`
- command restored to `--max-num-seqs 4`

Final restored verification during this pass:

- health: `200`
- text request: `92` completion tokens in `8.28s`
- multimodal inline-image request: successful

## What Was Already Enabled

### `deez1`

The live `llama.cpp` path already had:

- continuous batching enabled by default
- multiple server slots active
- prompt cache enabled
- flash attention enabled via `-fa 1`

### `deez2`

The live vLLM path already had:

- prefix caching enabled
- chunked prefill enabled
- asynchronous scheduling enabled

This means two of the requested directions were already active on `deez2` before any new tuning:

- batching
- token prefill

## Tested Changes

### `deez2`: raise `--max-num-seqs` from `4` to `8`

Reason for test:

- increase concurrency headroom
- improve aggregate token throughput under heavier parallel request load

Result:

- eight-request aggregate throughput improved from about `216 tokens / 2.79s` to about `216 tokens / 2.08s`
- that is roughly `77.4 tok/s` before vs `103.8 tok/s` after
- but single-request text latency degraded from about `4.26s` to about `8.52s`

Decision:

- rejected

Reason:

- it improved aggregate throughput, but it degraded single-request performance, which violated the no-degradation requirement

### `deez1`: force explicit slot count with `-np 8`

Reason for test:

- see whether explicit slot sizing could outperform the current auto-slot behavior under parallel load

Result:

- single-request throughput was about `50.93 tok/s`
- eight-request aggregate throughput fell to about `167.06 tok/s`
- the current production path had already shown about `254.87 tok/s` aggregate across eight concurrent requests

Decision:

- rejected

Reason:

- materially worse aggregate throughput than the unchanged production configuration

## DFlash Or DDTree

No supported, verified path for `DFlash` or `DDTree` was found in the currently deployed `llama.cpp` Vulkan or vLLM ROCm serving images during this pass.

No such feature was enabled because doing so would have required switching to an unverified path rather than improving the locked current one.

## Final Outcome

No tested speed tuning change met the requirement of improving throughput without degrading performance or quality.

Accepted final state:

- `deez1` stays on the original production command from the checkpoint report
- `deez2` stays on the original production command from the checkpoint report with `--max-num-seqs 4`

Conclusion:

- the current locked commands remain the best verified non-degraded serving configuration
- batching and prefill-related optimizations that were safely available were already active
- the additional changes tested in this pass were rejected because they failed the non-degradation rule