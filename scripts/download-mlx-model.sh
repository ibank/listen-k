#!/usr/bin/env bash
# Downloads an MLX-format model directory (Gemma 4 default) from HuggingFace.
# Prefers `huggingface-cli` for resumable LFS downloads; falls back to
# `git lfs clone`. Result lands in models/mlx/<basename>/.
set -euo pipefail

cd "$(dirname "$0")/.."

MODEL="${1:-mlx-community/gemma-3-4b-it-4bit}"
NAME="$(basename "$MODEL")"
DEST_ROOT="models/mlx"
DEST="$DEST_ROOT/$NAME"

if [[ -d "$DEST" ]] && [[ -f "$DEST/config.json" ]]; then
  echo "✅ 이미 존재: $DEST"
  du -sh "$DEST"
  exit 0
fi

mkdir -p "$DEST_ROOT"

echo "MLX 모델 다운로드: $MODEL"

if command -v huggingface-cli >/dev/null 2>&1; then
  huggingface-cli download "$MODEL" --local-dir "$DEST"
elif command -v hf >/dev/null 2>&1; then
  hf download "$MODEL" --local-dir "$DEST"
else
  if ! command -v git >/dev/null 2>&1; then
    echo "❌ git 또는 huggingface-cli 가 필요합니다"
    exit 1
  fi
  if ! git lfs version >/dev/null 2>&1; then
    echo "❌ git-lfs 가 필요합니다: brew install git-lfs && git lfs install"
    exit 1
  fi
  git clone "https://huggingface.co/$MODEL" "$DEST"
fi

echo ""
echo "✅ 다운로드 완료: $DEST ($(du -sh "$DEST" | awk '{print $1}'))"
