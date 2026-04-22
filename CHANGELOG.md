# Changelog

All notable changes to Listen K are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.6.0] — 2026-04-23

### Added
- **Auto-update** via `electron-updater`. On launch the app pulls the
  latest signed + notarised DMG from the public GitHub Releases feed,
  downloads it in the background, and installs it the next time the
  user quits. First check fires 10 seconds after launch; subsequent
  checks every 4 hours while the app stays open. A
  `check-for-updates` IPC handler exposes a manual re-check for a
  future "Check for updates" button. Toasts surface
  `toast.updateAvailable` and `toast.updateReady` in all four
  locales. Silently no-ops in development (`app.isPackaged === false`).

### Changed
- `electron-updater` added as the first production npm dependency
  (MIT; transitive deps `argparse` Python-2.0 and `sax`
  BlueOak-1.0.0 both OSI-approved permissive, added to the CI
  license-allowlist so `license-checker` stays green).
- `package.json.build.publish` now pins
  `provider: github`, `owner: ibank`, `repo: listen-k`,
  `releaseType: draft` — electron-builder uses this both to drive
  upload and to emit `latest-mac.yml` for the updater to read.
- `release.yml` switched from the manual two-step flow
  (`--publish never` + `gh release create`) to
  `--publish always`, which creates the Release, uploads the DMG +
  blockmap + `latest-mac.yml` in one shot. The follow-up `gh release
  upload` step keeps the SHA256SUMS addition.

## [0.5.6] — 2026-04-23

### Changed
- Tmp WAV file used by the batch-transcribe fallback is now named with
  `crypto.randomBytes` rather than `Date.now()`. On macOS the path is
  under the per-user `$TMPDIR` so the old pattern was never actually
  race-able by another user, but a predictable same-user path is a
  gratuitous invariant to lose.
- `scripts/after-pack.js` switched from `execSync` with shell-interpolated
  strings to `execFileSync` with array args. `productFilename` comes from
  electron-builder today, so no concrete injection path existed, but the
  array form is simply safer hygiene.
- `.github/dependabot.yml` now covers a third ecosystem: `swift`, rooted at
  `native/transcribe-helper`. Transitive Swift deps (WhisperKit →
  swift-transformers → swift-jinja / swift-crypto / yyjson /
  swift-collections + swift-argument-parser) will get weekly update
  PRs like the npm + Actions ones already do.
- `scripts/migrate-from-ad-hoc.sh` header now recommends `curl ... -o
  migrate.sh && less migrate.sh && bash migrate.sh` over the direct
  `curl | bash` pattern. The script content is unchanged; just a safer
  default instruction.

### Fixed
- Stats IPC handlers (`stats-record-transcribe`) now whitelist the
  `engine` value against `['apple', 'whisper.cpp', 'openai',
  'whisperkit']` before using it as an object key. Prior code would
  accept arbitrary renderer-supplied strings (including `__proto__`,
  `constructor`) into `stats.counters.callsByEngine[engine]`; the
  practical blast radius was pollution of the local `stats.json`, not
  an escape into the main process, but dropping bogus keys is free.
- Removed dead IPC + dead pushes from main.js:
  - `ipcMain.handle('show-window', ...)` had no preload bridge and no
    caller — deleted.
  - `stream-started` / `stream-stopping` were pushed to the renderer
    but no renderer ever registered a listener — removed both sends.
  - `fnListenerReady` was assigned on READY and exit but never read
    downstream — the variable and its three assignment sites are gone.
- Dropped the `--bundle <frontmost>` flag from `paste-helper`
  invocation. `paste-helper.swift` reads `args[1] == "--check"` and
  ignores every other argument; the flag was pure noise. focus-helper
  has already restored the target frontmost before we call paste, so
  nothing behavioural changed.
- `tray.html` no longer shows a `⌘Q` shortcut glyph next to the Quit
  button. No accelerator was actually registered for that key, so the
  glyph was misleading. If/when we add a real accelerator, the glyph
  comes back with it.
