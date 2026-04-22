#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
PKG_DIR="native/transcribe-helper"
OUT="bin/transcribe-helper"

if ! command -v swift >/dev/null 2>&1; then
  echo "❌ swift 가 필요합니다. Xcode Command Line Tools 설치:"
  echo "   xcode-select --install"
  exit 1
fi

echo "Swift Package 빌드 중 (WhisperKit)…"
(cd "$PKG_DIR" && swift build -c release)

mkdir -p bin

# Swift 가 빌드한 바이너리 위치는 arch-prefixed 디렉토리에 있음
ARCH_TRIPLE=$(ls "$PKG_DIR/.build" | grep -E 'apple-macosx' | head -1)
BUILT_BIN="$PKG_DIR/.build/$ARCH_TRIPLE/release/TranscribeHelper"

if [[ ! -f "$BUILT_BIN" ]]; then
  echo "❌ 빌드 산출물을 찾을 수 없습니다: $BUILT_BIN"
  exit 1
fi

cp "$BUILT_BIN" "$OUT"
chmod +x "$OUT"

# Ad-hoc 서명 (TCC 일관성)
codesign --force --sign - "$OUT"

echo ""
echo "✅ 빌드 완료: $OUT  ($(stat -f%z "$OUT" | awk '{printf "%.1f MB\n", $1/1048576}'))"
echo ""
echo "시스템 프레임워크만 사용하는지 확인:"
otool -L "$OUT" | grep -v 'System\|usr/lib' | head -5 || echo "  (외부 의존 없음 ✓)"
