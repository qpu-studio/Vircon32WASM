// Entry point of the WebAssembly version
import { WasmCore } from "./WasmCore.js";
import { WebGLRenderer } from "./WebGLRenderer.js";
import { App } from "./App.js";
import { Scene3D } from "./Scene3D.js";

async function main() {
  const renderer = new WebGLRenderer(document.getElementById("screen") as HTMLCanvasElement);
  const moduleURL = new URL("wasm/vircon32.mjs", document.baseURI).href;
  const core = await WasmCore.create(moduleURL, renderer, (line) => console.debug("[Vircon32]", line));
  const app = new App({ core, renderer, biosURL: "bios/StandardBios.v32", coreName: "WebAssembly" });
  const scene = new Scene3D(document.getElementById("view3d")!, renderer.canvas, app);
  document.getElementById("view")!.addEventListener("click", () => scene.toggleView());
  (window as any).vircon32 = { core, app, scene };
  await app.start();
}
main().catch((e) => {
  const box = document.getElementById("error");
  if (box) { box.textContent = String(e?.message ?? e); box.hidden = false; }
  console.error(e);
});
