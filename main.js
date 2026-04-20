const {
  app,
  BrowserWindow,
  globalShortcut,
  session,
  systemPreferences,
  ipcMain,
  clipboard,
  Tray,
  nativeImage,
  Menu,
} = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mainWindow;
let hudWindow;
let tray;
let fnListener = null;
let isRecording = false;
let isProcessing = false;
let savedFrontmostBundleId = null;
let fnListenerReady = false;

function resPath(...parts) {
  const base = app.isPackaged ? process.resourcesPath : __dirname;
  return path.join(base, ...parts);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 640,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', async () => {
    const firstRunFlag = path.join(app.getPath('userData'), '.first-run-done');
    const isFirstRun = !fs.existsSync(firstRunFlag);

    const status = await collectStatus();
    if (isFirstRun || !isSetupComplete(status)) {
      mainWindow.show();
      mainWindow.focus();
    }

    if (isFirstRun) {
      try {
        fs.mkdirSync(path.dirname(firstRunFlag), { recursive: true });
        fs.writeFileSync(firstRunFlag, new Date().toISOString());
      } catch (err) {
        console.warn('[first-run] failed to write marker:', err.message);
      }
    }
  });

  if (process.env.LISTENK_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createHudWindow() {
  const { screen } = require('electron');
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;

  const HUD_WIDTH = 260;
  const HUD_HEIGHT = 64;

  hudWindow = new BrowserWindow({
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    x: Math.round((width - HUD_WIDTH) / 2),
    y: height - HUD_HEIGHT - 48,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-hud.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hudWindow.loadFile('hud.html');
}

function showHud(state) {
  if (!hudWindow) return;
  hudWindow.webContents.send('hud-state', state || 'recording');
  if (!hudWindow.isVisible()) hudWindow.showInactive();
}

function hideHud() {
  if (!hudWindow) return;
  if (hudWindow.isVisible()) hudWindow.hide();
}

function createTray() {
  const icon = nativeImage
    .createFromNamedImage('NSStatusAvailable', [-1, 0, 1])
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  updateTrayMenu();
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide();
    else showWindowNonIntrusive();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const stateLabel = isRecording
    ? '🔴 녹음 중'
    : isProcessing
    ? '⏳ 변환/정제 중'
    : '⚪ 대기';
  tray.setToolTip(`Listen K · ${stateLabel}`);
  const menu = Menu.buildFromTemplate([
    { label: `Listen K · ${stateLabel}`, enabled: false },
    { type: 'separator' },
    { label: '창 열기', click: () => showWindowNonIntrusive() },
    {
      label: '녹음 토글 (fn)',
      click: () => handleFnPress(),
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function showWindowNonIntrusive() {
  if (!mainWindow) return;
  mainWindow.showInactive();
}

function showWindowActive() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function getFrontmostBundleId() {
  const helper = resPath('bin', 'focus-helper');
  if (!fs.existsSync(helper)) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(helper, ['get-frontmost'], (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.trim() || null);
    });
  });
}

function activateApp(bundleId) {
  const helper = resPath('bin', 'focus-helper');
  if (!fs.existsSync(helper) || !bundleId) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(helper, ['activate', bundleId], (err) => resolve(!err));
  });
}

async function handleFnPress() {
  if (isProcessing) return;
  if (!mainWindow) return;

  if (!isRecording) {
    savedFrontmostBundleId = await getFrontmostBundleId();
    console.log('[focus] saved frontmost:', savedFrontmostBundleId);
    isRecording = true;
    showHud('recording');
  } else {
    isRecording = false;
    showHud('processing');
  }

  updateTrayMenu();
  mainWindow.webContents.send('toggle-record');
}

function startFnListener() {
  const helperPath = resPath('bin', 'fn-listener');
  console.log('[fn-listener] spawn path:', helperPath);
  if (!fs.existsSync(helperPath)) {
    console.warn('[fn-listener] 미빌드. 실행:  npm run build:helper');
    return;
  }

  fnListener = spawn(helperPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });

  fnListener.on('spawn', () => console.log('[fn-listener] spawned, pid=', fnListener.pid));
  fnListener.on('error', (err) => console.error('[fn-listener] spawn error:', err));

  let buf = '';
  fnListener.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (t === 'FN_DOWN') {
        console.log('[fn-listener] FN_DOWN received → toggle');
        handleFnPress();
      } else if (t === 'READY') {
        fnListenerReady = true;
        console.log('[fn-listener] READY');
      } else if (t) {
        console.log('[fn-listener] stdout:', t);
      }
    }
  });

  fnListener.stderr.on('data', (data) => {
    console.error('[fn-listener] stderr:', data.toString().trim());
  });

  fnListener.on('exit', (code, signal) => {
    console.error('[fn-listener] exited code=', code, 'signal=', signal);
    fnListener = null;
    fnListenerReady = false;
  });
}

