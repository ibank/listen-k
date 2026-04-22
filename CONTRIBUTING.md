# Contributing to Listen K

Thanks for your interest in Listen K. This is a solo-maintained indie project,
so contributions are welcome but expect slower review cadence than a funded
OSS team.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Table of contents

1. [Before you open an issue](#before-you-open-an-issue)
2. [Development setup](#development-setup)
3. [Project layout](#project-layout)
4. [Making a change](#making-a-change)
5. [Commit style · DCO](#commit-style--dco)
6. [Adding or updating a translation](#adding-or-updating-a-translation)
7. [Pull request checklist](#pull-request-checklist)
8. [What is in scope, what is not](#what-is-in-scope-what-is-not)

---

## Before you open an issue

- Search existing [issues](https://github.com/ibank/listen-k/issues).
- Purchase, refund, and license-key questions go to hello@listenk.com, not
  GitHub issues.
- For suspected security vulnerabilities, follow [SECURITY.md](SECURITY.md)
  — please do **not** open a public issue.

## Development setup

Requirements:

- macOS 14 (Sonoma) or newer, Apple Silicon
- Node.js 20.x LTS
- Xcode 15 or newer (for Swift helpers)
- (optional) Ollama, cmake — only if working on those paths

```bash
git clone https://github.com/ibank/listen-k.git
cd listen-k
npm install
npm run build:helper          # Swift helpers: fn-listener, paste-helper, focus-helper
npm run build:transcribe      # transcribe-helper (WhisperKit)
npm run model:whisperkit      # downloads the default Whisper model (~632 MB)
npm start
```

Without Developer ID signing secrets, `npm run dist:dir` produces an ad-hoc
signed bundle — fine for local testing, not for redistribution.

## Project layout

- `main.js` — Electron main process (IPC, window lifecycle, transcribe stream)
- `preload*.js` — context-bridge exposing a narrow `window.listenk*` API
- `renderer.js` / `hud.js` / `tray.js` — three renderer surfaces (dashboard, HUD, tray popover)
- `i18n.js` — four-locale IIFE with a `t(key, params)` helper
- `native/transcribe-helper/` — Swift helper wrapping WhisperKit
- `native/translate-helper/` — Swift helper for MLX-based translation
- `scripts/` — build, model download, smoke, packaging hooks
- `docs/` — strategy and internal notes (not end-user documentation)

## Making a change

- Keep changes focused — one concern per PR.
- Match the surrounding code style. There is no formatter configured; just
  don't reflow unrelated code.
- Run `node -c main.js && node -c renderer.js && node -c i18n.js` after any
  main-process or renderer change.
- Run `bash scripts/smoke.sh` if you touched helpers, IPC, or the transcribe
  pipeline. Model-dependent steps auto-skip when the model is absent.
- UI changes: verify in the browser (or `npm start`) across ko/en/ja/zh-CN.

## Commit style · DCO

We use the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA. Every commit must carry a `Signed-off-by` line asserting you
wrote the change or have the right to contribute it. `git commit -s` adds it
automatically.

Commit messages: imperative mood, short subject (<72 chars), optional body
explaining the why.

```
Fix HUD safety timer leak on will-quit

The safety timer kept the app alive for up to 30s after Quit.
Clear it (and the done timer) alongside the fn-listener subprocess
teardown. Signed-off-by: Your Name <you@example.com>
```

## Adding or updating a translation

Listen K ships with four locales: `ko`, `en`, `ja`, `zh-CN`. Each lives inside
the `MESSAGES` map in `i18n.js`. To add a new locale:

1. Copy the `en` block verbatim and rename the outer key (e.g. `'es'`).
2. Translate every value. Keep `{placeholder}` tokens unchanged.
3. Add a matching block to `tray.js` (`STATE_LABELS`, `L10N`, `HOTKEY_LABEL`)
   and `hud.js` if it has its own label map.
4. Add your locale to `SUPPORTED_LOCALES` in `renderer.js` if applicable.
5. Open a PR with screenshots in at least the new locale.

To update an existing translation, change the relevant strings and open a
PR — no coordination with the maintainer needed. Formatting errors in
placeholders will surface in review.

## Pull request checklist

Before opening a PR, confirm:

- [ ] Commits are signed off (DCO)
- [ ] `node -c` passes on all changed JS files
- [ ] `bash scripts/smoke.sh` passes (or documents why it can't in your env)
- [ ] UI changes tested in at least two locales (ko + en)
- [ ] No new third-party dependency without a license check — see
      [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)
- [ ] No API keys, model files, or `dist/` artifacts added
- [ ] [CHANGELOG.md](CHANGELOG.md) `[Unreleased]` updated for user-visible
      changes

## What is in scope, what is not

**In scope**
- macOS 14+ on Apple Silicon
- Korean, English, Japanese, Simplified Chinese UI
- Local-first transcription (WhisperKit, whisper.cpp, Apple Speech)
- Optional BYOK OpenAI and local Ollama post-processing

**Not in scope (will likely be declined)**
- Windows, Linux, iOS, or Intel Mac ports
- Sending transcripts to third-party services by default
- Telemetry or analytics without explicit opt-in
- Bundling proprietary models or assets without a clear license

Unsure whether an idea fits? Open a [discussion](https://github.com/ibank/listen-k/discussions)
before investing time in code.
