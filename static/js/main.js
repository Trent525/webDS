// main.js — improved frontend loader and ROM loader for melonDS WebAssembly build
// This version more robustly loads the Emscripten glue, waits for runtime initialization,
// writes ROM/BIOS into the Emscripten FS, and calls the emulator entrypoint.

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

  let Module = null; // the initialized Emscripten module instance
  let romBuffer = null;
  let bios7 = null;
  let bios9 = null;

  function setStatus(s) { statusEl.textContent = s; }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Don't load the same script twice
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  async function findAndInstantiateModule(jsPath = 'static/emu/melonDS.js') {
    // Try to load glue script (if present) then instantiate the Module in multiple ways
    try {
      await loadScript(jsPath);
    } catch (e) {
      // If the script doesn't exist, keep going; maybe the user already added it or uses a different name.
      console.warn('Could not load glue script at', jsPath, e);
    }

    // Factory names commonly used by Emscripten builds
    const factoryNames = [
      'createMelonDSModule',
      'createModule',
      'ModuleFactory'
    ];

    // If a factory function exists, call it and await the instance
    for (const name of factoryNames) {
      const factory = window[name];
      if (typeof factory === 'function') {
        setStatus(`Found factory ${name}(); instantiating...`);
        const inst = factory();
        // factory might return a Promise or a Module object
        const moduleObj = await Promise.resolve(inst);
        // Wait for runtime init if needed
        if (moduleObj.calledRun) return moduleObj;
        await new Promise((resolve) => {
          moduleObj.onRuntimeInitialized = resolve;
        });
        return moduleObj;
      }
    }

    // If a global Module object already exists
    if (window.Module && typeof window.Module === 'object') {
      const mod = window.Module;
      // Let the caller attach canvas before runtime init if desired
      if (mod.calledRun) return mod;
      return await new Promise((resolve) => {
        // Respect any existing onRuntimeInitialized
        const prev = mod.onRuntimeInitialized;
        mod.onRuntimeInitialized = function () {
          if (typeof prev === 'function') try { prev(); } catch (e) { console.warn(e); }
          resolve(mod);
        };
      });
    }

    throw new Error('No Emscripten Module or factory found. Build melonDS with Emscripten and place the JS/WASM in static/emu/');
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
    setStatus(romBuffer ? 'ROM loaded into memory' : 'ROM cleared');
  });
  fileBios7.addEventListener('change', async () => {
    bios7 = await readFileInput(fileBios7);
    setStatus(bios7 ? 'BIOS ARM7 loaded' : '');
  });
  fileBios9.addEventListener('change', async () => {
    bios9 = await readFileInput(fileBios9);
    setStatus(bios9 ? 'BIOS ARM9 loaded' : '');
  });

  async function ensureModuleReady() {
    if (Module) return Module;
    setStatus('Initializing emulator module...');

    try {
      Module = await findAndInstantiateModule();
    } catch (err) {
      console.error(err);
      setStatus('Emulator build not found or failed to instantiate. See console.');
      throw err;
    }

    // If the build uses SDL2 and expects a canvas, tell it which canvas to use.
    // Some builds create their own canvas; setting Module['canvas'] helps Emscripten/SDL pick it up.
    try {
      if (!Module['canvas']) Module['canvas'] = canvasTop;
    } catch (e) { console.warn(e); }

    setStatus('Emulator runtime initialized.');
    return Module;
  }

  btnStart.addEventListener('click', async () => {
    setStatus('Starting...');
    try {
      await ensureModuleReady();
    } catch (e) { return; }

    if (!romBuffer) { setStatus('Please choose a .nds ROM first'); return; }

    // Ensure FS exists and write files
    if (!Module.FS) {
      setStatus('Emulator FS not available on Module. Build with Emscripten FS enabled.');
      return;
    }

    try {
      // Create a roms directory
      try { Module.FS.mkdir('/roms'); } catch (e) { /* ignore if exists */ }

      // Convert ArrayBuffer to Uint8Array
      const romU8 = romBuffer instanceof Uint8Array ? romBuffer : new Uint8Array(romBuffer);
      Module.FS.writeFile('/roms/game.nds', romU8, { canRead: true, canWrite: true });
      setStatus('ROM written to /roms/game.nds');

      if (bios7) {
        const b7 = bios7 instanceof Uint8Array ? bios7 : new Uint8Array(bios7);
        Module.FS.writeFile('/roms/bios7.bin', b7, { canRead: true, canWrite: true });
        setStatus('ARM7 BIOS written to /roms/bios7.bin');
      }
      if (bios9) {
        const b9 = bios9 instanceof Uint8Array ? bios9 : new Uint8Array(bios9);
        Module.FS.writeFile('/roms/bios9.bin', b9, { canRead: true, canWrite: true });
        setStatus('ARM9 BIOS written to /roms/bios9.bin');
      }

      // Attempt to launch. Different melonDS builds might expect different args or a different entrypoint.
      // callMain is the generic entrypoint. If melonDS compiled as a standalone binary, callMain(['/roms/game.nds']) should work.
      if (typeof Module.callMain === 'function') {
        setStatus('Calling Module.callMain with /roms/game.nds. Emulator will take over the page.');
        try {
          Module.callMain(['/roms/game.nds']);
          // callMain may not return if it enters the main loop; we can't update status after that in many builds.
        } catch (e) {
          console.error('callMain failed', e);
          setStatus('Module.callMain threw an error. See console.');
        }
      } else if (typeof Module._main === 'function') {
        // attempt to call C main via pointer
        try {
          // Simple approach: Module._main expects argc/argv; building proper argv in the heap is complex.
          // If you need this path, it's better to compile melonDS so Module.callMain is available.
          Module._main(1, 0);
        } catch (e) {
          console.error('Module._main failed', e);
          setStatus('Module._main threw an error. See console.');
        }
      } else {
        setStatus('No entrypoint (callMain/_main) found on Module. Check melonDS build options.');
      }

    } catch (err) {
      console.error('Failed to write files or start emulator', err);
      setStatus('Failed to start emulator. See console.');
    }
  });

  btnPause.addEventListener('click', () => {
    if (!Module) { setStatus('Module not running'); return; }
    // Pause API varies by build. Try common functions if present.
    if (Module._emu_pause) {
      try { Module._emu_pause(); setStatus('Toggled pause via _emu_pause()'); } catch (e) { setStatus('Pause failed'); }
    } else {
      setStatus('Pause API not available for this build');
    }
  });

  btnReset.addEventListener('click', () => {
    if (!Module) { setStatus('Module not running'); return; }
    if (typeof Module.callMain === 'function') {
      try { Module.callMain([]); setStatus('callMain([]) invoked (may reset emulator)'); } catch (e) { setStatus('Reset failed'); }
    } else {
      setStatus('Reset not available for this build');
    }
  });

  // Bottom-screen click -> forward as a simple touch event if API available
  canvasBottom.addEventListener('click', (ev) => {
    if (!Module) return;
    const r = canvasBottom.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) * (canvasBottom.width / r.width));
    const y = Math.floor((ev.clientY - r.top) * (canvasBottom.height / r.height));
    setStatus(`Touch at ${x},${y}`);
    // If the module exposes a touch function, try to call it. Common names vary.
    if (typeof Module._onTouch === 'function') {
      try { Module._onTouch(x, y); } catch (e) { console.warn(e); }
    }
  });

  // Basic keyboard mapping — forward to C functions if exposed
  const keyMap = {
    'ArrowUp': 'UP', 'ArrowDown': 'DOWN', 'ArrowLeft': 'LEFT', 'ArrowRight': 'RIGHT',
    'z': 'A', 'x': 'B', 'a': 'L', 's': 'R', 'Enter': 'START', 'Shift': 'SELECT'
  };
  window.addEventListener('keydown', (e) => {
    if (!Module) return;
    const k = keyMap[e.key];
    if (!k) return;
    if (typeof Module._onKeyDown === 'function') {
      try { Module._onKeyDown(k); } catch (e) { console.warn(e); }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (!Module) return;
    const k = keyMap[e.key];
    if (!k) return;
    if (typeof Module._onKeyUp === 'function') {
      try { Module._onKeyUp(k); } catch (e) { console.warn(e); }
    }
  });

  // Kick off a best-effort attempt to preload the emulator glue so the page shows better status early.
  (async function preflight() {
    try {
      await findAndInstantiateModule();
      setStatus('Emulator glue detected and initialized (preflight).');
    } catch (e) {
      // It's fine if this fails; user can still build and then click Start which will attempt again.
      setStatus('Emulator glue not present. Build melonDS to WASM and place melonDS.js/.wasm into static/emu/.');
    }
  })();
})();
