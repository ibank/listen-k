#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
PKG_DIR="native/translate-helper"

if ! command -v swift >/dev/null 2>&1; then
  echo "❌ swift 가 필요합니다"
  exit 1
fi

echo "Swift Package 빌드 중 (MLX-Swift + MLXLLM)…"
(cd "$PKG_DIR" && swift build -c release)

mkdir -p bin

ARCH_TRIPLE=$(ls "$PKG_DIR/.build" | grep -E 'apple-macosx' | head -1)
BUILT_BIN="$PKG_DIR/.build/$ARCH_TRIPLE/release/TranslateHelper"

if [[ ! -f "$BUILT_BIN" ]]; then
  echo "❌ 빌드 산출물을 찾을 수 없습니다: $BUILT_BIN"
  exit 1
fi

cp "$BUILT_BIN" bin/translate-helper
chmod +x bin/translate-helper
codesign --force --sign - bin/translate-helper

echo ""
echo "✅ 빌드 완료: bin/translate-helper ($(stat -f%z bin/translate-helper | awk '{printf "%.1f MB\n", $1/1048576}'))"
echo ""
otool -L bin/translate-helper | grep -v 'System\|usr/lib' | head -5 || echo "  (외부 의존 없음)"
