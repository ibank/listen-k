#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

MODEL="${1:-openai_whisper-small}"
DEST_ROOT="models/whisperkit"
DEST="$DEST_ROOT/$MODEL"
HELPER="bin/transcribe-helper"

if [[ -d "$DEST" ]] && [[ -n "$(ls -A "$DEST" 2>/dev/null || true)" ]]; then
  SIZE=$(du -sh "$DEST" 2>/dev/null | awk '{print $1}')
  echo "✅ 이미 다운로드됨: $DEST ($SIZE)"
  exit 0
fi

if [[ ! -x "$HELPER" ]]; then
  echo "❌ transcribe-helper 가 먼저 빌드되어야 합니다:"
  echo "   npm run build:transcribe"
  exit 1
fi

mkdir -p "$DEST_ROOT"
echo "WhisperKit 모델 다운로드 중 ($MODEL)… (~150 MB, 수 분 소요)"

DOWNLOADED_PATH="$("$HELPER" --download "$MODEL" "$DEST_ROOT")"

# WhisperKit stashes the files at <downloadBase>/models/argmaxinc/whisperkit-coreml/<variant>/
# Move them up to <DEST_ROOT>/<variant>/ for a cleaner bundle layout.
if [[ -d "$DOWNLOADED_PATH" ]] && [[ "$DOWNLOADED_PATH" != "$(pwd)/$DEST" ]]; then
  rm -rf "$DEST"
  mv "$DOWNLOADED_PATH" "$DEST"
  rm -rf "$DEST_ROOT/models"
fi

if [[ -d "$DEST" ]]; then
  SIZE=$(du -sh "$DEST" 2>/dev/null | awk '{print $1}')
  echo "✅ $DEST ($SIZE)"
else
  echo "❌ 기대 경로에 모델이 없습니다: $DEST"
  echo "   실제 경로: $DOWNLOADED_PATH"
  exit 1
fi
