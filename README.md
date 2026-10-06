# Vircon32 · WebAssembly

El núcleo **original en C++** del emulador de la consola de fantasía [Vircon32](https://github.com/vircon32/ComputerSoftware) (`DesktopEmulator/ConsoleLogic`), compilado a **WebAssembly** con Emscripten y con un frontend web en TypeScript.

El código C++ de la consola está **sin modificar**: se usa tal cual y solo se le añade una capa de enlace (`src/WasmBindings.cpp`) que conecta sus callbacks de vídeo con WebGL y le pasa los archivos mediante el sistema de ficheros en memoria de Emscripten.

## Probarlo

```bash
cd web/public
python3 -m http.server 8080
# abre http://localhost:8080
# o carga un cartucho directamente: http://localhost:8080/?rom=ruta/al/cartucho.v32
```

Por defecto la página carga `games/Retrotime.v32`, uno de los juegos de la comunidad que se descargan con `npm run games` (ver [games/](games/README.md)). Para que el navegador lo encuentre, el servidor tiene que servir también esa carpeta en `/games/`.

`web/public/` ya incluye el WebAssembly (`wasm/vircon32.wasm` + `vircon32.mjs`) y el bundle del frontend (`vircon32.js`), así que basta con cualquier servidor estático. Carga un cartucho `.v32` con el botón **Load cartridge** o arrastrándolo sobre la pantalla.

### Controles

| Consola | Teclado |
|---|---|
| D-pad | Flechas |
| A / B | `X` o `Espacio` / `Z` |
| X / Y | `S` / `A` |
| L / R | `Q` / `W` |
| Start | `Enter` |
| Pausa / Reset | `Esc` / `F5` |

Los mandos (Gamepad API) se asignan a los puertos 1 a 4. Cada cartucho recibe su propia memory card, que se guarda automáticamente en IndexedDB. Se puede descargar o importar como `.memc`.

## Compilar

Hace falta [Emscripten](https://emscripten.org/docs/getting_started/downloads.html) (`emcc` en el `PATH`) y Node.js.

```bash
npm install
npm run build:wasm   # src/ (C++) -> web/public/wasm/vircon32.{mjs,wasm}
npm run build:web    # web/src (TypeScript) -> web/public/vircon32.js
npm run build        # las dos cosas
npm test             # test sin navegador (Node.js)
```

El workflow de GitHub Actions (`.github/workflows/build.yml`) hace lo mismo en cada push y publica el resultado como artefacto.

## Estructura

```
src/ConsoleLogic/        Lógica de la consola, copiada sin cambios del repositorio oficial
src/VirconDefinitions/   Definiciones comunes de Vircon32 (sin cambios)
src/WasmBindings.cpp     API en C para JavaScript: carga de ROMs, frames, mandos, audio, memory card
build.sh                 Compilación con emcc (-O3, excepciones nativas de WebAssembly)
web/src/
  WasmCore.ts            Envoltorio TypeScript del módulo WebAssembly
  WebGLRenderer.ts       Render con WebGL (mismos shaders y blending que el emulador de escritorio)
  AudioOutput.ts         Audio con Web Audio
  Input.ts               Teclado y Gamepad API
  App.ts                 Bucle a 60 fps, interfaz, cartuchos y memory cards
  Scene3D.ts             Escena 3D (Three.js): monitor, consola y mando interactivos
web/public/              Página, BIOS estándar y binarios compilados
games/                   Lista de juegos de la comunidad y script para descargarlos
tests/                   Test sin navegador y ROMs de prueba (con su código C)
```

### Cómo encaja

- **Vídeo**: los `V32::Callbacks` (`DrawQuad`, `ClearScreen`, `SetBlendingMode`…) se implementan con `EM_JS` y llaman a `Module.video`, que es el `WebGLRenderer`.
- **Archivos**: la BIOS y los cartuchos se escriben en el FS virtual y se cargan con las funciones originales `LoadBios` y `LoadCartridge`, con todas sus validaciones. La memory card queda enlazada a `/card.memc`, que el frontend lee para guardarla en IndexedDB.
- **Errores**: las excepciones de C++ (`-fwasm-exceptions`) se capturan en la capa de enlace y llegan a JavaScript como mensajes de error.

## Verificación

Se comparó, fotograma a fotograma, con otra implementación de la consola, ejecutando las dos con la misma entrada. Se compararon todas las llamadas de vídeo, el audio de cada frame y la memory card final:

- **ROM de estrés** (`tests/roms/stress-test.c`), 3.000 frames con reset intermedio: idénticos.

### Rendimiento (Node.js 22)

| ROM | ms por frame |
|---|---|
| CPU al 100 % (`cpu-benchmark`) | ~5,9 |

El presupuesto es de 16,7 ms por frame. El C++ original está escrito para ser legible y no para ir rápido: despacha las instrucciones con punteros a función y los dispositivos con llamadas virtuales, y cada error de hardware lanza una excepción.

## Créditos y licencias

- **Vircon32** © Carra. El código de `src/ConsoleLogic` y `src/VirconDefinitions` procede de [vircon32/ComputerSoftware](https://github.com/vircon32/ComputerSoftware) (commit `5219741`) y se distribuye bajo la [licencia BSD-3-Clause](https://opensource.org/license/bsd-3-clause). La BIOS estándar está bajo CC BY 4.0.
- Los juegos de [games/](games/README.md) son de sus autores y no se incluyen en el repositorio.
- El entorno HDRI de la escena 3D (`web/public/env/studio_1k.hdr`) es [Brown Photostudio 02](https://polyhaven.com/a/brown_photostudio_02), de Poly Haven (CC0).