function checkAccessibility() {
  const helper = resPath('bin', 'paste-helper');
  if (!fs.existsSync(helper)) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(helper, ['--check'], (err) => resolve(!err));
  });
}

function checkInputMonitoring() {
  const helper = resPath('bin', 'fn-listener');
  if (!fs.existsSync(helper)) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(helper, ['--check'], (err) => resolve(!err));
  });
}

function checkOllama() {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300);
    fetch('http://localhost:11434/api/tags', { signal: controller.signal })
      .then((r) => {
        clearTimeout(timer);
        if (!r.ok) return resolve({ running: false });
        return r.json().then((json) => {
          const models = (json.models || []).map((m) => m.name);
          resolve({ running: true, models });
        });
      })
      .catch(() => {
        clearTimeout(timer);
        resolve({ running: false });
      });
  });
}

function isSetupComplete(s) {
  return (
    s.mic === 'granted' &&
    s.inputMonitoring &&
    s.accessibility &&
    s.whisperBin &&
    s.whisperModel
  );
}

function getAppBundlePath() {
  if (!app.isPackaged) return null;
  const exe = app.getPath('exe');
  return exe.replace(/\/Contents\/MacOS\/.*$/, '');
}

async function collectStatus() {
  const mic = systemPreferences.getMediaAccessStatus('microphone');
  const [accessibility, inputMonitoring] = await Promise.all([
    checkAccessibility(),
    checkInputMonitoring(),
  ]);
  const whisperBin = findWhisperBin();
  const whisperModel = findModel();
  const ollama = await checkOllama();

  return {
    mic,
    inputMonitoring,
    accessibility,
    whisperBin: whisperBin ? { path: whisperBin } : null,
    whisperModel: whisperModel ? { path: whisperModel } : null,
    ollama,
    packaged: app.isPackaged,
    appBundlePath: getAppBundlePath(),
    fnListenerPath: resPath('bin', 'fn-listener'),
    pasteHelperPath: resPath('bin', 'paste-helper'),
  };
}

const SETTINGS_URLS = {
  mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  'input-monitoring': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  keyboard: 'x-apple.systempreferences:com.apple.preference.keyboard',
};

app.whenReady().then(async () => {
  const t0 = Date.now();
  const log = (msg) => console.log(`[startup +${Date.now() - t0}ms] ${msg}`);

  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  // Non-blocking mic permission: only prompt if status is not-determined.
  // askForMediaAccess blocks until the user interacts, so we never await it here.
  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (micStatus === 'not-determined') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
  log(`mic status=${micStatus}`);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'microphone') return callback(true);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'microphone';
  });

  // Spawn fn-listener first so READY can arrive before the window is shown.
  startFnListener();
  log('fn-listener spawned');

  createWindow();
  log('main window created');
  createHudWindow();
  log('hud window created');
  createTray();
  log('tray created');

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    handleFnPress();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindowActive();
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault?.();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (fnListener) {
    try { fnListener.kill('SIGTERM'); } catch {}
  }
});

