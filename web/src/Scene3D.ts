// 3D scene of the console on a desk (after the Vircon32 renders): a monitor showing
// the emulator output, the console and a gamepad. The pieces are interactive:
// console buttons and slots trigger the toolbar actions, the gamepad presses
// controls of port 1, and clicking the monitor zooms in and out of the screen.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** photographed interior used for reflections and ambient light (Poly Haven, CC0) */
const EnvironmentURL = "env/studio_1k.hdr";

/** what the scene needs to know from the application */
export interface SceneHost {
  readonly isPaused: boolean;
  readonly cartridgeTitle: string | null;
  portConnected(port: number): boolean;
  setVirtual(control: number, pressed: boolean): void;
}

/** what happens when a piece is pressed */
interface Action {
  click?: string;    // id of the toolbar button to click
  control?: number;  // gamepad control held while pressed
  view?: boolean;    // toggles the screen close-up
}

const Colors = {
  plastic: 0xe3e2db,
  plasticDark: 0xcfcec6,
  panel: 0xf1e6df,
  key: 0x45484c,
  well: 0xf7f6ee,
  dpad: 0x686c72,
  teal: 0x6cc4a6,
  monitor: 0x3a3c3f,
  desk: 0xa0604a,
  wall: 0x6a6159,
};

const Views = {
  // 45 degrees to the left of the front view, facing the console
  scene: { position: new THREE.Vector3(-5.94, 4.8, 7.24), target: new THREE.Vector3(0.6, 1.75, 0.7) },
  screen: { position: new THREE.Vector3(0, 3.12, 3.3), target: new THREE.Vector3(0, 3.12, -2) },
};

const standard = (color: number, roughness = 0.55) => new THREE.MeshStandardMaterial({ color, roughness });

// ----------------------------------------------------------------------
//   procedural surface detail (no image files): the fine texture of moulded
//   plastic and the slightly glossier smudges left by hands
// ----------------------------------------------------------------------

/** grayscale data texture drawn on a canvas; tiled, not color-managed */
function surfaceTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** fine random grain, softened so it reads as a mould texture rather than noise */
function grainImage(ctx: CanvasRenderingContext2D, size: number, contrast: number): void {
  const raw = document.createElement("canvas");
  raw.width = raw.height = size;
  const rawCtx = raw.getContext("2d")!;
  const image = rawCtx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * contrast;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  rawCtx.putImageData(image, 0, 0);
  ctx.filter = "blur(0.7px)";
  ctx.drawImage(raw, 0, 0);
  ctx.filter = "none";
}

/** mostly white (the material's roughness) with soft darker blotches (glossier smudges) */
function smudgeImage(ctx: CanvasRenderingContext2D, size: number, count: number, depth: number): void {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = size * (0.03 + Math.random() * 0.12);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const shade = Math.round(255 * (1 - depth * (0.4 + Math.random() * 0.6)));
    g.addColorStop(0, `rgba(${shade},${shade},${shade},0.55)`);
    g.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

const Surfaces = {
  grain: null as THREE.CanvasTexture | null,
  smudge: null as THREE.CanvasTexture | null,
  repeats: new Map<string, THREE.Texture>(),
};

/** shared surface texture with its own tiling (clones share the same image) */
function tiled(kind: "grain" | "smudge", repeat: number): THREE.Texture {
  Surfaces.grain ??= surfaceTexture(512, (ctx, s) => grainImage(ctx, s, 90));
  Surfaces.smudge ??= surfaceTexture(512, (ctx, s) => smudgeImage(ctx, s, 70, 0.35));
  const key = `${kind}:${repeat}`;
  let texture = Surfaces.repeats.get(key);
  if (!texture) {
    texture = Surfaces[kind]!.clone();
    texture.repeat.set(repeat, repeat);
    Surfaces.repeats.set(key, texture);
  }
  return texture;
}

/**
 * slightly glossy injection-moulded plastic with a fine grain and hand smudges;
 * `tiling` is how many times the grain repeats across the part's UV space
 */
const plastic = (color: number, roughness = 0.42, tiling = 10) =>
  new THREE.MeshPhysicalMaterial({
    color, roughness,
    roughnessMap: tiled("smudge", Math.max(1, tiling / 8)),
    bumpMap: tiled("grain", tiling), bumpScale: 1.2,
    clearcoat: 0.25, clearcoatRoughness: 0.4,
  });

/** canvas texture with text, drawn by the callback on a canvas of the given aspect */
function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * 256);
  canvas.height = Math.round(height * 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  const redraw = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, canvas.width, canvas.height);
    texture.needsUpdate = true;
  };
  redraw();
  return { texture, redraw };
}

