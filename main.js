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
let transcribeStream = null;
let transcribeStreamReady = false;
let transcribeStreamBuffer = '';

const HOTKEY_MODES = ['ropt-double', 'rctl-double', 'rcmd-double', 'rshift-double', 'fn'];
const DEFAULT_HOTKEY = 'rshift-double';

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  const p = configPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Atomic write: write to temp, then rename. Guards against corruption
    // if the process dies mid-write.
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, p);
  } catch (err) {
    console.warn('[config] save failed:', err.message);
  }
}

function currentHotkey() {
  const cfg = loadConfig();
  return HOTKEY_MODES.includes(cfg.hotkey) ? cfg.hotkey : DEFAULT_HOTKEY;
}

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
  hudWindow.webContents.send('hud-reset');
  cancelHudSafetyHide();
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

function currentLanguage() {
  const cfg = loadConfig();
  const raw = cfg.language || 'ko-KR';
  return (raw.split('-')[0] || 'ko').toLowerCase();
}

function currentStreamingEnabled() {
  const cfg = loadConfig();
  return cfg.streaming !== false;
}

let hudSafetyTimer = null;
function scheduleHudSafetyHide(ms) {
  if (hudSafetyTimer) clearTimeout(hudSafetyTimer);
  if (ms == null) {
    // Ollama post-processing can legitimately take 30 s+; regex rules are
    // instant. Scale the safety net to the active mode so slow Ollama
    // sessions aren't force-hidden mid-flight.
    ms = postProcessingMode() === 'ollama' ? 90000 : 20000;
  }
  hudSafetyTimer = setTimeout(() => {
    if (!isRecording) {
      console.log('[hud] safety timeout — force hide');
      isProcessing = false;
      hideHud();
      updateTrayMenu();
    }
  }, ms);
}
function cancelHudSafetyHide() {
  if (hudSafetyTimer) { clearTimeout(hudSafetyTimer); hudSafetyTimer = null; }
}

async function handleFnPress() {
  if (isProcessing) return;
  if (!mainWindow) return;

  const streamingEnabled = currentStreamingEnabled();
  console.log(
    '[fn] press, recording=', isRecording,
    'streamingEnabled=', streamingEnabled,
    'streamAlive=', transcribeStream !== null,
    'streamReady=', transcribeStreamReady
  );

  // Streaming path — fully isolated from the legacy getUserMedia path so
  // audio can never be captured by both at once.
  if (streamingEnabled) {
    if (!transcribeStream) {
      mainWindow.webContents.send('toast', '전사 엔진이 비활성 상태입니다. 앱을 재시작해주세요.');
      return;
    }
    if (!transcribeStreamReady) {
      mainWindow.webContents.send('toast', '전사 엔진 초기화 중…');
      return;
    }
    if (!isRecording) {
      savedFrontmostBundleId = await getFrontmostBundleId();
      console.log('[focus] saved frontmost:', savedFrontmostBundleId);
      isRecording = true;
      showHud('recording');
      cancelHudSafetyHide();
      sendStreamCmd({ cmd: 'start', language: currentLanguage() });
      mainWindow.webContents.send('stream-started');
    } else {
      isRecording = false;
      showHud('processing');
      sendStreamCmd({ cmd: 'stop' });
      mainWindow.webContents.send('stream-stopping');
      scheduleHudSafetyHide();
    }
    updateTrayMenu();
    return;
  }

  // Legacy batch path — driven entirely by the renderer's own
  // getUserMedia pipeline (independent of the streaming helper).
  if (!isRecording) {
    savedFrontmostBundleId = await getFrontmostBundleId();
    console.log('[focus] saved frontmost:', savedFrontmostBundleId);
    isRecording = true;
    showHud('recording');
    cancelHudSafetyHide();
    mainWindow.webContents.send('toggle-record');
  } else {
    isRecording = false;
    showHud('processing');
    scheduleHudSafetyHide();
    mainWindow.webContents.send('toggle-record');
  }
  updateTrayMenu();
}