function findWhisperBin() {
  const bundled = resPath('bin', 'whisper-cli');
  if (fs.existsSync(bundled)) return bundled;

  const candidates = ['whisper-cli', 'whisper-cpp', 'whisper'];
  const pathDirs = (process.env.PATH || '').split(':').concat([
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ]);
  for (const name of candidates) {
    for (const dir of pathDirs) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function findModel() {
  if (process.env.WHISPER_MODEL && fs.existsSync(process.env.WHISPER_MODEL)) {
    return process.env.WHISPER_MODEL;
  }
  const candidates = [
    resPath('models', 'ggml-base.bin'),
    resPath('models', 'ggml-small.bin'),
    path.join(os.homedir(), 'models', 'ggml-base.bin'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

ipcMain.handle('transcribe', async (_e, { wavBuffer, language }) => {
  const whisperBin = findWhisperBin();
  if (!whisperBin) {
    throw new Error('whisper-cli 설치 필요:\n  brew install whisper-cpp');
  }

  const modelPath = findModel();
  if (!modelPath) {
    throw new Error(
      'Whisper 모델 없음. 다운로드:\n' +
        '  npm run model:base'
    );
  }

  const tmpFile = path.join(os.tmpdir(), `listenk_${Date.now()}.wav`);
  await fs.promises.writeFile(tmpFile, Buffer.from(wavBuffer));

  const lang = (language || '').split('-')[0] || 'auto';

  return new Promise((resolve, reject) => {
    execFile(
      whisperBin,
      ['-m', modelPath, '-f', tmpFile, '-l', lang, '-nt', '-np'],
      { maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        fs.unlink(tmpFile, () => {});
        if (err) {
          reject(new Error(`whisper 실패: ${stderr || err.message}`));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
});

ipcMain.handle('set-state', (_e, { recording, processing }) => {
  if (typeof recording === 'boolean') isRecording = recording;
  if (typeof processing === 'boolean') {
    isProcessing = processing;
    if (processing) showHud('processing');
  }
  if (!recording && !processing) hideHud();
  updateTrayMenu();
});

ipcMain.handle('hud-cancel', () => {
  if (!isRecording && !isProcessing) return;
  isRecording = false;
  isProcessing = false;
  hideHud();
  updateTrayMenu();
  if (mainWindow) mainWindow.webContents.send('cancel-record');
});

ipcMain.handle('hud-confirm', () => {
  if (!isRecording) return;
  isRecording = false;
  showHud('processing');
  updateTrayMenu();
  if (mainWindow) mainWindow.webContents.send('toggle-record');
});

ipcMain.handle('paste-text', async (_e, text) => {
  if (!text) return;
  const trimmed = text.trim();
  clipboard.writeText(trimmed);

  const OWN_BUNDLE_ID = 'com.ibank.listenk';
  if (
    savedFrontmostBundleId &&
    savedFrontmostBundleId !== OWN_BUNDLE_ID &&
    !/electron|com\.github\.electron/i.test(savedFrontmostBundleId)
  ) {
    console.log('[focus] activating target:', savedFrontmostBundleId);
    await activateApp(savedFrontmostBundleId);
    await new Promise((r) => setTimeout(r, 180));
  } else {
    await new Promise((r) => setTimeout(r, 80));
  }

  const pasteHelper = resPath('bin', 'paste-helper');
  const useHelper = fs.existsSync(pasteHelper);

  return new Promise((resolve, reject) => {
    if (useHelper) {
      console.log('[paste] invoking', pasteHelper);
      execFile(pasteHelper, [], (err, stdout, stderr) => {
        console.log('[paste] stdout:', stdout.trim(), '| stderr:', stderr.trim());
        if (err) {
          reject(
            new Error(
              `paste-helper 실패 (손쉬운 사용 권한 필요 — bin/paste-helper 허용): ${
                stderr || err.message
              }`
            )
          );
        } else {
          resolve();
        }
      });
    } else {
      execFile(
        'osascript',
        [
          '-e',
          'tell application "System Events" to keystroke "v" using command down',
        ],
        (err, _stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `paste 실패 (손쉬운 사용 권한 필요): ${stderr || err.message}`
              )
            );
          } else {
            resolve();
          }
        }
      );
    }
  });
});

ipcMain.handle('show-window', () => showWindowActive());

ipcMain.handle('get-status', () => collectStatus());

ipcMain.handle('open-settings-pane', (_e, pane) => {
  const url = SETTINGS_URLS[pane];
  if (!url) return false;
  require('electron').shell.openExternal(url);
  return true;
});

ipcMain.handle('request-mic', async () => {
  try {
    const ok = await systemPreferences.askForMediaAccess('microphone');
    return ok;
  } catch {
    return false;
  }
});

ipcMain.handle('open-url', (_e, url) => {
  require('electron').shell.openExternal(url);
});

ipcMain.handle('show-in-finder', (_e, p) => {
  require('electron').shell.showItemInFolder(p);
});

ipcMain.handle('clipboard-write', (_e, text) => {
  clipboard.writeText(text == null ? '' : String(text));
  return true;
});
