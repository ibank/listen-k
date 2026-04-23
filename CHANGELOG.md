# Changelog

All notable changes to Listen K are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.7.5] — 2026-04-23

### Changed
- **Input Monitoring is no longer a required permission.** The
  hotkey helper (`fn-listener`) only ever subscribed to
  `.flagsChanged` events on a `listen-only` event tap, which macOS
  does *not* gate behind Input Monitoring — that permission
  protects keystroke content, not modifier state. The defensive
  `IOHIDCheckAccess` exit at the top of the helper was blocking
  startup even though the tap would have worked fine, and the
  onboarding / dashboard surfaced an "Input Monitoring: ✕"
  warning that was actively misleading. The gate is removed; the
  onboarding permission list and the dashboard hotkey-detection
  row are dropped. Users now grant only **Microphone +
  Accessibility** for a full first-run setup. `--check` on the
  helper remains for diagnostic callers that want the explicit
  TCC state. (Paste still needs Accessibility because
  `CGEvent.post` injects keystrokes — that protection path is
  unchanged.)
- **Ollama recommended-models list shows real download sizes.**
  The sidebar was rendering hand-transcribed size strings (e.g.
  `'3.4 GB'` from ollama.com/library) that drifted out of sync
  with what actually pulls. The renderer now fetches each
  model's manifest from `registry.ollama.ai` in the background,
  sums the layer bytes, and swaps in the exact size using the
  same `fmtBytes` formatter the installed-models list uses. The
  hardcoded strings remain as the first-paint fallback so the
  list doesn't flash placeholders, and results are cached for
  the lifetime of the renderer so repeat tab visits don't
  re-request.

### Fixed
- **HUD no longer stays stuck on "Listening" after exiting the
  onboarding practice step.** Two specific paths could leave the
  recording HUD visible after the user bailed out of Step 4:
  (a) the deferred turn-off branch wrote `stop` to the
  transcribe helper's stdin and waited for a `final` event —
  when the helper was gone or not ready, the write silently
  failed (try/catch) and `final` never arrived, so
  `onboardingPracticeMode` and `isRecording` stayed set
  forever; (b) the non-deferred branch only flipped the flag
  with no HUD cleanup. The handler now tracks whether the
  `stop` actually went through and, if not, runs the same
  reset path the `final` handler would have (clear flags,
  `hideHud`, refresh tray). On the non-deferred path,
  `hideHud()` runs as an idempotent safety net.

## [0.7.4] — 2026-04-23

### Fixed
- **"Restart & install" button now actually restarts.** The banner
  introduced in v0.7.1 called `autoUpdater.quitAndInstall()`, which
  dispatches `app.quit()` internally. Our close handler
  (`main.js:146`) prevents window close unless `app.isQuitting` is
  already set — a convention the tray Quit handler follows
  (`app.isQuitting = true; app.quit()`) but `quitAndInstall` does
  not. The result: the window vanished, the app kept running the
  OLD version in the tray, and reopening the dashboard showed the
  button frozen on "Restarting…" with the old build still active.
  The only way out was to quit manually via the tray.
  - `install-update-now` now flips `app.isQuitting = true` before
    invoking `quitAndInstall`, matching the tray Quit pattern.
  - Client-side safety: if the quit somehow doesn't happen within
    5 seconds, the banner button restores itself and a toast
    points the user at the tray-menu Quit recovery path, so the
    button can never be permanently stuck.
  - i18n `banner.update.installStuck` added across all four locales.

## [0.7.3] — 2026-04-23

