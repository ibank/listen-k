const {
  app,
  BrowserWindow,
  globalShortcut,
  session,
  systemPreferences,
  ipcMain,
  clipboard,
  safeStorage,
  Tray,
  nativeImage,
  Menu,
} = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require('./i18n');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let hudWindow;
let tray;
let fnListener = null;
let isRecording = false;
let isProcessing = false;
let savedFrontmostBundleId = null;
// fnListenerReady was tracked here previously but never read downstream;
// removed in v0.5.6.
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
    width: 960,
    height: 720,
    minWidth: 780,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile('index.html');

  // Hardening: the renderer has no business opening new windows or
  // navigating away from the bundled file://. Deny both — if some future
  // feature really needs an external link, it should go through the
  // (protocol-gated) open-url IPC path, not an uncontrolled navigation.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.once('ready-to-show', async () => {
    const firstRunFlag = path.join(app.getPath('userData'), '.first-run-done');
    const isFirstRun = !fs.existsSync(firstRunFlag);
    // Accessibility / Input Monitoring grants relaunch the app mid-flow.
    // After the relaunch isFirstRun is false and isSetupComplete() is true,
    // which previously suppressed the window before the user had reached
    // the finish button. Fall back to the renderer-owned onboardingDone flag
    // so the window stays visible until onboarding is explicitly completed.
    const onboardingDone = Boolean(loadConfig().onboardingDone);

    const status = await collectStatus();
    if (isFirstRun || !onboardingDone || !isSetupComplete(status)) {
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

  if (process.env.LISTENK_DEBUG === '1' || process.env.TYPELESS_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Mirror renderer console to the terminal so a plain `npm start` surfaces
  // client-side logs without opening DevTools. Helpful for chasing down
  // renderer-only issues like the first-run banner state.
  // Electron 36+ switched this event to a single WebContentsConsoleMessageEventParams
  // argument (the old positional (e, level, message) form logs a deprecation
  // warning on every boot under Electron 41).
  mainWindow.webContents.on('console-message', (event) => {
    const level = event.level; // 'verbose' | 'info' | 'warning' | 'error'
    const message = event.message;
    const tag = level === 'warning' ? 'warn' : level === 'error' ? 'error' : 'log';
    if (message && !message.startsWith('Electron Security Warning')) {
      console.log(`[renderer.${tag}] ${message}`);
    }
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Send an IPC message to a renderer without crashing the main process if the
// window has been destroyed (e.g. during shutdown, or after a force-quit but
// before async subprocess events finish draining). Also swallows the race
// where webContents is being torn down mid-send.
function safeSend(win, channel, ...args) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, ...args);
  } catch (err) {
    console.warn(`[ipc] send ${channel} failed:`, err.message);
  }
}

// The pill itself is constrained by CSS (min 240 px / max 680 px with
// live text). The window is transparent, so extra width is invisible —
// the pill self-centres within via `justify-content: space-between` +
// `margin: auto`. Sizing the window to 720 px gives the pill room to
// grow to its full 680 px max-width plus a little glow-shadow padding;
// the previous 260 px cap clipped long partial transcripts.
const HUD_WIDTH = 720;
// 50 px pill + ~26 px context bar on top + 8 px padding = ~84 px; 100 px
// adds breathing room for the glow drop-shadow so nothing clips.
const HUD_HEIGHT = 100;

function positionHudOnActiveScreen() {
  if (!hudWindow) return;
  const { screen } = require('electron');
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const bounds = hudWindow.getBounds();
  hudWindow.setBounds({
    x: x + Math.round((width - bounds.width) / 2),
    y: y + height - bounds.height - 48,
    width: bounds.width,
    height: bounds.height,
  });
}

function createHudWindow() {
  const { screen } = require('electron');
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;

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
      sandbox: true,
    },
  });

  hudWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  hudWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hudWindow.loadFile('hud.html');

  hudWindow.on('closed', () => {
    hudWindow = null;
  });
}

const ENGINE_LABELS_HUD = {
  apple: 'Apple Speech',
  whisperkit: 'WhisperKit',
  'whisper.cpp': 'whisper.cpp',
  openai: 'OpenAI API',
};
const MODE_LABELS_HUD = {
  off: { ko: '원문', en: 'Raw', ja: '生', 'zh-CN': '原文' },
  rules: { ko: '규칙 정제', en: 'Rules', ja: 'ルール', 'zh-CN': '规则' },
  ollama: { ko: 'Ollama 정제', en: 'Ollama clean', ja: 'Ollama 整形', 'zh-CN': 'Ollama 整理' },
  translate: { ko: 'Ollama 번역', en: 'Translate', ja: '翻訳', 'zh-CN': '翻译' },
};
const STATE_CONTEXT = {
  processing: {
    ko: '다듬는 중…', en: 'Polishing…', ja: '整形中…', 'zh-CN': '整理中…',
  },
  processingOllama: {
    ko: 'Ollama 로 다듬는 중…', en: 'Ollama polishing…', ja: 'Ollama で整形中…', 'zh-CN': 'Ollama 整理中…',
  },
  processingTranslate: {
    ko: 'Ollama 번역 중…', en: 'Ollama translating…', ja: 'Ollama 翻訳中…', 'zh-CN': 'Ollama 翻译中…',
  },
  done: {
    ko: '붙여넣기 완료', en: 'Pasted · done', ja: '貼り付け完了', 'zh-CN': '粘贴完成',
  },
};

// `state` is optional — when omitted, the context bar just shows
// "[engine] · [mode]". When present, the label reflects the current
// pipeline phase so the user sees progress text match the coloured halo.
function sendHudContext(state) {
  if (!hudWindow) return;
  const engine = currentEngine();
  const loc = currentUiLocale();
  const cfg = loadConfig();
  const mode = ['off', 'rules', 'ollama', 'translate'].includes(cfg.mode) ? cfg.mode : 'off';
  const engineLabel = ENGINE_LABELS_HUD[engine] || engine;

  let modeLabel = MODE_LABELS_HUD[mode]?.[loc] || MODE_LABELS_HUD[mode]?.en || '';

  // Overlay state-aware messaging on top of the neutral engine/mode combo.
  if (state === 'processing') {
    const key = mode === 'translate' ? 'processingTranslate'
              : mode === 'ollama'   ? 'processingOllama'
              : 'processing';
    modeLabel = STATE_CONTEXT[key][loc] || STATE_CONTEXT[key].en;
  } else if (state === 'done') {
    modeLabel = STATE_CONTEXT.done[loc] || STATE_CONTEXT.done.en;
  }

  safeSend(hudWindow,'hud-context', {
    engine,
    engineLabel,
    mode,
    modeLabel,
    locale: loc,
    state: state || 'recording',
  });
}

function showHud(state) {
  if (!hudWindow) return;
  // Re-anchor to the screen containing the cursor every time the HUD is
  // summoned — fixes multi-monitor setups where the HUD would otherwise
  // always appear on the primary display regardless of where the user is
  // looking.
  positionHudOnActiveScreen();
  const s = state || 'recording';
  safeSend(hudWindow,'hud-state', s);
  sendHudContext(s);
  if (!hudWindow.isVisible()) hudWindow.showInactive();
}

// Flash the HUD's "done" state for a beat, then hide. Called after a
// successful paste so the user gets a green-checkmark confirmation
// instead of the HUD just vanishing.
let hudDoneTimer = null;
function flashHudDone(durationMs = 900) {
  if (!hudWindow || !hudWindow.isVisible()) { hideHud(); return; }
  safeSend(hudWindow,'hud-state', 'done');
  sendHudContext('done');
  if (hudDoneTimer) clearTimeout(hudDoneTimer);
  hudDoneTimer = setTimeout(() => { hideHud(); }, durationMs);
}

function hideHud() {
  if (hudDoneTimer) { clearTimeout(hudDoneTimer); hudDoneTimer = null; }
  if (!hudWindow) return;
  if (hudWindow.isVisible()) hudWindow.hide();
  safeSend(hudWindow,'hud-reset');
  cancelHudSafetyHide();
}

let trayWindow = null;
let trayNativeMenu = null;

