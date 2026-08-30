#!/usr/bin/env bash
# Example helper script to install Emscripten SDK (emsdk) and activate it locally.
# Run this script from a Unix-like shell. Do NOT run as root. You must have git, python installed.

set -euo pipefail

if [ -d "emsdk" ]; then
  echo "emsdk directory already exists; attempting to update"
  cd emsdk
  git pull
  cd ..
else
  git clone https://github.com/emscripten-core/emsdk.git
fi

cd emsdk
./emsdk install latest
./emsdk activate latest
# Source the emsdk environment in the current shell (print instructions)
echo "To use emsdk in this shell, run: source $(pwd)/emsdk_env.sh"
cd ..

echo "emsdk helper finished."
