// Web frontend for a Vircon32 core: main loop at 60 fps, user interface,
// cartridge loading (file picker / drag & drop), memory cards and settings.

import type { EmulatorCore } from "./EmulatorCore.js";
import type { WebGLRenderer } from "./WebGLRenderer.js";
import { AudioOutput } from "./AudioOutput.js";
import { Input } from "./Input.js";
import { loadStoredCard, storeCard, createEmptyCard, sameBytes } from "./Storage.js";

const FrameTime = 1000 / 60;
const CardCheckInterval = 30; // frames between memory card change checks
const DefaultRom = "games/Retrotime.v32"; // from the repository's games/ folder (npm run games)

export interface AppOptions {
  core: EmulatorCore;
  renderer: WebGLRenderer;
  biosURL: string;
  /** label shown in the interface, e.g. "TypeScript" or "WebAssembly" */
  coreName: string;
}

function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

export class App {
  private core: EmulatorCore;
  private renderer: WebGLRenderer;
  private audio = new AudioOutput();
  private input: Input;

  private paused = false;
  private lastTime = 0;
  private pendingTime = 0;
  private frameCount = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  private cardKey = "";
  private savedCard: Uint8Array | null = null;
  private cartridgeBytes: Uint8Array | null = null;

  /** title of the inserted cartridge, or null when there is none */
  cartridgeTitle: string | null = null;

  constructor(private options: AppOptions) {
    this.core = options.core;
    this.renderer = options.renderer;
    this.input = new Input(this.core);
  }

  get isPaused(): boolean { return this.paused; }
  portConnected(port: number): boolean { return this.input.isConnected(port); }
  setVirtual(control: number, pressed: boolean): void { this.input.setVirtual(control, pressed); }

  async start(): Promise<void> {
    $("core-name").textContent = this.options.coreName;
    const response = await fetch(this.options.biosURL);
    if (!response.ok) throw new Error(`Cannot load the BIOS (${response.status})`);
    this.core.loadBios(new Uint8Array(await response.arrayBuffer()));
    this.core.setGamepadConnection(0, true);
    this.bindInterface();
    this.core.setPower(true);
    this.setStatus("No cartridge — load a .v32 file to play");
    requestAnimationFrame((t) => this.loop(t));

    // ?rom=URL loads a cartridge directly; otherwise the default one (?rom= with no value: none)
    const romURL = new URLSearchParams(location.search).get("rom") ?? DefaultRom;
    if (romURL) {
      try {
        const rom = await fetch(romURL);
        if (!rom.ok) throw new Error(`HTTP ${rom.status}`);
        await this.insertCartridge(new Uint8Array(await rom.arrayBuffer()), romURL.split("/").pop() || "rom.v32");
      } catch (e) {
        this.showError(`Could not load ${romURL}: ${(e as Error).message}`);
      }
    }
  }

  // ------------------------------------------------------------------
  //   main loop
  // ------------------------------------------------------------------

