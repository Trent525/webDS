#!/usr/bin/env bash
# Example build script to compile melonDS to WebAssembly using Emscripten.
# This is a starting point and will likely require tweaking for melonDS upstream changes.
# Requirements: emsdk activated in your shell (source emsdk_env.sh), cmake, ninja or make.

set -euo pipefail

REPO_DIR=$(pwd)
BUILD_DIR="$REPO_DIR/build-melonds"
INSTALL_DIR="$REPO_DIR/static/emu"
mkdir -p "$BUILD_DIR"
mkdir -p "$INSTALL_DIR"

# Clone melonDS if not present
if [ ! -d "melonds" ]; then
  echo "Cloning melonDS..."
  git clone --depth 1 https://github.com/melonDS-emu/melonDS.git melonds
fi

cd melonds
# Create the build dir inside melonds
mkdir -p build && cd build

# Use emcmake to configure cmake for Emscripten
# You may want to set flags to disable optional backends, sound, or features that require native libs.
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR"

# Build with emmake
emmake make -j"$(nproc)"

# If the build produces a JS/WASM pair, copy them to the static/emu directory.
# The exact output filenames depend on melonDS build configuration; adjust as needed.

# Example (adjust if needed):
if [ -f "melonDS.js" ]; then
  cp melonDS.js melonDS.wasm "$INSTALL_DIR/"
  echo "Copied melonDS.js and melonDS.wasm to $INSTALL_DIR"
else
  echo "Build done. Please locate the generated .js/.wasm files and copy them into $INSTALL_DIR"
fi

