import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  platform: "node",
  format: "esm",
  target: "node20",
  bundle: true,
  sourcemap: true,
  external: ["@ai-sdk/openai-compatible"],
});

console.log("Bundled to dist/index.js");
