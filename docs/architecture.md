---
updated: 2026-04-22
scope: Listen K — contributor-facing architecture overview
audience: new contributors, security reviewers, maintainers making cross-cutting changes
---

# Architecture

This document is for people who want to **change** Listen K, not just use it.
Read [README.md](../README.md) first for the user-facing description.

Listen K is an Electron app (CommonJS main process) that drives four sandboxed
Swift helpers over stdio. The central idea is that the **main process is the
single source of truth** for app state, and every renderer surface (dashboard,
HUD, tray popover) is a thin reflection pushed via IPC.

## 1. Process topology

```
                       ┌──────────────────────────────────────────┐
                       │              main.js (Node)              │
                       │                                          │
                       │  config store · IPC routing · engine     │
                       │  selection · focus snapshot · history +  │
                       │  stats · timers · tray + windows         │
                       └──────────────────────────────────────────┘
                           │           │          │         │
                           ▼           ▼          ▼         ▼
        BrowserWindow (3×)      child_process spawn (4×)
        ┌──────────────┐       ┌──────────────────────────┐
        │ index.html   │       │ bin/fn-listener          │  Swift
        │ renderer.js  │       │  (CGEventTap)            │  CGEventTap
        ├──────────────┤       ├──────────────────────────┤
        │ hud.html     │       │ bin/transcribe-helper    │  WhisperKit
        │ hud.js       │       │  (--stream / --audio)    │  Swift Package
        ├──────────────┤       ├──────────────────────────┤
        │ tray.html    │       │ bin/focus-helper         │  NSWorkspace
        │ tray.js      │       ├──────────────────────────┤
        └──────────────┘       │ bin/paste-helper         │  AXUIElement +
                               │  (--check / <bundle>)    │  CGEventPost ⌘V
                               └──────────────────────────┘
                                    │
                                    ▼
                             ┌──────────────────┐
                             │ Ollama (optional)│  HTTP localhost:11434
                             │ OpenAI (BYOK)    │  HTTPS (user key)
                             └──────────────────┘
```

Each helper is a **separate binary** so permission scopes are narrow and a
misbehaving helper cannot crash the UI:

| Helper | Why separate | Permission it asks for |
|---|---|---|
| `fn-listener` | CGEventTap must run with special rights and stays up for the app lifetime | Accessibility / Input Monitoring |
| `transcribe-helper` | WhisperKit + Metal GPU; heavy to cold-start | Microphone |
| `focus-helper` | Reads / restores frontmost app around a paste cycle | None (standard NSWorkspace) |
| `paste-helper` | Synthesises ⌘V into the target app | Accessibility (AXIsProcessTrusted) |

The main process spawns these as child processes with strict `stdio: ['pipe',
'pipe', 'pipe']` channels and kills them with SIGTERM on `will-quit`.

---

## 2. Renderer surfaces

There are **three renderers**, each backed by its own preload bridge:

### 2.1 Dashboard (`index.html` + `renderer.js`)
- Main settings surface: engine, language, hotkey, theme, post-processing mode
- Pages: Status, Engines, Post-processing, Ollama, Stats, History, Onboarding
- Preload bridge: `window.listenk` — broadest API (40+ methods)

### 2.2 HUD (`hud.html` + `hud.js`)
- Floating, frameless, always-on-top; shown during recording / processing
- Preload bridge: `window.listenkHud` — narrow: `cancel()`, `confirm()`,
  `onState/onPartial/onReset/onContext` listeners
- Positioned over the focused display by the main process

### 2.3 Tray popover (`tray.html` + `tray.js`)
- Click on the menu bar icon opens a small BrowserWindow styled as a popover
- Preload bridge: `window.listenkTray` — `cmd({cmd, ...})` for actions,
  `onSnapshot(cb)` receives pushed state + recents + locale + theme

All three preloads use `contextIsolation: true` and `nodeIntegration: false`.
Renderers can only do what the preload explicitly exposes.

---

## 3. IPC channel taxonomy

Channels group by intent. Every `invoke` below has a matching `ipcMain.handle`
in `main.js`.

