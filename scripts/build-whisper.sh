#!/usr/bin/env bash
# Builds whisper.cpp's whisper-cli statically (Metal + embedded shaders)
# and drops it at bin/whisper-cli. Linked only against Apple system
# frameworks — no brew dylibs — so the binary moves cleanly into the
# packaged .app. Clones a pinned tag so the build stays reproducible.
set -euo pipefail

cd "$(dirname "$0")/.."

WHISPER_VERSION="${WHISPER_VERSION:-v1.7.5}"
REPO_DIR=".whisper-cpp"
OUT_BIN="bin/whisper-cli"
STAMP=".whisper-cpp-version"

if [[ -f "$OUT_BIN" ]] && [[ -f "$STAMP" ]] && [[ "$(cat "$STAMP")" == "$WHISPER_VERSION" ]]; then
  echo "whisper-cli 이미 빌드됨 ($WHISPER_VERSION) — skip"
  otool -L "$OUT_BIN" | head -6
  exit 0
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "❌ cmake 이 필요합니다:  brew install cmake"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "❌ git 이 필요합니다"
  exit 1
fi

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "whisper.cpp $WHISPER_VERSION 가져오는 중..."
  rm -rf "$REPO_DIR"
  git clone --depth 1 --branch "$WHISPER_VERSION" \
    https://github.com/ggerganov/whisper.cpp "$REPO_DIR"
else
  (cd "$REPO_DIR" && \
    git fetch --depth 1 origin tag "$WHISPER_VERSION" 2>/dev/null || true; \
    git checkout -f "$WHISPER_VERSION")
fi

cd "$REPO_DIR"

rm -rf build
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF

cmake --build build -j --config Release --target whisper-cli

cd ..
mkdir -p bin
cp "$REPO_DIR/build/bin/whisper-cli" "$OUT_BIN"
chmod +x "$OUT_BIN"
codesign --force --sign - "$OUT_BIN"

echo "$WHISPER_VERSION" > "$STAMP"

echo ""
echo "✅ 빌드 완료: $OUT_BIN"
echo ""
otool -L "$OUT_BIN" | head -10