function startFnListener() {
  const helperPath = resPath('bin', 'fn-listener');
  const mode = currentHotkey();
  console.log('[fn-listener] spawn path:', helperPath, 'mode=', mode);
  if (!fs.existsSync(helperPath)) {
    console.warn('[fn-listener] 미빌드. 실행:  npm run build:helper');
    return;
  }

  fnListener = spawn(helperPath, [mode], { stdio: ['ignore', 'pipe', 'pipe'] });

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

function restartFnListener() {
  if (fnListener) {
    try { fnListener.kill('SIGTERM'); } catch {}
    fnListener = null;
  }
  fnListenerReady = false;
  startFnListener();
}

let transcribeStreamRestarts = 0;
const MAX_STREAM_RESTARTS = 3;

function startTranscribeStream() {
  const helper = findTranscribeHelper();
  const model = findWhisperKitModel();
  if (!helper || !model) {
    console.warn('[stream] helper or model missing — streaming disabled');
    return;
  }

  console.log('[stream] spawning transcribe-helper --stream', model);
  transcribeStreamBuffer = '';
  transcribeStream = spawn(helper, ['--stream', '--model-dir', model, '--language', 'auto'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  transcribeStream.stdout.on('data', (chunk) => {
    transcribeStreamBuffer += chunk.toString();
    const lines = transcribeStreamBuffer.split('\n');
    transcribeStreamBuffer = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let event;
      try { event = JSON.parse(t); } catch { continue; }
      handleStreamEvent(event);
    }
  });

  transcribeStream.stderr.on('data', (data) => {
    console.error('[stream stderr]', data.toString().trim());
  });

  transcribeStream.on('exit', (code, signal) => {
    console.error('[stream] helper exited', code, signal);
    transcribeStream = null;
    transcribeStreamReady = false;

    // Release any UI state that assumed the helper was alive, so the HUD
    // doesn't sit spinning after a crash.
    const wasActive = isRecording || isProcessing;
    if (wasActive) {
      isRecording = false;
      isProcessing = false;
      hideHud();
      updateTrayMenu();
      if (mainWindow) {
        mainWindow.webContents.send('toast', '전사 엔진이 비정상 종료됐습니다 — 재시작 중');
      }
    }

    // Clean exit (code 0 or SIGTERM from will-quit) → don't resurrect.
    if (code === 0 || signal === 'SIGTERM') return;

    if (transcribeStreamRestarts >= MAX_STREAM_RESTARTS) {
      console.error('[stream] max restarts reached, giving up');
      if (mainWindow) {
        mainWindow.webContents.send('toast', '전사 엔진이 반복 종료됐습니다. 앱을 재시작해주세요.');
      }
      return;
    }
    const backoff = 1500 * Math.pow(2, transcribeStreamRestarts);
    transcribeStreamRestarts++;
    console.log(`[stream] restarting in ${backoff}ms (attempt ${transcribeStreamRestarts}/${MAX_STREAM_RESTARTS})`);
    setTimeout(startTranscribeStream, backoff);
  });

  transcribeStream.on('spawn', () => {
    // Successful spawn → reset backoff counter after the helper reports
    // ready (done in handleStreamEvent for correctness).
  });
}

function handleStreamEvent(event) {
  console.log('[stream event]', event.type, event.text ? `text(${event.text.length})` : '');
  switch (event.type) {
    case 'ready':
      transcribeStreamReady = true;
      transcribeStreamRestarts = 0;
      if (mainWindow) mainWindow.webContents.send('toast', '전사 엔진 준비됨');
      break;
    case 'partial':
      if (mainWindow) mainWindow.webContents.send('stream-partial', event.text || '');
      if (hudWindow && hudWindow.isVisible()) hudWindow.webContents.send('hud-partial', event.text || '');
      break;
    case 'final':
      cancelHudSafetyHide();
      if (mainWindow) mainWindow.webContents.send('stream-final', event.text || '');
      // Belt-and-suspenders: if the renderer's post-process + paste pipeline
      // never reports back within 15 s, force the HUD away.
      scheduleHudSafetyHide(15000);
      break;
    case 'stopped':
      break;
    case 'error':
      console.error('[stream] error:', event.message);
      if (mainWindow) mainWindow.webContents.send('stream-error', event.message || '');
      if (!isRecording) {
        isProcessing = false;
        hideHud();
        updateTrayMenu();
      }
      break;
    default:
      break;
  }
}

function sendStreamCmd(cmd) {
  if (!transcribeStream || !transcribeStreamReady) return false;
  try {
    transcribeStream.stdin.write(JSON.stringify(cmd) + '\n');
    return true;
  } catch (err) {
    console.error('[stream] write failed', err);
    return false;
  }
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
  const hasEngine = (s.transcribeHelper && s.whisperKitModel) || (s.whisperBin && s.whisperModel);
  return (
    s.mic === 'granted' &&
    s.inputMonitoring &&
    s.accessibility &&
    hasEngine
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

  const wkHelper = findTranscribeHelper();
  const wkModel = findWhisperKitModel();
  const engine = wkHelper && wkModel ? 'whisperkit' : 'none';

  return {
    mic,
    inputMonitoring,
    accessibility,
    whisperBin: whisperBin ? { path: whisperBin } : null,
    whisperModel: whisperModel ? { path: whisperModel } : null,
    transcribeHelper: wkHelper ? { path: wkHelper } : null,
    whisperKitModel: wkModel ? { path: wkModel } : null,
    engine,
    streamReady: transcribeStreamReady,
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

  // Spawn the long-lived streaming transcriber eagerly — model load takes
  // several seconds, first fn press should already be warm.
  startTranscribeStream();
  log('transcribe-stream spawned');

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
  if (transcribeStream) {
    try {
      transcribeStream.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
      transcribeStream.kill('SIGTERM');
    } catch {}
  }
});

function findTranscribeHelper() {
  const p = resPath('bin', 'transcribe-helper');
  return fs.existsSync(p) ? p : null;
}

function postProcessingMode() {
  const cfg = loadConfig();
  return cfg.mode || 'rules';
}

function findWhisperKitModel() {
  const root = resPath('models', 'whisperkit');
  // Prefer the highest-quality variant that's actually on disk. Turbo /
  // large-v3 variants give markedly better Korean accuracy than small.
  const preferred = [
    'openai_whisper-large-v3-v20240930_turbo_632MB',
    'openai_whisper-large-v3-v20240930_turbo',
    'openai_whisper-large-v3_turbo_954MB',
    'openai_whisper-large-v3_turbo',
    'openai_whisper-large-v3-v20240930_626MB',
    'openai_whisper-large-v3-v20240930',
    'openai_whisper-large-v3_947MB',
    'openai_whisper-large-v3',
    'openai_whisper-large-v2_turbo_955MB',
    'openai_whisper-large-v2_turbo',
    'openai_whisper-medium',
    'openai_whisper-small',
    'openai_whisper-base',
    'openai_whisper-tiny',
  ];
  for (const name of preferred) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  // Fallback: take whatever is there.
  try {
    const entries = fs.readdirSync(root).map((n) => path.join(root, n)).filter((p) => fs.statSync(p).isDirectory());
    if (entries.length) return entries[0];
  } catch {}
  return null;
}

// Combined finder used by status dashboard
function findModel() {
  return findWhisperKitModel();
}

ipcMain.handle('transcribe', async (_e, { wavBuffer, language }) => {
  const buf = Buffer.from(wavBuffer);
  // Reject absurdly tiny takes outright — WAV header alone is 44 bytes, and
  // <200ms of audio almost certainly means the user fumbled the hotkey.
  if (buf.length < 44 + 16000 * 0.2 * 2) {
    throw new Error('녹음이 너무 짧습니다.');
  }

  const wkHelper = findTranscribeHelper();
  const wkModel = findWhisperKitModel();
  if (!wkHelper || !wkModel) {
    throw new Error('전사 엔진 또는 모델 누락. npm run build:transcribe && npm run model:whisperkit');
  }

  const tmpFile = path.join(os.tmpdir(), `listenk_${Date.now()}.wav`);
  await fs.promises.writeFile(tmpFile, buf);
  const lang = (language || '').split('-')[0] || 'auto';

  return new Promise((resolve, reject) => {
    execFile(
      wkHelper,
      ['--audio', tmpFile, '--model-dir', wkModel, '--language', lang],
      { maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        fs.unlink(tmpFile, () => {});
        if (err) reject(new Error(`WhisperKit 실패: ${stderr || err.message}`));
        else resolve(stdout.trim());
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
  console.log('[state] recording=', isRecording, 'processing=', isProcessing);
  if (!isRecording && !isProcessing) hideHud();
  updateTrayMenu();
});

ipcMain.handle('hud-cancel', () => {
  if (!isRecording && !isProcessing) return;
  isRecording = false;
  isProcessing = false;
  // If the streaming helper is active, tell it to stop so it doesn't keep
  // holding the microphone. We discard whatever final it emits because the
  // user asked to cancel.
  if (transcribeStream && transcribeStreamReady) {
    try {
      transcribeStream.stdin.write(JSON.stringify({ cmd: 'stop' }) + '\n');
    } catch {}
  }
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
  const shouldActivate =
    savedFrontmostBundleId &&
    savedFrontmostBundleId !== OWN_BUNDLE_ID &&
    !/electron|com\.github\.electron/i.test(savedFrontmostBundleId);

  if (shouldActivate) {
    console.log('[focus] activating target:', savedFrontmostBundleId);
    await activateApp(savedFrontmostBundleId);
    // Poll frontmost until activation actually lands (up to ~600 ms)
    // instead of guessing with a fixed sleep — critical for slow apps
    // that don't come forward within 180 ms.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const current = await getFrontmostBundleId();
      if (current === savedFrontmostBundleId) break;
    }
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

ipcMain.handle('get-hotkey', () => currentHotkey());

ipcMain.handle('set-language', (_e, lang) => {
  const cfg = loadConfig();
  cfg.language = lang || 'ko-KR';
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('set-streaming', (_e, enabled) => {
  const cfg = loadConfig();
  cfg.streaming = !!enabled;
  saveConfig(cfg);
  return { ok: true, streaming: cfg.streaming };
});

ipcMain.handle('get-streaming', () => currentStreamingEnabled());

ipcMain.handle('set-hotkey', (_e, mode) => {
  if (!HOTKEY_MODES.includes(mode)) return { ok: false, error: 'invalid mode' };
  const cfg = loadConfig();
  cfg.hotkey = mode;
  saveConfig(cfg);
  restartFnListener();
  return { ok: true, mode };
});
