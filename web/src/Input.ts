// Keyboard and Gamepad API input, mapped to the 4 Vircon32 gamepad ports.
// Port 1 (index 0) = keyboard + first physical gamepad; ports 2-4 = other gamepads.

import type { EmulatorCore } from "./EmulatorCore.js";
import { Controls } from "./EmulatorCore.js";

/** default keyboard layout (same idea as the desktop emulator) */
export const KeyboardMap: Record<string, number> = {
  ArrowLeft: Controls.Left,
  ArrowRight: Controls.Right,
  ArrowUp: Controls.Up,
  ArrowDown: Controls.Down,
  Enter: Controls.Start,
  Space: Controls.A,
  KeyX: Controls.A,
  KeyZ: Controls.B,
  KeyS: Controls.X,
  KeyA: Controls.Y,
  KeyQ: Controls.L,
  KeyW: Controls.R,
};

// Gamepad API "standard" mapping
const GamepadButtonMap: [number, number][] = [
  [0, Controls.A], [1, Controls.B], [2, Controls.X], [3, Controls.Y],
  [4, Controls.L], [5, Controls.R], [9, Controls.Start],
  [12, Controls.Up], [13, Controls.Down], [14, Controls.Left], [15, Controls.Right],
];
const StickThreshold = 0.5;

export class Input {
  private keyboardState = new Array(11).fill(false);
  private virtualState = new Array(11).fill(false);
  private sent: boolean[][] = [0, 1, 2, 3].map(() => new Array(11).fill(false));
  private connected = [true, false, false, false];
  enabled = true;

  constructor(private core: EmulatorCore, target: Window = window) {
    target.addEventListener("keydown", (e) => this.onKey(e, true));
    target.addEventListener("keyup", (e) => this.onKey(e, false));
    target.addEventListener("blur", () => this.keyboardState.fill(false));
  }

  private onKey(e: KeyboardEvent, pressed: boolean): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
    const control = KeyboardMap[e.code];
    if (control === undefined) return;
    e.preventDefault();
    this.keyboardState[control] = pressed;
  }

  /** reads all devices and sends the changes to the console; call once per frame */
  update(): void {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    const physical = Array.from(pads).filter((p): p is Gamepad => p !== null && p.connected);

    for (let port = 0; port < 4; port++) {
      const pad = physical[port];
      const shouldBeConnected = port === 0 || pad !== undefined;
      if (shouldBeConnected !== this.connected[port]) {
        this.connected[port] = shouldBeConnected;
        this.core.setGamepadConnection(port, shouldBeConnected);
        this.sent[port].fill(false);
      }
      if (!shouldBeConnected) continue;

      const state = new Array(11).fill(false);
      if (port === 0) for (let c = 0; c < 11; c++) state[c] = this.keyboardState[c] || this.virtualState[c];
      if (pad) {
        for (const [button, control] of GamepadButtonMap)
          if (pad.buttons[button]?.pressed) state[control] = true;
        const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
        if (x < -StickThreshold) state[Controls.Left] = true;
        if (x > StickThreshold) state[Controls.Right] = true;
        if (y < -StickThreshold) state[Controls.Up] = true;
        if (y > StickThreshold) state[Controls.Down] = true;
      }
      if (!this.enabled) state.fill(false);

      for (let c = 0; c < 11; c++) {
        if (state[c] !== this.sent[port][c]) {
          this.sent[port][c] = state[c];
          this.core.setGamepadControl(port, c, state[c]);
        }
      }
    }
  }

  /** presses or releases a control of the on-screen gamepad (port 1) */
  setVirtual(control: number, pressed: boolean): void {
    this.virtualState[control] = pressed;
  }

  /** ports that have a gamepad (port 1 always does, through the keyboard) */
  isConnected(port: number): boolean {
    return this.connected[port];
  }

  /** marks every port as needing to be re-sent (after a console reset) */
  resync(): void {
    for (let port = 0; port < 4; port++) {
      this.core.setGamepadConnection(port, this.connected[port]);
      this.sent[port].fill(false);
    }
  }
}
