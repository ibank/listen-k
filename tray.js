// Listen K — tray popover renderer.
//
// All commands flow through a single `tray-cmd` IPC so main.js stays the
// single source of truth for what each button does (open window, toggle
// recording, jump to a page, quit). Status + recent transcripts are
// pushed from main on state changes and on popover show.

const api = window.listenkTray;
if (!api) console.warn('[tray] listenkTray bridge missing');

const STATE_LABELS = {
  ko: { idle: '대기', recording: '녹음 중', processing: '처리 중', ready: '준비됨' },
  en: { idle: 'Idle', recording: 'Recording', processing: 'Processing', ready: 'Ready' },
  ja: { idle: '待機', recording: '録音中', processing: '処理中', ready: '準備完了' },
  'zh-CN': { idle: '待机', recording: '录音中', processing: '处理中', ready: '就绪' },
};
const L10N = {
  ko: {
    recordTitle: '지금 녹음 시작', recordDesc: '어디서든 더블탭',
    open: '대시보드 열기', history: '전사 이력', stats: '통계',
    recent: '최근', quit: 'Listen K 종료', noRecent: '기록 없음',
  },
  en: {
    recordTitle: 'Record now', recordDesc: 'Double-tap the hotkey anywhere',
    open: 'Open dashboard', history: 'History', stats: 'Stats',
    recent: 'Recent', quit: 'Quit Listen K', noRecent: 'No history',
  },
  ja: {
    recordTitle: '今すぐ録音', recordDesc: 'どこでもダブルタップ',
    open: 'ダッシュボードを開く', history: '履歴', stats: '統計',
    recent: '最近', quit: 'Listen K を終了', noRecent: '記録なし',
  },
  'zh-CN': {
    recordTitle: '立即录音', recordDesc: '任意位置双击快捷键',
    open: '打开仪表板', history: '历史', stats: '统计',
    recent: '最近', quit: '退出 Listen K', noRecent: '无记录',
  },
};
const HOTKEY_LABEL = {
  'rshift-double': '⇧⇧',
  'ropt-double': '⌥⌥',
  'rctl-double': '⌃⌃',
  'rcmd-double': '⌘⌘',
  'fn': 'fn',
};

let locale = 'en';
function loc() { return L10N[locale] || L10N.en; }
function stateLabels() { return STATE_LABELS[locale] || STATE_LABELS.en; }

function $(id) { return document.getElementById(id); }

function applyLocaleText() {
  const L = loc();
  $('trayRecordTitle').textContent = L.recordTitle;
  $('trayRecordDesc').textContent = L.recordDesc;
  $('trayOpenLabel').textContent = L.open;
  $('trayHistoryLabel').textContent = L.history;
  $('trayStatsLabel').textContent = L.stats;
  $('trayRecentLabel').textContent = L.recent;
  $('trayQuitLabel').textContent = L.quit;
}

function setStatus(kind /* 'idle' | 'rec' | 'processing' | 'ready' | 'error' */) {
  const chip = $('trayStatusChip');
  const textEl = chip.querySelector('.tray-status-text');
  const labels = stateLabels();
  let label = labels.idle, data = '';
  if (kind === 'rec')        { label = labels.recording; data = 'rec'; }
  else if (kind === 'processing') { label = labels.processing; data = ''; }
  else if (kind === 'ready') { label = labels.ready; data = 'ok'; }
  else if (kind === 'error') { label = 'Error';     data = 'error'; }
  if (data) chip.setAttribute('data-kind', data);
  else chip.removeAttribute('data-kind');
  textEl.textContent = label;
}

function setHotkey(mode) {
  $('trayRecordHotkey').textContent = HOTKEY_LABEL[mode] || '⇧⇧';
}

function renderRecents(entries) {
  const list = $('trayRecentList');
  list.innerHTML = '';
  const items = (entries || []).slice(0, 5);
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tray-recent-empty';
    empty.textContent = loc().noRecent;
    list.appendChild(empty);
    return;
  }
  items.forEach((entry) => {
    const text = (entry.clean || entry.raw || '').trim();
    if (!text) return;
    const btn = document.createElement('button');
    btn.className = 'tray-recent-item';
    btn.type = 'button';
    btn.title = text;
    btn.textContent = text;
    btn.addEventListener('click', () => api?.cmd?.({ cmd: 'paste-recent', text }));
    list.appendChild(btn);
  });
}

// Buttons
$('trayRecordBtn')?.addEventListener('click', () => api?.cmd?.({ cmd: 'record' }));
document.querySelectorAll('.tray-menu-item[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => api?.cmd?.({ cmd: btn.getAttribute('data-cmd') }));
});

// Paint the theme class on <html> so tray.css's :root.theme-light / .theme-dark
// overrides take effect. 'system' leaves no class so the @media query
// reads the OS preference.
function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  if (theme === 'light') root.classList.add('theme-light');
  else if (theme === 'dark') root.classList.add('theme-dark');
}

// Main → tray pushes
api?.onSnapshot?.((snap) => {
  if (snap.locale) { locale = snap.locale; applyLocaleText(); }
  if (snap.hotkey) setHotkey(snap.hotkey);
  if (snap.state) setStatus(snap.state);
  if (snap.theme) applyTheme(snap.theme);
  if (Array.isArray(snap.recents)) renderRecents(snap.recents);
});

// Initial paint (before snapshot arrives)
applyLocaleText();
setStatus('idle');
setHotkey('rshift-double');
renderRecents([]);
