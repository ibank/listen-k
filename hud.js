const pill = document.getElementById('pill');
const cancelBtn = document.getElementById('cancelBtn');
const confirmBtn = document.getElementById('confirmBtn');
const liveText = document.getElementById('liveText');

const api = window.listenkHud;

cancelBtn.addEventListener('click', () => {
  api?.cancel?.();
});

confirmBtn.addEventListener('click', () => {
  api?.confirm?.();
});

api?.onState?.((state) => {
  if (state === 'recording' || state === 'processing') {
    pill.dataset.state = state;
    if (state === 'recording') {
      liveText.textContent = '';
      pill.dataset.hasText = 'false';
    }
  }
});

api?.onPartial?.((text) => {
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

api?.onReset?.(() => {
  liveText.textContent = '';
  pill.dataset.hasText = 'false';
  pill.dataset.state = 'recording';
});