### 3.1 Recording lifecycle
- `transcribe` — batch transcribe a WAV buffer (fallback path when streaming
  is disabled)
- `set-state` — renderer reports `{recording, processing, pasted}` to update
  the tray icon and HUD
- `hud-cancel` / `hud-confirm` — HUD button clicks
- `tray-cmd` — `{cmd: 'record' | 'open' | 'history' | 'stats' | 'quit' |
  'paste-recent'}` from the tray popover
- Pushed **from main**: `toggle-record`, `cancel-record`, `hud-state`,
  `hud-partial`, `hud-reset`, `hud-context`, `stream-partial`, `stream-final`,
  `stream-ready`, `stream-error`

### 3.2 Settings (get/set pairs)
`get-engine` / `set-engine`, `get-hotkey` / `set-hotkey`, `get-language` /
`set-language`, `get-mode` / `set-mode`, `get-tone` / `set-tone`,
`get-streaming` / `set-streaming`, `get-theme` / `set-theme`, `get-ui-locale` /
`set-ui-locale`, `get-openai-key` / `set-openai-key` (Keychain-encrypted),
`get-openai-model` / `set-openai-model`, `get-ollama-model` /
`set-ollama-model`, `get-translate-target` / `set-translate-target`

All persisted to `~/Library/Application Support/Listen K/config.json`.

### 3.3 Data (history, stats, models)
- `history-list`, `history-append`, `history-clear`
- `stats-get`, `stats-record-transcribe`, `stats-record-ollama`, `stats-clear`
- `list-whisper-models`, `set-whisper-model`
- `ollama-list`, `ollama-pull`, `ollama-pull-cancel`, `ollama-delete` +
  pushed `ollama-pull-progress` events

### 3.4 OS bridges
- `request-mic` — triggers AVAudioSession permission prompt
- `open-url` — `shell.openExternal`
- `show-in-finder` — `shell.showItemInFolder`
- `clipboard-write` — `clipboard.writeText`
- `paste-text` — invokes `bin/paste-helper` on the saved frontmost bundle

### 3.5 Onboarding
- `get-onboarding-done` / `set-onboarding-done`
- `set-onboarding-hotkey-test` → pushed `onboarding-hotkey-fired` when the
  hotkey listener sees the test tap

---

## 4. Engine selection

```
┌──── renderer sends set-engine ────┐
│                                   ▼
│                        ┌─────────────────────┐
│                        │ currentEngine()     │
│                        │ switch on `engine`  │
│                        └─────────────────────┘
│                                   │
│       ┌───────────────────┬───────┼───────────┬──────────────────┐
│       ▼                   ▼       ▼           ▼                  ▼
│  whisperkit          apple-speech  whisper-cpp   openai (BYOK)
│  (default)                                          HTTPS → OpenAI
│                                                     /v1/audio/transcriptions
│  spawns transcribe-helper --stream   SFSpeechRecognizer     whisper.cpp binary
│  respawnStream() on settings change
```

Rules enforced in `main.js`:
- Engine switch is **refused while recording or processing** (returns
  `{ok: false, reason: 'busy'}` so the renderer rolls back its selector).
- Each engine has a `collectStatus()` branch that reports "ready" once the
  helper emits `{"type":"ready"}`.
- `respawnStream()` tears down the current helper cleanly before starting a
  new one; audio frames in flight are discarded.

---

## 5. Persistence

| Path | Owner | Format |
|---|---|---|
| `~/Library/Application Support/Listen K/config.json` | `loadConfig` / `saveConfig` | JSON |
| `~/Library/Application Support/Listen K/history.json` | `loadHistory` / `appendHistory` | JSON array |
| `~/Library/Application Support/Listen K/stats.json` | `loadStats` / `saveStats` | JSON |
| `~/Library/Application Support/Listen K/.first-run-done` | onboarding marker | empty |
| `~/Library/Caches/transcribe-helper/` | WhisperKit Core ML compile cache | Apple private |
| OpenAI API key | `safeStorage.encryptString` → Keychain | base64 blob in config |

