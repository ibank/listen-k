**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

# Listen K

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/ibank/listen-k)](https://github.com/ibank/listen-k/releases)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-blue)](https://developer.apple.com/macos/)
[![Star on GitHub](https://img.shields.io/github/stars/ibank/listen-k?style=social)](https://github.com/ibank/listen-k)

**Local AI voice dictation for Apple Silicon Macs**, with **first-class Korean, Japanese, and Chinese** alongside English. Double-tap Right Shift to open a floating HUD, speak, watch the text appear in real time, double-tap again, and it is pasted into whatever app you had focused.


- **Engines**: WhisperKit (default, `openai_whisper-large-v3-turbo`) · Apple Speech · whisper.cpp · OpenAI API (BYOK)
- **Post-processing**: rule-based (default, zero dependencies) · off · Ollama (local LLMs like Gemma) · OpenAI cleanup
- **No data leaves your device** on the default config — WhisperKit + rules is fully local
- **UI** in Korean · English · Japanese · Simplified Chinese, auto-switched from your system locale
- **Target**: Apple Silicon macOS 14 (Sonoma) or newer
- **License**: MIT — source is open; a signed, notarised DMG is sold at [listenk.com](https://listenk.com)

## Why Listen K?

There are several excellent dictation apps for macOS. Listen K sits in a specific spot:

| | Listen K | [Superwhisper](https://superwhisper.com) | [Wispr Flow](https://wisprflow.ai) | [MacWhisper](https://goodsnooze.gumroad.com/l/macwhisper) | [Whisper Notes](https://whispernotes.app) | Apple Dictation |
|---|---|---|---|---|---|---|
| **Source** | MIT open source | Closed | Closed | Closed | Closed | Closed |
| **Local by default** | ✅ | ✅ | ❌ (cloud) | ✅ | ✅ | ✅ |
| **Korean / Japanese / Chinese quality** | First-class, CJK-tuned prompts | Good | Good | Mixed | Good | Weak on long-form CJK |
| **Auto-paste into focused app** | ✅ | ✅ | ✅ | Manual copy | Manual copy | System only |
| **Hotkey flexibility** | 5 options incl. fn | 3 options | fn only | 1 option | 1 option | Fixed |
| **Pricing** | Free source · $29 signed DMG | $8.49/mo · $249 lifetime | $15/mo | $79.99 lifetime | $6.99 one-time | Free (OS bundled) |
| **Four-locale UI** | ko / en / ja / zh-CN | en only | en only | en only | en only | System locale |

If you write Korean, Japanese, or Chinese daily and want your transcripts to stay on your machine without subscribing, Listen K is built for you.

---

## Install

### Notarised release (default path once signing is set up)
1. Download the latest `ListenK-x.y.z-arm64.dmg` from [Releases](https://github.com/ibank/listen-k/releases)
2. Open it and drag **Listen K** into Applications
3. Launch — the dashboard opens automatically the first time
4. Grant two permissions when prompted
   - **Accessibility**: add `/Applications/Listen K.app` (covers both hotkey detection and auto-paste)
   - **Microphone**: prompted automatically before the first recording
5. (Optional) For Ollama post-processing: `brew install ollama && ollama pull gemma3:4b`

The first launch takes ~40 seconds while Core ML compiles the model. Subsequent launches are instant.

### Ad-hoc development builds (v0.3 and earlier)
If you picked up a build before notarisation was wired up, you have to clear the quarantine flag once:
- Quick: `xattr -cr "/Applications/Listen K.app"`
- Or: System Settings → Privacy & Security → **Open Anyway** next to the "Listen K was blocked" banner

## Usage

1. Place the cursor where the text should go
2. **⇧⇧** (double-tap Right Shift) — HUD opens and recording starts
3. Speak (live text streams into the HUD)
4. **⇧⇧** again, or the HUD `✓` — post-processes and pastes into the focused app
5. Cancel with the HUD `✕`

**Alternative hotkeys**: `⌥⌥` / `⌃⌃` / `⌘⌘` / `fn`, configurable in settings. Click the menu bar icon to open the tray popover.

---

## Configuration

Listen K persists settings to `~/Library/Application Support/Listen K/config.json`. The app writes this file; you do not need to edit it by hand.

| Key | Values | Notes |
|---|---|---|
| `hotkey` | `rshift-double` (default) · `ropt-double` · `rctl-double` · `rcmd-double` · `fn` | Global hotkey |
| `engine` | `whisperkit` (default) · `apple` · `whisper.cpp` · `openai` | Transcription engine |
| `language` | `ko-KR` · `en-US` · `ja-JP` · `zh-CN` | Whisper language hint |
| `uiLocale` | `ko` · `en` · `ja` · `zh-CN` | UI language (defaults to system locale) |
| `theme` | `system` (default) · `light` · `dark` | Appearance |
| `streaming` | `true` (default) · `false` | Whether to show live text in the HUD |
| `mode` | `rules` (default) · `off` · `ollama` · `translate` | Post-processing |

First-run marker: `.first-run-done` in the same directory. Delete it to re-open the onboarding dashboard.

---

## Build from source

Requirements: macOS 14+ on Apple Silicon, Xcode 15+, Node.js 20 LTS.

```bash
git clone https://github.com/ibank/listen-k.git
cd listen-k
npm install
npm run build:helper       # Swift helpers: fn-listener, paste-helper, focus-helper
npm run build:transcribe   # bin/transcribe-helper (WhisperKit Swift Package)
npm run model:whisperkit   # Core ML model (~632 MB) → models/whisperkit/

npm start                  # dev mode
npm run dist               # DMG build (predist runs the three commands above)
npm run icon               # regenerate the app icon
```

To switch to another model variant:
```bash
bash scripts/download-whisperkit-model.sh openai_whisper-base
bash scripts/download-whisperkit-model.sh openai_whisper-large-v3-v20240930_626MB
```
Listen K auto-selects the highest-quality model present under `models/whisperkit/`.

## Project layout

```
main.js                         Electron main: IPC, state, tray, helper lifecycle
preload*.js                     contextIsolation bridges (main / HUD / tray)
index.html + renderer.js        Dashboard (status, settings, stats, history)
hud.html + hud.js               Floating HUD (waveform / live text / ✕ / ✓)
tray.html + tray.js             Menu bar tray popover
i18n.js                         4-locale table (ko/en/ja/zh-CN) + t(key, params)
styles.css / hud.css / tray.css Design system

native/fn-listener.swift        CGEventTap (modifier double-tap / fn)
native/paste-helper.swift       Accessibility check + CGEventPost ⌘V
native/focus-helper.swift       NSWorkspace frontmost save/restore
native/transcribe-helper/       WhisperKit AudioStreamTranscriber Swift Package
native/translate-helper/        MLX-based translation Swift Package (experimental)

scripts/build-*.sh              Swift helper builds
scripts/smoke.sh                Binary presence + stream-ready verification
scripts/after-pack.js           electron-builder afterPack (ad-hoc or Developer ID)
```

## Troubleshooting

- **HUD appears but no text**: run from a terminal with `npm start` and watch for `[audio] buf=` logs. If buf stays at 0, the app is missing microphone permission.
- **Hallucinations ("Thank you for watching" with no input)**: the microphone is picking up silence. Verify microphone permission on the app bundle. The `turbo` model hallucinates less than smaller ones.
- **⇧⇧ does nothing**: check the dashboard "Hotkey detection" row. It goes green once Accessibility is granted. If still red, make sure the double-tap interval is under 380 ms.
- **Focus restoration fails and text pastes into Listen K itself**: usually a bundle-id recognition failure, common when the focused surface is not a standard macOS app (e.g. a web widget inside a browser tab).
- **Core ML loading > 1 minute**: the Neural Engine compile step may be running. The shipped code uses cpuAndGPU only, so ~40 seconds is normal. Otherwise, `rm -rf ~/Library/Caches/transcribe-helper` and relaunch.

---

## Contributing

Issues, pull requests, and translations are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Bundled libraries and their licenses are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Trademark

The **Listen K** name, logo, and app icon are © 2026 ibank and are **not covered by the MIT license** on the source. If you fork Listen K, please ship it under your own name and icon.

## Supporting the project

Buying a notarised DMG from [listenk.com](https://listenk.com) directly funds development. You can also support the project through [GitHub Sponsors](https://github.com/sponsors/ibank).

## Roadmap

- [x] Light mode (`prefers-color-scheme`)
- [x] Transcription history
- [x] Apple Speech / OpenAI / whisper.cpp engine options
- [x] Four-locale UI
- [ ] Auto-update via `electron-updater` (after notarisation)
- [ ] Per-app tone and style profiles
- [ ] Personal vocabulary / custom pronunciation dictionary
- [ ] Team licensing