  private loop(time: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const elapsed = this.lastTime ? time - this.lastTime : FrameTime;
    this.lastTime = time;
    if (this.paused || !this.core.isPowerOn()) return;

    // run as many console frames as real time requires (max 4 to recover from stalls)
    this.pendingTime = Math.min(this.pendingTime + elapsed, FrameTime * 4);
    let frames = 0;
    while (this.pendingTime >= FrameTime * 0.9 && frames < 4) {
      this.input.update();
      this.core.runNextFrame();
      this.renderer.flush();
      this.audio.pushFrame(this.core.getSoundOutput());
      this.pendingTime -= FrameTime;
      frames++;
      this.frameCount++;
      if (this.frameCount % CardCheckInterval === 0) void this.checkMemoryCard();
    }
    if (this.pendingTime < 0) this.pendingTime = 0;

    this.fpsFrames += frames;
    if (time - this.fpsTime >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (time - this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = time;
      $("stats").textContent =
        `${this.fps.toFixed(0)} fps · CPU ${this.core.getCPULoad().toFixed(0)}% · GPU ${this.core.getGPULoad().toFixed(0)}%`;    }
  }

  // ------------------------------------------------------------------
  //   cartridges & memory cards
  // ------------------------------------------------------------------

  async insertCartridge(bytes: Uint8Array, fileName: string): Promise<void> {
    await this.persistMemoryCard();
    this.core.setPower(false);
    try {
      this.core.unloadCartridge();
      this.core.loadCartridge(bytes);
    } catch (e) {
      this.showError((e as Error).message);
      this.core.setPower(true);
      return;
    }
    this.cartridgeBytes = bytes;
    const title = this.core.getCartridgeTitle() || fileName;

    // every cartridge gets its own memory card, kept in the browser
    this.cardKey = `card:${title}`;
    const stored = await loadStoredCard(this.cardKey);
    try {
      this.core.unloadMemoryCard();
      this.core.loadMemoryCard(stored ?? createEmptyCard());
      this.savedCard = this.core.getMemoryCardFile();
    } catch (e) {
      this.showError("Memory card: " + (e as Error).message);
    }

    this.input.resync();
    this.core.setPower(true);
    this.audio.start();
    this.audio.resync();
    this.setStatus(title);
    this.cartridgeTitle = title;
    ($("eject") as HTMLButtonElement).disabled = false;
    $("screen").focus();
  }

  private async ejectCartridge(): Promise<void> {
    await this.persistMemoryCard();
    this.core.setPower(false);
    this.core.unloadMemoryCard();
    this.core.unloadCartridge();
    this.cartridgeBytes = null;
    this.cardKey = "";
    this.savedCard = null;
    this.core.setPower(true);
    this.setStatus("No cartridge — load a .v32 file to play");
    this.cartridgeTitle = null;
    ($("eject") as HTMLButtonElement).disabled = true;
  }

  private async checkMemoryCard(): Promise<void> {
    if (!this.cardKey || !this.core.hasMemoryCard()) return;
    const current = this.core.getMemoryCardFile();
    if (current && !sameBytes(current, this.savedCard)) {
      this.savedCard = current;
      await storeCard(this.cardKey, current);
    }
  }

  private async persistMemoryCard(): Promise<void> {
    await this.checkMemoryCard();
  }

  // ------------------------------------------------------------------
  //   user interface
  // ------------------------------------------------------------------

  private setStatus(text: string): void {
    $("title").textContent = text;
  }

  showError(message: string): void {
    const box = $("error");
    box.textContent = message;
    box.hidden = false;
    setTimeout(() => (box.hidden = true), 6000);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    $("pause").setAttribute("aria-pressed", String(this.paused));
    $("screen-wrap").classList.toggle("paused", this.paused);
    this.audio.resync();
    this.pendingTime = 0;
  }

  private bindInterface(): void {
    const fileInput = $("file") as HTMLInputElement;
    const openFile = async (file: File) => {
      if (file.name.toLowerCase().endsWith(".memc")) {
        await this.importMemoryCard(file);
        return;
      }
      await this.insertCartridge(new Uint8Array(await file.arrayBuffer()), file.name);
    };

    $("load").addEventListener("click", () => { this.audio.start(); fileInput.click(); });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) void openFile(file);
      fileInput.value = "";
    });
    $("eject").addEventListener("click", () => void this.ejectCartridge());
    $("reset").addEventListener("click", () => {
      this.audio.start();
      this.core.reset();
      this.input.resync();
      $("screen").focus();
    });
    $("pause").addEventListener("click", () => this.togglePause());
    const mute = $("mute");
    mute.addEventListener("click", () => {
      this.audio.start();
      this.audio.setMuted(!this.audio.isMuted);
      mute.textContent = this.audio.isMuted ? "Unmute" : "Mute";
      mute.setAttribute("aria-pressed", String(this.audio.isMuted));
    });
    const volume = $("volume") as HTMLInputElement;
    volume.addEventListener("input", () => this.audio.setVolume(Number(volume.value) / 100));
    $("fullscreen").addEventListener("click", () => {
      const wrap = $("screen-wrap");
      if (document.fullscreenElement) void document.exitFullscreen();
      else void wrap.requestFullscreen?.();
    });
    $("card-export").addEventListener("click", () => this.exportMemoryCard());
    $("card-import").addEventListener("click", () => fileInput.click());

    // drag & drop of cartridges and memory cards
    const drop = $("screen-wrap");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragging"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
      const file = e.dataTransfer?.files[0];
      if (file) { this.audio.start(); void openFile(file); }
    });

    // any interaction allows audio to start
    const unlock = () => this.audio.start();
    window.addEventListener("keydown", unlock);
    window.addEventListener("pointerdown", unlock);

    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && !document.fullscreenElement) this.togglePause();
      if (e.code === "F5" && !e.ctrlKey) { e.preventDefault(); this.core.reset(); this.input.resync(); }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void this.persistMemoryCard();
      this.audio.resync();
      this.lastTime = 0;
    });
    window.addEventListener("pagehide", () => void this.persistMemoryCard());
  }

  private exportMemoryCard(): void {
    const bytes = this.core.getMemoryCardFile();
    if (!bytes) { this.showError("There is no memory card inserted (load a cartridge first)"); return; }
    const name = (this.core.getCartridgeTitle() || "memory-card").replace(/[^\w.-]+/g, "_") + ".memc";
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async importMemoryCard(file: File): Promise<void> {
    if (!this.cartridgeBytes) { this.showError("Load a cartridge before importing its memory card"); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    this.core.setPower(false);
    try {
      this.core.unloadMemoryCard();
      this.core.loadMemoryCard(bytes);
      this.savedCard = null; // force saving it to the browser storage
      await this.checkMemoryCard();
    } catch (e) {
      this.showError((e as Error).message);
      this.core.loadMemoryCard(this.savedCard ?? createEmptyCard());
    }
    this.input.resync();
    this.core.setPower(true);
  }
}