Config edits are **always round-trip**: read, mutate in memory, write back.
There is no in-memory `config` global — every handler calls `loadConfig()`.

---

## 6. Localisation flow

`i18n.js` is an IIFE that exposes `window.i18n.t(key, params)` and
`window.i18n.setLocale(loc)`. Four locales live in one file:
`ko` (Korean, source) → `en` → `ja` → `zh-CN`.

- Renderer: reads `get-ui-locale` on boot, listens for `set-ui-locale`
  echoes, and calls `window.i18n.setLocale` then re-renders the DOM.
- HUD: has its own small `L10N` map in `hud.js` keyed by the same locale code.
- Tray: same pattern in `tray.js`.
- Main process: has a `tr(key, params)` helper that uses `currentUiLocale()`
  for toast notifications and error strings.

**Adding a locale** requires touching 4 places: `i18n.js` (main map), `hud.js`
(HUD labels), `tray.js` (tray labels), and `renderer.js` (if the locale list
is used for a dropdown).

---

## 7. Lifecycle and shutdown

```
app 'ready'          → createDashboardWindow + createTray + spawn fn-listener + spawn transcribe-helper
app 'before-quit'    → set app.isQuitting = true
app 'will-quit'      → unregisterAll globalShortcut
                       clear hudDoneTimer / hudSafetyTimer
                       fnListener.kill('SIGTERM')
                       transcribeStream.stdin.write('{"cmd":"quit"}\n')
                       transcribeStream.kill('SIGTERM')
```

Transcribe helper respects `{"cmd":"quit"}` on stdin; fn-listener terminates
on SIGTERM.  If the transcribe helper exits with a non-SIGTERM/non-zero code,
`crashCount++` and a backoff-respawn attempts up to N times, then surfaces a
`toast.engineCrashMax`.

---

## 8. Security boundary

- **Accessibility** is trusted for `fn-listener` + `paste-helper`. The app
  never reads arbitrary UI text; it only *writes* ⌘V.
- **Input Monitoring** is required for CGEventTap (fn-listener only).
- **Microphone** is scoped to transcribe-helper which reads directly from
  AVAudioEngine.
- Bundle IDs handed to `focus-helper` and `paste-helper` are **filtered
  through `safeBundleId()`** (`/^[a-zA-Z0-9._-]{1,255}$/`) before execFile.
- OpenAI key is stored via `safeStorage` (Keychain-backed). Renderers never
  see the plaintext key — they only get `{set: true, masked: "sk-…abcd"}` or
  the last-set bool.

For the full threat model see [SECURITY.md](../SECURITY.md).

---

## 9. Where to start if you want to change X

| Goal | Start here |
|---|---|
| Add a new engine | `currentEngine()` switch in `main.js` + `setEngine` IPC + renderer engine-card UI |
| Add a new locale | `i18n.js` (copy `en` block) + `hud.js` + `tray.js` + language dropdown in `renderer.js` |
| Change HUD appearance | `hud.css` + state machine in `hud.js` — **don't move UI logic into main** |
| Add a post-processing mode | `postProcess()` in `main.js` + `get-mode`/`set-mode` accepting new value + renderer mode picker |
| Add a hotkey | `HOTKEY_MODES` + `fn-listener.swift` recognisers + `set-hotkey` validation |
| Add telemetry | Don't, without explicit opt-in. See [SECURITY.md](../SECURITY.md) "out of scope". |

---

## 10. Non-goals (today)

- **Windows / Linux port.** The Swift helpers are Apple-only and rewriting them
  against Windows UIA / Linux AT-SPI is a separate project.
- **Intel Mac support.** WhisperKit Metal path targets Apple Silicon.
- **Cloud transcription by default.** OpenAI is opt-in BYOK; Apple Speech is
  on-device; WhisperKit is local.
- **Mobile (iOS).** Out of scope. Sindre's [Aiko](https://sindresorhus.com/aiko)
  is the reference app for iOS Whisper.

If you want to change any of the above, open a [discussion](https://github.com/ibank/ListenK/discussions)
before writing code.
