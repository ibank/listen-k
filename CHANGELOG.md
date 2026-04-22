# Changelog

All notable changes to Listen K are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Theme switcher: System / Light / Dark, applied to the main window and the
  tray popover.
- Ollama model manager page with a "Ready" state in the title bar.
- Strategy docs: [docs/monetization.md](docs/monetization.md),
  [docs/open-source-checklist.md](docs/open-source-checklist.md).
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

[Unreleased]: https://github.com/ibank/ListenK/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ibank/ListenK/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ibank/ListenK/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ibank/ListenK/releases/tag/v0.1.0
