#!/usr/bin/env bash
#
# Listen K — one-shot migration script for users upgrading from an ad-hoc
# signed beta (v0.1.x / v0.2.x / v0.3.x) to the first Developer ID signed +
# notarised release (v0.4.0+).
#
# macOS binds TCC permissions (Accessibility, Input Monitoring, Microphone,
# Speech Recognition) to the signing identity. Ad-hoc and Developer ID
# builds are different identities even though the bundle id is the same,
# so previously granted permissions do NOT carry over. The keychain /
# safeStorage ACL faces the same issue — it prompts for the login
# keychain password on every app launch if the new identity isn't
# authorised on the existing "Electron Safe Storage" item.
#
# This script:
#   1. Quits any running Listen K processes
#   2. Removes the /Applications/Listen K.app bundle (if it's an ad-hoc
#      build; leaves Developer ID builds alone)
#   3. Wipes user data at:
#        ~/Library/Application Support/listen-k
#        ~/Library/Caches/transcribe-helper
#        ~/Library/Preferences/com.ibank.listenk*
#        ~/Library/Saved Application State/com.ibank.listenk.savedState
#        ~/Library/Logs/Listen K
#        ~/Library/HTTPStorages/com.ibank.listenk*
#        ~/Library/WebKit/com.ibank.listenk
#   4. Prints the exact System Settings panels the user must visit to
#      remove stale TCC entries, and the download URL for the new DMG.
#
# Does NOT touch:
#   - The shared "Electron Safe Storage" keychain item (used by other
#     Electron apps on this machine)
#   - Ollama models at ~/.ollama (unrelated)
#   - Any System keychain or TCC database directly (that needs sudo
#     and is risky — System Settings GUI is the supported path)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ibank/ListenK/main/scripts/migrate-from-ad-hoc.sh | bash
#   # or, if you cloned the repo:
#   bash scripts/migrate-from-ad-hoc.sh
#   # preview without changing anything:
#   bash scripts/migrate-from-ad-hoc.sh --dry-run

set -u

APP="/Applications/Listen K.app"
DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY=1 ;;
    --help|-h)
      sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

run() {
  if [ "$DRY" -eq 1 ]; then
    echo "  [dry-run] $*"
  else
    eval "$@"
  fi
}

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is macOS-only. Aborting." >&2
  exit 1
fi

echo "Listen K · 구 ad-hoc 빌드 → v0.4.0 Developer ID 빌드 마이그레이션"
[ "$DRY" -eq 1 ] && echo "(DRY-RUN — 실제 변경 없음)"
echo ""

# ── 1. 실행 중 프로세스 종료 ──────────────────────────────────
echo "[1/4] Listen K 관련 프로세스 종료"
for proc in "Listen K" fn-listener transcribe-helper paste-helper focus-helper apple-speech-helper; do
  if pgrep -f "$proc" >/dev/null 2>&1; then
    run "pkill -f \"$proc\" 2>/dev/null || true"
    echo "  · $proc 종료"
  fi
done
run "osascript -e 'quit app \"Listen K\"' 2>/dev/null || true"
sleep 1
echo ""

# ── 2. 구 앱 제거 (ad-hoc 만) ────────────────────────────────
echo "[2/4] /Applications/Listen K.app 확인"
if [ ! -d "$APP" ]; then
  echo "  · 설치되어 있지 않음 (skip)"
else
  team=$(codesign -dv "$APP" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2}')
  if [ "$team" = "N6PC9VGB89" ]; then
    echo "  · 이미 Developer ID (Team $team) — 제거하지 않음"
  else
    echo "  · ad-hoc 또는 구 빌드 감지 (TeamIdentifier=$team) — 제거"
    run "rm -rf \"$APP\""
  fi
fi
echo ""

# ── 3. 사용자 데이터·캐시·logs 전부 제거 ──────────────────────
echo "[3/4] 사용자 데이터 및 캐시 제거"
TARGETS=(
  "$HOME/Library/Application Support/listen-k"
  "$HOME/Library/Application Support/Listen K"
  "$HOME/Library/Caches/com.ibank.listenk"
  "$HOME/Library/Caches/transcribe-helper"
  "$HOME/Library/Preferences/com.ibank.listenk.plist"
  "$HOME/Library/Preferences/com.ibank.listenk.helper.plist"
  "$HOME/Library/Saved Application State/com.ibank.listenk.savedState"
  "$HOME/Library/Logs/Listen K"
  "$HOME/Library/HTTPStorages/com.ibank.listenk"
  "$HOME/Library/HTTPStorages/com.ibank.listenk.binarycookies"
  "$HOME/Library/WebKit/com.ibank.listenk"
)
removed=0
for p in "${TARGETS[@]}"; do
  if [ -e "$p" ]; then
    run "rm -rf \"$p\""
    echo "  · 삭제: $p"
    removed=$((removed + 1))
  fi
done
[ "$removed" -eq 0 ] && echo "  · 남은 데이터 없음"
echo ""

# ── 4. 수동 단계 안내 ───────────────────────────────────────
cat <<'EOF'
[4/4] 사용자가 직접 해야 할 일

  (a) 시스템 설정에서 Listen K 의 구 TCC 권한 항목 제거
      아래 4개 패널에서 "Listen K" 항목이 보이면 선택 후 − 버튼으로 제거:

        · 손쉬운 사용 (Accessibility)
        · 입력 모니터링 (Input Monitoring)
        · 마이크 (Microphone)
        · 음성 인식 (Speech Recognition)

      한 번에 4개 패널 열기:

        open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"

  (b) 최신 DMG 다운로드 후 Applications 로 드래그

        https://github.com/ibank/ListenK/releases/latest

      (내부 유통 중엔 draft 링크를 따로 공유 받으세요.)

  (c) 앱 첫 실행 시 권한 프롬프트에서 "항상 허용 (Always Allow)" 을 선택
      — 단순 "허용 (Allow)" 를 누르면 키체인 암호를 매번 다시 물어봅니다.

완료.
EOF
