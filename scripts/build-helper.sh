#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p bin

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc 가 필요합니다. Xcode Command Line Tools 설치:"
  echo "  xcode-select --install"
  exit 1
fi

swiftc -O native/fn-listener.swift        -o bin/fn-listener
swiftc -O native/paste-helper.swift       -o bin/paste-helper
swiftc -O native/focus-helper.swift       -o bin/focus-helper

# apple-speech-helper needs to be wrapped in a proper .app bundle —
# TCC rejects NSSpeechRecognitionUsageDescription from a bare CLI
# binary (even with `-sectcreate __TEXT __info_plist`) and the process
# is killed with SIGABRT on SFSpeechRecognizer.requestAuthorization.
#
# Layout:
#   bin/apple-speech-helper.app/
#     Contents/
#       Info.plist
#       MacOS/apple-speech-helper   ← actual binary
APPLE_APP="bin/apple-speech-helper.app"
rm -rf "$APPLE_APP"
mkdir -p "$APPLE_APP/Contents/MacOS"
cp native/apple-speech-helper-Info.plist "$APPLE_APP/Contents/Info.plist"
swiftc -O native/apple-speech-helper.swift -o "$APPLE_APP/Contents/MacOS/apple-speech-helper"

# Keep the convenience symlink so scripts can still reference
# bin/apple-speech-helper directly.
rm -f bin/apple-speech-helper
ln -s "apple-speech-helper.app/Contents/MacOS/apple-speech-helper" bin/apple-speech-helper

# Ad-hoc codesign so macOS treats each helper as a distinct TCC identity.
codesign --force --sign - bin/fn-listener
codesign --force --sign - bin/paste-helper
codesign --force --sign - bin/focus-helper
# Sign the bundle as a whole so the MacOS binary and its Info.plist are
# validated together; this is what TCC keys off.
codesign --force --deep --sign - bin/apple-speech-helper.app

echo "컴파일 + ad-hoc 서명 완료:"
echo "  bin/fn-listener           (입력 모니터링 권한 필요)"
echo "  bin/paste-helper          (손쉬운 사용 권한 필요)"
echo "  bin/focus-helper          (별도 권한 불필요)"
echo "  bin/apple-speech-helper   (음성 인식 + 마이크 권한 필요)"
echo ""
echo "⚠️  재빌드 시 서명 정체성이 바뀌므로 권한 목록에서 제거 후 다시 추가해야 할 수 있습니다."
