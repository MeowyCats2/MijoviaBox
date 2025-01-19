import { rmdir } from "node:fs/promises";

await rmdir("./static/build", {"recursive": true})
console.log(await Bun.build({
    entrypoints: ["./client.ts"],
    outdir: "./static/build",
    sourcemap: "linked",
}));
console.log("Built!")