- Removed a stale comment in `renderer.js` that referenced the literal
  Korean toast string `"전사 엔진 준비됨"` — the banner-hide trigger
  stopped string-matching it when the toast got localised back in
  v0.2.0.
- CHANGELOG `[0.3.0]` date format aligned with every other entry
  (`2026-04` → `2026-04-22`).
- `scripts/smoke.sh` now checks for
  `bin/apple-speech-helper.app/Contents/MacOS/apple-speech-helper`
  alongside the other four helpers, so a broken Apple Speech build
  fails the smoke step instead of silently passing.
- `i18n.js` entry `'kpi.unitTimes': ''` for English now carries a
  one-line comment explaining that English has no count classifier and
  `withUnit()` intentionally hides the span when the value is empty.

## [0.5.5] — 2026-04-23

### Changed
- `docs/architecture.md` rewritten to match v0.5.x reality: helper count
  is 5 (added `apple-speech-helper.app` row), `open-url` IPC is gone,
  history file is `history.jsonl` (newline-delimited JSON) not
  `history.json`, the restart counter is `transcribeStreamRestarts` not
  `crashCount`, the `get-openai-key` return shape is the status object
  not `{set, masked}`, and the engine-selection diagram uses the real
  engine keys `apple` / `whisper.cpp`. New sections document the
  `safeSend` guard, the `--hf-cache` flag threaded through
  `transcribe-helper`, and the 600 ms `lastStopAt` cooldown between
  stop and the next start.
- `docs/release-procedure.md` no longer links to the internal
  `manual-*.md` runbooks (those are under local-only `ops/` and would
  404 on the public repo). Replaced with inline instructions.
- `package.json.description` now reflects the full engine set
  (WhisperKit / Apple Speech / whisper.cpp / OpenAI BYOK) and
  highlights first-class Korean / Japanese / Chinese.
- `SECURITY.md` supported-versions table bumped from `0.3.x` to
  `0.5.x`.
- `CONTRIBUTING.md` translation-flow instructions reference the real
  identifiers (`strings` / `LOCALES` in `i18n.js`) instead of
  non-existent `MESSAGES` / `SUPPORTED_LOCALES`.
- macOS usage-description strings in `package.json` `mac.extendInfo`
  and `native/apple-speech-helper-Info.plist` translated from Korean
  to English, so non-Korean users see an intelligible TCC prompt on
  first launch.
- `apple-speech-helper.swift` language map now includes `zh → zh-CN`
  alongside ko / en / ja.
- Onboarding banner title changed from "Two permissions, please" to
  "Three permissions, please" — the onboarding step has listed three
  rows (Microphone, Accessibility, Input Monitoring) since v0.3.0;
  the string lagged. Applied to all four locales.
- Ollama cleanup system prompt now has ko / en / ja / zh-CN variants
  selected based on the transcription language hint (`langSel.value`).
  Previously a Korean-only system prompt would tell the LLM (typically
  a small gemma3:4b) to "keep the original language", which smaller
  models tend to ignore — non-Korean users saw Korean artefacts in
  the cleaned output.
- `package.json.build.extraResources` now excludes `bin/translate-helper`
  from the DMG. The binary weighed ~30 MB and was never invoked by
  main.js — it shipped silently in every release since v0.2.0. The
  source stays in `native/translate-helper/` for future work.

## [0.5.4] — 2026-04-23

### Fixed
- Four READMEs advertised config keys that never matched the code. The
  `engine` cell said `apple-speech` / `whisper-cpp` but the accepted
  values are `apple` / `whisper.cpp` (silent fallback to `whisperkit`
  if you wrote the advertised strings). The `mode` cell listed
  `openai`, which is a separate BYOK engine, not a post-processing
  mode — the actual fourth option is `translate`. The UI-locale key
  was advertised as `locale`; code reads `uiLocale`. All four locale
  READMEs corrected.
- All four READMEs referenced `assets/demo.gif`, which does not exist
  in the repo — the `<p align="center">` block has been removed so
  the GitHub project page no longer renders a broken image. The
  block will come back once a real asset ships.
