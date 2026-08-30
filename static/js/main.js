// main.js — frontend loader and UI glue for melonDS WebAssembly build
// This file tries to load an Emscripten-generated `melonDS.js` script from `static/emu/`.
// If present, the Emscripten module should expose a Module object we can interact with.

(function () {
  const statusEl = document.getElementById('status');
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');

  const fileRom = document.getElementById('file-rom');
  const fileBios7 = document.getElementById('file-bios7');
  const fileBios9 = document.getElementById('file-bios9');

  const canvasTop = document.getElementById('screen-top');
  const canvasBottom = document.getElementById('screen-bottom');

  let Module = null;
  let emuReady = false;
  let romBuffer = null;
  let bios7 = null;
  let bios9 = null;

  function setStatus(s) { statusEl.textContent = s; }

  // Try to lazy-load the Emscripten-generated glue JS if it exists
  async function tryLoadEmu() {
    const jsPath = 'static/emu/melonDS.js';
    try {
      setStatus('Loading emulator: ' + jsPath);
      await loadScript(jsPath);
      // Emscripten glue usually creates a global `Module` or returns a factory; try to pick it up.
      Module = window.Module || window.melonDSModule || null;
      if (!Module) {
        setStatus('Loaded glue, waiting for Module...');
        // Some builds provide a factory function; try common names
        Module = window.createModule || window.createMelonDSModule || window.Module;
      }

      // If the build expects a Module object at load time, it may already have started.
      // We can't fully generalize; user will likely need to compile melonDS with DEFAULT_LIBRARY_FUNCS_TO_INCLUDE or specific API.

      setStatus('Emulator glue loaded. Please build melonDS.wasm and place in static/emu/.');
      emuReady = true;
    } catch (err) {
      console.warn('Emulator glue not found:', err);
      setStatus('No emulator build found. Place melonDS.js and melonDS.wasm in static/emu/ after building.');
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function readFileInput(input) {
    return new Promise((resolve) => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(f);
    });
  }

  fileRom.addEventListener('change', async () => {
    romBuffer = await readFileInput(fileRom);
    setStatus(romBuffer ? 'ROM loaded into memory (not yet started)' : 'ROM cleared');
  });
  fileBios7.addEventListener('change', async () => {
    bios7 = await readFileInput(fileBios7);
    setStatus(bios7 ? 'BIOS ARM7 loaded' : '');
  });
  fileBios9.addEventListener('change', async () => {
    bios9 = await readFileInput(fileBios9);
    setStatus(bios9 ? 'BIOS ARM9 loaded' : '');
  });

  btnStart.addEventListener('click', async () => {
    if (!emuReady) {
      setStatus('Emulator not built/loaded. See README.');
      return;
    }
    if (!romBuffer) { setStatus('Please choose a .nds ROM first'); return; }

    setStatus('Starting emulator...');

    // Many Emscripten builds expose a FS API. If Module exists and has FS, write files into the virtual FS.
    if (window.Module && Module.FS && Module.FS.mkdir) {
      try {
        if (!Module.FS.analyzePath('/roms').exists) Module.FS.mkdir('/roms');
      } catch (e) { }
      // Write ROM
      try { Module.FS.writeFile('/roms/game.nds', new Uint8Array(romBuffer)); } catch (e) { console.error(e); }
      if (bios7) try { Module.FS.writeFile('/roms/bios7.bin', new Uint8Array(bios7)); } catch (e) {}
      if (bios9) try { Module.FS.writeFile('/roms/bios9.bin', new Uint8Array(bios9)); } catch (e) {}

      setStatus('ROM and BIOS files written to emscripten FS at /roms/. Attempting to call emulator main.');

      // This next call depends on how melonDS is built. Commonly, an entrypoint function or main expects args.
      // We attempt to call Module._main with argv pointing to the rom path. This will likely need adjustment.
      try {
        if (typeof Module._main === 'function') {
          // Create a char** argv in the Emscripten heap (approximation). Simpler approach is to call Module.callMain.
          Module.callMain(['/roms/game.nds']);
        } else if (typeof Module.callMain === 'function') {
          Module.callMain(['/roms/game.nds']);
        } else {
          setStatus('Emulator build loaded, but no entry point found. Check your melonDS Emscripten build options and API.');
        }
      } catch (err) {
        console.error(err);
        setStatus('Error launching emulator. See console for details.');
      }

    } else {
      setStatus('Emulator Module FS not available. Ensure melonDS is built with Emscripten and exposes FS/API.');
    }
  });

  btnPause.addEventListener('click', () => {
    // pause/resume API depends on emulator build. Try to call a common function if present.
    if (Module && Module._pause) { Module._pause(); setStatus('Pause toggled'); }
    else setStatus('Pause not available for this build');
  });

  btnReset.addEventListener('click', () => {
    if (Module && Module.callMain) { try { Module.callMain([]); setStatus('Reset called'); } catch (e) { setStatus('Reset failed'); } }
    else setStatus('Reset not available for this build');
  });

  // Simple touchscreen handling for bottom screen canvas — forwards clicks as coordinates to the Module if an API is available.
  canvasBottom.addEventListener('click', (ev) => {
    const r = canvasBottom.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) * (canvasBottom.width / r.width));
    const y = Math.floor((ev.clientY - r.top) * (canvasBottom.height / r.height));
    setStatus(`Touch at ${x},${y}`);
    if (Module && Module._onTouch) {
      try { Module._onTouch(x, y); } catch (e) { }
    }
  });

  // Keyboard mapping: map some keys to common DS buttons; actual wiring depends on the emulator build.
  const keyMap = {
    'ArrowUp': 'UP', 'ArrowDown': 'DOWN', 'ArrowLeft': 'LEFT', 'ArrowRight': 'RIGHT',
    'z': 'A', 'x': 'B', 'a': 'L', 's': 'R', 'Enter': 'START', 'Shift': 'SELECT'
  };
  window.addEventListener('keydown', (e) => {
    if (!Module) return;
    const k = keyMap[e.key];
    if (k && Module._onKeyDown) {
      try { Module._onKeyDown(k); } catch (e) { }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (!Module) return;
    const k = keyMap[e.key];
    if (k && Module._onKeyUp) {
      try { Module._onKeyUp(k); } catch (e) { }
    }
  });

  // Attempt to load the emulator glue. This is best-effort; your build process may expose a different API.
  tryLoadEmu();
})();
