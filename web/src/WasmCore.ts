// EmulatorCore backed by the WebAssembly build of the official
// Vircon32 C++ ConsoleLogic (see src/WasmBindings.cpp and build.sh).

import type { EmulatorCore } from "./EmulatorCore.js";
import type { VideoCallbacks } from "./VideoCallbacks.js";

// minimal typing of the Emscripten module we use
interface Vircon32Module {
  video: VideoCallbacks;
  logLine?: (line: string) => void;
  HEAPU8: Uint8Array;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  UTF8ToString(pointer: number): string;
  stringToNewUTF8?(text: string): number;
  _malloc(size: number): number;
  _free(pointer: number): void;
  [name: string]: any;
}

type ModuleFactory = (options: object) => Promise<Vircon32Module>;

const BiosPath = "/bios.v32";
const CartridgePath = "/cartridge.v32";
const CardPath = "/card.memc";

export class WasmCore implements EmulatorCore {
  private soundView: Int16Array | null = null;
  private soundPointer = 0;

  private constructor(private m: Vircon32Module) {
    m._v32_initialize();
  }

  /** loads the module (vircon32.mjs + vircon32.wasm) and creates the console */
  static async create(moduleURL: string, video: VideoCallbacks, log?: (line: string) => void): Promise<WasmCore> {
    const factory = (await import(/* @vite-ignore */ moduleURL)).default as ModuleFactory;
    const m = await factory({ video, logLine: log, print: log ?? console.log, printErr: console.warn });
    return new WasmCore(m);
  }

  private call(name: string, ...args: (number | string)[]): any {
    const m = this.m;
    const pointers: number[] = [];
    const converted = args.map((a) => {
      if (typeof a !== "string") return a;
      const bytes = new TextEncoder().encode(a + "\0");
      const p = m._malloc(bytes.length);
      m.HEAPU8.set(bytes, p);
      pointers.push(p);
      return p;
    });
    try {
      return m["_" + name](...converted);
    } finally {
      for (const p of pointers) m._free(p);
    }
  }

  /** calls a binding that returns null on success or an error message */
  private callChecked(name: string, ...args: (number | string)[]): void {
    const error = this.call(name, ...args) as number;
    if (error) throw new Error(this.m.UTF8ToString(error));
  }

  private writeFile(path: string, bytes: Uint8Array): void {
    this.m.FS.writeFile(path, bytes);
  }

  private removeFile(path: string): void {
    try { this.m.FS.unlink(path); } catch { /* not present */ }
  }

  // ---------------- EmulatorCore ----------------

  loadBios(bytes: Uint8Array): void {
    this.writeFile(BiosPath, bytes);
    try { this.callChecked("v32_load_bios", BiosPath); }
    finally { this.removeFile(BiosPath); }
  }

  loadCartridge(bytes: Uint8Array): void {
    this.writeFile(CartridgePath, bytes);
    try { this.callChecked("v32_load_cartridge", CartridgePath); }
    finally { this.removeFile(CartridgePath); }   // contents are already copied to the console
  }

  unloadCartridge(): void { this.call("v32_unload_cartridge"); }
  hasCartridge(): boolean { return this.call("v32_has_cartridge") !== 0; }

  getCartridgeTitle(): string {
    return this.m.UTF8ToString(this.call("v32_get_cartridge_title"));
  }

  loadMemoryCard(bytes: Uint8Array): void {
    this.call("v32_unload_memory_card");
    this.writeFile(CardPath, bytes);
    this.callChecked("v32_load_memory_card", CardPath);
  }

  unloadMemoryCard(): void {
    this.call("v32_unload_memory_card");
    this.removeFile(CardPath);
  }

  hasMemoryCard(): boolean { return this.call("v32_has_memory_card") !== 0; }

  getMemoryCardFile(): Uint8Array | null {
    if (!this.hasMemoryCard()) return null;
    // the console writes the card to its file at the end of the frames that modify it
    this.call("v32_flush_memory_card");
    return this.m.FS.readFile(CardPath).slice();
  }

  setPower(on: boolean): void { this.call("v32_set_power", on ? 1 : 0); }
  isPowerOn(): boolean { return this.call("v32_is_power_on") !== 0; }
  reset(): void { this.call("v32_reset"); }
  runNextFrame(): void { this.m._v32_run_next_frame(); }

  setGamepadConnection(port: number, connected: boolean): void {
    this.call("v32_set_gamepad_connection", port, connected ? 1 : 0);
  }

  setGamepadControl(port: number, control: number, pressed: boolean): void {
    this.call("v32_set_gamepad_control", port, control, pressed ? 1 : 0);
  }

  setCurrentDate(year: number, days: number): void { this.call("v32_set_current_date", year, days); }
  setCurrentTime(h: number, m: number, s: number): void { this.call("v32_set_current_time", h, m, s); }

  getSoundOutput(): Int16Array {
    // the wasm memory may grow and detach old views, so re-create when needed
    const pointer = this.call("v32_get_sound_samples") as number;
    if (!this.soundView || this.soundPointer !== pointer || this.soundView.buffer !== this.m.HEAPU8.buffer) {
      this.soundPointer = pointer;
      this.soundView = new Int16Array(this.m.HEAPU8.buffer, pointer, 735 * 2);
    }
    return this.soundView;
  }

  getCPULoad(): number { return this.call("v32_get_cpu_load"); }
  getGPULoad(): number { return this.call("v32_get_gpu_load"); }
  isCPUHalted(): boolean { return this.call("v32_is_cpu_halted") !== 0; }
}
