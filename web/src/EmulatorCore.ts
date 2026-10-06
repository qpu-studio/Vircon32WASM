// Interface of the emulator core driven by the web frontend,
// implemented by the WebAssembly build of the original C++ ConsoleLogic (WasmCore).

export interface EmulatorCore {
  loadBios(bytes: Uint8Array): void;
  loadCartridge(bytes: Uint8Array): void;
  unloadCartridge(): void;
  hasCartridge(): boolean;
  getCartridgeTitle(): string;

  loadMemoryCard(bytes: Uint8Array): void;
  unloadMemoryCard(): void;
  hasMemoryCard(): boolean;
  /** current contents of the memory card as a .memc file, or null if none */
  getMemoryCardFile(): Uint8Array | null;

  setPower(on: boolean): void;
  isPowerOn(): boolean;
  reset(): void;
  runNextFrame(): void;

  setGamepadConnection(port: number, connected: boolean): void;
  setGamepadControl(port: number, control: number, pressed: boolean): void;

  /** 735 stereo samples (1470 interleaved int16) produced by the last frame */
  getSoundOutput(): Int16Array;
  getCPULoad(): number;
  getGPULoad(): number;
}

/** Gamepad controls, in the order used by the console */
export const Controls = {
  Left: 0, Right: 1, Up: 2, Down: 3,
  Start: 4, A: 5, B: 6, X: 7, Y: 8, L: 9, R: 10,
} as const;