function createTray() {
  // Brand-aligned menubar icon — miniaturised 5-bar equalizer that mirrors
  // the app icon so users can actually find us in the menubar. Template
  // mode lets macOS handle light/dark tint + hover/active states without
  // us shipping four variants. The @2x file is picked up automatically by
  // Electron from the same directory when display scale is Retina.
  const iconPath = resPath('icons', 'trayIconTemplate.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    icon.setTemplateImage(true);
  } else {
    // Dev-mode fallback: if the PNG hasn't been generated yet (first
    // checkout before `npm run icon:tray`), fall back to the system
    // placeholder so the tray still appears.
    console.warn('[tray] custom icon missing at', iconPath, '- using system placeholder');
    icon = nativeImage
      .createFromNamedImage('NSStatusAvailable', [-1, 0, 1])
      .resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  updateTrayMenu();
  // On macOS, `tray.setContextMenu(menu)` hijacks left-click (it opens
  // the native menu and suppresses the `click` event). So we DO NOT set
  // a default context menu — instead we store the template and pop it
  // up only on explicit right-click. Left-click goes straight to the
  // custom popover.
  tray.on('click', () => toggleTrayWindow());
  tray.on('right-click', () => {
    if (trayNativeMenu) tray.popUpContextMenu(trayNativeMenu);
  });
}

function updateTrayMenu() {
  // Mirror the state into the renderer's dashboard button on every
  // tray-menu refresh. Every callsite that flips `isRecording` /
  // `isProcessing` already calls updateTrayMenu(), so folding the push
  // in here keeps the two UI surfaces in lockstep for free.
  pushRecordState();
  if (!tray) return;
  const stateLabel = isRecording
    ? tr('tray.state.recording')
    : isProcessing
    ? tr('tray.state.processing')
    : tr('tray.state.idle');
  tray.setToolTip(`Listen K · ${stateLabel}`);
  // Native fallback menu — right-click only. The primary UI is the
  // custom popover (see tray.on('click') in createTray()). Labels use
  // the current UI locale so right-click doesn't ship a bilingual
  // "창 열기 / Open window" fallback to users whose system isn't Korean.
  trayNativeMenu = Menu.buildFromTemplate([
    { label: `Listen K · ${stateLabel}`, enabled: false },
    { type: 'separator' },
    { label: tr('tray.menu.open'), click: () => showWindowNonIntrusive() },
    { label: tr('tray.menu.toggleRecord'), click: () => handleFnPress() },
    { type: 'separator' },
    { label: tr('tray.menu.quit'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  if (trayWindow && trayWindow.isVisible()) sendTraySnapshot();
}

function createTrayWindow() {
  trayWindow = new BrowserWindow({
    width: 320,
    height: 520,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-tray.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  trayWindow.loadFile('tray.html');
  trayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  trayWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  trayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Hide when user clicks outside (normal popover behaviour on macOS).
  trayWindow.on('blur', () => {
    if (trayWindow && !trayWindow.isDestroyed() && trayWindow.isVisible()) trayWindow.hide();
  });

  trayWindow.on('closed', () => {
    trayWindow = null;
  });
}

function positionTrayWindow() {
  if (!trayWindow || !tray) return;
  const trayBounds = tray.getBounds();
  const winBounds = trayWindow.getBounds();
  // Centre horizontally under the tray icon, pin 6px below the menubar.
  const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (winBounds.width / 2));
  const y = Math.round(trayBounds.y + trayBounds.height + 6);
  trayWindow.setPosition(x, y, false);
}

function currentTrayState() {
  if (isRecording) return 'rec';
  if (isProcessing) return 'processing';
  if (transcribeStreamReady) return 'ready';
  return 'idle';
}

async function sendTraySnapshot() {
  if (!trayWindow) return;
  const recents = loadHistory(5);
  const cfg = loadConfig();
  const theme = ['light', 'dark'].includes(cfg.theme) ? cfg.theme : 'system';
  safeSend(trayWindow,'tray-snapshot', {
    locale: currentUiLocale(),
    hotkey: currentHotkey(),
    state: currentTrayState(),
    theme,
    recents: recents.map((e) => ({ clean: e.clean, raw: e.raw })),
  });
}

function toggleTrayWindow() {
  if (!trayWindow) createTrayWindow();
  if (trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }
  positionTrayWindow();
  trayWindow.showInactive();
  // Give the window's preload a tick to wire up the listener before we
  // push the first snapshot.
  setTimeout(() => sendTraySnapshot(), 30);
}

ipcMain.handle('tray-cmd', (_e, payload) => {
  const cmd = payload && payload.cmd;
  if (trayWindow) trayWindow.hide();
  switch (cmd) {
    case 'open':
      showWindowActive();
      // "Open dashboard" should actually land the user on the dashboard
      // page even if they were previously looking at History/Stats/etc.
      safeSend(mainWindow,'navigate-page', 'sec-status');
      return { ok: true };
    case 'record':
      handleFnPress();
      return { ok: true };
    case 'history':
      showWindowActive();
      safeSend(mainWindow,'navigate-page', 'sec-history');
      return { ok: true };
    case 'stats':
      showWindowActive();
      safeSend(mainWindow,'navigate-page', 'sec-stats');
      return { ok: true };
    case 'paste-recent':
      if (payload.text) {
        pasteToFrontmost(payload.text).catch((err) =>
          console.warn('[tray] paste-recent failed:', err.message)
        );
      }
      return { ok: true };
    case 'quit':
      app.isQuitting = true;
      app.quit();
      return { ok: true };
    default:
      return { ok: false, reason: 'unknown cmd' };
  }
});

// Apple bundle IDs are reverse-DNS: letters, digits, dots, dashes,
// underscores only. Filter anything else so a hostile app can't smuggle
// metacharacters into the paste-helper command line. execFile doesn't
// spawn a shell so this is belt-and-suspenders, but cheap.
const BUNDLE_ID_RE = /^[a-zA-Z0-9._-]{1,255}$/;
function safeBundleId(id) {
  return id && BUNDLE_ID_RE.test(id) ? id : null;
}

async function pasteToFrontmost(text) {
  // Bundle-id argument used to be passed as `['--bundle', frontmost]` for
  // eventual frontmost verification, but paste-helper never actually read
  // it — the helper just pastes into whatever app holds focus at the time
  // it posts the ⌘V event. focus-helper has already restored the correct
  // frontmost by the time we get here, so the flag was pure noise.
  const paste = resPath('bin', 'paste-helper');
  if (!fs.existsSync(paste)) throw new Error('paste-helper missing');
  clipboard.writeText(text);
  // Give the user's target app a beat to regain focus after the popover
  // hides, then fire ⌘V via the helper.
  await new Promise((r) => setTimeout(r, 150));
  return new Promise((resolve, reject) => {
    execFile(paste, [], (err) => (err ? reject(err) : resolve()));
  });
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
  const safe = safeBundleId(bundleId);
  if (!fs.existsSync(helper) || !safe) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(helper, ['activate', safe], (err) => resolve(!err));
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

function currentEngine() {
  const cfg = loadConfig();
  const e = cfg.engine;
  if (e === 'apple' || e === 'whisper.cpp' || e === 'openai' || e === 'whisperkit') return e;
  // New installs land on Apple Speech — on-device by default, no model
  // download, and autoFallbackFromAppleOnCrash() catches the "helper won't
  // stay up" dev-mode case by flipping back to WhisperKit. Existing users
  // already have `cfg.engine` persisted, so this only affects first boots.
  return 'apple';
}

function currentUiLocale() {
  const cfg = loadConfig();
  if (cfg.uiLocale && i18n.LOCALES.includes(cfg.uiLocale)) return cfg.uiLocale;
  // First launch: follow the system locale. app.getLocale() is safe to call
  // once the app is ready; the few call sites before ready fall back to 'en'.
  try {
    return i18n.detectSystemLocale(app.getLocale());
  } catch {
    return i18n.DEFAULT_LOCALE;
  }
}

// Translate using the user's current UI locale. For anything sent to the
// renderer (toasts, thrown error messages that become err.message in the
// renderer catch block), use this so the user sees their chosen language.
function tr(key, params) {
  return i18n.t(key, params, currentUiLocale());
}

const OPENAI_MODELS = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'];
function currentOpenAiModel() {
  const cfg = loadConfig();
  return OPENAI_MODELS.includes(cfg.openaiModel) ? cfg.openaiModel : 'gpt-4o-transcribe';
}

// OpenAI key is stored in config.json as an Electron-safeStorage-encrypted
// blob (base64 of the ciphertext) under `openaiKeyEnc`. On macOS this is
// backed by the user's Keychain — config.json alone is useless without
// the same user's session. If encryption isn't available on this platform
// (shouldn't happen on macOS), we skip saving rather than write plaintext.
//
// Legacy plaintext `openaiKey` from pre-encryption versions is still read
// once — the next save migrates it to `openaiKeyEnc` and deletes the old
// plaintext field.
function encryptionAvailable() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function decryptStoredKey(cfg) {
  if (cfg.openaiKeyEnc && encryptionAvailable()) {
    try {
      const buf = Buffer.from(cfg.openaiKeyEnc, 'base64');
      return safeStorage.decryptString(buf).trim();
    } catch (err) {
      console.warn('[openai] decrypt failed:', err.message);
      return '';
    }
  }
  if (cfg.openaiKey) return String(cfg.openaiKey).trim();
  return '';
}

function currentOpenAiKey() {
  const fromEnv = (process.env.OPENAI_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  return decryptStoredKey(loadConfig());
}

function persistOpenAiKey(raw) {
  const cfg = loadConfig();
  const key = typeof raw === 'string' ? raw.trim() : '';

  if (!key) {
    delete cfg.openaiKeyEnc;
    delete cfg.openaiKey;
    saveConfig(cfg);
    return { ok: true, hasKey: false, encrypted: false };
  }

  if (!encryptionAvailable()) {
    // Refuse to write plaintext — user asked for encryption. Surface the
    // failure so the renderer can tell them.
    return {
      ok: false,
      hasKey: Boolean(cfg.openaiKeyEnc || cfg.openaiKey),
      encrypted: false,
      reason: tr('error.encryptionUnavailable'),
    };
  }

  const enc = safeStorage.encryptString(key).toString('base64');
  cfg.openaiKeyEnc = enc;
  delete cfg.openaiKey; // drop any lingering plaintext from legacy saves
  saveConfig(cfg);
  return { ok: true, hasKey: true, encrypted: true };
}

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

function findGgmlModel() {
  if (process.env.WHISPER_MODEL && fs.existsSync(process.env.WHISPER_MODEL)) {
    return process.env.WHISPER_MODEL;
  }
  const candidates = [
    resPath('models', 'ggml-base.bin'),
    resPath('models', 'ggml-small.bin'),
    resPath('models', 'ggml-tiny.bin'),
    path.join(os.homedir(), 'models', 'ggml-base.bin'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---- Transcription history (JSONL on disk) ----

function historyPath() {
  return path.join(app.getPath('userData'), 'history.jsonl');
}

const HISTORY_MAX = 500;

function appendHistory(entry) {
  const p = historyPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(entry) + '\n');
    // Lazy truncation: if the file grows too big, keep the last HISTORY_MAX lines.
    const stats = fs.statSync(p);
    if (stats.size > 2 * 1024 * 1024) {
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      const trimmed = lines.slice(-HISTORY_MAX).join('\n') + '\n';
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, trimmed);
      fs.renameSync(tmp, p);
    }
  } catch (err) {
    console.warn('[history] append failed:', err.message);
  }
}

function loadHistory(limit = 50) {
  const p = historyPath();
  if (!fs.existsSync(p)) return [];
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[history] load failed:', err.message);
    return [];
  }
}

function clearHistory() {
  try { fs.unlinkSync(historyPath()); } catch {}
}

// ---- Usage stats (separate file — lifetime + today aggregates) ----
//
// Kept separate from history.jsonl because history is size-capped but stats
// are meant to accumulate forever. Stats are intentionally minimal — just
// enough to answer "how much did I spend on OpenAI?" and "how many tokens
// did Ollama chew through?" Fine-grained per-call detail stays in history.

function statsPath() {
  return path.join(app.getPath('userData'), 'stats.json');
}

const STATS_TEMPLATE = () => ({
  counters: {
    callsByEngine: {}, // { apple: 10, whisperkit: 5, openai: 2, ... }
    audioSecByEngine: {}, // same keys, seconds totalled
    openaiCost: 0, // USD, float
    openaiCallsByModel: {}, // { 'gpt-4o-transcribe': 3 }
    ollamaPromptTokens: 0,
    ollamaEvalTokens: 0,
    ollamaCalls: 0,
  },
  today: {
    date: '',
    callsByEngine: {},
    audioSecByEngine: {},
    openaiCost: 0,
    ollamaPromptTokens: 0,
    ollamaEvalTokens: 0,
    ollamaCalls: 0,
  },
  firstSeenAt: null,
  lastUpdatedAt: null,
});

function loadStats() {
  const p = statsPath();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Merge with template so newly-added fields appear on existing files.
    const out = STATS_TEMPLATE();
    Object.assign(out.counters, raw.counters || {});
    Object.assign(out.today, raw.today || {});
    out.firstSeenAt = raw.firstSeenAt || null;
    out.lastUpdatedAt = raw.lastUpdatedAt || null;
    return out;
  } catch {
    return STATS_TEMPLATE();
  }
}

function saveStats(stats) {
  const p = statsPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(stats, null, 2));
    fs.renameSync(tmp, p);
  } catch (err) {
    console.warn('[stats] save failed:', err.message);
  }
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ensureTodayBucket(stats) {
  const today = todayKey();
  if (stats.today.date !== today) {
    stats.today = {
      date: today,
      callsByEngine: {},
      audioSecByEngine: {},
      openaiCost: 0,
      ollamaPromptTokens: 0,
      ollamaEvalTokens: 0,
      ollamaCalls: 0,
    };
  }
}

// OpenAI transcription pricing snapshot. Keep this here (not renderer) so the
// renderer can't fake cheaper costs by tampering with DOM — but accept that
// this table drifts over time and treat the "cost" field as best-effort.
const OPENAI_AUDIO_RATES_PER_MIN = {
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1': 0.006,
};

// Engines accepted by the stats ledger. Anything else from the renderer is
// dropped — prevents a compromised renderer from writing arbitrary keys
// (including `__proto__` / `constructor`) into the counters map.
const STAT_ENGINES = new Set(['apple', 'whisper.cpp', 'openai', 'whisperkit']);

function recordTranscribeStat({ engine, model, audioSec }) {
  if (!engine || !STAT_ENGINES.has(engine)) return;
  const stats = loadStats();
  ensureTodayBucket(stats);

  const sec = Math.max(0, Number(audioSec) || 0);
  const rate = engine === 'openai' ? (OPENAI_AUDIO_RATES_PER_MIN[model] || 0) : 0;
  const cost = (sec / 60) * rate;

  const bump = (obj, key, by) => { obj[key] = (obj[key] || 0) + by; };

  bump(stats.counters.callsByEngine, engine, 1);
  bump(stats.counters.audioSecByEngine, engine, sec);
  if (engine === 'openai') {
    stats.counters.openaiCost = (stats.counters.openaiCost || 0) + cost;
    if (model) bump(stats.counters.openaiCallsByModel, model, 1);
  }

  bump(stats.today.callsByEngine, engine, 1);
  bump(stats.today.audioSecByEngine, engine, sec);
  if (engine === 'openai') stats.today.openaiCost += cost;

  if (!stats.firstSeenAt) stats.firstSeenAt = new Date().toISOString();
  stats.lastUpdatedAt = new Date().toISOString();
  saveStats(stats);
  return stats;
}

function recordOllamaStat({ promptTokens, evalTokens }) {
  const stats = loadStats();
  ensureTodayBucket(stats);
  const inTok = Math.max(0, Number(promptTokens) || 0);
  const outTok = Math.max(0, Number(evalTokens) || 0);
  stats.counters.ollamaPromptTokens += inTok;
  stats.counters.ollamaEvalTokens += outTok;
  stats.counters.ollamaCalls = (stats.counters.ollamaCalls || 0) + 1;
  stats.today.ollamaPromptTokens += inTok;
  stats.today.ollamaEvalTokens += outTok;
  stats.today.ollamaCalls = (stats.today.ollamaCalls || 0) + 1;
  if (!stats.firstSeenAt) stats.firstSeenAt = new Date().toISOString();
  stats.lastUpdatedAt = new Date().toISOString();
  saveStats(stats);
  return stats;
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
  // During onboarding step 3 we're just confirming the user's hotkey
  // works — no actual recording should start. Emit a dedicated event to
  // the renderer so the overlay can show "✓ detected".
  if (onboardingHotkeyTest) {
    safeSend(mainWindow,'onboarding-hotkey-fired');
    return;
  }

  if (isProcessing) return;
  if (!mainWindow) return;

  // Which pipeline carries the audio is determined by the engine only.
  // The "실시간 표시" toggle is a pure UI switch that controls whether
  // partial transcripts get forwarded to the HUD — it must NOT change
  // the capture path, otherwise Apple/WhisperKit engines end up stranded
  // on the legacy getUserMedia flow that doesn't exist for them.
  // whisper.cpp and OpenAI are batch-only — no streaming partials.
  const streamingEnabled = !['whisper.cpp', 'openai'].includes(currentEngine());
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
      safeSend(mainWindow,'toast', tr('toast.engineInactive'));
      return;
    }
    if (!transcribeStreamReady) {
      safeSend(mainWindow,'toast', tr('toast.engineInit'));
      return;
    }
    if (!isRecording) {
      savedFrontmostBundleId = await getFrontmostBundleId();
      console.log('[focus] saved frontmost:', savedFrontmostBundleId);
      isRecording = true;
      showHud('recording');
      cancelHudSafetyHide();
      sendStreamCmd({ cmd: 'start', language: currentLanguage() });
    } else {
      isRecording = false;
      // Close the race window: flip to processing immediately rather than
      // waiting for the renderer's set-state round-trip. Otherwise a rapid
      // second hotkey tap during those ~tens-of-ms lands back in the
      // "!isRecording" branch above and fires a new `start` while the
      // previous stream's stopStreamTranscription is still tearing down
      // the shared AudioProcessor — which is exactly the "mic gets
      // tangled" symptom users hit on initial launch. set-state from the
      // renderer still clears it when the paste pipeline completes.
      isProcessing = true;
      showHud('processing');
      sendStreamCmd({ cmd: 'stop' });
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
    safeSend(mainWindow,'toggle-record');
  } else {
    isRecording = false;
    showHud('processing');
    scheduleHudSafetyHide();
    safeSend(mainWindow,'toggle-record');
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
      } else if (t.startsWith('READY')) {
        // fn-listener emits `READY mode=<hotkey>` — match the prefix.
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
  });
}

function restartFnListener() {
  if (fnListener) {
    try { fnListener.kill('SIGTERM'); } catch {}
    fnListener = null;
  }
  startFnListener();
}

let transcribeStreamRestarts = 0;
const MAX_STREAM_RESTARTS = 3;

function startTranscribeStream() {
  const engine = currentEngine();

  // whisper.cpp and OpenAI are batch-only with no persistent process.
  if (engine === 'whisper.cpp' || engine === 'openai') {
    console.log(`[stream] engine=${engine} → skip streaming helper (batch-only)`);
    transcribeStream = null;
    transcribeStreamReady = false;
    return;
  }

  let helper, args;
  if (engine === 'apple') {
    const appleHelper = resPath('bin', 'apple-speech-helper');
    if (!fs.existsSync(appleHelper)) {
      console.warn('[stream] apple-speech-helper missing');
      return;
    }
    helper = appleHelper;
    const cfg = loadConfig();
    const localeId = cfg.language || 'ko-KR';
    args = ['--stream', '--language', localeId];
  } else {
    const wkHelper = findTranscribeHelper();
    const model = findWhisperKitModel();
    if (!wkHelper || !model) {
      console.warn('[stream] helper or model missing — streaming disabled');
      return;
    }
    helper = wkHelper;
    const hfCache = path.join(app.getPath('userData'), 'huggingface-cache');
    try { fs.mkdirSync(hfCache, { recursive: true }); } catch {}
    args = ['--stream', '--model-dir', model, '--language', 'auto', '--hf-cache', hfCache];
  }

  console.log(`[stream] spawning ${engine} engine:`, helper, args.join(' '));
  transcribeStreamBuffer = '';
  transcribeStream = spawn(helper, args, {
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
        safeSend(mainWindow,'toast', tr('toast.engineCrash'));
      }
    }

    // Clean exit (code 0 or SIGTERM from will-quit) → don't resurrect.
    if (code === 0 || signal === 'SIGTERM') return;

    if (transcribeStreamRestarts >= MAX_STREAM_RESTARTS) {
      console.error('[stream] max restarts reached, giving up');
      // If the failing engine is Apple Speech (common in dev), fall back
      // to WhisperKit automatically. Otherwise just tell the user.
      if (currentEngine() === 'apple') {
        autoFallbackFromAppleOnCrash();
      } else if (mainWindow) {
        safeSend(mainWindow,'toast', tr('toast.engineCrashMax'));
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
      if (mainWindow) {
        safeSend(mainWindow,'toast', tr('toast.engineReady'));
        safeSend(mainWindow,'stream-ready');
      }
      break;
    case 'partial':
      if (mainWindow) safeSend(mainWindow,'stream-partial', event.text || '');
      // HUD live-text is gated by the user's "실시간 표시" preference —
      // when off, we still stream internally (so we can re-transcribe on
      // stop) but the pill stays on its waveform animation instead of
      // flashing partial text.
      if (hudWindow && hudWindow.isVisible() && currentStreamingEnabled()) {
        safeSend(hudWindow,'hud-partial', event.text || '');
      }
      break;
    case 'final':
      cancelHudSafetyHide();
      if (mainWindow) safeSend(mainWindow,'stream-final', event.text || '');
      // Belt-and-suspenders: if the renderer's post-process + paste pipeline
      // never reports back within 15 s, force the HUD away.
      scheduleHudSafetyHide(15000);
      break;
    case 'stopped':
      break;
    case 'error':
      console.error('[stream] error:', event.message);
      if (mainWindow) safeSend(mainWindow,'stream-error', event.message || '');
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

// Full list with size/modified timestamp — used by the model-manager
// page so we can render disk usage and "last used" hints.
async function ollamaListDetailed() {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (!res.ok) return { running: false, models: [] };
    const json = await res.json();
    const models = (json.models || []).map((m) => ({
      name: m.name,
      size: m.size || 0, // bytes
      modifiedAt: m.modified_at || null,
      digest: m.digest || null,
    }));
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

// Pulls a model, streaming progress updates to the caller. Returns an
// AbortController-style { cancel } handle so the renderer can abandon a
// long download without leaking the request. Progress shape mirrors
// Ollama's JSON lines: { status, completed, total }.
const activeOllamaPulls = new Map(); // name → AbortController
async function ollamaPullModel(name, onProgress) {
  if (!name) throw new Error('name required');
  const controller = new AbortController();
  activeOllamaPulls.set(name, controller);
  let res;
  try {
    res = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal: controller.signal,
    });
  } catch (err) {
    activeOllamaPulls.delete(name);
    throw err;
  }
  if (!res.ok) {
    activeOllamaPulls.delete(name);
    throw new Error(`ollama pull ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed);
          onProgress?.(chunk);
        } catch {}
      }
    }
    return { ok: true };
  } finally {
    activeOllamaPulls.delete(name);
  }
}

async function ollamaDeleteModel(name) {
  const res = await fetch('http://localhost:11434/api/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ollama delete ${res.status}: ${txt.slice(0, 200)}`);
  }
  return { ok: true };
}

ipcMain.handle('ollama-list', () => ollamaListDetailed());

ipcMain.handle('ollama-pull', async (event, name) => {
  try {
    await ollamaPullModel(name, (chunk) => {
      // Stream chunks back to whichever renderer started the pull so it
      // can paint a progress bar in real time.
      try { event.sender.send('ollama-pull-progress', { name, chunk }); } catch {}
    });
    return { ok: true };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('ollama-pull-cancel', (_e, name) => {
  const ctrl = activeOllamaPulls.get(name);
  if (ctrl) { ctrl.abort(); return { ok: true }; }
  return { ok: false };
});

ipcMain.handle('ollama-delete', async (_e, name) => {
  try { await ollamaDeleteModel(name); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

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
  const ollama = await checkOllama();

  const wkHelper = findTranscribeHelper();
  const wkModel = findWhisperKitModel();
  const appleHelper = resPath('bin', 'apple-speech-helper');
  const appleHelperExists = fs.existsSync(appleHelper);
  const whisperCppBin = findWhisperBin();
  const ggmlModel = findGgmlModel();
  const openaiKeyPresent = Boolean(currentOpenAiKey());
  const openaiKeyFromEnv = Boolean((process.env.OPENAI_API_KEY || '').trim());
  const selectedEngine = currentEngine();
  let engine = 'none';
  if (selectedEngine === 'apple') {
    engine = appleHelperExists ? 'apple' : 'none';
  } else if (selectedEngine === 'whisper.cpp') {
    engine = whisperCppBin && ggmlModel ? 'whisper.cpp' : 'none';
  } else if (selectedEngine === 'openai') {
    engine = openaiKeyPresent ? 'openai' : 'none';
  } else {
    engine = wkHelper && wkModel ? 'whisperkit' : 'none';
  }

  return {
    mic,
    inputMonitoring,
    accessibility,
    transcribeHelper: wkHelper ? { path: wkHelper } : null,
    whisperKitModel: wkModel ? { path: wkModel } : null,
    appleSpeechHelper: appleHelperExists ? { path: appleHelper } : null,
    whisperCppBin: whisperCppBin ? { path: whisperCppBin } : null,
    ggmlModel: ggmlModel ? { path: ggmlModel } : null,
    openai: {
      hasKey: openaiKeyPresent,
      fromEnv: openaiKeyFromEnv,
      model: currentOpenAiModel(),
    },
    selectedEngine,
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

  // One-time migration: if a pre-encryption build left the OpenAI key as
  // plaintext in config.json, re-encrypt it now that safeStorage is ready.
  try {
    const cfg = loadConfig();
    if (cfg.openaiKey && !cfg.openaiKeyEnc && encryptionAvailable()) {
      const res = persistOpenAiKey(cfg.openaiKey);
      if (res.ok) log('openai key migrated: plaintext → encrypted');
    }
  } catch (err) {
    console.warn('[startup] openai key migration skipped:', err.message);
  }

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
  // Create the tray popover window ahead of time — showing it on tray
  // click is a no-op if the window is already loaded, which feels
  // snappier than creating on demand.
  createTrayWindow();
  log('tray window created');

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    handleFnPress();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindowActive();
  });

  setupAutoUpdater();
});

// ── Auto-update ─────────────────────────────────────────────────────
// electron-updater pulls the latest release from GitHub, downloads the
// signed + notarised DMG in the background, and installs it the next time
// the app quits. No manifest hosting on our side — electron-builder
// uploaded `latest-mac.yml` alongside the DMG when it published the
// release (see `mac.publish` in package.json and `release.yml`).
// Silently no-ops in dev builds (autoUpdater checks `app.isPackaged`).
// Non-null once electron-updater has finished downloading a new build —
// the signal the dashboard banner and Usage-page button both key off to
// offer the "Restart & install" path.
let pendingUpdateVersion = null;

function pushUpdateState() {
  safeSend(mainWindow, 'update-state', {
    pendingUpdateVersion,
    currentVersion: app.getVersion(),
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[updater] dev build — skipping');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => console.log('[updater] checking…'));
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    safeSend(mainWindow, 'toast', tr('toast.updateAvailable', { version: info.version }));
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] no update available');
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update downloaded:', info.version);
    pendingUpdateVersion = info.version;
    pushUpdateState();
    safeSend(mainWindow, 'toast', tr('toast.updateReady', { version: info.version }));
  });
  autoUpdater.on('error', (err) => {
    // Don't surface transient network errors to the user — first-run or
    // offline Macs would see an alarming toast for a retryable problem.
    console.warn('[updater] error:', err && err.message ? err.message : err);
  });

  // First check 10 s after launch (let the model load and mic permission
  // settle first). Subsequent checks every 4 h while the app stays open.
  // Errors are logged to console but not surfaced to the user — transient
  // network failures shouldn't alarm first-run / offline users. But we
  // stopped silently eating them completely: the swallow here was masking
  // the ZIP-file-not-provided bug that made auto-update DOA for v0.6.0–v0.7.1.
  const logCheckErr = (err) => {
    console.warn('[updater] checkForUpdates rejected:', (err && err.message) || err);
  };
  setTimeout(() => { autoUpdater.checkForUpdates().catch(logCheckErr); }, 10_000);
  setInterval(() => { autoUpdater.checkForUpdates().catch(logCheckErr); }, 4 * 60 * 60 * 1000);
}

// Let the renderer pull the current update state on boot (covers the
// case where the user opens the dashboard after the download already
// finished in the background).
ipcMain.handle('get-update-state', () => ({
  pendingUpdateVersion,
  currentVersion: app.getVersion(),
}));

// Triggered by the dashboard banner's "Restart & install" button or the
// Usage-page "Check for updates" button when an update is ready. Bypasses
// the "wait for normal quit" delay of autoInstallOnAppQuit — the app
// immediately quits and relaunches into the new version.
ipcMain.handle('install-update-now', () => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  if (!pendingUpdateVersion) return { ok: false, reason: 'not-downloaded' };
  // quitAndInstall(isSilent, isForceRunAfter) — the defaults (true, false)
  // leave the new app *not* launched. We explicitly want forceRunAfter
  // so the user lands back in the dashboard, same as a normal cold boot.
  setImmediate(() => {
    try { autoUpdater.quitAndInstall(true, true); } catch (err) {
      console.warn('[updater] quitAndInstall failed:', err && err.message);
    }
  });
  return { ok: true, version: pendingUpdateVersion };
});

// Renderer can invoke this from a Settings "Check for updates" button.
// Returns the UpdateCheckResult from electron-updater or null on failure.
ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  if (!app.isPackaged) return { ok: false, reason: 'dev', currentVersion };
  try {
    const res = await autoUpdater.checkForUpdates();
    const latestVersion = res && res.updateInfo && res.updateInfo.version;
    return {
      ok: true,
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      updateAvailable: Boolean(latestVersion && latestVersion !== currentVersion),
    };
  } catch (err) {
    return { ok: false, reason: (err && err.message) || 'unknown', currentVersion };
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

app.on('window-all-closed', (e) => {
  e.preventDefault?.();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (hudDoneTimer) { clearTimeout(hudDoneTimer); hudDoneTimer = null; }
  if (hudSafetyTimer) { clearTimeout(hudSafetyTimer); hudSafetyTimer = null; }
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
  return cfg.mode || 'off';
}

// User-writable directory for models downloaded in-app. The signed app
// bundle is read-only, so anything the user pulls via the Engine page
// lands here — this side of the FS is mutable and already per-user
// (Application Support).
function whisperKitUserRoot() {
  return path.join(app.getPath('userData'), 'models', 'whisperkit');
}

// Returns the directory that actually holds a given model name, checking
// the user-writable root first so downloaded variants override any bundled
// namesake. Null when neither root has it.
function whisperKitModelPath(name) {
  if (!name) return null;
  const userRoot = whisperKitUserRoot();
  const userDir = path.join(userRoot, name);
  if (fs.existsSync(userDir)) return userDir;
  const bundled = path.join(resPath('models', 'whisperkit'), name);
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

function listInstalledWhisperKitModels() {
  const names = new Set();
  for (const root of [resPath('models', 'whisperkit'), whisperKitUserRoot()]) {
    if (!fs.existsSync(root)) continue;
    try {
      for (const n of fs.readdirSync(root)) {
        try {
          if (fs.statSync(path.join(root, n)).isDirectory()) names.add(n);
        } catch {}
      }
    } catch {}
  }
  return Array.from(names).sort();
}

// Back-compat alias — existing callers (status dashboard) expect a flat
// list of installed model names. Now merged across bundled + user-writable.
function listWhisperKitModels() {
  return listInstalledWhisperKitModels();
}

function findWhisperKitModel() {
  // Honour explicit user override before falling back to auto-pick.
  const cfg = loadConfig();
  if (cfg.whisperKitModel) {
    const explicit = whisperKitModelPath(cfg.whisperKitModel);
    if (explicit) return explicit;
  }

  // Default preference: large-v3-turbo first when available. Turbo distills
  // decoder layers so it's ~2x faster with minimal accuracy loss on
  // English; non-English (esp. Korean) is slightly weaker than full
  // large-v3, so we still fall back to non-turbo if present. base ranks
  // after the larger variants because it's the always-bundled floor —
  // shipped mainly so Apple Speech has a working WhisperKit fallback.
  const preferred = [
    'openai_whisper-large-v3-v20240930_turbo_632MB',
    'openai_whisper-large-v3-v20240930_turbo',
    'openai_whisper-large-v3_turbo_954MB',
    'openai_whisper-large-v3_turbo',
    'openai_whisper-large-v2_turbo_955MB',
    'openai_whisper-large-v2_turbo',
    'openai_whisper-large-v3-v20240930_626MB',       // full, quantised
    'openai_whisper-large-v3-v20240930',
    'openai_whisper-large-v3_947MB',
    'openai_whisper-large-v3',
    'openai_whisper-medium',
    'openai_whisper-small',
    'openai_whisper-base',
    'openai_whisper-tiny',
  ];
  for (const name of preferred) {
    const p = whisperKitModelPath(name);
    if (p) return p;
  }
  // Fallback: take whatever is installed.
  const installed = listInstalledWhisperKitModels();
  if (installed.length) return whisperKitModelPath(installed[0]);
  return null;
}

// Combined finder used by status dashboard
function findModel() {
  return findWhisperKitModel();
}

ipcMain.handle('transcribe', async (_e, { wavBuffer, language }) => {
  const buf = Buffer.from(wavBuffer);
  if (buf.length < 44 + 16000 * 0.2 * 2) {
    throw new Error(tr('error.recordingTooShort'));
  }

  // Random suffix rather than Date.now() so two concurrent fallback
  // transcribes (or a same-user process predicting the path) can't race
  // on the filename.
  const tmpFile = path.join(os.tmpdir(), `listenk_${require('crypto').randomBytes(12).toString('hex')}.wav`);
  await fs.promises.writeFile(tmpFile, buf);
  const lang = (language || '').split('-')[0] || 'auto';
  const engine = currentEngine();

  // whisper.cpp path: whisper-cli + ggml model.
  if (engine === 'whisper.cpp') {
    const whisperBin = findWhisperBin();
    const ggmlModel = findGgmlModel();
    if (!whisperBin) {
      fs.unlink(tmpFile, () => {});
      throw new Error(tr('error.whisperCliMissing'));
    }
    if (!ggmlModel) {
      fs.unlink(tmpFile, () => {});
      throw new Error(tr('error.ggmlMissing'));
    }
    return new Promise((resolve, reject) => {
      execFile(
        whisperBin,
        ['-m', ggmlModel, '-f', tmpFile, '-l', lang, '-nt', '-np'],
        { maxBuffer: 20 * 1024 * 1024 },
        (err, stdout, stderr) => {
          fs.unlink(tmpFile, () => {});
          if (err) reject(new Error(tr('error.whisperCppFail', { detail: stderr || err.message })));
          else resolve(stdout.trim());
        }
      );
    });
  }

  // OpenAI Whisper API — cloud path. Uploads the WAV as multipart/form-data,
  // receives plain-text transcript. Requires OPENAI_API_KEY in config or env.
  if (engine === 'openai') {
    const apiKey = currentOpenAiKey();
    if (!apiKey) {
      fs.unlink(tmpFile, () => {});
      throw new Error(tr('error.openaiKeyMissing'));
    }
    const model = currentOpenAiModel();
    try {
      const wav = await fs.promises.readFile(tmpFile);
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', model);
      if (lang && lang !== 'auto') form.append('language', lang);
      form.append('response_format', 'text');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        throw new Error(tr('error.openaiStatus', { status: res.status, detail }));
      }
      // response_format=text returns the raw transcript (no JSON envelope).
      const text = (await res.text()).trim();
      return text;
    } finally {
      fs.unlink(tmpFile, () => {});
    }
  }

  // Default: WhisperKit batch.
  const wkHelper = findTranscribeHelper();
  const wkModel = findWhisperKitModel();
  if (!wkHelper || !wkModel) {
    fs.unlink(tmpFile, () => {});
    throw new Error(tr('error.wkMissing'));
  }
  const hfCache = path.join(app.getPath('userData'), 'huggingface-cache');
  try { fs.mkdirSync(hfCache, { recursive: true }); } catch {}
  return new Promise((resolve, reject) => {
    execFile(
      wkHelper,
      ['--audio', tmpFile, '--model-dir', wkModel, '--language', lang, '--hf-cache', hfCache],
      { maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        fs.unlink(tmpFile, () => {});
        if (err) reject(new Error(tr('error.wkFail', { detail: stderr || err.message })));
        else resolve(stdout.trim());
      }
    );
  });
});

ipcMain.handle('set-state', (_e, { recording, processing, pasted }) => {
  if (typeof recording === 'boolean') isRecording = recording;
  if (typeof processing === 'boolean') {
    isProcessing = processing;
    if (processing) showHud('processing');
  }
  console.log('[state] recording=', isRecording, 'processing=', isProcessing, 'pasted=', pasted);
  if (!isRecording && !isProcessing) {
    // Successful paste → flash green checkmark before hiding. Everything
    // else (cancel, error, silent) just hides immediately.
    if (pasted === true) flashHudDone();
    else hideHud();
  }
  updateTrayMenu();
});

// Dashboard "Record now" button. Intentionally the same entry point as
// the hotkey + tray "toggle record" — so the user gets identical HUD,
// streaming engine, and focus-restore behaviour no matter where they
// start. Previously the button took a legacy batch-capture path that
// bypassed the HUD and had no visible way to stop mid-recording.
ipcMain.handle('trigger-record', async () => {
  await handleFnPress();
  return { ok: true, isRecording, isProcessing };
});

// Pushed to the renderer whenever main-side recording state changes so
// the dashboard's Record button can reflect reality (idle / recording /
// processing) without polling.
function pushRecordState() {
  safeSend(mainWindow, 'record-state', { isRecording, isProcessing });
}

ipcMain.handle('get-record-state', () => ({ isRecording, isProcessing }));

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
  if (mainWindow) safeSend(mainWindow,'cancel-record');
});

ipcMain.handle('hud-confirm', () => {
  if (!isRecording) return;
  isRecording = false;
  showHud('processing');
  updateTrayMenu();
  if (mainWindow) safeSend(mainWindow,'toggle-record');
});

ipcMain.handle('paste-text', async (_e, text) => {
  if (!text) return;
  const trimmed = text.trim();
  clipboard.writeText(trimmed);

  const OWN_BUNDLE_ID = 'com.eazler.listenk';
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
          reject(new Error(tr('error.pasteHelperFail', { detail: stderr || err.message })));
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
                tr('error.pasteFail', { detail: stderr || err.message })
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

// `open-url` was removed: no renderer caller existed, and `shell.openExternal`
// accepting an unvalidated string (including `file://`, `smb://`, custom
// schemes) is an unnecessary footgun if the renderer is ever compromised. If
// a future feature needs to open an external link, add a purpose-specific
// IPC that hard-codes the URL (see `open-settings-pane` for the pattern).

// Purpose-specific handler for the Ollama empty-state banner's "Download
// Ollama" button. URL is hardcoded so a compromised renderer can't pivot
// this into an arbitrary-URL primitive.
ipcMain.handle('open-ollama-download', () => {
  require('electron').shell.openExternal('https://ollama.com/download');
  return true;
});

// `show-in-finder` is the only place we surface a filesystem path in Finder
// for the user, and the renderer-side callers (`showInFinder(targetPath)`
// in renderer.js) always hand it a path returned from `collectStatus()` —
// i.e. app bundle path, paste-helper path, or fn-listener path. Gate the
// handler with an explicit prefix allowlist so a compromised renderer
// can't pivot it into a filesystem-reveal primitive.
ipcMain.handle('show-in-finder', (_e, p) => {
  if (typeof p !== 'string' || !p) return false;
  const abs = path.resolve(p);
  const allowedPrefixes = [
    process.resourcesPath,
    app.getPath('userData'),
    '/Applications/',
    __dirname, // dev builds point at the repo root
  ].filter(Boolean);
  if (!allowedPrefixes.some((pre) => abs === pre || abs.startsWith(pre + '/'))) {
    console.warn('[security] show-in-finder rejected path outside allowlist:', abs);
    return false;
  }
  require('electron').shell.showItemInFolder(abs);
  return true;
});

ipcMain.handle('clipboard-write', (_e, text) => {
  clipboard.writeText(text == null ? '' : String(text));
  return true;
});

ipcMain.handle('history-list', (_e, limit) => loadHistory(typeof limit === 'number' ? limit : 50));
ipcMain.handle('history-append', (_e, entry) => { appendHistory(entry || {}); return true; });
ipcMain.handle('history-clear', () => { clearHistory(); return true; });

ipcMain.handle('stats-get', () => {
  const stats = loadStats();
  ensureTodayBucket(stats);
  // Expose the OpenAI rate table so the renderer can explain how cost was
  // derived ("$0.006/min × 32s = $0.0032").
  return { stats, openaiRatesPerMin: OPENAI_AUDIO_RATES_PER_MIN };
});
ipcMain.handle('stats-record-transcribe', (_e, payload) => recordTranscribeStat(payload || {}));
ipcMain.handle('stats-record-ollama', (_e, payload) => recordOllamaStat(payload || {}));
ipcMain.handle('stats-clear', () => {
  try { fs.unlinkSync(statsPath()); } catch {}
  return true;
});

ipcMain.handle('list-whisper-models', () => {
  const cfg = loadConfig();
  return {
    available: listWhisperKitModels(),
    selected: cfg.whisperKitModel || null,
    active: path.basename(findWhisperKitModel() || ''),
  };
});

// ── WhisperKit model catalog + in-app downloader ──────────────────
// Curated list of WhisperKit variants we expose on the Engine page.
// Sizes are approximate (bytes on disk after download); actual files
// may differ by a few MB depending on shard layout. `tag` is an
// i18n-friendly short identifier; `label` is a fallback when locale
// strings haven't loaded yet.
const WHISPERKIT_CATALOG = [
  { name: 'openai_whisper-base',                           tag: 'base',     sizeMB: 150,  label: 'Base',     recommendedFor: 'low-memory fallback' },
  { name: 'openai_whisper-small',                          tag: 'small',    sizeMB: 500,  label: 'Small',    recommendedFor: 'balanced speed + quality' },
  { name: 'openai_whisper-large-v3-v20240930_turbo_632MB', tag: 'turbo',    sizeMB: 632,  label: 'Turbo',    recommendedFor: 'fastest large-v3 · default' },
  { name: 'openai_whisper-large-v3-v20240930_626MB',       tag: 'accurate', sizeMB: 626,  label: 'Accurate', recommendedFor: 'highest quality (non-English)' },
];

// in-flight downloads keyed by model name → { proc, aborted }
const activeWhisperKitPulls = new Map();

ipcMain.handle('whisperkit-catalog', () => {
  const cfg = loadConfig();
  const active = path.basename(findWhisperKitModel() || '');
  return {
    catalog: WHISPERKIT_CATALOG.map((entry) => {
      const userRoot = whisperKitUserRoot();
      const bundledPath = path.join(resPath('models', 'whisperkit'), entry.name);
      const userPath = path.join(userRoot, entry.name);
      const bundled = fs.existsSync(bundledPath);
      const downloaded = fs.existsSync(userPath);
      return {
        ...entry,
        installed: bundled || downloaded,
        bundled,
        downloading: activeWhisperKitPulls.has(entry.name),
        isActive: entry.name === active,
        isSelected: entry.name === (cfg.whisperKitModel || null),
      };
    }),
    selected: cfg.whisperKitModel || null,
    active,
  };
});

ipcMain.handle('whisperkit-download', async (_e, name) => {
  if (!name || !WHISPERKIT_CATALOG.find((m) => m.name === name)) {
    return { ok: false, reason: 'unknown model' };
  }
  if (activeWhisperKitPulls.has(name)) {
    return { ok: false, reason: 'already downloading' };
  }
  const helper = findTranscribeHelper();
  if (!helper) return { ok: false, reason: 'transcribe-helper missing' };

  const userRoot = whisperKitUserRoot();
  try { fs.mkdirSync(userRoot, { recursive: true }); } catch {}

  // Don't re-download if the model is already present (either bundled or
  // in the user directory) — just report success so the UI reconciles.
  if (whisperKitModelPath(name)) {
    safeSend(mainWindow, 'whisperkit-download-progress', {
      name, fraction: 1, status: 'complete',
    });
    return { ok: true, alreadyInstalled: true };
  }

  return await new Promise((resolve) => {
    const proc = spawn(helper, ['--download', name, userRoot, '--json-progress'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const state = { proc, aborted: false };
    activeWhisperKitPulls.set(name, state);

    let stdoutBuf = '';
    let lastError = '';

    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let evt;
        try { evt = JSON.parse(trimmed); } catch {
          console.warn('[whisperkit] malformed progress line:', trimmed.slice(0, 200));
          continue;
        }
        if (evt.type === 'download-progress') {
          safeSend(mainWindow, 'whisperkit-download-progress', {
            name,
            fraction: Number(evt.fraction) || 0,
            completed: evt.completed || 0,
            total: evt.total || 0,
            status: 'downloading',
          });
        } else if (evt.type === 'download-complete') {
          safeSend(mainWindow, 'whisperkit-download-progress', {
            name, fraction: 1, status: 'complete', path: evt.path,
          });
        } else if (evt.type === 'download-error') {
          lastError = String(evt.message || 'unknown');
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      // WhisperKit logs noise goes to stderr; only surface on exit.
      if (text) lastError = text.trim().split('\n').slice(-1)[0] || lastError;
    });

    proc.on('error', (err) => {
      activeWhisperKitPulls.delete(name);
      safeSend(mainWindow, 'whisperkit-download-progress', {
        name, status: 'error', message: err.message,
      });
      resolve({ ok: false, reason: err.message });
    });

    proc.on('close', (code) => {
      activeWhisperKitPulls.delete(name);
      if (state.aborted) {
        // User-initiated cancel; remove any partial directory so a retry
        // starts clean rather than resuming a half-complete shard tree.
        const partial = path.join(userRoot, name);
        try { fs.rmSync(partial, { recursive: true, force: true }); } catch {}
        safeSend(mainWindow, 'whisperkit-download-progress', {
          name, status: 'cancelled',
        });
        resolve({ ok: false, cancelled: true });
        return;
      }
      if (code === 0) {
        resolve({ ok: true, path: path.join(userRoot, name) });
      } else {
        safeSend(mainWindow, 'whisperkit-download-progress', {
          name, status: 'error', message: lastError || `exit ${code}`,
        });
        resolve({ ok: false, reason: lastError || `exit ${code}` });
      }
    });
  });
});

ipcMain.handle('whisperkit-cancel', (_e, name) => {
  const state = activeWhisperKitPulls.get(name);
  if (!state) return { ok: false, reason: 'not downloading' };
  state.aborted = true;
  try { state.proc.kill('SIGTERM'); } catch {}
  return { ok: true };
});

ipcMain.handle('whisperkit-delete', (_e, name) => {
  if (!name || !WHISPERKIT_CATALOG.find((m) => m.name === name)) {
    return { ok: false, reason: 'unknown model' };
  }
  const userDir = path.join(whisperKitUserRoot(), name);
  if (!fs.existsSync(userDir)) {
    // Bundled models can't be removed from a signed read-only bundle;
    // surface this clearly so the UI can disable the button.
    return { ok: false, reason: 'bundled' };
  }
  // Refuse to delete the model that's actively driving the stream —
  // the helper still holds its Core ML files open.
  if (isRecording || isProcessing) {
    return { ok: false, reason: 'busy' };
  }
  const cfg = loadConfig();
  const isActive = (cfg.whisperKitModel === name) || (path.basename(findWhisperKitModel() || '') === name);
  try {
    fs.rmSync(userDir, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  // If we just removed the selected model, clear the selection so
  // findWhisperKitModel falls back to the preferred order.
  if (isActive) {
    delete cfg.whisperKitModel;
    saveConfig(cfg);
    respawnStream();
  }
  return { ok: true };
});

ipcMain.handle('set-whisper-model', (_e, name) => {
  const cfg = loadConfig();
  if (name) cfg.whisperKitModel = name;
  else delete cfg.whisperKitModel;
  saveConfig(cfg);
  respawnStream();
  return { ok: true };
});

ipcMain.handle('set-engine', (_e, engine) => {
  // Block engine switches while a recording or post-process is live —
  // respawnStream() would kill the current stream and race to bring a
  // new one up, leaving the HUD stuck / audio split across two engines.
  if (isRecording || isProcessing) {
    return { ok: false, reason: 'busy', engine: currentEngine() };
  }
  const cfg = loadConfig();
  const allowed = ['apple', 'whisper.cpp', 'openai', 'whisperkit'];
  // Sanitiser fallback matches the first-boot default in currentEngine().
  // autoFallbackFromAppleOnCrash() still catches the rare case where Apple
  // Speech is configured but its helper won't come up.
  cfg.engine = allowed.includes(engine) ? engine : 'apple';
  saveConfig(cfg);
  respawnStream();
  return { ok: true, engine: cfg.engine };
});

ipcMain.handle('get-openai-key', () => {
  // Return just a presence/source hint to the renderer, never the secret
  // itself. The API key is used inside main.js only — exposing its value
  // over IPC would let any compromised renderer exfiltrate it.
  //
  // Crucially: do NOT probe safeStorage.isEncryptionAvailable() unconditionally.
  // On macOS the first call to that API touches the "Electron Safe Storage"
  // Keychain item, and under a fresh Developer ID signing identity the OS
  // prompts the user to allow the app to read the keychain. Users who have
  // never configured an OpenAI API key were getting that prompt on every
  // launch just because the dashboard's OpenAI pane loaded this status.
  // Short-circuit when there is no stored key and no env-var override, and
  // only touch Keychain when the information actually matters.
  const cfg = loadConfig();
  const fromEnv = Boolean((process.env.OPENAI_API_KEY || '').trim());
  const hasStoredKey = Boolean(cfg.openaiKeyEnc) || Boolean(cfg.openaiKey);
  if (!hasStoredKey && !fromEnv) {
    return {
      hasKey: false,
      fromEnv: false,
      encrypted: false,
      legacyPlaintext: false,
      encryptionAvailable: true, // assume true; probe lazily when saving
    };
  }
  const hasKey = Boolean(currentOpenAiKey());
  return {
    hasKey,
    fromEnv,
    encrypted: Boolean(cfg.openaiKeyEnc),
    legacyPlaintext: Boolean(cfg.openaiKey && !cfg.openaiKeyEnc),
    encryptionAvailable: encryptionAvailable(),
  };
});

ipcMain.handle('set-openai-key', (_e, key) => persistOpenAiKey(key));

ipcMain.handle('get-openai-model', () => currentOpenAiModel());

ipcMain.handle('get-ui-locale', () => ({
  locale: currentUiLocale(),
  supported: i18n.LOCALES,
  labels: i18n.LOCALE_LABELS,
}));

// Theme preference — 'system' | 'light' | 'dark'. Stored in config.json
// so it persists across launches. The renderer applies this via a class
// on <html>; 'system' leaves no class so CSS @media follows the OS.
const THEME_OPTIONS = ['system', 'light', 'dark'];
ipcMain.handle('get-theme', () => {
  const cfg = loadConfig();
  return THEME_OPTIONS.includes(cfg.theme) ? cfg.theme : 'system';
});
ipcMain.handle('set-theme', (_e, theme) => {
  const cfg = loadConfig();
  if (THEME_OPTIONS.includes(theme) && theme !== 'system') cfg.theme = theme;
  else delete cfg.theme;
  saveConfig(cfg);
  return { ok: true, theme: cfg.theme || 'system' };
});

// Onboarding completion flag. Tracked in config.json so it survives DMG
// re-installs (the config dir is keyed by bundle id, not version). First
// launch of a fresh install has no config.json, so the key is missing,
// and the renderer shows the overlay.
ipcMain.handle('get-onboarding-done', () => {
  const cfg = loadConfig();
  return Boolean(cfg.onboardingDone);
});
ipcMain.handle('set-onboarding-done', (_e, done) => {
  const cfg = loadConfig();
  if (done) cfg.onboardingDone = true;
  else delete cfg.onboardingDone;
  saveConfig(cfg);
  return { ok: true };
});

// Onboarding step 3 "tap your hotkey" test: renderer puts main into a
// suppressed mode where handleFnPress does NOT start a recording. We just
// forward the detection event so the onboarding UI can show "✓ detected".
let onboardingHotkeyTest = false;
ipcMain.handle('set-onboarding-hotkey-test', (_e, enabled) => {
  onboardingHotkeyTest = Boolean(enabled);
  return { ok: true };
});
ipcMain.handle('set-ui-locale', (_e, loc) => {
  const cfg = loadConfig();
  if (i18n.LOCALES.includes(loc)) cfg.uiLocale = loc;
  else delete cfg.uiLocale;
  saveConfig(cfg);
  return { ok: true, locale: currentUiLocale() };
});
ipcMain.handle('set-openai-model', (_e, name) => {
  const cfg = loadConfig();
  if (OPENAI_MODELS.includes(name)) cfg.openaiModel = name;
  else delete cfg.openaiModel;
  saveConfig(cfg);
  return { ok: true, model: currentOpenAiModel() };
});

ipcMain.handle('get-engine', () => currentEngine());

ipcMain.handle('get-ollama-model', () => {
  const cfg = loadConfig();
  return cfg.ollamaModel || 'gemma3:4b';
});

ipcMain.handle('set-ollama-model', (_e, name) => {
  const cfg = loadConfig();
  if (name) cfg.ollamaModel = name;
  else delete cfg.ollamaModel;
  saveConfig(cfg);
  return { ok: true, model: cfg.ollamaModel || null };
});

function respawnStream() {
  if (transcribeStream) {
    try { transcribeStream.kill('SIGTERM'); } catch {}
  }
  transcribeStreamRestarts = 0;
  transcribeStreamReady = false;
  setTimeout(startTranscribeStream, 300);
}

function autoFallbackFromAppleOnCrash() {
  // If Apple Speech engine is selected but its helper won't stay up (common
  // case: running in dev mode from a parent process whose Info.plist lacks
  // NSSpeechRecognitionUsageDescription) we silently flip back to
  // WhisperKit so the user isn't stranded with no working engine.
  const cfg = loadConfig();
  if (cfg.engine !== 'apple') return;
  cfg.engine = 'whisperkit';
  saveConfig(cfg);
  if (mainWindow) {
    safeSend(mainWindow,'toast', tr('toast.engineAppleFallback'));
  }
  transcribeStreamRestarts = 0;
  setTimeout(startTranscribeStream, 300);
}

ipcMain.handle('get-hotkey', () => currentHotkey());

ipcMain.handle('set-language', (_e, lang) => {
  const cfg = loadConfig();
  cfg.language = lang || 'ko-KR';
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('get-language', () => {
  const cfg = loadConfig();
  return cfg.language || 'ko-KR';
});

ipcMain.handle('get-mode', () => {
  const cfg = loadConfig();
  return cfg.mode || 'off';
});
ipcMain.handle('set-mode', (_e, mode) => {
  const cfg = loadConfig();
  cfg.mode = mode || 'off';
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('get-tone', () => {
  const cfg = loadConfig();
  return cfg.tone || 'neutral';
});
ipcMain.handle('set-tone', (_e, tone) => {
  const cfg = loadConfig();
  cfg.tone = tone || 'neutral';
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('get-translate-target', () => {
  const cfg = loadConfig();
  return cfg.translateTarget || 'English';
});
ipcMain.handle('set-translate-target', (_e, target) => {
  const cfg = loadConfig();
  cfg.translateTarget = target || 'English';
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
