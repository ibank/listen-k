#!/usr/bin/env bash
# Patches node_modules/electron/dist/Electron.app/Contents/Info.plist to add
# the privacy usage descriptions Listen K's Swift helpers need. TCC walks
# the responsible-process chain to find these keys, and in dev mode the
# chain ends at the dev Electron binary (not our packaged Listen K.app),
# so without this patch SFSpeechRecognizer.requestAuthorization crashes
# the apple-speech-helper process with SIGABRT at first use.
#
# Idempotent: checks for existing keys before inserting; re-signs ad-hoc
# only when something actually changed so the normal code-signing path
# keeps the cdhash stable across runs.
set -u

cd "$(dirname "$0")/.."
PLIST="node_modules/electron/dist/Electron.app/Contents/Info.plist"
if [[ ! -f "$PLIST" ]]; then
  echo "[patch-electron-plist] Electron.app not found — skipping"
  exit 0
fi

want_key() {
  local key="$1"
  local value="$2"
  if /usr/libexec/PlistBuddy -c "Print :$key" "$PLIST" &>/dev/null; then
    return 1  # already present
  fi
  /usr/libexec/PlistBuddy -c "Add :$key string '$value'" "$PLIST"
  return 0
}

changed=0
if want_key NSSpeechRecognitionUsageDescription "Listen K (dev): Apple Speech 엔진으로 음성을 텍스트로 변환"; then
  changed=1
fi
if want_key NSMicrophoneUsageDescription "Listen K (dev): 음성 받아쓰기용 마이크 사용"; then
  changed=1
fi

if [[ $changed -eq 1 ]]; then
  echo "[patch-electron-plist] added usage descriptions + re-signing"
  codesign --force --deep --sign - "node_modules/electron/dist/Electron.app" >/dev/null 2>&1 || {
    echo "[patch-electron-plist] warning: ad-hoc re-sign failed"
  }
fi
