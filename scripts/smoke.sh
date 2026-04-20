#!/usr/bin/env bash
# Minimal smoke test: verifies every helper binary is runnable and the
# transcribe pipeline loads without crashing. Safe to run any time —
# doesn't touch the mic, the filesystem outside /tmp, or any remote service.
set -u

cd "$(dirname "$0")/.."

fail=0
pass=0

step() {
  local name="$1"
  shift
  if "$@"; then
    echo "  ✅ $name"
    pass=$((pass+1))
  else
    echo "  ✗ $name"
    fail=$((fail+1))
  fi
}

run_ok() {
  local out
  out=$("$@" 2>&1) || return 1
  return 0
}

echo "[smoke] helper binaries"
[[ -x bin/fn-listener ]]       && step "bin/fn-listener present"       true || step "bin/fn-listener missing"       false
[[ -x bin/paste-helper ]]      && step "bin/paste-helper present"      true || step "bin/paste-helper missing"      false
[[ -x bin/focus-helper ]]      && step "bin/focus-helper present"      true || step "bin/focus-helper missing"      false
[[ -x bin/transcribe-helper ]] && step "bin/transcribe-helper present" true || step "bin/transcribe-helper missing" false

echo ""
echo "[smoke] --check on helpers that expose it"
# --check exits with a specific status code; we tolerate either "granted" (0)
# or "not granted" (non-zero) — both mean the binary runs to completion. We
# only fail on signals or missing binary.
if [[ -x bin/transcribe-helper ]]; then
  bin/transcribe-helper --check >/dev/null 2>&1
  [[ $? -le 2 ]] && step "transcribe-helper --check"  true || step "transcribe-helper --check crashed" false
fi
if [[ -x bin/paste-helper ]]; then
  bin/paste-helper --check >/dev/null 2>&1
  [[ $? -le 3 ]] && step "paste-helper --check" true || step "paste-helper --check crashed" false
fi
if [[ -x bin/fn-listener ]]; then
  bin/fn-listener --check >/dev/null 2>&1
  [[ $? -le 2 ]] && step "fn-listener --check" true || step "fn-listener --check crashed" false
fi

echo ""
echo "[smoke] WhisperKit model present"
MODEL_ROOT="models/whisperkit"
if [[ -d "$MODEL_ROOT" ]] && [[ -n "$(ls -A "$MODEL_ROOT" 2>/dev/null)" ]]; then
  step "models/whisperkit/* exists" true
else
  step "models/whisperkit empty — run: npm run model:whisperkit" false
fi

echo ""
echo "[smoke] stream boot (30 s timeout)"
if [[ -x bin/transcribe-helper ]] && [[ -n "$(ls -A "$MODEL_ROOT" 2>/dev/null)" ]]; then
  MODEL_DIR=$(find "$MODEL_ROOT" -maxdepth 1 -mindepth 1 -type d | head -1)
  # Feed `quit` on stdin, expect a {"type":"ready"} event within 30 s.
  if (echo '{"cmd":"quit"}'; sleep 30) | \
       timeout 35 bin/transcribe-helper --stream --model-dir "$MODEL_DIR" --language en 2>/dev/null | \
       grep -q '"type":"ready"'; then
    step "transcribe-helper --stream boots to ready" true
  else
    step "transcribe-helper --stream never emitted ready" false
  fi
else
  echo "  · skip (missing binary or model)"
fi

echo ""
echo "[smoke] $pass passed, $fail failed"
exit $((fail > 0 ? 1 : 0))
