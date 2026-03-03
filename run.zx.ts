/// <reference types="zx/globals" />

usePowerShell();

async function main() {
  do {
    await $`c:\\llama-cpp\\llama-server.exe -hf unsloth/Qwen3.5-35B-A3B-GGUF:UD-Q4_K_XL --jinja --n-gpu-layers 999 --flash-attn on --fit off --ctx-size 65536 --port 9090 --host 0.0.0.0 --tensor-split 0.5,0.5 --cache-type-k q8_0 --cache-type-v q8_0 -np 1`.catch(
      () => {},
    );
    console.log(chalk.yellow("LLaMA server exited, restarting..."));
    await new Promise((resolve) => setTimeout(resolve, 2500));
  } while (true);
}

main()
  .then(() => {
    console.log(chalk.green("Exited cleanly!"));
  })
  .catch((err) => {
    console.error(chalk.red("Exited with error:"), err);
    process.exit(1);
  });