- `fn-listener` emits `READY mode=<hotkey>`, so `main.js`'s exact-match
  `t === 'READY'` check was a no-op on every launch. Changed to
  `t.startsWith('READY')`. (The `fnListenerReady` flag is currently
  unused downstream, so nothing user-visible changed — but the intent
  was broken.)
- `renderer.js` emitted a hardcoded Korean toast
  (`모델: <name> (재로딩 중)` / `자동 선택 (재로딩 중)`) when the
  Whisper model picker changed, bypassing the existing
  `toast.modelChange` / `toast.modelAuto` i18n keys. Fixed.
- The tray's right-click native fallback menu hardcoded bilingual
  Korean / English labels (`"창 열기 / Open window"`, `"🔴 녹음 중"`,
  etc.) regardless of the user's selected locale. Added `tray.state.*`
  and `tray.menu.*` keys across all four locales and routed
  `updateTrayMenu()` through `tr()`.
- Swift helpers (`transcribe-helper`, `apple-speech-helper`,
  `paste-helper`) emitted Korean-only error messages that surfaced
  directly in the renderer's status row for non-Korean users. Switched
  to English. A more-complete code-based localisation (where the Swift
  side emits stable codes and the JS side translates) is deferred to
  a future release.

## [0.5.3] — 2026-04-22

### Security
- Add a strict `Content-Security-Policy` meta on every renderer HTML
  (`index.html`, `hud.html`, `tray.html`). Default-src self, no remote
  script origins, `connect-src` locked to `http://localhost:11434`
  (Ollama) and `https://api.openai.com` (BYOK) on the dashboard and
  self-only on HUD / tray.
- Drop the Google Fonts `<link>` from `index.html`. `styles.css`
  already falls back to `-apple-system` / `SF Mono`, which ship with
  macOS — the external font request was both a boot-time network
  dependency and the only reason CSP `font-src` had to include remote
  origins.
- Enable the Chromium renderer sandbox on all three BrowserWindows
  (`mainWindow`, `hudWindow`, `trayWindow`). Each preload only uses
  `contextBridge` + `ipcRenderer`, both sandbox-safe, so this is a
  free hardening step.
- Add `setWindowOpenHandler`/`will-navigate` guards on all three
  BrowserWindows so a compromised renderer cannot `window.open(...)`
  a new BrowserWindow or navigate the current one away from the
  bundled `file://`.
- Remove the `open-url` IPC handler and its `window.listenk.openUrl`
  bridge entry — no renderer code ever called it, and exposing
  `shell.openExternal(<arbitrary string>)` over IPC would let a
  compromised renderer open `file://`, `smb://`, or custom-scheme
  URLs. Purpose-specific handlers like `open-settings-pane` remain
  because they hard-code the URL on the main side.
- Gate `show-in-finder` with an explicit prefix allowlist
  (`process.resourcesPath`, `app.getPath('userData')`, `/Applications`,
  and the repo root in dev). All renderer callers already pass
  main-supplied paths, so the guard is transparent — but it closes
  the handler as a generic filesystem-reveal primitive.

## [0.5.2] — 2026-04-22

### Fixed
- Rapid hotkey toggling no longer leaves the microphone "tangled" —
  the common symptom being a recording that captures silence (Whisper
  then hallucinates English filler like `" ♪"` / `"Thank you for
  watching."`) or a HUD that spins forever without text. Two linked
  fixes:
  - `main.js` flips `isProcessing = true` the moment the `stop`
    command is dispatched, instead of waiting for the renderer's
    `set-state` round-trip. Previously a second hotkey tap during
    that ~tens-of-ms window fell back into the start branch and
    fired a fresh `start` while the previous stream was still
    tearing down.
  - `transcribe-helper` enforces a 600 ms cooldown between
    `stop()` and the next `start()` so the detached
    `stopStreamTranscription` has time to release the shared
    `AudioProcessor` / AVAudioEngine before a new stream tries to
    stand it up. The race was most visible on the very first toggle
    after launch, where Core ML kernels are still JIT-compiling and
    teardown runs slowest.

## [0.5.1] — 2026-04-22

