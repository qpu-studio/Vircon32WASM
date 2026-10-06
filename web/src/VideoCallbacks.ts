// Video callbacks the console core calls while running.
// Colors are packed 32-bit words: byte 0 (lowest) = R, then G, B, A.

export interface VideoCallbacks {
  clearScreen(color: number): void;
  /** 4 vertices x (x, y, texture_x, texture_y): top-left, top-right, bottom-left, bottom-right */
  drawQuad(quad: Float32Array): void;
  setMultiplyColor(color: number): void;
  setBlendingMode(mode: number): void;
  /** -1 = BIOS texture, 0..255 = cartridge textures */
  selectTexture(textureID: number): void;
  /** pixels: 1024 x 1024 RGBA bytes */
  loadTexture(textureID: number, pixels: Uint8Array): void;
  unloadCartridgeTextures(): void;
  unloadBiosTexture(): void;
}