### Added
- **Hands-on practice step in onboarding.** The flow taught users
  *configuration* (permissions, hotkey binding) but then dropped
  them into a dashboard with no idea what record → HUD → paste
  actually feels like. A new Step 4 "Try it out" runs one real
  record-and-transcribe round-trip inside the overlay: press the
  just-configured hotkey → the real HUD appears at the bottom of
  the screen (so the user learns what to look for) → speak →
  press again → transcript lands as a quoted result inside the
  onboarding card. Paste is skipped (the overlay isn't a paste
  target) and post-processing is bypassed (so a missing-Ollama
  config doesn't turn training into a failure). "Try again"
  rewinds the card; "Done · Start" closes the overlay.
- A new `set-onboarding-practice` IPC + `onboarding-practice-final`
  push event lets the overlay route real stream audio through the
  normal recorder without the normal post-process / paste
  side-effects. Bailing out of the step mid-recording (Back / Skip
  while speaking) arms a one-shot discard latch so the
  async-arriving transcript gets dropped rather than accidentally
  pasted into a previously focused app.
- i18n: `onboard.practice.*` added across ko / en / ja / zh-CN.

## [0.7.2] — 2026-04-23

### Fixed
- **Auto-update was completely broken since v0.6.0 — now actually
  works.** electron-updater's macOS backend (Squirrel.Mac) only
  consumes `.zip` files; we had only been shipping `.dmg`, which made
  `MacUpdater.js` throw `ERR_UPDATER_ZIP_FILE_NOT_FOUND` and bail out.
  The `.catch(() => {})` on the scheduled `checkForUpdates()` ate the
  error silently, so every one of the v0.6.0 → v0.7.1 releases
  happily logged `[updater] update available` and then downloaded
  nothing — no cache directory, no install, no banner. Users who sat
  on v0.6.0 for days never got an update because there was no update
  path to take.
  - `package.json.build.mac.target` now includes both `dmg` and
    `zip` (arm64). electron-builder signs + notarises the `.app`
    inside both containers, and the published `latest-mac.yml`
    lists both — electron-updater picks the `.zip`, humans grab
    the `.dmg`.
  - `npm run dist` and the GitHub Actions release job both pass
    `--mac dmg zip`. `SHA256SUMS` covers both artifacts.
  - The scheduled `checkForUpdates()` `.catch()` is no longer
    silent — a `console.warn` line surfaces the error if
    something similar ever slips through again. Still not user-
    visible (transient network failures shouldn't alarm anyone),
    but a terminal-run launch will now show it.

### Upgrade
v0.6.x / v0.7.x installs should auto-update to v0.7.2 on their next
4-hour check once this release is live. The client-side
electron-updater was working correctly all along; it was just waiting
for a `.zip` we never shipped. Once the download completes, v0.7.1's
new dashboard banner takes over and offers **Restart & install** as
a single click.

## [0.7.1] — 2026-04-23

### Fixed
- **Auto-update now has a visible path to apply itself.** Before this,
  v0.6.0+ pulled new builds in the background but the only cue was a
  toast that vanished in seconds, and install was gated on the user
  quitting the app — which the menubar-only architecture actively
  works against (closing the window hides the app rather than quits
  it). Real-world users saw "Update available" once and then ran on
  the old version for days waiting for an install that wasn't coming.
  - New persistent banner pinned to the top of the dashboard when an
    update has finished downloading: "v0.7.1 has been downloaded …
    Restart now to apply it immediately" with a primary **Restart &
    install** button and a **Later** dismiss that only hides it for
    the current session.
  - The Usage-page "Check for updates" button flips to **Restart &
    install vX.Y.Z** once the background download completes, so users
    who open Usage before noticing the banner still land on the
    action without needing another round-trip to the network.
  - New IPCs `get-update-state` / `install-update-now` +
    `update-state` event, plus a new internal `pendingUpdateVersion`
    tracker in main. `autoUpdater.quitAndInstall(true, true)` is
    invoked with `forceRunAfter=true` so the user lands back in the
    dashboard instead of an empty dock.
  - Existing `toast.updateReady` reworded across all four locales to
    point at the banner instead of implying "just wait until you
    quit".

## [0.7.0] — 2026-04-23

### Added
- **In-app WhisperKit model picker.** New card on the Engine page
  lists the full WhisperKit variant catalog (`base` / `small` /
  `turbo` / `accurate`) with per-row status (Bundled · Installed ·
  In use) and action buttons that drive install, switch, and delete
  through new IPCs — no more "open a terminal and run
  `npm run model:whisperkit:turbo`". Progress streams live from the
  download with a throttled bar + percent label + cancel, and the
  Cancel button cleans up any partial directory so a retry starts
  clean rather than resuming a half-downloaded shard tree. Models
  downloaded in-app land in `userData/models/whisperkit/` and the
  finder merges them with the bundled set (user directory wins,
  bundled models can't be deleted because the bundle is read-only).
  i18n `page.whisperkit.*` added across ko / en / ja / zh-CN.

### Changed
- **DMG shrunk from ~592 MB → under 200 MB.** The `turbo` (632 MB)
  model is no longer bundled; only the ~150 MB `base` model ships
  as an always-available fallback for the Apple-Speech → WhisperKit
  safety net. Users who want the larger variants grab them via the
  new picker on first use. `predist` and the GitHub Actions release
  workflow both switched from `npm run model:whisperkit` (turbo by
  default) to `npm run model:whisperkit:base`.
- **transcribe-helper `--download` now supports `--json-progress`.**
  Without the flag the old contract is preserved (human text on
  stderr, final path on stdout — `scripts/download-whisperkit-model.sh`
  keeps working). With the flag the helper emits NDJSON
  `download-progress` / `download-complete` / `download-error`
  events, throttled to 150 ms or 1 % fraction deltas so the IPC
  boundary doesn't flood. Main process parses them and forwards to
  the renderer as `whisperkit-download-progress`.

### Upgrade notes
Users on v0.6.x who had explicitly pinned `cfg.whisperKitModel` to
the turbo variant will silently fall back to the bundled `base`
after updating — `findWhisperKitModel()`'s preferred list already
handles "explicit choice missing" by falling through to the next
available option. Quality will drop on non-English transcripts until
the user installs turbo via the new picker. Engine settings and
every other preference are untouched.

## [0.6.3] — 2026-04-23

### Changed
- **Default engine is now Apple Speech** instead of WhisperKit for
  fresh installs. On-device, zero model download, and the existing
  `autoFallbackFromAppleOnCrash()` safety net already covers the
  "Apple helper won't stay up" case by flipping back to WhisperKit.
  Existing users are unaffected — their persisted `cfg.engine` is
  authoritative; only the first-boot fallback and the `set-engine`
  input sanitiser changed.
- **Brand-aligned menubar icon.** The tray was using macOS's generic
  `NSStatusAvailable` green-dot glyph — users reported not being
  able to find Listen K in their menubar. The new 16×16 template
  image is the same five-bar equalizer as the app icon at 4/8/12/8/4
  px heights, emitted as a grayscale + alpha PNG so macOS handles
  light/dark menubar tinting natively. `scripts/generate-tray-icon.js`
  + `npm run icon:tray` produces both 1x and 2x variants; they ship
  in `resources/icons/`.
- **HUD window widened from 260 px to 720 px** so long partial
  transcripts no longer clip. The pill's own max-width (680 px when
  live text is present) was already correct; the transparent
  containing BrowserWindow was the bottleneck. The extra 40 px of
  window width is invisible breathing room for the pill's glow
  drop-shadow.

### Fixed
- **Dashboard "Record now" button now takes the same path as the
  hotkey and the tray menu.** Previously it routed through a legacy
  renderer-owned batch-capture pipeline that bypassed the streaming
  engine, never showed the HUD, and guarded itself against re-click
  so there was no visible way to stop mid-recording from the
  dashboard. The click now invokes the new `trigger-record` IPC,
  which calls `handleFnPress()` — the canonical entry point — and
  the button reacts to a new `record-state` push event with three
  states (idle / recording / processing), complete with a stop-
  square icon, pulse, spinner, and "Processing…" label so the user
  always knows what to do next.

## [0.6.2] — 2026-04-23

### Added
- **App version is now visible in the UI.** The sidebar footer carries
  a persistent `Listen K vX.Y.Z` line so the build running is always
  discoverable without touching the terminal or the About menu, and
  the Usage page has a new "About" card with a **Check for updates**
  button that drives the same `electron-updater` feed that auto-update
  uses (via the existing `check-for-updates` IPC, extended to return
  `currentVersion` / `latestVersion` so the renderer can show a
  specific "update available · vX.Y.Z" line instead of a generic
  toast). i18n for `usage.about.*` added across ko / en / ja / zh-CN.
- New IPC `get-app-version` (exposed as `window.listenk.getAppVersion`)
  so renderer code can display the current build without piping it
  through config.

### Changed
- **Ollama-not-running banner is now a real help surface.** The
  previous terse one-liner ("터미널에서 실행하세요" / "Start it from a
  terminal") is replaced by a two-scenario layout: an "Not installed
  yet?" row with `brew install ollama` and a link to
  `ollama.com/download`, and an "Already installed?" row with
  `brew services start ollama` / `ollama serve`. Two action buttons
  ("Open Ollama download page" + "Refresh") let the user finish the
  fix without leaving the app. The download button goes through a new
  purpose-specific IPC `open-ollama-download` that hardcodes the URL
  (same hardening pattern as `open-settings-pane`). i18n keys added
  across all four locales.
- **Recommended Ollama models refreshed for 2026-04.** The list on
  the Ollama page now reads `gemma4:e4b` (new default, replacing
  `gemma3:4b`), `qwen3.5:4b` (multilingual), `gemma3:12b` (higher
  quality), `llama3.2:3b` (lightweight), `qwen2.5:7b` (balanced), and
  `phi4-mini:3.8b` (multilingual alternative). `mistral:7b` is
  dropped — no longer a clear win over qwen2.5:7b for post-processing
  transcripts. `qwen3.6` is intentionally excluded because Ollama
  only ships it at 35B today. Existing users' persisted
  `ollamaDefault` selection is untouched — only the unselected
  fallback moves to `gemma4:e4b`. The "copy pull command" action row
  and the `hasGemma` status check were updated to the new default.

## [0.6.1] — 2026-04-23

### Changed
- DMG now ships with a distinct silver-palette volume icon
  (`build/dmg-icon.icns`, produced from `scripts/generate-dmg-icon.js`
  via the new `npm run icon:dmg`). The installer's mounted volume reads
  visually as a "disk" — inverse of the dark app icon — while keeping
  the same five-bar equalizer motif so the product identity is still
  instantly recognisable. Wired through `package.json.build.dmg.icon`
  plus `iconSize: 110`.

### Fixed
- Main window no longer disappears mid-onboarding after the user grants
  Accessibility or Input Monitoring. macOS relaunches the app when those
  TCC toggles flip; after the relaunch the previous `ready-to-show`
  heuristic saw `isFirstRun=false` and `isSetupComplete()=true` and
  silently kept the window hidden, stranding the user at the tray icon
  before they had ever reached the onboarding "시작 / 완료" button.
  The check now also consults `cfg.onboardingDone`, so the dashboard
  stays visible until the user explicitly finishes the flow.

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

[Unreleased]: https://github.com/ibank/listen-k/compare/v0.7.4...HEAD
[0.7.4]: https://github.com/ibank/listen-k/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/ibank/listen-k/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/ibank/listen-k/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/ibank/listen-k/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/ibank/listen-k/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/ibank/listen-k/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/ibank/listen-k/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/ibank/listen-k/compare/v0.6.0...v0.6.1
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
