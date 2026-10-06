// Headless test of the WebAssembly build: runs the BIOS and the test cartridges
// in Node.js, checks that they keep running and measures speed.
//   npx tsx tests/headless.mts
import { readFileSync } from "node:fs";
import { WasmCore } from "../web/src/WasmCore.ts";

const bios = new Uint8Array(readFileSync(new URL("../web/public/bios/StandardBios.v32", import.meta.url)));
const roms = [
  ["stress-test", "roms/stress-test.v32"],
  ["cpu-benchmark", "roms/cpu-benchmark.v32"],
];
const emptyCard = new Uint8Array(8 + 1024 * 1024);
emptyCard.set(new TextEncoder().encode("V32-MEMC"));

let failed = false;
for (const [name, path] of roms) {
  let quads = 0;
  const video = {
    clearScreen() {}, drawQuad() { quads++; }, setMultiplyColor() {}, setBlendingMode() {},
    selectTexture() {}, loadTexture() {}, unloadCartridgeTextures() {}, unloadBiosTexture() {},
  };
  const c = await WasmCore.create(new URL("../web/public/wasm/vircon32.mjs", import.meta.url).href, video);
  c.loadBios(bios);
  c.loadCartridge(new Uint8Array(readFileSync(new URL(path, import.meta.url))));
  c.loadMemoryCard(emptyCard);
  c.setGamepadConnection(0, true);
  c.setPower(true);
  const frames = 1200;
  const start = performance.now();
  for (let f = 0; f < frames; f++) {
    c.setGamepadControl(0, 5, f % 40 < 3);
    c.setGamepadControl(0, 4, f % 300 < 2);
    c.runNextFrame();
  }
  const ms = (performance.now() - start) / frames;
  const ok = !c.isCPUHalted() && quads > 0;
  if (!ok) failed = true;
  console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(15)} ${frames} frames, ${quads} quads, ` +
    `CPU ${c.getCPULoad().toFixed(0)}%, ${ms.toFixed(2)} ms/frame (${(1000 / ms).toFixed(0)} fps max)`);
}
process.exit(failed ? 1 : 0);
