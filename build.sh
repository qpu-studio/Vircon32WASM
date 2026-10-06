#!/bin/bash
# Builds the official Vircon32 ConsoleLogic (C++) to WebAssembly with Emscripten.
# Requires emcc on PATH (https://emscripten.org/docs/getting_started/downloads.html)
set -e
cd "$(dirname "$0")"
mkdir -p web/public/wasm
emcc -O3 -std=c++11 -fwasm-exceptions \
  src/WasmBindings.cpp src/ConsoleLogic/*.cpp \
  -o web/public/wasm/vircon32.mjs \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createVircon32Module \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=128MB -sMAXIMUM_MEMORY=4GB \
  -sSTACK_SIZE=1MB \
  -sEXPORTED_RUNTIME_METHODS=FS,UTF8ToString,stringToUTF8 \
  -sFORCE_FILESYSTEM=1 -sEXPORTED_FUNCTIONS=_malloc,_free \
  "$@"
echo "Built web/public/wasm/vircon32.mjs + vircon32.wasm"
