const pill = document.getElementById('pill');
const cancelBtn = document.getElementById('cancelBtn');
const confirmBtn = document.getElementById('confirmBtn');
const liveText = document.getElementById('liveText');
const liveTextBody = document.getElementById('liveTextBody');

const api = window.listenkHud;

// Per-locale "done" success message. Matches the design's
// "Slack에 붙여넣었어요." green text — we don't know the target app so
// we use a neutral "Pasted." phrasing.
const DONE_MSG = {
  ko: '붙여넣었어요',
  en: 'Pasted',
  ja: '貼り付けました',
  'zh-CN': '已粘贴',
};
// Per-locale aria-labels for the HUD's cancel / confirm buttons.
// The HTML ships with Korean placeholders; we rewrite them on the first
// hud-context event so a VoiceOver user on an English (or JA/ZH) system
// doesn't hear "취소" / "확정" read aloud.
const ARIA_LABELS = {
  ko: { cancel: '취소', confirm: '확정' },
  en: { cancel: 'Cancel', confirm: 'Confirm' },
  ja: { cancel: 'キャンセル', confirm: '確定' },
  'zh-CN': { cancel: '取消', confirm: '确认' },
};
let hudLocale = 'en';
function resolveLocale(loc) {
  if (DONE_MSG[loc]) return loc;
  const short = String(loc || '').split('-')[0];
  if (DONE_MSG[short]) return short;
  return 'en';
}
function doneText() { return DONE_MSG[hudLocale] || DONE_MSG.en; }
function applyAriaLabels() {
  const L = ARIA_LABELS[hudLocale] || ARIA_LABELS.en;
  if (cancelBtn) cancelBtn.setAttribute('aria-label', L.cancel);
  if (confirmBtn) confirmBtn.setAttribute('aria-label', L.confirm);
  // Keep <html lang> in sync too so font fallback + screen readers pick
  // the right voice/script.
  document.documentElement.setAttribute('lang', hudLocale);
}

cancelBtn.addEventListener('click', () => {
  api?.cancel?.();
});

confirmBtn.addEventListener('click', () => {
  api?.confirm?.();
});

api?.onState?.((state) => {
  // Accept the four active states we paint. Anything else (including an
  // empty string or a typo introduced in a future refactor) falls into
  // the 'idle' branch so the HUD can't end up frozen on a stale state
  // the way it used to when main sent a value we didn't recognise.
  const known = new Set(['recording', 'processing', 'done', 'idle', 'error']);
  const effective = known.has(state) ? state : 'idle';
  pill.dataset.state = effective;

  if (effective === 'recording' || effective === 'idle') {
    // Whatever partial was on screen is no longer relevant — clear it
    // so the next recording starts from a blank pill.
    if (liveTextBody) liveTextBody.textContent = '';
    pill.dataset.hasText = 'false';
  }
  if (effective === 'error') {
    // The accompanying hud-message arrives separately (onMessage below)
    // and writes the localized error into liveTextBody. We leave any
    // existing text in place here so the message survives a race where
    // hud-message lands a tick before hud-state. If no message is set
    // by the time we paint, fall back to a generic '!' marker so the
    // user at least sees that something errored.
    if (liveTextBody && !liveTextBody.textContent) {
      liveTextBody.textContent = '!';
    }
    pill.dataset.hasText = 'true';
  }
  if (effective === 'done') {
    // Show the success line in place of live text. hasText=true makes
    // the live-text element visible; CSS paints it green + prepends ✓.
    if (liveTextBody) liveTextBody.textContent = doneText();
    pill.dataset.hasText = 'true';
  }
});

// Distinct from onPartial: this is a one-shot error message pushed by
// main when the stream helper fails in a way the user needs to see
// (e.g. Apple Speech with Siri/Dictation disabled). Painted into the
// same liveTextBody slot — CSS keys off pill[data-state='error'] to
// recolor it red rather than the partial-text white.
api?.onMessage?.((text) => {
  if (!liveTextBody) return;
  liveTextBody.textContent = (text || '').trim();
  pill.dataset.hasText = liveTextBody.textContent ? 'true' : 'false';
});

api?.onPartial?.((text) => {
  const t = (text || '').trim();
  if (!t) {
    if (liveTextBody) liveTextBody.textContent = '';
    pill.dataset.hasText = 'false';
    return;
  }
  if (liveTextBody) liveTextBody.textContent = t;
  pill.dataset.hasText = 'true';
  requestAnimationFrame(() => {
    liveText.scrollLeft = liveText.scrollWidth;
  });
});

api?.onReset?.(() => {
  if (liveTextBody) liveTextBody.textContent = '';
  pill.dataset.hasText = 'false';
  pill.dataset.state = 'recording';
});

// Context pill above the HUD: shows "[engine] · [mode]" so the user knows
// which pipeline is active + what post-processing will run when they stop
// talking. Hidden until main sends anything.
const hudContextEl = document.getElementById('hudContext');
api?.onContext?.((ctx) => {
  if (!hudContextEl || !ctx) return;
  if (ctx.locale) {
    hudLocale = resolveLocale(ctx.locale);
    applyAriaLabels();
  }
  const text = ctx.engineLabel
    ? (ctx.modeLabel ? `${ctx.engineLabel} · ${ctx.modeLabel}` : ctx.engineLabel)
    : '';
  if (!text) { hudContextEl.hidden = true; return; }
  hudContextEl.querySelector('.hud-context-text').textContent = text;
  if (ctx.engine) hudContextEl.setAttribute('data-engine', ctx.engine);
  else hudContextEl.removeAttribute('data-engine');
  if (ctx.state) hudContextEl.setAttribute('data-state', ctx.state);
  else hudContextEl.removeAttribute('data-state');
  hudContextEl.hidden = false;
});
