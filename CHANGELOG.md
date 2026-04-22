# Changelog

All notable changes to Listen K are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

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

## [0.3.0] — 2026-04

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

[Unreleased]: https://github.com/ibank/ListenK/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/ibank/ListenK/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ibank/ListenK/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ibank/ListenK/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/ibank/ListenK/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/ibank/ListenK/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/ibank/ListenK/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/ibank/ListenK/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ibank/ListenK/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ibank/ListenK/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ibank/ListenK/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ibank/ListenK/releases/tag/v0.1.0
