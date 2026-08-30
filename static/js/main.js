// main.js — improved loader supporting both modularized (factory) and global Module melonDS builds
// Works with melonDS.js + melonDS.wasm placed in static/emu/

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

  let romBuffer = null;
  let bios7 = null;
  let bios9 = null;
  let runningModule = null;

  function setStatus(s) { statusEl.textContent = s; }

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

  // Try HEAD first to avoid adding script tags that 404
  async function exists(path) {
    try {
      const r = await fetch(path, { method: 'HEAD' });
      return r.ok;
    } catch (e) { return false; }
  }

  function addScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  // Create a preRun function that writes the ROM/BIOS into Module.FS when runtime initializes
  function makePreRun(romBuf, b7, b9) {
    return function () {
      try { if (!Module.FS.analyzePath('/roms').exists) Module.FS.mkdir('/roms'); } catch (e) { }
      try {
        if (romBuf) Module.FS.writeFile('/roms/game.nds', new Uint8Array(romBuf), { canRead: true, canWrite: true });
        if (b7) Module.FS.writeFile('/roms/bios7.bin', new Uint8Array(b7), { canRead: true, canWrite: true });
        if (b9) Module.FS.writeFile('/roms/bios9.bin', new Uint8Array(b9), { canRead: true, canWrite: true });
      } catch (e) { console.error('preRun writeFile error', e); }
    };
  }

  async function launchWithFactory(factory, romBuf, b7, b9) {
    setStatus('Instantiating melonDS (factory) and launching...');
    const preRun = makePreRun(romBuf, b7, b9);
    const Module = await factory({
      locateFile: (path) => `static/emu/${path}`,
      preRun: [preRun],
      canvas: canvasTop,
      arguments: ['/roms/game.nds']
    });

    try {
      if (typeof Module.callMain === 'function') {
        Module.callMain(['/roms/game.nds']);
      } else {
        setStatus('Module instantiated (factory) — callMain not found; emulator may have started automatically. Check console.');
      }
    } catch (e) {
      console.error('Error calling callMain', e);
      setStatus('Error launching emulator (see console)');
    }
    return Module;
  }

  function setGlobalModuleAndLoad(jsPath, romBuf, b7, b9) {
    return new Promise(async (resolve, reject) => {
      setStatus('Preparing global Module config and loading melonDS.js...');

      // Create Module config expected by non-modularized builds
      const preRun = function () {
        try { if (!Module.FS.analyzePath('/roms').exists) Module.FS.mkdir('/roms'); } catch (e) { }
        try {
          if (romBuf) Module.FS.writeFile('/roms/game.nds', new Uint8Array(romBuf), { canRead: true, canWrite: true });
          if (b7) Module.FS.writeFile('/roms/bios7.bin', new Uint8Array(b7), { canRead: true, canWrite: true });
          if (b9) Module.FS.writeFile('/roms/bios9.bin', new Uint8Array(b9), { canRead: true, canWrite: true });
        } catch (e) { console.error('preRun writeFile error (global)', e); }
      };

      // If a Module already exists on window, we will try to reuse it by appending preRun
      if (window.Module && typeof window.Module === 'object') {
        try {
          window.Module.preRun = window.Module.preRun || [];
          window.Module.preRun.push(preRun);
          window.Module.locateFile = window.Module.locateFile || ((p) => `static/emu/${p}`);
          window.Module.canvas = window.Module.canvas || canvasTop;
        } catch (e) { console.warn('Failed to attach to existing global Module config', e); }
      } else {
        window.Module = {
          preRun: [preRun],
          locateFile: (p) => `static/emu/${p}`,
          canvas: canvasTop,
          arguments: ['/roms/game.nds']
        };
      }

      try {
        await addScript(jsPath);
      } catch (e) {
        console.error('Loading melonDS.js failed', e);
        return reject(e);
      }

      // Wait for runtime init if Module.onRuntimeInitialized is used
      // If script created a factory instead, we'll detect that outside
      const checkInterval = setInterval(() => {
        // If modularized factory appeared, bail out (factory path will handle launching)
        const factory = window.createMelonDSModule || window.createModule || window.createMelonDS || window.ModuleFactory;
        if (factory && typeof factory === 'function') {
          clearInterval(checkInterval);
          return resolve({ type: 'factoryAppeared' });
        }
        if (window.Module && window.Module.calledRun) {
          clearInterval(checkInterval);
          return resolve({ type: 'globalModuleReady', module: window.Module });
        }
      }, 200);

      // Timeout after 10s
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve({ type: 'unknown' });
      }, 10000);
    });
  }

  async function startEmulator(romBuf, b7, b9) {
    const jsPath = 'static/emu/melonDS.js';
    const jsExists = await exists(jsPath);
    if (!jsExists) { setStatus('melonDS.js not found in static/emu/. Place melonDS.js/.wasm there and retry.'); return; }

    // Heuristic: if factory already exists on window, use it
    const factory = window.createMelonDSModule || window.createModule || window.createMelonDS || window.ModuleFactory || null;
    if (factory && typeof factory === 'function') {
      runningModule = await launchWithFactory(factory, romBuf, b7, b9);
      setStatus('Emulator launched via factory.');
      return;
    }

    // Otherwise set up global Module and load the script
    try {
      const res = await setGlobalModuleAndLoad(jsPath, romBuf, b7, b9);
      if (res && res.type === 'factoryAppeared') {
        // A factory appeared after loading the script (modularized build) — use it
        const factory2 = window.createMelonDSModule || window.createModule || window.createMelonDS || window.ModuleFactory;
        if (factory2 && typeof factory2 === 'function') {
          runningModule = await launchWithFactory(factory2, romBuf, b7, b9);
          setStatus('Emulator launched via factory (post-load).');
          return;
        }
      }
      if (res && res.type === 'globalModuleReady') {
        runningModule = res.module;
        setStatus('Emulator started (global Module).');
        return;
      }
      setStatus('Loaded melonDS.js but could not detect runtime start. Check console.');
    } catch (e) {
      console.error(e);
      setStatus('Failed to load or start melonDS.js (see console)');
    }
  }

  btnStart.addEventListener('click', async () => {
    if (!romBuffer) { setStatus('Please select a .nds ROM first'); return; }
    if (runningModule) { setStatus('Emulator already running'); return; }
    await startEmulator(romBuffer, bios7, bios9);
  });

  btnPause.addEventListener('click', () => {
    if (!runningModule) { setStatus('Module not running'); return; }
    if (runningModule.ccall) {
      try { runningModule.ccall('emu_pause', 'void', [], []); setStatus('Pause attempted'); } catch (e) { setStatus('Pause not available'); }
    } else setStatus('Pause API not available');
  });

  btnReset.addEventListener('click', () => {
    if (!runningModule) { setStatus('Module not running'); return; }
    if (runningModule.callMain) { try { runningModule.callMain([]); setStatus('Reset attempted'); } catch (e) { setStatus('Reset failed'); } }
    else setStatus('Reset API not available');
  });

  // Basic touch logging
  canvasBottom.addEventListener('click', (ev) => {
    const r = canvasBottom.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) * (canvasBottom.width / r.width));
    const y = Math.floor((ev.clientY - r.top) * (canvasBottom.height / r.height));
    setStatus(`Touch at ${x},${y}`);
  });

  // Preflight: hint
  (async function preflight() {
    const ok = await exists('static/emu/melonDS.js');
    if (ok) setStatus('melonDS.js found in static/emu/ — click Start to launch a ROM.');
    else setStatus('Place melonDS.js and melonDS.wasm in static/emu/ and click Start.');
  })();
})();
