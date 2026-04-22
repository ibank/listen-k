#!/usr/bin/env bash
#
# Listen K — one-shot migration script for users on any previous build
# (ad-hoc v0.1.x–v0.3.x, Developer ID v0.4.x, or Developer ID v0.5.0 with
# the old com.ibank.listenk bundle id) upgrading to v0.5.1+ under the new
# com.eazler.listenk bundle id.
#
# macOS binds TCC permissions (Accessibility, Input Monitoring, Microphone,
# Speech Recognition) to the signing identity AND the bundle id. The v0.5.1
# bump to com.eazler.listenk counts as a brand-new app from TCC's point of
# view, so previously granted permissions do NOT carry over and stale
# entries in the old com.ibank.listenk namespace become orphans.
#
# This script:
#   1. Quits any running Listen K processes.
#   2. Removes /Applications/Listen K.app unless it is already a
#      Developer ID signed build with the NEW bundle id (prevents
#      accidental re-removal after upgrade).
#   3. Wipes user-scoped caches, preferences, and saved state under BOTH
#      the old (com.ibank.listenk) and new (com.eazler.listenk) bundle
#      namespaces, plus the shared Application Support directory that is
#      keyed by the npm package name "listen-k".
#   4. Resets TCC decisions for both bundle ids via `tccutil reset`.
#   5. Prints the exact System Settings panels and the new DMG location.
#
# Does NOT touch:
#   - The shared "Electron Safe Storage" keychain item (used by other
#     Electron apps on this machine).
#   - Ollama models at ~/.ollama (unrelated).
#   - Any System keychain or TCC database directly via sudo — tccutil
#     is the supported per-user reset path.
#
# Usage (read-before-run, preferred — you should never pipe a random URL
# straight into bash):
#   curl -fsSL https://raw.githubusercontent.com/ibank/listen-k/main/scripts/migrate-from-ad-hoc.sh -o migrate.sh
#   less migrate.sh        # inspect before running
#   bash migrate.sh        # or `bash migrate.sh --dry-run` first
#
# If you cloned the repo:
#   bash scripts/migrate-from-ad-hoc.sh
#   bash scripts/migrate-from-ad-hoc.sh --dry-run   # preview without changes

set -u

APP="/Applications/Listen K.app"
NEW_BUNDLE="com.eazler.listenk"
OLD_BUNDLE="com.ibank.listenk"
TEAM_ID="N6PC9VGB89"
DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY=1 ;;
    --help|-h)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
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

echo "Listen K · 구 빌드 → v0.5.1+ (com.eazler.listenk) 마이그레이션"
[ "$DRY" -eq 1 ] && echo "(DRY-RUN — 실제 변경 없음)"
echo ""

# ── 1. 실행 중 프로세스 종료 ──────────────────────────────────
echo "[1/5] Listen K 관련 프로세스 종료"
for proc in "Listen K" fn-listener transcribe-helper paste-helper focus-helper apple-speech-helper; do
  if pgrep -f "$proc" >/dev/null 2>&1; then
    run "pkill -f \"$proc\" 2>/dev/null || true"
    echo "  · $proc 종료"
  fi
done
run "osascript -e 'quit app \"Listen K\"' 2>/dev/null || true"
sleep 1
echo ""

# ── 2. 구 앱 제거 ────────────────────────────────────────────
# Keep the bundle only if it is BOTH Developer ID signed AND already on
# the new bundle id — otherwise it is either ad-hoc, pre-bundle-rename,
# or some external copy, all of which should be wiped.
echo "[2/5] /Applications/Listen K.app 확인"
if [ ! -d "$APP" ]; then
  echo "  · 설치되어 있지 않음 (skip)"
else
  team=$(codesign -dv "$APP" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2}')
  bundle=$(/usr/libexec/PlistBuddy -c 'print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null || echo "unknown")
  if [ "$team" = "$TEAM_ID" ] && [ "$bundle" = "$NEW_BUNDLE" ]; then
    echo "  · 이미 최신 (Team $team, bundle $bundle) — 제거하지 않음"
  else
    echo "  · 구 빌드 감지 (team=$team bundle=$bundle) — 제거"
    run "rm -rf \"$APP\""
  fi
fi
echo ""

# ── 3. 사용자 데이터·캐시·logs 전부 제거 ──────────────────────
echo "[3/5] 사용자 데이터 및 캐시 제거 (구·신 bundle id 둘 다)"
TARGETS=(
  # npm name 기반 (양쪽 모두 공유)
  "$HOME/Library/Application Support/listen-k"
  "$HOME/Library/Application Support/Listen K"
  "$HOME/Library/Caches/transcribe-helper"
  "$HOME/Library/Logs/Listen K"
)
# Per-bundle-id artefacts — expand for both old and new namespaces
for id in "$OLD_BUNDLE" "$NEW_BUNDLE"; do
  TARGETS+=(
    "$HOME/Library/Caches/$id"
    "$HOME/Library/Preferences/$id.plist"
    "$HOME/Library/Preferences/$id.helper.plist"
    "$HOME/Library/Saved Application State/$id.savedState"
    "$HOME/Library/HTTPStorages/$id"
    "$HOME/Library/HTTPStorages/$id.binarycookies"
    "$HOME/Library/WebKit/$id"
  )
done
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

# ── 4. TCC 권한 초기화 (sudo 불필요) ──────────────────────────
echo "[4/5] TCC 권한 기록 리셋 (구·신 bundle id 둘 다)"
for svc in Microphone SpeechRecognition Accessibility ListenEvent All; do
  for id in "$OLD_BUNDLE" "$NEW_BUNDLE"; do
    run "tccutil reset $svc $id >/dev/null 2>&1 || true"
  done
done
run "killall 'System Settings' 2>/dev/null || true"
echo "  · 완료 (다음 실행 시 권한 프롬프트 새로 뜸)"
echo ""

# ── 5. 수동 단계 안내 ───────────────────────────────────────
cat <<'EOF'
[5/5] 사용자가 직접 해야 할 일

  (a) v0.5.1+ DMG 를 Applications 로 드래그
      https://github.com/ibank/listen-k/releases/latest
      (내부 유통 중엔 draft 링크를 따로 공유 받으세요.)

  (b) 앱 첫 실행 시 권한 프롬프트에서 "항상 허용 (Always Allow)" 을 선택
      — 단순 "허용 (Allow)" 을 누르면 키체인 암호를 매번 다시 물어봅니다.

  (c) 만약 시스템 설정 → 개인정보 보호 및 보안 화면에 여전히 구
      "Listen K" 항목 (com.ibank.listenk) 이 잔상처럼 남아있다면
      재부팅 한 번으로 정리됩니다.

완료.
EOF
