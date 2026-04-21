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

  if (process.env.LISTENK_DEBUG === '1' || process.env.TYPELESS_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Mirror renderer console to the terminal so a plain `npm start` surfaces
  // client-side logs without opening DevTools. Helpful for chasing down
  // renderer-only issues like the first-run banner state.
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    const tag = level === 2 ? 'warn' : level === 3 ? 'error' : 'log';
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
}

const HUD_WIDTH = 260;
const HUD_HEIGHT = 64;

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
    },
  });

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hudWindow.loadFile('hud.html');
}

function showHud(state) {
  if (!hudWindow) return;
  // Re-anchor to the screen containing the cursor every time the HUD is
  // summoned — fixes multi-monitor setups where the HUD would otherwise
  // always appear on the primary display regardless of where the user is
  // looking.
  positionHudOnActiveScreen();
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

function currentEngine() {
  const cfg = loadConfig();
  const e = cfg.engine;
  if (e === 'apple' || e === 'whisper.cpp' || e === 'openai' || e === 'whisperkit') return e;
  return 'apple';
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
      reason: '이 플랫폼에서는 safeStorage 암호화를 사용할 수 없습니다.',
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

function recordTranscribeStat({ engine, model, audioSec }) {
  if (!engine) return;
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
    args = ['--stream', '--model-dir', model, '--language', 'auto'];
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
        mainWindow.webContents.send('toast', '전사 엔진이 비정상 종료됐습니다 — 재시작 중');
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
      if (mainWindow) {
        mainWindow.webContents.send('toast', '전사 엔진 준비됨');
        mainWindow.webContents.send('stream-ready');
      }
      break;
    case 'partial':
      if (mainWindow) mainWindow.webContents.send('stream-partial', event.text || '');
      // HUD live-text is gated by the user's "실시간 표시" preference —
      // when off, we still stream internally (so we can re-transcribe on
      // stop) but the pill stays on its waveform animation instead of
      // flashing partial text.
      if (hudWindow && hudWindow.isVisible() && currentStreamingEnabled()) {
        hudWindow.webContents.send('hud-partial', event.text || '');
      }
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
  return cfg.mode || 'off';
}

function listWhisperKitModels() {
  const root = resPath('models', 'whisperkit');
  if (!fs.existsSync(root)) return [];
  try {
    return fs
      .readdirSync(root)
      .filter((n) => {
        try {
          return fs.statSync(path.join(root, n)).isDirectory();
        } catch { return false; }
      })
      .sort();
  } catch {
    return [];
  }
}

function findWhisperKitModel() {
  const root = resPath('models', 'whisperkit');

  // Honour explicit user override before falling back to auto-pick.
  const cfg = loadConfig();
  if (cfg.whisperKitModel) {
    const explicit = path.join(root, cfg.whisperKitModel);
    if (fs.existsSync(explicit)) return explicit;
  }

  // Default preference: large-v3-turbo first (the bundled default). Turbo
  // distills decoder layers so it's ~2x faster with minimal accuracy loss
  // on English; non-English (esp. Korean) is slightly weaker than full
  // large-v3, so we still fall back to non-turbo if present. Small/base
  // variants rank last since they exist only as a low-RAM escape hatch.
  const preferred = [
    'openai_whisper-large-v3-v20240930_turbo_632MB', // bundled default (turbo)
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
  if (buf.length < 44 + 16000 * 0.2 * 2) {
    throw new Error('녹음이 너무 짧습니다.');
  }

  const tmpFile = path.join(os.tmpdir(), `listenk_${Date.now()}.wav`);
  await fs.promises.writeFile(tmpFile, buf);
  const lang = (language || '').split('-')[0] || 'auto';
  const engine = currentEngine();

  // whisper.cpp path: whisper-cli + ggml model.
  if (engine === 'whisper.cpp') {
    const whisperBin = findWhisperBin();
    const ggmlModel = findGgmlModel();
    if (!whisperBin) {
      fs.unlink(tmpFile, () => {});
      throw new Error('whisper-cli 바이너리가 없습니다. npm run build:whisper 또는 brew install whisper-cpp');
    }
    if (!ggmlModel) {
      fs.unlink(tmpFile, () => {});
      throw new Error('ggml 모델이 없습니다. npm run model:ggml:base');
    }
    return new Promise((resolve, reject) => {
      execFile(
        whisperBin,
        ['-m', ggmlModel, '-f', tmpFile, '-l', lang, '-nt', '-np'],
        { maxBuffer: 20 * 1024 * 1024 },
        (err, stdout, stderr) => {
          fs.unlink(tmpFile, () => {});
          if (err) reject(new Error(`whisper.cpp 실패: ${stderr || err.message}`));
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
      throw new Error('OpenAI API 키가 없습니다. 엔진 페이지에서 입력하거나 OPENAI_API_KEY 환경변수를 설정하세요.');
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
        throw new Error(`OpenAI ${res.status}: ${detail}`);
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
    throw new Error('전사 엔진 또는 모델 누락. npm run build:transcribe && npm run model:whisperkit');
  }
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

ipcMain.handle('set-whisper-model', (_e, name) => {
  const cfg = loadConfig();
  if (name) cfg.whisperKitModel = name;
  else delete cfg.whisperKitModel;
  saveConfig(cfg);
  respawnStream();
  return { ok: true };
});

ipcMain.handle('set-engine', (_e, engine) => {
  const cfg = loadConfig();
  const allowed = ['apple', 'whisper.cpp', 'openai', 'whisperkit'];
  cfg.engine = allowed.includes(engine) ? engine : 'apple';
  saveConfig(cfg);
  respawnStream();
  return { ok: true, engine: cfg.engine };
});

ipcMain.handle('get-openai-key', () => {
  // Return just a presence/source hint to the renderer, never the secret
  // itself. The API key is used inside main.js only — exposing its value
  // over IPC would let any compromised renderer exfiltrate it.
  const cfg = loadConfig();
  const fromEnv = Boolean((process.env.OPENAI_API_KEY || '').trim());
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
    mainWindow.webContents.send('toast', 'Apple Speech 엔진 초기화 실패 — WhisperKit 으로 전환했습니다 (설치된 Listen K.app 에서만 Apple 엔진 정상 동작)');
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
