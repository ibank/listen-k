const pill = document.getElementById('pill');
const cancelBtn = document.getElementById('cancelBtn');
const confirmBtn = document.getElementById('confirmBtn');

cancelBtn.addEventListener('click', () => {
  window.listenkHud?.cancel?.();
});

confirmBtn.addEventListener('click', () => {
  window.listenkHud?.confirm?.();
});

window.listenkHud?.onState?.((state) => {
  if (state === 'recording' || state === 'processing') {
    pill.dataset.state = state;
  }
});
