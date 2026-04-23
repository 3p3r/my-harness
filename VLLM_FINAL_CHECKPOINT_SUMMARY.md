# Final Checkpoint Summary

## Serving State

- `deez1`: `0xSero/Qwen3.6-35B-A3B-Q8_0.gguf` via `llama.cpp` Vulkan on port `8010`
- `deez2`: exact multimodal `OBLITERATUS/gemma-4-E4B-it-OBLITERATED` via `vLLM ROCm` on port `8000`
- Both hosts are on the stabilized ROCm/MES path with `amdgpu.cwsr_enable=0`

## Verified Outcome

- `deez1` Qwen `Q8_0` is the accepted production path and was validated at about `52 tok/s`
- `deez2` Gemma multimodal is working and was validated with image input at `131072` context
- The speed-tuning pass did not produce a strictly better configuration, so the checkpoint commands remain the accepted baseline

## Memory Conclusion

- These boxes are currently behaving as roughly `64 GB system RAM + 64 GB GPU-visible / firmware-reserved memory`
- This is not a Linux `mem=` cap or an offline-memory issue
- The likely control point is BIOS UMA / graphics memory reservation
- Do not increase the reservation above the current effective `64 GB`; that is already the largest working split observed here

## Practical Guidance

- Leave the current split alone if the priority is keeping the present Qwen and Gemma inference configurations working
- Only reduce the reservation if the priority shifts to reclaiming conventional system RAM, with the understanding that GPU-fit headroom may drop