### Changed
- Bundle id renamed from `com.ibank.listenk` to `com.eazler.listenk` to
  match the Apple Developer Program legal entity (`eazler, inc`,
  Team ID `N6PC9VGB89`). The Mach-O signing identity and the Info.plist
  CFBundleIdentifier now both resolve under the same brand, which keeps
  the store listing, trademark, and support email on one namespace.
- Nested `apple-speech-helper.app` bundle id follows suit
  (`com.eazler.listenk.apple-speech-helper`).
- `main.js` `OWN_BUNDLE_ID` (used by the paste-helper's self-target
  guard) updated accordingly.

### Migration
- TCC treats the new bundle id as a brand-new app, so Microphone /
  Input Monitoring / Accessibility / Speech Recognition permissions
  have to be granted once more on upgrade. `scripts/migrate-from-ad-hoc.sh`
  now wipes state under BOTH the old `com.ibank.listenk` and new
  `com.eazler.listenk` namespaces and calls `tccutil reset` for both.
- User data at `~/Library/Application Support/listen-k/` is keyed by
  the npm package name, not the bundle id, so config / history / stats
  survive the rename untouched.

## [0.5.0] — 2026-04-22

### Changed
- Electron runtime upgraded from 31.7.7 to 41.2.2, bringing Chromium
  146 and Node 24. Verified against the full Developer ID + notarise
  + entitlements pipeline: boot completes in under 7 seconds, stream-
  ready event fires, WhisperKit loads, no runtime errors.