/** flat text plane; lies on top of a surface unless `upright` */
function label(text: string, width: number, height: number,
  { color = "#222", font = "bold", upright = false, size = 0.62 } = {}): THREE.Mesh {
  const { texture } = canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.font = `${font} ${Math.round(h * size)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2, w * 0.96);
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.8 }));
  if (!upright) mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** "VIRCON32" lettering with small caps, as on the console */
function brandLabel(width: number, height: number): THREE.Mesh {
  const { texture } = canvasTexture(width, height, (ctx, w, h) => {
    const big = Math.round(h * 0.78), small = Math.round(h * 0.56);
    ctx.fillStyle = "#26272a";
    ctx.textBaseline = "alphabetic";
    const parts: [string, number][] = [["V", big], ["IRCON", small], ["32", big]];
    ctx.font = `bold ${big}px Arial`;
    let total = 0;
    for (const [text, size] of parts) { ctx.font = `bold ${size}px Arial`; total += ctx.measureText(text).width; }
    let x = (w - total) / 2;
    for (const [text, size] of parts) {
      ctx.font = `bold ${size}px Arial`;
      ctx.fillText(text, x, h * 0.82);
      x += ctx.measureText(text).width;
    }
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.8 }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private ambientOcclusion: GTAOPass;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.1, 100);
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private held = new Map<number, { mesh: THREE.Object3D; control: number }>();

  private screenTexture: THREE.CanvasTexture;
  private led!: THREE.MeshStandardMaterial;
  private ports: THREE.MeshStandardMaterial[] = [];
  private consoleUnit = new THREE.Group();
  private cartridge!: THREE.Group;
  private redrawCartridge!: () => void;
  private shownTitle: string | null = "";

  private view: keyof typeof Views = "scene";
  private tween: { from: THREE.Vector3; fromTarget: THREE.Vector3; t: number } | null = null;

  constructor(private container: HTMLElement, screenCanvas: HTMLCanvasElement, private host: SceneHost) {
    // antialiasing is done by SMAA at the end of the post-processing chain
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio * 1.25, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // reflections and ambient light: a synthetic room at once, the photographed one when it arrives
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.25;
    new HDRLoader().load(EnvironmentURL, (hdr) => {
      this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
    });

    // post-processing: ambient occlusion in contact areas, a soft glow on the screen and LED,
    // antialiasing, and finally tone mapping + sRGB output
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ambientOcclusion = new GTAOPass(this.scene, this.camera, 512, 512);
    this.ambientOcclusion.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 16 });
    this.ambientOcclusion.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.ambientOcclusion.blendIntensity = 0.9;
    this.composer.addPass(this.ambientOcclusion);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.12, 0.35, 0.985);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());

    this.screenTexture = new THREE.CanvasTexture(screenCanvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenTexture.minFilter = THREE.LinearFilter;
    this.screenTexture.generateMipmaps = false;

    this.buildRoom();
    this.buildMonitor();
    this.buildConsole();
    this.buildGamepad();

    // ?cam=x,y,z,targetX,targetY,targetZ sets the initial camera (for captures)
    const cam = new URLSearchParams(location.search).get("cam")?.split(",").map(Number);
    const custom = cam?.length === 6 && cam.every(Number.isFinite);
    this.camera.position.copy(custom ? new THREE.Vector3(cam![0], cam![1], cam![2]) : Views.scene.position);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(custom ? new THREE.Vector3(cam![3], cam![4], cam![5]) : Views.scene.target);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 14;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.5;
    this.controls.minAzimuthAngle = -0.9;
    this.controls.maxAzimuthAngle = 0.9;

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** switches between the whole scene and the screen close-up */
  toggleView(): void {
    this.view = this.view === "scene" ? "screen" : "scene";
    this.tween = { from: this.camera.position.clone(), fromTarget: this.controls.target.clone(), t: 0 };
  }

  // ------------------------------------------------------------------
  //   models
  // ------------------------------------------------------------------

  private add(parent: THREE.Object3D, mesh: THREE.Mesh, x: number, y: number, z: number, action?: Action): THREE.Mesh {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (action) mesh.userData.action = action;
    return mesh;
  }

  private buildRoom(): void {
    this.scene.background = new THREE.Color(0x3a3430);
    this.scene.add(new THREE.HemisphereLight(0xfff6ee, 0x7a4a3a, 0.4));
    // warm lamp from the upper left, the main light of a dim room
    const sun = new THREE.SpotLight(0xffe2c0, 170, 24, 0.66, 0.75, 2);
    sun.position.set(-3.5, 7.5, 5);
    sun.target.position.set(0, 0.8, 1);
    this.scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    const fill = new THREE.PointLight(0xffd2b0, 4, 14, 2);
    fill.position.set(5, 3.5, 4);
    this.scene.add(fill);

    // matte terracotta desk with a very fine grain
    const grain = canvasTexture(8, 4, (ctx, w, h) => {
      ctx.fillStyle = "#9c6150";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "60,25,15" : "220,150,120"},0.05)`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 18, 1);
      }
    }).texture;
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    grain.repeat.set(2, 1.5);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 7.5), new THREE.MeshStandardMaterial({ map: grain, roughness: 0.82, bumpMap: tiled("grain", 30), bumpScale: 0.25, roughnessMap: tiled("smudge", 3) }));
    desk.position.set(0, -0.15, 0.6);
    desk.receiveShadow = true;
    this.scene.add(desk);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), standard(Colors.wall, 0.9));
    wall.position.set(0, 9, -3.15);
    wall.receiveShadow = true;
    this.scene.add(wall);

    // two wall sockets next to the monitor
    for (const x of [4.4, 5.2]) {
      this.add(this.scene, new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.72, 0.06, 3, 0.03), standard(0xe9e5dc, 0.6)), x, 0.95, -3.12);
      const well = this.add(this.scene, new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 40), standard(0xdcd7cc, 0.7)),
        x, 0.95, -3.08);
      well.rotation.x = Math.PI / 2;
      for (const dx of [-0.1, 0.1]) {
        const hole = this.add(this.scene, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), standard(0x3a3632)),
          x + dx, 0.95, -3.06);
        hole.rotation.x = Math.PI / 2;
      }
    }

    // soft contact shadows where the objects touch the desk
    const blob = canvasTexture(1, 1, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(30,10,4,0.55)");
      g.addColorStop(0.6, "rgba(30,10,4,0.25)");
      g.addColorStop(1, "rgba(30,10,4,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }).texture;
    const contact = (w: number, d: number, x: number, z: number, angle: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
      mesh.rotation.set(-Math.PI / 2, 0, angle);
      mesh.position.set(x, 0.003, z);
      this.scene.add(mesh);
    };
    contact(3.8, 3.1, 1.2, 0.8, -0.72);
    contact(2.9, 1.5, -0.4, 2.75, -0.6);
    contact(2.8, 1.7, 0, -2, 0);

    // light coming from the monitor's screen
    const glow = new THREE.SpotLight(0xbfd4ff, 24, 9, 1.1, 1, 2);
    glow.position.set(0, 3.12, -1.8);
    glow.target.position.set(0, 0, 2.5);
    this.scene.add(glow, glow.target);
  }

  private buildMonitor(): void {
    const monitor = new THREE.Group();
    monitor.position.set(0, 0, -2);
    this.scene.add(monitor);

    this.add(monitor, new THREE.Mesh(new RoundedBoxGeometry(5.8, 3.5, 0.25, 4, 0.08), plastic(Colors.monitor, 0.5, 40)),
      0, 3.0, 0, { view: true });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4 * 9 / 16),
      new THREE.MeshBasicMaterial({ map: this.screenTexture, toneMapped: false }));
    this.add(monitor, screen, 0, 3.12, 0.13, { view: true }).castShadow = false;
    this.add(monitor, label("VIRCON TV", 1.3, 0.22, { color: "#c9cacc", upright: true }), 0, 1.42, 0.13).castShadow = false;
    this.add(monitor, new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.25, 0.16), standard(0x2c2e31)), 0, 0.7, -0.08);
    this.add(monitor, new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.08, 1.3, 2, 0.03), standard(0x2c2e31)), 0, 0.04, 0);
  }

  private buildConsole(): void {
    const unit = this.consoleUnit;
    unit.position.set(1.2, 0, 0.8);
    unit.rotation.y = -0.72;
    this.scene.add(unit);
    const top = 1.0, front = 1.25;

    // shell on a slightly inset base
    this.add(unit, new THREE.Mesh(new RoundedBoxGeometry(2.85, 0.14, 2.15, 3, 0.05), standard(0x9f9d96, 0.7)), 0, 0.07, 0);
    this.add(unit, new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.88, 2.5, 6, 0.2), plastic(Colors.plastic, 0.42, 24)), 0, 0.56, 0);
    // side vents
    for (let i = 0; i < 10; i++)
      this.add(unit, new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.36, 0.04), standard(0x8d8b85, 0.8)), 1.6, 0.52, -0.75 + i * 0.1)
        .castShadow = false;

    // cartridge bay: cream recessed plate, dark slot frame and the cartridge sticking out of it
    this.add(unit, new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.02, 0.95), standard(0xf2ede2, 0.75)), 0, top, -0.62);
    this.add(unit, new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.07, 0.32, 2, 0.02), standard(0x2a2b2d, 0.7)), 0, top + 0.02, -0.62,
      { click: "load" });

    this.add(unit, new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.006, 0.15), standard(0x050505, 0.9)), 0, top + 0.056, -0.62,
      { click: "load" }).castShadow = false;

    this.cartridge = new THREE.Group();
    this.cartridge.position.set(0, top + 0.5, -0.62);
    unit.add(this.cartridge);
    const cartLabel = canvasTexture(1.1, 1.0, (ctx, w, h) => {
      const title = (this.host.cartridgeTitle ?? "").toUpperCase();
      // top strip: "V32" badge and the title
      ctx.fillStyle = "#f4f4f2";
      ctx.fillRect(0, 0, w, h * 0.13);
      ctx.fillStyle = "#1b1b1b";
      ctx.fillRect(w * 0.03, h * 0.02, w * 0.14, h * 0.09);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(h * 0.07)}px Arial`;
      ctx.textBaseline = "middle";
      ctx.fillText("V32", w * 0.045, h * 0.067);
      ctx.fillStyle = "#e08a00";
      ctx.fillText(title, w * 0.2, h * 0.067, w * 0.77);
      // art: dark band with the console name, sky and the title
      const sky = ctx.createLinearGradient(0, h * 0.13, w, h);
      sky.addColorStop(0, "#9fd8f2"); sky.addColorStop(0.6, "#e9f6ff"); sky.addColorStop(1, "#ffd9c2");
      ctx.fillStyle = "#1b1b1b";
      ctx.fillRect(0, h * 0.13, w * 0.15, h);
      ctx.fillStyle = "#7ed321";
      ctx.fillRect(w * 0.15, h * 0.13, w * 0.02, h);
      ctx.fillStyle = sky;
      ctx.fillRect(w * 0.17, h * 0.13, w, h);
      ctx.save();
      ctx.translate(w * 0.075, h * 0.92);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(w * 0.1)}px Arial`;
      ctx.fillText("Vircon32", 0, 0);
      ctx.restore();
      ctx.fillStyle = "#f2a900";
      ctx.strokeStyle = "#7a3d00";
      ctx.lineWidth = h * 0.012;
      ctx.font = `900 ${Math.round(h * 0.12)}px Arial`;
      ctx.textBaseline = "top";
      title.split(/[\s_-]+/).slice(0, 4).forEach((word, i) => {
        ctx.strokeText(word, w * 0.24, h * (0.2 + i * 0.16), w * 0.7);
        ctx.fillText(word, w * 0.24, h * (0.2 + i * 0.16), w * 0.7);
      });
    });
    this.redrawCartridge = cartLabel.redraw;
    this.add(this.cartridge, new THREE.Mesh(new RoundedBoxGeometry(1.3, 1.15, 0.22, 3, 0.05), plastic(0xc9c9c6, 0.5, 10)), 0, 0, 0,
      { click: "load" });
    this.add(this.cartridge, new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.0),
      new THREE.MeshStandardMaterial({ map: cartLabel.texture, roughness: 0.55 })), 0, 0.02, 0.111, { click: "load" });

    // POWER switch with its LED and "ON" mark
    this.led = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2010, emissiveIntensity: 2 });
    this.add(unit, new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), this.led), -1.1, top + 0.01, -0.08);
    const key = (x: number, z: number, text: string, click: string, framed: boolean) => {
      if (framed)
        this.add(unit, new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.06, 0.42, 2, 0.02), standard(0x2a2b2d, 0.6)), x, top + 0.01, z);
      const mesh = this.add(unit, new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.11, 0.3, 2, 0.03), plastic(Colors.key, 0.45, 4)),
        x, top + 0.05, z, { click });
      const caption = label(text, 0.5, 0.12, { color: "#e9e9e9" });
      caption.position.y = 0.056;
      mesh.add(caption);
    };
    key(-1.1, 0.22, "POWER", "pause", false);
    this.add(unit, label("ON", 0.25, 0.1), -1.1, top + 0.003, 0.46);
    key(1.1, -0.02, "RESET", "reset", true);

    // name and the recessed EJECT plate
    this.add(unit, brandLabel(1.5, 0.26), 0, top + 0.004, -0.02);
    const eject = this.add(unit, new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.03, 0.34, 2, 0.012), plastic(0xd2d1cb, 0.5, 8)),
      0, top + 0.005, 0.34, { click: "eject" });
    const ejectText = label("EJECT", 0.8, 0.2, { color: "#bdbcb6", font: "" });
    ejectText.position.y = 0.016;
    eject.add(ejectText);

    // front: USB gamepad ports and memory card slot
    const panel = (w: number, x: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, action?: Action) =>
      this.add(unit, new THREE.Mesh(new THREE.PlaneGeometry(w, 0.42),
        new THREE.MeshStandardMaterial({ map: canvasTexture(w, 0.42, draw).texture, roughness: 0.8 })), x, 0.54, front + 0.002, action)
        .castShadow = false;
    panel(1.85, -0.55, (ctx, w, h) => {
      ctx.fillStyle = "#f1e6df";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#222";
      ctx.font = `bold ${Math.round(h * 0.2)}px Arial`;
      ctx.textAlign = "center";
      for (let i = 0; i < 4; i++) ctx.fillText(`P${i + 1}`, w * (0.14 + i * 0.24), h * 0.34);
    });
    for (let i = 0; i < 4; i++) {
      const x = -0.55 + 1.85 * (0.14 + i * 0.24 - 0.5);
      this.add(unit, new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.03), standard(0x2b2b2b, 0.6)), x, 0.45, front + 0.01)
        .castShadow = false;
      const tongue = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.35, metalness: 0.4, emissive: 0x000000 });
      this.ports.push(tongue);
      this.add(unit, new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.035), tongue), x, 0.465, front + 0.015).castShadow = false;
    }
    panel(0.95, 0.95, (ctx, w, h) => {
      ctx.fillStyle = "#f1e6df";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#222";
      ctx.font = `bold ${Math.round(h * 0.17)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("MEMORY CARD", w / 2, h * 0.36, w * 0.9);
    }, { click: "card-export" });
    this.add(unit, new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.07, 0.03), standard(0x9a9a9a, 0.4)), 0.95, 0.45, front + 0.01,
      { click: "card-export" }).castShadow = false;
    this.add(unit, new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.035), standard(0x2f5fae, 0.3)), 0.95, 0.455, front + 0.012,
      { click: "card-export" }).castShadow = false;
    // power cable from the back of the console to the wall socket
    this.scene.updateMatrixWorld(true);
    const at = (x: number, y: number, z: number) => unit.localToWorld(new THREE.Vector3(x, y, z));
    const powerCable = standard(0x24292c, 0.55);
    this.add(this.scene, new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.24, 0.14, 2, 0.04), powerCable), 4.4, 0.95, -2.99);
    const power = new THREE.CatmullRomCurve3([
      at(1.1, 0.3, -1.25),
      at(1.1, 0.12, -1.5),
      at(1.25, 0.035, -1.8),
      new THREE.Vector3(3.9, 0.035, -2.75),
      new THREE.Vector3(4.35, 0.06, -3.05),
      new THREE.Vector3(4.4, 0.5, -3.08),
      new THREE.Vector3(4.4, 0.85, -3.03),
      new THREE.Vector3(4.4, 0.95, -2.95),
    ]);
    this.add(this.scene, new THREE.Mesh(new THREE.TubeGeometry(power, 100, 0.03, 10), powerCable), 0, 0, 0);
  }

  private buildGamepad(): void {
    const pad = new THREE.Group();
    const padAngle = -0.6;
    pad.position.set(-0.4, 0, 2.75);
    pad.rotation.y = padAngle;
    pad.scale.setScalar(0.8);
    this.scene.add(pad);

    // stadium-shaped body
    const shape = new THREE.Shape();
    const halfWidth = 1.5, radius = 0.65;
    shape.absarc(-halfWidth + radius, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
    shape.absarc(halfWidth - radius, 0, radius, -Math.PI / 2, Math.PI / 2, false);
    const body = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 5, curveSegments: 48 });
    body.rotateX(-Math.PI / 2);
    this.add(pad, new THREE.Mesh(body, plastic(0xd9d9d4, 0.42, 6)), 0, 0.06, 0);
    const top = 0.28;

    for (const x of [-0.85, 0.85])
      this.add(pad, new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.02, 64), standard(0xf3f1e4, 0.6)), x, top + 0.005, 0);

    // d-pad: four arms (one per direction) with arrows, and the center
    const dpad = plastic(0x5f636a, 0.45, 3);
    const arm = (w: number, d: number, x: number, z: number, control?: number, arrow?: number) => {
      const mesh = this.add(pad, new THREE.Mesh(new RoundedBoxGeometry(w, 0.09, d, 2, 0.02), dpad), -0.85 + x, top + 0.05, z,
        control === undefined ? undefined : { control });
      if (arrow !== undefined) {
        const tri = label("▲", 0.12, 0.12, { color: "#3a3d42", size: 0.9 });
        tri.position.y = 0.046;
        tri.rotation.z = arrow;
        mesh.add(tri);
      }
    };
    arm(0.21, 0.21, 0, 0);
    arm(0.21, 0.24, 0, -0.22, 2, 0);
    arm(0.21, 0.24, 0, 0.22, 3, Math.PI);
    arm(0.24, 0.21, -0.22, 0, 0, Math.PI / 2);
    arm(0.24, 0.21, 0.22, 0, 1, -Math.PI / 2);

    // face buttons
    const faces: [string, number, number, number][] = [["X", 0, -0.27, 7], ["Y", -0.27, 0, 8], ["A", 0.27, 0, 5], ["B", 0, 0.27, 6]];
    for (const [name, x, z, control] of faces) {
      const button = this.add(pad, new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 40), plastic(Colors.teal, 0.3, 3)),
        0.85 + x, top + 0.06, z, { control });
      const letter = label(name, 0.18, 0.18, { color: "#1d2b27", size: 0.8 });
      letter.position.y = 0.051;
      button.add(letter);
    }

    // START and name
    this.add(pad, new THREE.Mesh(new RoundedBoxGeometry(0.75, 0.02, 0.34, 2, 0.01), standard(0xf3f1e4, 0.6)), 0, top + 0.005, 0.27);
    this.add(pad, new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.06, 0.11, 2, 0.025), plastic(0x5f636a, 0.45, 2)), 0, top + 0.03, 0.31,
      { control: 4 });
    this.add(pad, label("START", 0.4, 0.09, { font: "" }), 0, top + 0.017, 0.17);
    this.add(pad, brandLabel(0.9, 0.18), 0, top + 0.006, -0.25);

    // cable: a plug in P1, down to the desk and into the back of the gamepad
    this.scene.updateMatrixWorld(true);
    const portX = -0.55 + 1.85 * (0.14 - 0.5), front = 1.25;
    const local = (x: number, y: number, z: number) => this.consoleUnit.localToWorld(new THREE.Vector3(x, y, z));
    const cable = standard(0x24292c, 0.55);
    this.add(this.consoleUnit, new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.15, 0.26, 2, 0.03), cable), portX, 0.45, front + 0.13);
    const path = new THREE.CatmullRomCurve3([
      local(portX, 0.45, front + 0.25),
      local(portX + 0.02, 0.3, front + 0.42),
      local(portX + 0.08, 0.035, front + 0.62),
      pad.localToWorld(new THREE.Vector3(-0.75, 0.035 / 0.8, -1.05)),
      pad.localToWorld(new THREE.Vector3(-0.45, 0.2, -0.72)),
      pad.localToWorld(new THREE.Vector3(-0.35, 0.2, -0.6)),
    ]);
    this.add(this.scene, new THREE.Mesh(new THREE.TubeGeometry(path, 80, 0.04, 12), cable), 0, 0, 0);
  }

  // ------------------------------------------------------------------
  //   interaction
  // ------------------------------------------------------------------

  private pick(e: PointerEvent): { mesh: THREE.Object3D; action: Action } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.scene.children, true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.action) object = object.parent;
      return object ? { mesh: object, action: object.userData.action } : null;
    }
    return null;
  }

  private bindPointer(): void {
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = "none";
    // capture phase so a press on a piece does not also start orbiting
    canvas.addEventListener("pointerdown", (e) => {
      const hit = this.pick(e);
      if (!hit) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const { mesh, action } = hit;
      if (action.control !== undefined) {
        canvas.setPointerCapture(e.pointerId);
        this.host.setVirtual(action.control, true);
        mesh.position.y -= 0.03;
        this.held.set(e.pointerId, { mesh, control: action.control });
      } else if (action.click) {
        mesh.position.y -= 0.02;
        setTimeout(() => (mesh.position.y += 0.02), 120);
        document.getElementById(action.click)?.click();
      } else if (action.view) {
        this.toggleView();
      }
    }, { capture: true });

    const release = (e: PointerEvent) => {
      const held = this.held.get(e.pointerId);
      if (!held) return;
      this.held.delete(e.pointerId);
      this.host.setVirtual(held.control, false);
      held.mesh.position.y += 0.03;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      canvas.style.cursor = this.pick(e) ? "pointer" : "grab";
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------
  //   per frame
  // ------------------------------------------------------------------

  private frame(): void {
    this.screenTexture.needsUpdate = true;

    const paused = this.host.isPaused;
    this.led.emissiveIntensity = paused ? 0 : 2;
    this.led.color.setHex(paused ? 0x6b2a26 : 0xff3b30);

    const title = this.host.cartridgeTitle;
    if (title !== this.shownTitle) {
      this.shownTitle = title;
      this.cartridge.visible = title !== null;
      if (title !== null) this.redrawCartridge();
    }

    this.ports.forEach((material, port) => {
      const on = this.host.portConnected(port);
      material.color.setHex(on ? 0x6cc4a6 : 0x9a9a9a);
      material.emissive.setHex(on ? 0x2f8f6f : 0x000000);
    });

    if (this.tween) {
      const view = Views[this.view];
      this.tween.t = Math.min(1, this.tween.t + 1 / 36);
      const k = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from, view.position, k);
      this.controls.target.lerpVectors(this.tween.fromTarget, view.target, k);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.controls.update();
    this.composer.render();
  }
}
