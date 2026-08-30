# webDS

A web frontend and build scaffold to run melonDS (Nintendo DS emulator) in the browser via WebAssembly (WASM).

This repository contains a minimal HTML/JS frontend and helper scripts to compile melonDS to WebAssembly with Emscripten. It purposely does NOT include any BIOS, firmware, or commercial ROMs. You must provide those yourself (see Legal & BIOS section below).

What is included
- index.html: Minimal two-screen UI and controls
- static/js/main.js: Frontend logic to load an Emscripten-built emulator and wire file inputs / keyboard / touch
- static/css/style.css: Basic UI styling
- scripts/setup_emsdk.sh: Helper to install/activate emsdk (must be run locally)
- scripts/build_melonds_wasm.sh: Example build script to compile melonDS with Emscripten (may need tweaking for your environment)
- package.json: small dev server to serve files locally
- README.md: instructions, build steps, and legal notes

Quick start (dev)
1. Clone this repo.
2. Install Node.js and run `npm install`.
3. Build melonDS to WebAssembly following README steps, then copy the generated `melonDS.js` and `melonDS.wasm` into `static/emu/`.
4. Start the dev server: `npm run serve` and open http://localhost:8080

If you want, I can also add a GitHub Action to attempt a build; local builds are recommended because building emulator native code needs Emscripten and system dependencies.


---

Emscripten build flags required for loader

To make the frontend automatically instantiate the melonDS WebAssembly module and load the ROM, build melonDS with Emscripten using these flags (or their CMake equivalents):

-s MODULARIZE=1 \
-s EXPORT_NAME='createMelonDSModule' \
-s EXPORTED_RUNTIME_METHODS='["FS","callMain","ccall","cwrap"]' \
-s ALLOW_MEMORY_GROWTH=1 \
-s ASSERTIONS=1 \
-s ENVIRONMENT='web' \

Example (emcc link flags):

emcc <object-files> -o melonDS.js \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='createMelonDSModule' \
  -s EXPORTED_RUNTIME_METHODS='["FS","callMain","ccall","cwrap"]' \
  -s ALLOW_MEMORY_GROWTH=1

Notes:
- MODULARIZE=1 exports a factory function which our loader calls to instantiate the runtime and provide locateFile.
- locateFile is used to load melonDS.wasm from `static/emu/` so ensure both files are copied there after building.

Running locally
1. Build melonDS as above and copy melonDS.js and melonDS.wasm into `static/emu/`.
2. Start the dev server (`npm run serve`) and open the page.
3. Load a .nds ROM using the file input and click Start. The loader writes the ROM into the Emscripten FS before runtime starts and calls the emulator entrypoint.

Legal reminder
- This project does NOT include Nintendo DS BIOS, firmware, or commercial ROMs. You must dump BIOS/ROMs from hardware you own. Running commercial ROMs without owning them is illegal in many jurisdictions.
