#!/usr/bin/env bash
# Downloads a ggml Whisper model for whisper.cpp from the official HF repo.
# Used by the whisper.cpp engine option (WhisperKit has its own downloader).
set -euo pipefail

MODEL="${1:-base}"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
DEST="$DEST_DIR/ggml-${MODEL}.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"

mkdir -p "$DEST_DIR"

if [[ -f "$DEST" ]]; then
  echo "이미 존재: $DEST"
  exit 0
fi

echo "다운로드: $URL"
echo "  → $DEST"
curl -L --fail --progress-bar -o "$DEST" "$URL"
echo "완료: $DEST"
