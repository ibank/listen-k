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
let hudLocale = 'en';
function resolveLocale(loc) {
  if (DONE_MSG[loc]) return loc;
  const short = String(loc || '').split('-')[0];
  if (DONE_MSG[short]) return short;
  return 'en';
}
function doneText() { return DONE_MSG[hudLocale] || DONE_MSG.en; }

cancelBtn.addEventListener('click', () => {
  api?.cancel?.();
});

confirmBtn.addEventListener('click', () => {
  api?.confirm?.();
});

api?.onState?.((state) => {
  if (state === 'recording' || state === 'processing' || state === 'done') {
    pill.dataset.state = state;
    if (state === 'recording') {
      if (liveTextBody) liveTextBody.textContent = '';
      pill.dataset.hasText = 'false';
    }
    if (state === 'done') {
      // Show the success line in place of live text. hasText=true makes
      // the live-text element visible; CSS paints it green + prepends ✓.
      if (liveTextBody) liveTextBody.textContent = doneText();
      pill.dataset.hasText = 'true';
    }
  }
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
  if (ctx.locale) hudLocale = resolveLocale(ctx.locale);
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
