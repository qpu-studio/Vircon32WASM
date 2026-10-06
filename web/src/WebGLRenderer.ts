// WebGL implementation of the Vircon32 video callbacks.
// It follows the OpenGL renderer of the official desktop emulator
// (Emulator/VideoOutput.cpp): same shaders, quad batching, blending modes,
// and clearing the screen by drawing a white quad with the clear color.

import type { VideoCallbacks } from "./VideoCallbacks.js";

const ScreenWidth = 640;
const ScreenHeight = 360;
const TextureSize = 1024;
const QuadQueueSize = 4096;

const VertexShader = `
attribute vec4 VertexInfo;
varying highp vec2 TextureCoordinate;
void main() {
  gl_Position = vec4( VertexInfo.x / 320.0 - 1.0, 1.0 - VertexInfo.y / 180.0, 0.0, 1.0 );
  TextureCoordinate = VertexInfo.zw;
}`;

const FragmentShader = `
uniform mediump vec4 MultiplyColor;
uniform sampler2D TextureUnit;
varying highp vec2 TextureCoordinate;
void main() {
  gl_FragColor = MultiplyColor * texture2D( TextureUnit, TextureCoordinate );
}`;

export class WebGLRenderer implements VideoCallbacks {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private multiplyColorLocation: WebGLUniformLocation;
  private vertexBuffer: WebGLBuffer;
  private vertices = new Float32Array(QuadQueueSize * 16);
  private queuedQuads = 0;

  private biosTexture: WebGLTexture | null = null;
  private cartridgeTextures: (WebGLTexture | null)[] = new Array(256).fill(null);
  private whiteTexture: WebGLTexture;
  private selectedTexture = -1;
  private multiplyColor = -1;
  private blendingMode = 0x20;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = ScreenWidth;
    canvas.height = ScreenHeight;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      // the console does not necessarily redraw the whole screen every frame
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL is not available in this browser");
    this.gl = gl;

    const program = this.compileProgram();
    gl.useProgram(program);
    this.multiplyColorLocation = gl.getUniformLocation(program, "MultiplyColor")!;
    gl.uniform1i(gl.getUniformLocation(program, "TextureUnit"), 0);

    this.vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.STREAM_DRAW);
    const location = gl.getAttribLocation(program, "VertexInfo");
    gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(location);

    const indices = new Uint16Array(QuadQueueSize * 6);
    for (let i = 0; i < QuadQueueSize; i++) {
      indices.set([4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 1, 4 * i + 2, 4 * i + 3], 6 * i);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.viewport(0, 0, ScreenWidth, ScreenHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);

    this.whiteTexture = this.createTexture(1, new Uint8Array([255, 255, 255, 255]));
    this.setMultiplyColor(-1);
    this.setBlendingMode(0x20);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private compileProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error("Shader compilation failed: " + gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VertexShader));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Shader linking failed: " + gl.getProgramInfoLog(program));
    return program;
  }

  private createTexture(size: number, pixels: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private bindSelectedTexture(): void {
    const id = this.selectedTexture;
    this.gl.bindTexture(this.gl.TEXTURE_2D, id < 0 ? this.biosTexture : this.cartridgeTextures[id]);
  }

  /** draws all queued quads; must be called before any state change */
  flush(): void {
    if (this.queuedQuads === 0) return;
    const gl = this.gl;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices.subarray(0, this.queuedQuads * 16));
    gl.drawElements(gl.TRIANGLES, this.queuedQuads * 6, gl.UNSIGNED_SHORT, 0);
    this.queuedQuads = 0;
  }

  // ---------------- video callbacks ----------------

  clearScreen(color: number): void {
    const previousColor = this.multiplyColor;
    this.setMultiplyColor(color);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.whiteTexture);
    const v = this.vertices;
    v.set([0, 0, 0.5, 0.5, ScreenWidth, 0, 0.5, 0.5, 0, ScreenHeight, 0.5, 0.5, ScreenWidth, ScreenHeight, 0.5, 0.5], 0);
    this.queuedQuads = 1;
    this.flush();
    this.setMultiplyColor(previousColor);
    this.bindSelectedTexture();
  }

  drawQuad(quad: Float32Array): void {
    this.vertices.set(quad, this.queuedQuads * 16);
    if (++this.queuedQuads >= QuadQueueSize) this.flush();
  }

  setMultiplyColor(color: number): void {
    this.flush();
    this.multiplyColor = color;
    this.gl.uniform4f(this.multiplyColorLocation,
      (color & 255) / 255, ((color >>> 8) & 255) / 255, ((color >>> 16) & 255) / 255, (color >>> 24) / 255);
  }

  setBlendingMode(mode: number): void {
    const gl = this.gl;
    this.flush();
    switch (mode) {
      case 0x20: gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.blendEquation(gl.FUNC_ADD); break;
      case 0x21: gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.blendEquation(gl.FUNC_ADD); break;
      case 0x22: gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); break;
      default: return;
    }
    this.blendingMode = mode;
  }

  selectTexture(id: number): void {
    this.flush();
    this.selectedTexture = id;
    this.bindSelectedTexture();
  }

  loadTexture(id: number, pixels: Uint8Array): void {
    this.flush();
    const texture = this.createTexture(TextureSize, pixels);
    if (id < 0) {
      if (this.biosTexture) this.gl.deleteTexture(this.biosTexture);
      this.biosTexture = texture;
    } else {
      if (this.cartridgeTextures[id]) this.gl.deleteTexture(this.cartridgeTextures[id]);
      this.cartridgeTextures[id] = texture;
    }
    this.bindSelectedTexture();
  }

  unloadCartridgeTextures(): void {
    this.flush();
    for (let i = 0; i < this.cartridgeTextures.length; i++) {
      if (this.cartridgeTextures[i]) this.gl.deleteTexture(this.cartridgeTextures[i]);
      this.cartridgeTextures[i] = null;
    }
  }

  unloadBiosTexture(): void {
    this.flush();
    if (this.biosTexture) this.gl.deleteTexture(this.biosTexture);
    this.biosTexture = null;
  }

  /** fills the screen with black (used when the console is off) */
  blank(): void {
    this.flush();
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
