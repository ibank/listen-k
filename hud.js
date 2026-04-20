const pill = document.getElementById('pill');
const cancelBtn = document.getElementById('cancelBtn');
const confirmBtn = document.getElementById('confirmBtn');
const liveText = document.getElementById('liveText');

cancelBtn.addEventListener('click', () => {
  window.typelessHud?.cancel?.();
});

confirmBtn.addEventListener('click', () => {
  window.typelessHud?.confirm?.();
});

window.typelessHud?.onState?.((state) => {
  if (state === 'recording' || state === 'processing') {
    pill.dataset.state = state;
    if (state === 'recording') {
      liveText.textContent = '';
      pill.dataset.hasText = 'false';
    }
  }
});

window.typelessHud?.onPartial?.((text) => {
  const t = (text || '').trim();
  if (!t) {
    liveText.textContent = '';
    pill.dataset.hasText = 'false';
    return;
  }
  liveText.textContent = t;
  pill.dataset.hasText = 'true';
  requestAnimationFrame(() => {
    liveText.scrollLeft = liveText.scrollWidth;
  });
});

window.typelessHud?.onReset?.(() => {
  liveText.textContent = '';
  pill.dataset.hasText = 'false';
  pill.dataset.state = 'recording';
});
