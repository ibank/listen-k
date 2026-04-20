const pill = document.getElementById('pill');
const cancelBtn = document.getElementById('cancelBtn');
const confirmBtn = document.getElementById('confirmBtn');

cancelBtn.addEventListener('click', () => {
  window.typelessHud?.cancel?.();
});

confirmBtn.addEventListener('click', () => {
  window.typelessHud?.confirm?.();
});

window.typelessHud?.onState?.((state) => {
  if (state === 'recording' || state === 'processing') {
    pill.dataset.state = state;
  }
});