- GitHub Actions upgraded: `actions/checkout@v6`, `actions/setup-node@v6`
  (merged from Dependabot PRs #1 and #2).

### Fixed
- Migrated the `webContents.on('console-message', ...)` handler from
  the positional `(event, level, message)` signature to the
  `WebContentsConsoleMessageEventParams` object form. Electron 41 logs
  a deprecation warning on every launch against the old shape; the new
  form is cleaner and forward-compatible.

## [0.4.4] — 2026-04-22

### Fixed
- The "Listen K wants to use key 'Electron Safe Storage' in your keychain"
  prompt no longer fires for users who have never configured an OpenAI
  API key. The `get-openai-key` IPC handler used to call
  `safeStorage.isEncryptionAvailable()` unconditionally whenever the
  dashboard's OpenAI pane loaded; on macOS the first call to that API
  probes the Keychain, which under a fresh Developer ID signing identity
  surfaces an ACL prompt every launch. Short-circuit the handler when
  there is no stored key and no `OPENAI_API_KEY` env var, returning an
  optimistic `encryptionAvailable: true` that gets verified lazily at
  save time instead.

## [0.4.3] — 2026-04-22

### Fixed
- Uncaught `TypeError: Object has been destroyed` when a stream event (e.g.
  `stream-final` from `transcribe-helper`) arrives after the main dashboard
  window has been destroyed. The renderer references were kept around as
  stale pointers because `close` was handled but `closed` was never
  observed. Introduce a `safeSend(win, channel, ...)` helper that null-
  checks, `isDestroyed()`-checks, and try/catches the send; wire
  `closed` handlers on `mainWindow`, `hudWindow`, and `trayWindow` to
  null the refs the moment the window is actually torn down.

## [0.4.2] — 2026-04-22

### Fixed
- Stop triggering the "Listen K.app would like to access files in your
  Documents folder" TCC prompt on first launch. WhisperKit's transitive
  dependency swift-transformers defaults its `HubApi.downloadBase` to
  `~/Documents/huggingface/` when no explicit path is provided, and
  under Developer ID + hardened runtime macOS enforces Documents-folder
  TCC strictly (ad-hoc builds were exempted by a quirk, which is why
  this only surfaced after v0.4.0). Pass an explicit `--hf-cache` arg
  from `main.js` pointing at `app.getPath('userData')/huggingface-cache`
  and route it through `WhisperKitConfig(downloadBase:)` in
  `transcribe-helper`, so the tokenizer / config cache lives inside the
  app's own Application Support directory with no user-visible prompt.

## [0.4.1] — 2026-04-22

### Fixed
- Transcription engine is no longer stuck in the "preparing" state and the
  microphone permission prompt now actually appears on first launch of a
  Developer ID signed build. Under hardened runtime, TCC silently denies
  any microphone request from a binary that does not declare
  `com.apple.security.device.audio-input`; electron-builder's default
  entitlements only include the Electron runtime keys (`allow-jit`,
  `allow-unsigned-executable-memory`, `disable-library-validation`), so
  `transcribe-helper` and `apple-speech-helper` were blocked without any
  user-visible prompt. Ship a custom `build/entitlements.mac.plist` that
  adds `com.apple.security.device.audio-input` and
  `com.apple.security.automation.apple-events`, and wire it up via
  `mac.entitlements` + `mac.entitlementsInherit`.

## [0.4.0] — 2026-04-22

### Added
- Theme switcher: System / Light / Dark, applied to the main window and the
  tray popover.
- Ollama model manager page with a "Ready" state in the title bar.
- Strategy and pre-launch audit docs (maintainer-only; kept in a
  local `ops/` directory that is no longer tracked in git).
- Open-source release files: `LICENSE`, `THIRD_PARTY_LICENSES.md`,
  `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, CI workflows.

### Changed
- Engine switch is blocked while recording or processing; the renderer rolls
  back the selector if the main process declines.
- Hardcoded Korean error strings in `main.js` moved to the i18n table so they
  localise in en / ja / zh-CN.
- `package.json` now carries `author`, `license`, `repository`, `homepage`,
  and `bugs` metadata.

### Fixed
- Bundle IDs handed to `focus-helper` and `paste-helper` are now validated
  against a strict regex (`/^[a-zA-Z0-9._-]{1,255}$/`).
- `hudDoneTimer` and `hudSafetyTimer` are cleared on `app.will-quit` so they
  cannot fire during shutdown.

## [0.3.0] — 2026-04-22

### Added
- Page routing, OpenAI engine option, statistics page.
- Apple Speech as a selectable engine; set as default on supported systems.
- Polished onboarding overlay, sidebar reshuffle, tray popover redesign.

### Changed
- Main window UI refreshed: sidebar navigation, semantic settings groups,
  consistent field-row pattern.
- HUD state transitions smoothed; engine page gained a sub-group layout.

## [0.2.0]

### Added
- Full UI localisation across four languages (ko / en / ja / zh-CN), with
  live reload.
- Ollama-based translation as a post-processing mode.
- MLX translate-helper scaffold (wired but not yet user-facing).
- whisper.cpp as a third engine option alongside WhisperKit and Apple Speech.
- Bundled large-v3 non-turbo variant for the accuracy-first pick.

### Changed
- i18n wrapped in an IIFE to avoid script-scope collisions with
  `renderer.js`.
- Engine routing decoupled from the "실시간 표시" streaming toggle.
- Default Whisper model set to `base` for speed-first boot.

### Fixed
- Settings persistence across restart (full audit pass).
- WhisperKit stop detaches `stopStreamTranscription` so the helper cannot
  hang.

## [0.1.0]

Initial preview.

### Added
- Right-Shift double-tap global hotkey, HUD overlay, auto-paste into the
  focused app.
- WhisperKit transcription with the Whisper large-v3 turbo model (632 MB).
- Transcription history, smoke test harness, first-run banner.
- Light mode, multi-monitor HUD placement, arm64-only distribution.
- Optional Ollama post-processing with a rule-based fallback.

[Unreleased]: https://github.com/ibank/listen-k/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ibank/listen-k/compare/v0.5.6...v0.6.0
[0.5.6]: https://github.com/ibank/listen-k/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/ibank/listen-k/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/ibank/listen-k/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/ibank/listen-k/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/ibank/listen-k/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ibank/listen-k/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ibank/listen-k/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/ibank/listen-k/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/ibank/listen-k/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/ibank/listen-k/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/ibank/listen-k/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ibank/listen-k/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ibank/listen-k/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ibank/listen-k/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ibank/listen-k/releases/tag/v0.1.0
