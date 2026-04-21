const $ = (id) => document.getElementById(id);

const rawEl = $('raw');
const cleanEl = $('clean');
const statusEl = $('status');
const langSel = $('lang');
const modelInput = $('model');
const toneSel = $('tone');
const modeSel = $('mode');
const hotkeySel = $('hotkey');
const streamingSel = $('streaming');
const whisperModelSel = $('whisperModel');
const engineSel = $('engine');
const openaiKeyInput = $('openaiKey');
const openaiModelSel = $('openaiModel');
const uiLocaleSel = $('uiLocale');
const translateTargetSel = $('translateTarget');
const copyBtn = $('copyBtn');
const refreshBtn = $('refreshBtn');
const checkListEl = $('checkList');
const recentCard = $('recentCard');
const toastEl = $('toast');

// ---- i18n ----
// Thin wrapper over window.i18n (loaded from i18n.js before us). Keep the
// ultra-short name so string-heavy files stay readable. Locale is applied
// to the whole document on boot + whenever the user picks a new language.
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

function applyTranslations(root = document) {
  if (!window.i18n) return;
  // Plain text nodes.
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  // Attribute targets (placeholder / title / aria-label).
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  // Usage rows contain HTML (<kbd>, <span class="icon-check">) that need to
  // be interpolated into the translated template. data-i18n-html takes the
  // kbd hint from data-hotkey (kept in sync by applyHotkeyHint) and injects
  // icon spans via placeholder tokens.
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    const hk = el.getAttribute('data-hotkey') || '⇧⇧';
    const kbd = `<kbd class="hotkey-hint">${hk}</kbd>`;
    const step = el.querySelector('.usage-step');
    const stepHtml = step ? step.outerHTML : '';
    let raw = t(key, { hotkey: '⟦HOTKEY⟧' });
    raw = raw
      .replace(/⟦HOTKEY⟧/g, kbd)
      .replace(/✓/g, '<span class="icon-check">✓</span>')
      .replace(/✕/g, '<span class="icon-x">✕</span>')
      .replace(/⌘⇧Space/g, '<kbd>⌘</kbd><kbd>⇧</kbd><kbd>Space</kbd>');
    el.innerHTML = stepHtml + ' ' + raw;
  });
  // Output placeholders (CSS :empty::before uses data-placeholder attr).
  if (rawEl) rawEl.dataset.placeholder = t('placeholder.raw');
  if (cleanEl) cleanEl.dataset.placeholder = t('placeholder.clean');
  // <html lang> for accessibility + browser speech defaults.
  document.documentElement.setAttribute('lang', window.i18n.getLocale());
}

const OLLAMA_URL = 'http://localhost:11434/api/generate';

let audioContext = null;
let micStream = null;
let source = null;
let processor = null;
let pcmChunks = [];
let sourceSampleRate = 16000;
let recording = false;
let finalTranscript = '';

function setStatus(text, kind = '') {
  // The titlebar status chip has an LED child + a text child — target the
  // text node specifically so we don't clobber the LED dot.
  const txt = statusEl.querySelector('.status-text') || statusEl;
  txt.textContent = text;
  statusEl.dataset.kind = kind;
}

function toast(msg, ms = 1500) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, ms);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn('[clipboard] navigator.clipboard failed, falling back to IPC', err);
    try {
      return await window.listenk.clipboardWrite(text);
    } catch (err2) {
      console.error('[clipboard] IPC fallback failed', err2);
      return false;
    }
  }
}

// ========== Audio capture / transcription / post-processing ==========

async function startRecognition() {
  console.log('[renderer] startRecognition()');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    console.error('[renderer] mic permission/capture failed', err);
    setStatus(t('status.micFail', { name: err.name }), 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
    return;
  }

  audioContext = new AudioContext();
  sourceSampleRate = audioContext.sampleRate;
  source = audioContext.createMediaStreamSource(micStream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);

  pcmChunks = [];
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    pcmChunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  recording = true;
  markTranscribeStart();
  setStatus(t('status.recording'), 'rec');
  window.listenk?.setState?.({ recording: true, processing: false });
}

async function stopRecognition() {
  if (!recording) return;
  recording = false;

  try {
    processor.disconnect();
    source.disconnect();
    micStream.getTracks().forEach((t) => t.stop());
  } catch {}

  if (pcmChunks.length === 0) {
    setStatus(t('status.noRecording'), 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
    return;
  }

  window.listenk?.setState?.({ recording: false, processing: true });
  setStatus(t('status.converting'));

  const flat = flattenChunks(pcmChunks);
  const samples16k =
    sourceSampleRate === 16000 ? flat : await resampleTo16k(flat, sourceSampleRate);
  const wav = encodeWAV(samples16k);

  try {
    const text = await window.listenk.transcribe({
      wavBuffer: wav,
      language: langSel.value,
    });

    finalTranscript = cleanWhisperOutput(text);
    showRecent();
    rawEl.textContent = finalTranscript;

    // Record stats using the exact audio length we just sent.
    recordTranscribeStats(samples16k.length / 16000);

    if (finalTranscript.trim()) {
      await postProcessAndPaste(finalTranscript);
    } else {
      setStatus(t('status.noSpeech'), 'error');
      window.listenk?.setState?.({ recording: false, processing: false });
    }
  } catch (err) {
    console.error('transcribe failed', err);
    setStatus(t('status.whisperError'), 'error');
    showRecent();
    cleanEl.textContent = err.message;
    window.listenk?.setState?.({ recording: false, processing: false });
  } finally {
    if (audioContext) {
      try { await audioContext.close(); } catch {}
      audioContext = null;
    }
  }
}

async function cancelRecord() {
  if (!recording) return;
  recording = false;
  transcribeStartMs = null; // don't record stats for a cancelled call

  try {
    processor?.disconnect();
    source?.disconnect();
    micStream?.getTracks().forEach((t) => t.stop());
    if (audioContext) {
      try { await audioContext.close(); } catch {}
      audioContext = null;
    }
  } catch {}

  pcmChunks = [];
  setStatus(t('status.cancelled'));
  window.listenk?.setState?.({ recording: false, processing: false });
  setTimeout(() => setStatus(t('status.idle')), 1200);
}

function cleanWhisperOutput(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function toggleRecord() {
  if (recording) stopRecognition();
  else startRecognition();
}

function showRecent() {
  if (recentCard?.hasAttribute('hidden')) recentCard.removeAttribute('hidden');
}

function flattenChunks(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function resampleTo16k(samples, fromRate) {
  const targetLen = Math.ceil((samples.length * 16000) / fromRate);
  const offlineCtx = new OfflineAudioContext(1, targetLen, 16000);
  const buffer = offlineCtx.createBuffer(1, samples.length, fromRate);
  buffer.copyToChannel(samples, 0);
  const src = offlineCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(offlineCtx.destination);
  src.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

function encodeWAV(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

// ========== Post-processing ==========

function cleanupWithRules(text) {
  let t = text;
  t = t.replace(
    /(^|[\s.,!?])(음+|어+|아+|에+|으+음*|그니까|그러니까|그러면|뭐|막|좀|이제|자|아니|어디|그+)(?=[\s.,!?]|$)/g,
    '$1'
  );
  t = t.replace(/\b(um+|uh+|hmm+|ah+|er+|mhm+|like|you\s+know|i\s+mean|kinda|sorta)\b/gi, '');
  t = t.replace(/(^|\s)(\S{1,4})(\s+\2){1,}/g, '$1$2');
  t = t.replace(/\s+([.,!?])/g, '$1');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

async function finalizePaste(cleanedText) {
  cleanEl.textContent = cleanedText;
  setStatus(t('status.pasting'));
  let pasted = true;
  try {
    if (cleanedText && window.listenk?.paste) {
      await window.listenk.paste(cleanedText);
    }
    setStatus(t('status.done'), 'ok');
  } catch (pasteErr) {
    pasted = false;
    setStatus(t('status.pasteFail', { message: pasteErr.message }), 'error');
  }

  if (cleanedText) {
    try {
      await window.listenk?.historyAppend?.({
        at: new Date().toISOString(),
        raw: (finalTranscript || '').trim(),
        clean: cleanedText,
        mode: modeSel?.value || 'off',
        language: langSel?.value || 'ko-KR',
        pasted,
      });
      refreshHistory();
    } catch {}
  }

  // Flash the HUD's "done" state for a beat on success; cancel/error paths
  // just hide via setState without the green checkmark.
  window.listenk?.setState?.({ recording: false, processing: false, pasted });
  setTimeout(() => setStatus(t('status.idle')), 1500);
}

async function postProcessAndPaste(raw) {
  const mode = modeSel?.value || 'off';
  if (mode === 'off') {
    setStatus(t('status.pasting'));
    await finalizePaste(raw.trim());
    return;
  }
  if (mode === 'rules') {
    setStatus(t('status.rules'));
    await finalizePaste(cleanupWithRules(raw));
    return;
  }
  if (mode === 'translate') {
    const targetLang = translateTargetSel?.value || 'English';
    setStatus(t('status.translate', { target: targetLang }));
    await cleanupWithOllama(raw, { task: 'translate', targetLang });
    return;
  }
  setStatus(t('status.ollama'));
  await cleanupWithOllama(raw);
}

function buildPrompt(raw, opts = {}) {
  if (opts.task === 'translate') {
    const target = opts.targetLang || 'English';
    return `You are a professional translator. Translate the following text to ${target}. Preserve meaning, tone, names, and formatting. Output only the translation — no commentary, no quotes, no preamble.

Source:
"""
${raw}
"""

${target} translation:`;
  }

  const toneInstruction = {
    neutral: '자연스럽고 깔끔한 문어체로',
    formal: '격식 있는 존댓말로',
    casual: '친근한 구어체로',
    email: '이메일에 적합한 정중하고 간결한 톤으로',
  }[toneSel.value] || '자연스럽게';

  return `당신은 음성 받아쓰기 결과를 정제하는 편집기입니다. 아래 원문은 사용자의 발화를 받아쓴 것입니다.

규칙:
1. "음", "어", "그", "뭐", "아", "그니까", "um", "uh", "you know" 같은 필러 단어 제거
2. 반복되는 표현 정리
3. 중간에 말을 바꾼 경우 최종 의도를 반영해 문맥에 맞게 수정
4. 목록/단계를 말했으면 줄바꿈으로 정리
5. 문장부호와 대소문자를 자연스럽게 복원
6. ${toneInstruction} 다듬되, 의미와 원래 언어는 유지
7. 번역하지 마세요. 내용을 요약하거나 추가하지 마세요.
8. 설명 없이 정제된 결과 텍스트만 출력하세요.

원문:
"""
${raw}
"""

정제된 텍스트:`;
}

async function cleanupWithOllama(raw, opts = {}) {
  cleanEl.textContent = '';
  const prompt = buildPrompt(raw, opts);
  // modelInput is now a <select>; fall back to a sensible default if Ollama
  // is offline or hasn't been listed yet.
  const model = (modelInput?.value || '').trim() || 'gemma3:4b';

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true }),
    });
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    // Ollama reports prompt_eval_count / eval_count only on the final chunk
    // (`done: true`). Capture both so the stats page can show token spend.
    let usage = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.response) {
            output += chunk.response;
            cleanEl.textContent = output;
          }
          if (chunk.done) {
            usage = {
              promptTokens: chunk.prompt_eval_count || 0,
              evalTokens: chunk.eval_count || 0,
            };
          }
        } catch {}
      }
    }
    if (usage) {
      try { await window.listenk?.statsRecordOllama?.(usage); } catch {}
    }
    await finalizePaste(output.trim());
  } catch (err) {
    cleanEl.textContent = t('error.ollamaHint', { message: err.message, model });
    setStatus(t('status.ollamaError'), 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
  }
}

// ========== IPC wiring (record/cancel from main/HUD) ==========

// Legacy batch capture (used only when the streaming helper is unavailable).
// The streaming path is driven by main.js sending stream-partial/final IPC,
// so the toggle-record fallback is gated by streamingActive below.
let streamingActive = false;
let latestPartial = '';

// Transcription timing — used to estimate audioSec for the streaming path
// where the renderer doesn't hold the raw WAV buffer. Legacy batch path can
// override with the exact samples-length value.
let transcribeStartMs = null;
function markTranscribeStart() { transcribeStartMs = Date.now(); }
async function recordTranscribeStats(audioSecOverride) {
  const start = transcribeStartMs;
  transcribeStartMs = null;
  try {
    const engine = engineSel?.value || 'whisperkit';
    const model = engine === 'openai' ? (openaiModelSel?.value || '') : null;
    const audioSec = audioSecOverride != null
      ? audioSecOverride
      : start ? (Date.now() - start) / 1000 : 0;
    await window.listenk?.statsRecordTranscribe?.({ engine, model, audioSec });
  } catch {}
}

if (window.listenk?.onToggleRecord) {
  window.listenk.onToggleRecord(() => {
    if (streamingActive) return;  // streaming path handles everything
    toggleRecord();
  });
}
window.listenk?.onCancelRecord?.(() => {
  if (streamingActive) {
    streamingActive = false;
    latestPartial = '';
    transcribeStartMs = null; // don't record cancelled call in stats
    showRecent();
    rawEl.textContent = t('misc.cancelled');
    setStatus(t('status.cancelled'));
    window.listenk?.setState?.({ recording: false, processing: false });
    setTimeout(() => setStatus(t('status.idle')), 1200);
    return;
  }
  cancelRecord();
});

window.listenk?.onStreamPartial?.((text) => {
  if (!streamingActive) markTranscribeStart();
  streamingActive = true;
  latestPartial = text || '';
  setStatus(t('status.listening'), 'rec');
  showRecent();
  rawEl.textContent = latestPartial;
  // If the helper is producing partials, it's alive — banner is stale.
  if (firstRunBanner && !firstRunBanner.hidden) hideFirstRunBanner();
});

window.listenk?.onStreamFinal?.(async (text) => {
  console.log('[renderer] stream-final received, length=', (text || '').length);
  const finalText = (text || latestPartial || '').trim();
  streamingActive = false;
  latestPartial = '';
  showRecent();
  rawEl.textContent = finalText;

  // Record stats for streaming engines — duration derived from timestamps.
  recordTranscribeStats();

  if (!finalText) {
    setStatus(t('status.noSpeech'), 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
    setTimeout(() => setStatus(t('status.idle')), 1200);
    return;
  }

  try {
    await postProcessAndPaste(finalText);
  } catch (err) {
    console.error('[renderer] postProcessAndPaste failed', err);
    setStatus(t('status.postFail', { message: err.message }), 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
  }
});

window.listenk?.onToast?.((msg) => {
  // The `stream-ready` IPC already hides the banner independently, so we no
  // longer need to string-match the toast text (which is now localized).
  if (msg) toast(msg, 2500);
});

window.listenk?.onStreamError?.((message) => {
  streamingActive = false;
  setStatus(t('status.streamError', { message }), 'error');
  cleanEl.textContent = message;
  window.listenk?.setState?.({ recording: false, processing: false });
});

copyBtn?.addEventListener('click', async () => {
  const text = cleanEl.textContent.trim() || rawEl.textContent.trim();
  if (!text) return;
  await copyToClipboard(text);
  toast(t('toast.copied'));
});

// ========== Onboarding dashboard ==========

const ICONS = {
  ok: '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5 L6.5 11.5 L12.5 5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 3 L8 9.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="8" cy="12.2" r="1.1" fill="currentColor"/></svg>',
  err: '<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="4.5" r="1.1" fill="currentColor"/><path d="M8 7 L8 12.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

function dot(state) {
  return `<div class="check-dot" data-state="${state}">${ICONS[state] || ICONS.info}</div>`;
}

function buildCheckRow({ state, title, desc, actions = [] }) {
  const row = document.createElement('div');
  row.className = 'check-row';
  row.innerHTML = `
    ${dot(state)}
    <div class="check-body">
      <div class="check-title"></div>
      <div class="check-desc"></div>
    </div>
    <div class="check-actions"></div>
  `;
  row.querySelector('.check-title').textContent = title;
  row.querySelector('.check-desc').textContent = desc;
  const actionsEl = row.querySelector('.check-actions');
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = a.primary ? 'primary' : 'ghost';
    b.textContent = a.label;
    b.addEventListener('click', a.onClick);
    actionsEl.appendChild(b);
  }
  return row;
}

function describeMic(status) {
  switch (status) {
    case 'granted':
      return { state: 'ok', glyph: '✓', desc: t('check.mic.granted') };
    case 'denied':
      return { state: 'err', glyph: '✕', desc: t('check.mic.denied') };
    case 'not-determined':
      return { state: 'warn', glyph: '!', desc: t('check.mic.notDetermined') };
    case 'restricted':
      return { state: 'err', glyph: '✕', desc: t('check.mic.restricted') };
    default:
      return { state: 'warn', glyph: '?', desc: t('check.mic.unknown', { status: String(status) }) };
  }
}

async function renderStatus(statusArg) {
  const s = statusArg || (await window.listenk.getStatus());
  const rows = [];

  // Keep the Ollama model dropdown in sync with whatever Ollama actually
  // has installed right now. Cheap to do — populate is no-op if the list
  // hasn't changed shape.
  populateOllamaModels(s.ollama?.models || []);

  const mic = describeMic(s.mic);
  rows.push(buildCheckRow({
    state: mic.state,
    glyph: mic.glyph,
    title: t('check.mic.title'),
    desc: mic.desc,
    actions: s.mic === 'not-determined'
      ? [{ label: t('check.mic.request'), primary: true, onClick: async () => { await window.listenk.requestMic(); refresh(); } }]
      : s.mic === 'denied' || s.mic === 'restricted'
      ? [{ label: t('check.mic.openSettings'), onClick: () => window.listenk.openSettingsPane('mic') }]
      : [],
  }));

  const targetPath = s.packaged ? s.appBundlePath : s.fnListenerPath;
  const targetLabel = s.packaged ? 'Listen K.app' : 'fn-listener';

  const imCoveredByAx = s.inputMonitoring && s.accessibility;

  rows.push(buildCheckRow({
    state: s.inputMonitoring ? 'ok' : 'err',
    glyph: s.inputMonitoring ? '✓' : '✕',
    title: t('check.hotkey.title'),
    desc: s.inputMonitoring
      ? (imCoveredByAx ? t('check.hotkey.grantedAX') : t('check.hotkey.grantedIM'))
      : t('check.hotkey.denied', { target: targetLabel, path: targetPath || '' }),
    actions: s.inputMonitoring ? [] : [
      { label: t('check.hotkey.openSettings'), primary: true, onClick: () => window.listenk.openSettingsPane('input-monitoring') },
      targetPath && { label: t('check.hotkey.showFinder'), onClick: () => window.listenk.showInFinder(targetPath) },
      targetPath && {
        label: t('check.hotkey.copyPath'),
        onClick: async () => { await copyToClipboard(targetPath); toast(t('toast.pathCopied')); },
      },
    ].filter(Boolean),
  }));

  const axTargetPath = s.packaged ? s.appBundlePath : s.pasteHelperPath;
  const axTargetLabel = s.packaged ? 'Listen K.app' : 'paste-helper';

  rows.push(buildCheckRow({
    state: s.accessibility ? 'ok' : 'err',
    glyph: s.accessibility ? '✓' : '✕',
    title: t('check.paste.title'),
    desc: s.accessibility
      ? t('check.paste.granted')
      : t('check.paste.denied', { target: axTargetLabel, path: axTargetPath || '' }),
    actions: s.accessibility ? [] : [
      { label: t('check.hotkey.openSettings'), primary: true, onClick: () => window.listenk.openSettingsPane('accessibility') },
      axTargetPath && { label: t('check.hotkey.showFinder'), onClick: () => window.listenk.showInFinder(axTargetPath) },
      axTargetPath && {
        label: t('check.hotkey.copyPath'),
        onClick: async () => { await copyToClipboard(axTargetPath); toast(t('toast.pathCopied')); },
      },
    ].filter(Boolean),
  }));

  const usingApple = s.selectedEngine === 'apple';
  const usingCpp = s.selectedEngine === 'whisper.cpp';
  const usingOAI = s.selectedEngine === 'openai';
  const usingWK = !usingApple && !usingCpp && !usingOAI;

  const engineOk = s.engine !== 'none';

  let engineLabel, enginePath, streamStatus;
  if (usingApple) {
    engineLabel = t('check.engine.apple');
    enginePath = s.appleSpeechHelper?.path;
    streamStatus = s.streamReady ? t('check.engine.streamReady') : t('check.engine.streamBooting');
  } else if (usingCpp) {
    engineLabel = t('check.engine.cpp');
    enginePath = s.whisperCppBin?.path;
    streamStatus = t('check.engine.batchMode');
  } else if (usingOAI) {
    engineLabel = t('check.engine.openai', { model: s.openai?.model || 'gpt-4o-transcribe' });
    enginePath = s.openai?.fromEnv ? t('check.engine.openaiKeyEnv') : t('check.engine.openaiKeyStored');
    streamStatus = t('check.engine.openaiDetail');
  } else {
    engineLabel = t('check.engine.whisperkit');
    enginePath = s.transcribeHelper?.path;
    streamStatus = s.streamReady ? t('check.engine.streamReady') : t('check.engine.streamInit');
  }

  let engineFixLabel = null;
  let engineFixCmd = null;
  if (!engineOk) {
    if (usingCpp) {
      engineFixLabel = t('check.engine.buildCpp');
      engineFixCmd = 'npm run build:whisper';
    } else if (usingOAI) {
      engineFixLabel = t('check.engine.needKey');
      engineFixCmd = t('check.engine.keyHint');
    } else {
      engineFixLabel = t('check.engine.buildHelper');
      engineFixCmd = 'npm run build:helper';
    }
  }

  rows.push(buildCheckRow({
    state: engineOk ? 'ok' : 'err',
    glyph: engineOk ? '✓' : '✕',
    title: t('check.engine.title'),
    desc: engineOk
      ? t('check.engine.detail', { label: engineLabel, detail: streamStatus, path: enginePath || '' })
      : t('check.engine.missing', { label: engineLabel }),
    actions: engineOk ? [] : [
      {
        label: t('check.engine.copyCmd'),
        primary: true,
        onClick: async () => {
          await copyToClipboard(engineFixCmd);
          toast(t('toast.copiedAs', { text: engineFixCmd }));
        },
      },
    ],
  }));

  if (usingWK) {
    rows.push(buildCheckRow({
      state: s.whisperKitModel ? 'ok' : 'err',
      glyph: s.whisperKitModel ? '✓' : '✕',
      title: t('check.model.title'),
      desc: s.whisperKitModel
        ? t('check.model.wk', { path: s.whisperKitModel.path })
        : t('check.model.wkMissing'),
      actions: s.whisperKitModel ? [] : [
        {
          label: t('check.model.wkCmd'),
          onClick: async () => {
            await copyToClipboard('npm run model:whisperkit');
            toast(t('toast.copiedAs', { text: 'npm run model:whisperkit' }));
          },
        },
      ],
    }));
  } else if (usingCpp) {
    rows.push(buildCheckRow({
      state: s.ggmlModel ? 'ok' : 'err',
      glyph: s.ggmlModel ? '✓' : '✕',
      title: t('check.model.title'),
      desc: s.ggmlModel
        ? t('check.model.ggml', { path: s.ggmlModel.path })
        : t('check.model.ggmlMissing'),
      actions: s.ggmlModel ? [] : [
        {
          label: t('check.model.ggmlCmd'),
          onClick: async () => {
            await copyToClipboard('npm run model:ggml:base');
            toast(t('toast.copiedAs', { text: 'npm run model:ggml:base' }));
          },
        },
      ],
    }));
  }

  if (currentHotkey === 'fn') {
    rows.push(buildCheckRow({
      state: 'info',
      glyph: 'ⓘ',
      title: t('check.fn.title'),
      desc: t('check.fn.desc'),
      actions: [
        { label: t('check.fn.openKeyboard'), onClick: () => window.listenk.openSettingsPane('keyboard') },
      ],
    }));
  }

  const mode = modeSel?.value;
  const hasGemma = s.ollama?.models?.some((m) => m.startsWith('gemma3'));
  if (mode === 'ollama' || s.ollama?.running) {
    let ollamaState, ollamaDesc, ollamaActions = [];
    if (!s.ollama?.running) {
      ollamaState = mode === 'ollama' ? 'err' : 'info';
      ollamaDesc = t('check.ollama.notRunning');
      ollamaActions = [{
        label: t('check.ollama.runCmd'),
        onClick: async () => { await copyToClipboard('brew services start ollama'); toast(t('toast.copied')); },
      }];
    } else if (!hasGemma) {
      ollamaState = mode === 'ollama' ? 'warn' : 'info';
      ollamaDesc = t('check.ollama.noModels', { models: (s.ollama.models || []).join(', ') || '—' });
      ollamaActions = [{
        label: t('check.ollama.pullCmd'),
        onClick: async () => { await copyToClipboard('ollama pull gemma3:4b'); toast(t('toast.copied')); },
      }];
    } else {
      ollamaState = 'ok';
      ollamaDesc = t('check.ollama.running', { models: s.ollama.models.join(', ') });
    }
    rows.push(buildCheckRow({
      state: ollamaState,
      glyph: ollamaState === 'ok' ? '✓' : ollamaState === 'warn' ? '!' : ollamaState === 'err' ? '✕' : 'ⓘ',
      title: mode === 'ollama' ? t('check.ollama.titleRequired') : t('check.ollama.titleOptional'),
      desc: ollamaDesc,
      actions: ollamaActions,
    }));
  }

  checkListEl.innerHTML = '';
  rows.forEach((r) => checkListEl.appendChild(r));
}

const firstRunBanner = $('firstRunBanner');
const bannerElapsedEl = $('bannerElapsed');
const bannerTitleEl = $('bannerTitle');

let bannerStart = null;
let bannerTimer = null;

function updateBannerElapsed() {
  if (!bannerElapsedEl) return;
  const s = Math.round((Date.now() - (bannerStart || Date.now())) / 1000);
  bannerElapsedEl.textContent = t('banner.elapsed', { sec: s });
  if (bannerTitleEl) {
    if (s > 120) {
      bannerTitleEl.textContent = t('banner.titleVerySlow');
      bannerElapsedEl.textContent = t('banner.elapsedHint', { sec: s });
    } else if (s > 60) {
      bannerTitleEl.textContent = t('banner.titleSlow');
    }
  }
}

function showFirstRunBanner() {
  if (!firstRunBanner) return;
  if (firstRunBanner.dataset.dismissed === 'true') return;
  if (!firstRunBanner.hidden) return;
  firstRunBanner.hidden = false;
  bannerStart = Date.now();
  updateBannerElapsed();
  if (bannerTimer) clearInterval(bannerTimer);
  bannerTimer = setInterval(updateBannerElapsed, 1000);
}

function hideFirstRunBanner() {
  if (!firstRunBanner) return;
  if (firstRunBanner.dataset.dismissed === 'true') return;
  console.log('[renderer] hiding first-run banner');
  firstRunBanner.hidden = true;
  firstRunBanner.dataset.dismissed = 'true';
  if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }
  bannerStart = null;
}

// Multiple hide triggers — any one of these is enough to permanently
// retire the banner for the rest of the session:
//   1. explicit stream-ready IPC from main
//   2. toast "전사 엔진 준비됨"
//   3. first stream-partial (we'd never get one without ready)
//   4. any successful stream-final
window.listenk?.onStreamReady?.(() => {
  console.log('[renderer] stream-ready IPC received');
  hideFirstRunBanner();
});

let lastStatusFingerprint = '';
async function refresh() {
  try {
    const status = await window.listenk.getStatus();

    if (firstRunBanner) {
      if (status.streamReady) {
        hideFirstRunBanner();
      } else if (status.engine === 'whisperkit' && !firstRunBanner.dataset.dismissed) {
        showFirstRunBanner();
      }
    }

    const fp = JSON.stringify(status);
    if (fp === lastStatusFingerprint) return;
    lastStatusFingerprint = fp;
    await renderStatus(status);
  } catch (err) {
    console.error('[renderer] status refresh failed', err);
  }
}

// ========== Transcription history ==========

const historyListEl = $('historyList');
const historyClearBtn = $('historyClearBtn');

function formatHistoryTimestamp(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const same = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (same) return `${t('history.today')} ${hh}:${mm}`;
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mo}/${dd} ${hh}:${mm}`;
  } catch {
    return iso || '';
  }
}

function buildHistoryRow(entry, highlightTerm) {
  const row = document.createElement('div');
  row.className = 'history-item';
  const mode = entry.mode || 'off';
  const modeLetter = { off: 'R', rules: 'F', ollama: 'O', translate: 'T' }[mode] || mode.charAt(0).toUpperCase();
  const modeLabel = t(`field.mode.${mode}`) || mode;
  row.innerHTML = `
    <div class="hist-avatar" data-mode="${mode}">${modeLetter}</div>
    <div class="history-body">
      <div class="history-text"></div>
      <div class="history-meta"></div>
    </div>
    <div class="history-actions">
      <button class="ghost" data-action="copy"></button>
      <button class="ghost" data-action="paste"></button>
    </div>
  `;
  const text = entry.clean || entry.raw || '';
  const textEl = row.querySelector('.history-text');
  if (highlightTerm) {
    textEl.innerHTML = highlightQuery(text, highlightTerm);
  } else {
    textEl.textContent = text;
  }
  const metaEl = row.querySelector('.history-meta');
  metaEl.textContent = '';
  const timestampSpan = document.createElement('span');
  timestampSpan.textContent = formatHistoryTimestamp(entry.at);
  metaEl.appendChild(timestampSpan);
  const modeChip = document.createElement('span');
  modeChip.className = 'hist-mode-chip';
  modeChip.textContent = modeLabel + (entry.language ? ' · ' + entry.language : '');
  metaEl.appendChild(modeChip);
  if (entry.pasted === false) {
    const notPastedSpan = document.createElement('span');
    notPastedSpan.style.color = 'var(--err)';
    notPastedSpan.textContent = t('history.notPasted');
    metaEl.appendChild(notPastedSpan);
  }
  row.querySelector('[data-action="copy"]').textContent = t('history.copy');
  row.querySelector('[data-action="paste"]').textContent = t('history.paste');

  row.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    await copyToClipboard(entry.clean || entry.raw || '');
    toast(t('toast.copied'));
  });
  row.querySelector('[data-action="paste"]').addEventListener('click', async () => {
    const text = entry.clean || entry.raw || '';
    if (!text) return;
    try {
      await window.listenk.paste(text);
      toast(t('toast.rePasted'));
    } catch (err) {
      toast(t('toast.pasteFail', { message: err.message }));
    }
  });
  return row;
}

// History view state — search query + period filter. Both live entirely in
// the renderer; the underlying historyList IPC returns the raw set, we
// filter in-memory.
let historyQuery = '';
let historyPeriod = 'all';   // 'all' | 'today' | 'week'
let historyCache = [];

function matchesHistoryPeriod(entry, period) {
  if (period === 'all') return true;
  const ts = Date.parse(entry.at);
  if (!ts) return false;
  const now = Date.now();
  if (period === 'today') {
    const d = new Date(ts);
    const n = new Date(now);
    return d.toDateString() === n.toDateString();
  }
  if (period === 'week') return now - ts < 7 * 24 * 60 * 60 * 1000;
  return true;
}

function matchesHistoryQuery(entry, q) {
  if (!q) return true;
  const hay = `${entry.clean || ''} ${entry.raw || ''}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function highlightQuery(text, q) {
  if (!q) return escapeHtml(text);
  const needle = q.toLowerCase();
  const t = String(text);
  const lo = t.toLowerCase();
  let out = '';
  let i = 0;
  while (i < t.length) {
    const idx = lo.indexOf(needle, i);
    if (idx === -1) { out += escapeHtml(t.slice(i)); break; }
    out += escapeHtml(t.slice(i, idx));
    out += `<mark class="history-highlight">${escapeHtml(t.slice(idx, idx + needle.length))}</mark>`;
    i = idx + needle.length;
  }
  return out;
}

function renderHistoryList() {
  if (!historyListEl) return;
  const filtered = historyCache.filter((e) =>
    matchesHistoryPeriod(e, historyPeriod) && matchesHistoryQuery(e, historyQuery));
  historyListEl.innerHTML = '';
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = historyQuery || historyPeriod !== 'all'
      ? t('history.filterEmpty')
      : t('page.history.empty');
    historyListEl.appendChild(empty);
    return;
  }
  filtered.forEach((e) => historyListEl.appendChild(buildHistoryRow(e, historyQuery)));
}

async function refreshHistory() {
  if (!historyListEl) return;
  try {
    historyCache = await window.listenk.historyList(200);
    renderHistoryList();
  } catch (err) {
    console.warn('[history] refresh failed', err);
  }
}

historyClearBtn?.addEventListener('click', async () => {
  if (!confirm(t('page.history.confirmClear'))) return;
  await window.listenk.historyClear();
  refreshHistory();
  toast(t('toast.historyCleared'));
});

// History search + period filter — in-memory over the last 200 entries.
const historySearchEl = $('historySearch');
historySearchEl?.addEventListener('input', () => {
  historyQuery = historySearchEl.value.trim();
  renderHistoryList();
});
document.querySelectorAll('.filter-chip[data-filter-period]').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-filter-period]').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    historyPeriod = chip.getAttribute('data-filter-period') || 'all';
    renderHistoryList();
  });
});

refreshHistory();

refreshBtn?.addEventListener('click', () => {
  lastStatusFingerprint = '';  // force redraw on user-initiated refresh
  refresh();
  refreshHistory();
  refreshStats();
  refreshStatsCharts();
  refreshKpiTiles();
});

// ========== Usage stats ==========

const statsContentEl = $('statsContent');
const statsClearBtn = $('statsClearBtn');

const ENGINE_LABELS = {
  apple: 'Apple Speech',
  whisperkit: 'WhisperKit',
  'whisper.cpp': 'whisper.cpp',
  openai: 'OpenAI Whisper API',
};

function fmtDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0));
  if (s < 60) return t('stats.duration.sec', { sec: s });
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return t('stats.duration.min', { min: m, sec: rem });
  const h = Math.floor(m / 60);
  return t('stats.duration.hour', { hour: h, min: m % 60 });
}
function fmtUSD(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(3)}`;
}
function fmtNum(n) {
  const locale = window.i18n ? window.i18n.getLocale() : 'en';
  return (Number(n) || 0).toLocaleString(locale);
}

function buildStatRow(title, value, help) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `
    <div class="field-info">
      <div class="field-title"></div>
      ${help ? '<div class="field-help"></div>' : ''}
    </div>
    <div class="field-control" style="font-variant-numeric: tabular-nums; font-weight: 500;"></div>
  `;
  row.querySelector('.field-title').textContent = title;
  if (help) row.querySelector('.field-help').textContent = help;
  row.querySelector('.field-control').textContent = value;
  return row;
}

function buildStatsGroup(titleText, rows) {
  const box = document.createElement('div');
  box.className = 'fields';
  box.style.marginBottom = 'var(--space-4)';
  rows.forEach((r) => box.appendChild(r));
  const wrap = document.createElement('div');
  if (titleText) {
    const h = document.createElement('div');
    h.textContent = titleText;
    h.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--text-3); letter-spacing: 0.8px; text-transform: uppercase; margin: var(--space-4) 0 var(--space-2);';
    wrap.appendChild(h);
  }
  wrap.appendChild(box);
  return wrap;
}

async function refreshStats() {
  if (!statsContentEl || !window.listenk?.statsGet) return;
  let payload;
  try { payload = await window.listenk.statsGet(); }
  catch (err) {
    statsContentEl.innerHTML = '';
    statsContentEl.appendChild(buildStatRow(t('stats.loadFail'), err.message || ''));
    return;
  }
  const stats = payload?.stats;
  if (!stats) return;

  statsContentEl.innerHTML = '';

  // Summary group
  const totalCalls = Object.values(stats.counters.callsByEngine || {}).reduce((a, b) => a + (b || 0), 0);
  const totalSec = Object.values(stats.counters.audioSecByEngine || {}).reduce((a, b) => a + (b || 0), 0);
  const todayCalls = Object.values(stats.today.callsByEngine || {}).reduce((a, b) => a + (b || 0), 0);
  const todaySec = Object.values(stats.today.audioSecByEngine || {}).reduce((a, b) => a + (b || 0), 0);

  statsContentEl.appendChild(buildStatsGroup(t('stats.section.summary'), [
    buildStatRow(t('stats.totalCalls'), fmtNum(totalCalls)),
    buildStatRow(t('stats.totalDuration'), fmtDuration(totalSec)),
    buildStatRow(t('stats.todayCalls'), `${fmtNum(todayCalls)} · ${fmtDuration(todaySec)}`),
  ]));

  // Per-engine breakdown
  const engines = Array.from(new Set([
    ...Object.keys(stats.counters.callsByEngine || {}),
    ...Object.keys(stats.counters.audioSecByEngine || {}),
  ])).sort();
  const engineRows = engines.map((eng) => {
    const calls = stats.counters.callsByEngine?.[eng] || 0;
    const sec = stats.counters.audioSecByEngine?.[eng] || 0;
    const isOai = eng === 'openai';
    const cost = isOai ? stats.counters.openaiCost || 0 : null;
    const label = t(`engineLabel.${eng}`) || eng;
    const callsStr = t('stats.countCalls', { n: fmtNum(calls) });
    const value = cost != null
      ? t('stats.engineLineWithCost', { calls: callsStr, duration: fmtDuration(sec), cost: fmtUSD(cost) })
      : t('stats.engineLine', { calls: callsStr, duration: fmtDuration(sec) });
    const help = isOai
      ? Object.entries(stats.counters.openaiCallsByModel || {})
          .map(([m, n]) => `${m}: ${t('stats.countCalls', { n })}`)
          .join(' · ')
      : '';
    return buildStatRow(label, value, help);
  });
  if (engineRows.length === 0) {
    engineRows.push(buildStatRow(t('stats.empty.title'), t('stats.empty.desc')));
  }
  statsContentEl.appendChild(buildStatsGroup(t('stats.section.byEngine'), engineRows));

  // OpenAI cost breakdown
  if ((stats.counters.openaiCost || 0) > 0 || (stats.today.openaiCost || 0) > 0) {
    const rates = payload.openaiRatesPerMin || {};
    const ratesText = Object.entries(rates)
      .map(([m, r]) => `${m}: $${r}/min`)
      .join(' · ');
    statsContentEl.appendChild(buildStatsGroup(t('stats.section.openaiCost'), [
      buildStatRow(t('stats.cumulative'), fmtUSD(stats.counters.openaiCost || 0), ratesText),
      buildStatRow(t('stats.today'), fmtUSD(stats.today.openaiCost || 0)),
    ]));
  }

  // Ollama tokens
  if ((stats.counters.ollamaCalls || 0) > 0) {
    statsContentEl.appendChild(buildStatsGroup(t('stats.section.ollama'), [
      buildStatRow(t('stats.ollamaCalls'), t('stats.countCalls', { n: fmtNum(stats.counters.ollamaCalls || 0) })),
      buildStatRow(t('stats.tokensCumulative'), t('stats.tokensValue', {
        in: fmtNum(stats.counters.ollamaPromptTokens || 0),
        out: fmtNum(stats.counters.ollamaEvalTokens || 0),
      })),
      buildStatRow(t('stats.tokensToday'), t('stats.tokensValue', {
        in: fmtNum(stats.today.ollamaPromptTokens || 0),
        out: fmtNum(stats.today.ollamaEvalTokens || 0),
      })),
    ]));
  }

  if (stats.firstSeenAt) {
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top: var(--space-4); font-size: 11px; color: var(--text-4); text-align: center;';
    const locale = window.i18n ? window.i18n.getLocale() : 'en';
    const since = new Date(stats.firstSeenAt).toLocaleDateString(locale);
    foot.textContent = t('stats.firstSeen', { date: since });
    statsContentEl.appendChild(foot);
  }
}

// ----- Stats page: bar chart (14d) + engine donut -----
//
// The bar chart is derived from history.jsonl timestamps (already on disk)
// so we don't need a new daily-bucket schema in stats.json. The donut reads
// cumulative call counts per engine directly from stats counters.

const statsBarChartEl = $('statsBarChart');
const statsDonutEl = $('statsDonut');
const statsDonutLegendEl = $('statsDonutLegend');
const statsKpiTilesEl = $('statsKpiTiles');
const ENGINE_COLORS = {
  whisperkit: '#5b8dff',
  apple: '#b367ff',
  openai: '#4ade80',
  'whisper.cpp': '#fbbf24',
};

function dayBucketKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function refreshStatsCharts() {
  if (!statsBarChartEl && !statsDonutEl && !statsKpiTilesEl) return;
  let payload, history = [];
  try { payload = await window.listenk?.statsGet?.(); } catch {}
  try { history = await window.listenk?.historyList?.(500) || []; } catch {}
  const stats = payload?.stats;
  if (!stats) return;

  // --- KPI tiles on Stats page (mirror dashboard but phrased for stats) ---
  if (statsKpiTilesEl) {
    const totalCalls = Object.values(stats.counters.callsByEngine || {}).reduce((a, b) => a + (b || 0), 0);
    const totalSec = Object.values(stats.counters.audioSecByEngine || {}).reduce((a, b) => a + (b || 0), 0);
    const todayCalls = Object.values(stats.today.callsByEngine || {}).reduce((a, b) => a + (b || 0), 0);
    const todaySec = Object.values(stats.today.audioSecByEngine || {}).reduce((a, b) => a + (b || 0), 0);
    const cost = stats.counters.openaiCost || 0;
    const unit = t('kpi.unitTimes');
    const withUnit = (v) => unit ? `${v}<span class="kpi-unit">${unit}</span>` : String(v);
    const tiles = [
      { label: t('stats.totalCalls'), valueHtml: withUnit(fmtNum(totalCalls)), detail: fmtDuration(totalSec) },
      { label: t('stats.todayCalls'), valueHtml: withUnit(fmtNum(todayCalls)), detail: fmtDuration(todaySec), cls: todayCalls > 0 ? 'up' : '' },
      { label: t('stats.section.openaiCost'), valueHtml: fmtUSD(cost), detail: cost > 0 ? 'OpenAI' : '—', cls: cost > 0 ? 'hint' : '' },
      { label: t('stats.section.ollama'), valueHtml: withUnit(fmtNum(stats.counters.ollamaCalls || 0)), detail: t('stats.tokensValue', {
          in: fmtNum(stats.counters.ollamaPromptTokens || 0),
          out: fmtNum(stats.counters.ollamaEvalTokens || 0),
        }) },
    ];
    statsKpiTilesEl.innerHTML = '';
    for (const tile of tiles) {
      const el = document.createElement('div');
      el.className = 'kpi-tile';
      const detailClass = 'kpi-detail' + (tile.cls ? ' ' + tile.cls : '');
      el.innerHTML = `<div class="kpi-label"></div><div class="kpi-value"></div><div class="${detailClass}"></div>`;
      el.querySelector('.kpi-label').textContent = tile.label;
      el.querySelector('.kpi-value').innerHTML = tile.valueHtml;
      el.querySelector('.kpi-detail').textContent = tile.detail;
      statsKpiTilesEl.appendChild(el);
    }
  }

  // --- 14-day bar chart from history timestamps (seconds per day) ---
  if (statsBarChartEl) {
    const bucketSec = {};
    for (const entry of history) {
      const ts = Date.parse(entry.at);
      if (!ts) continue;
      const day = dayBucketKey(new Date(ts));
      bucketSec[day] = (bucketSec[day] || 0) + 20; // coarse estimate — history entries don't carry audioSec
    }
    // Today's audio seconds from stats (more accurate than estimate).
    const today = new Date();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      days.push({ date: d, key: dayBucketKey(d) });
    }
    const maxSec = Math.max(1, ...days.map((d) => bucketSec[d.key] || 0));
    const todayKey = dayBucketKey(today);
    statsBarChartEl.innerHTML = '';
    days.forEach(({ date, key }) => {
      const sec = bucketSec[key] || 0;
      const pct = Math.max(sec / maxSec, 0.015) * 100; // min visible stub
      const bar = document.createElement('div');
      bar.className = 'bar' + (key === todayKey ? ' today' : '');
      bar.style.height = `${pct}%`;
      bar.setAttribute('data-label', String(date.getDate()));
      if (sec > 0) bar.setAttribute('data-value', fmtDuration(sec));
      statsBarChartEl.appendChild(bar);
    });
  }

  // --- Donut: engine share of cumulative calls ---
  if (statsDonutEl && statsDonutLegendEl) {
    const calls = stats.counters.callsByEngine || {};
    const total = Object.values(calls).reduce((a, b) => a + (b || 0), 0);
    statsDonutEl.innerHTML = '';
    statsDonutLegendEl.innerHTML = '';
    // SVG ring: circumference = 2π·15.915 ≈ 100 (percentage-friendly).
    const ns = 'http://www.w3.org/2000/svg';
    const track = document.createElementNS(ns, 'circle');
    track.setAttribute('cx', '21'); track.setAttribute('cy', '21');
    track.setAttribute('r', '15.915'); track.setAttribute('fill', 'none');
    track.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue('--bg-3').trim() || '#1a1a1f');
    track.setAttribute('stroke-width', '6');
    statsDonutEl.appendChild(track);

    const entries = Object.entries(calls)
      .filter(([, v]) => (v || 0) > 0)
      .sort((a, b) => b[1] - a[1]);
    let offset = 0;
    for (const [engine, count] of entries) {
      const pct = total > 0 ? (count / total) * 100 : 0;
      const seg = document.createElementNS(ns, 'circle');
      seg.setAttribute('cx', '21'); seg.setAttribute('cy', '21');
      seg.setAttribute('r', '15.915'); seg.setAttribute('fill', 'none');
      seg.setAttribute('stroke', ENGINE_COLORS[engine] || '#94a3b8');
      seg.setAttribute('stroke-width', '6');
      seg.setAttribute('stroke-dasharray', `${pct.toFixed(2)} ${(100 - pct).toFixed(2)}`);
      seg.setAttribute('stroke-dashoffset', String(25 - offset));
      seg.setAttribute('transform', 'rotate(-90 21 21)');
      statsDonutEl.appendChild(seg);
      offset += pct;

      const legend = document.createElement('div');
      legend.className = 'legend-row';
      legend.innerHTML = `
        <span class="swatch" style="background: ${ENGINE_COLORS[engine] || '#94a3b8'}"></span>
        <span class="label"></span>
        <span class="pct"></span>
      `;
      legend.querySelector('.label').textContent = t(`engineLabel.${engine}`) || engine;
      legend.querySelector('.pct').textContent = `${pct.toFixed(0)}%`;
      statsDonutLegendEl.appendChild(legend);
    }
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'legend-row';
      empty.style.color = 'var(--text-4)';
      empty.textContent = '—';
      statsDonutLegendEl.appendChild(empty);
    }
  }
}

// KPI tiles on the Status page — condensed view of the same stats that
// the dedicated Stats page renders in full. Pulls from the same IPC so
// today's numbers are always in sync.
const kpiTilesEl = $('kpiTiles');
async function refreshKpiTiles() {
  if (!kpiTilesEl || !window.listenk?.statsGet) return;
  let payload;
  try { payload = await window.listenk.statsGet(); } catch { return; }
  const stats = payload?.stats;
  if (!stats) return;

  const totalCalls = Object.values(stats.counters.callsByEngine || {}).reduce((a, b) => a + (b || 0), 0);
  const totalSec = Object.values(stats.counters.audioSecByEngine || {}).reduce((a, b) => a + (b || 0), 0);
  const todayCalls = Object.values(stats.today.callsByEngine || {}).reduce((a, b) => a + (b || 0), 0);
  const todaySec = Object.values(stats.today.audioSecByEngine || {}).reduce((a, b) => a + (b || 0), 0);
  const cost = stats.counters.openaiCost || 0;
  const unit = t('kpi.unitTimes');
  const withUnit = (v) => unit ? `${v}<span class="kpi-unit">${unit}</span>` : String(v);

  const tiles = [
    {
      label: t('kpi.todayCalls'),
      valueHtml: withUnit(fmtNum(todayCalls)),
      detail: t('kpi.detail.trendDuration', { duration: fmtDuration(todaySec) }),
      detailKind: todayCalls > 0 ? 'up' : '',
    },
    {
      label: t('kpi.totalCalls'),
      valueHtml: withUnit(fmtNum(totalCalls)),
      detail: fmtDuration(totalSec),
    },
    {
      label: t('kpi.openaiCost'),
      valueHtml: fmtUSD(cost),
      detail: cost > 0 ? 'OpenAI Whisper API' : '—',
      detailKind: cost > 0 ? 'hint' : '',
    },
    {
      label: t('kpi.ollamaCalls'),
      valueHtml: withUnit(fmtNum(stats.counters.ollamaCalls || 0)),
      detail: t('stats.tokensValue', {
        in: fmtNum(stats.counters.ollamaPromptTokens || 0),
        out: fmtNum(stats.counters.ollamaEvalTokens || 0),
      }),
    },
  ];

  kpiTilesEl.innerHTML = '';
  for (const tile of tiles) {
    const el = document.createElement('div');
    el.className = 'kpi-tile';
    const detailClass = 'kpi-detail' + (tile.detailKind ? ' ' + tile.detailKind : '');
    el.innerHTML = `
      <div class="kpi-label"></div>
      <div class="kpi-value"></div>
      <div class="${detailClass}"></div>
    `;
    el.querySelector('.kpi-label').textContent = tile.label;
    el.querySelector('.kpi-value').innerHTML = tile.valueHtml;
    el.querySelector('.kpi-detail').textContent = tile.detail;
    kpiTilesEl.appendChild(el);
  }
}

// History count badge in the sidebar. Hidden until we have a count to show.
const navCountHistoryEl = $('navCountHistory');
async function refreshNavCounts() {
  if (!navCountHistoryEl || !window.listenk?.historyList) return;
  try {
    const entries = await window.listenk.historyList(1000);
    const n = entries?.length || 0;
    if (n > 0) {
      navCountHistoryEl.textContent = fmtNum(n);
      navCountHistoryEl.hidden = false;
    } else {
      navCountHistoryEl.hidden = true;
    }
  } catch {}
}

// Hero action buttons route to in-app behaviour rather than invent new
// flows — "Record now" = trigger the same toggle the hotkey fires,
// "Change hotkey" = switch to the input settings page.
const heroRecBtn = $('heroRecBtn');
const heroHotkeyBtn = $('heroHotkeyBtn');
heroRecBtn?.addEventListener('click', () => {
  if (streamingActive || recording) return;
  // If a streaming engine is ready, trigger the same path the hotkey uses;
  // otherwise fall back to the legacy batch capture.
  toggleRecord();
});
heroHotkeyBtn?.addEventListener('click', () => {
  const link = document.querySelector('.nav-item[data-section="sec-input"]');
  if (link) link.click();
});

statsClearBtn?.addEventListener('click', async () => {
  if (!confirm(t('page.stats.confirmClear'))) return;
  await window.listenk.statsClear();
  refreshStats();
  refreshStatsCharts();
  refreshKpiTiles();
  toast(t('toast.statsCleared'));
});

refreshStats();
refreshStatsCharts();

function applyModeVisibility(mode) {
  document.querySelectorAll('[data-mode-only]').forEach((el) => {
    const allowed = el.dataset.modeOnly.split(',').map((s) => s.trim());
    el.style.display = allowed.includes(mode) ? '' : 'none';
  });
}

// ---- Ollama model dropdown population + persistence ----

let savedOllamaModel = '';

function populateOllamaModels(models) {
  if (!modelInput) return;
  const list = Array.isArray(models) ? models : [];
  const previousValue = modelInput.value;
  while (modelInput.options.length > 0) modelInput.remove(0);

  if (list.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('field.ollamaModel.none');
    opt.disabled = true;
    modelInput.appendChild(opt);
    modelInput.value = '';
    return;
  }

  for (const name of list) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    modelInput.appendChild(opt);
  }

  // Restore previous selection if still present, else saved config, else first.
  const candidate = [previousValue, savedOllamaModel].find((v) => v && list.includes(v));
  modelInput.value = candidate || list[0];
}

function applyEngineVisibility(engine) {
  document.querySelectorAll('[data-engine-only]').forEach((el) => {
    el.style.display = el.dataset.engineOnly === engine ? '' : 'none';
  });
}

const HOTKEY_LABELS = {
  'ropt-double': '⌥⌥',
  'rctl-double': '⌃⌃',
  'rcmd-double': '⌘⌘',
  'rshift-double': '⇧⇧',
  'fn': 'fn',
};

let currentHotkey = 'rshift-double';

function applyHotkeyHint(mode) {
  currentHotkey = mode || 'rshift-double';
  const hintEls = document.querySelectorAll('.hotkey-hint, #hotkeyHint');
  const label = HOTKEY_LABELS[currentHotkey] || '⇧⇧';
  hintEls.forEach((el) => { el.textContent = label; });
}

// ---------- Bootstrap ----------
//
// Restore every persisted setting BEFORE wiring up change listeners, so
// the act of painting the default DOM value never races the saved
// config and overwrites it. Each change listener in turn writes its own
// field back through an IPC setter.

const api = window.listenk;
let settingsReady = false;

async function restoreSettings() {
  if (!api) return;

  const safe = async (fn) => { try { return await fn(); } catch { return null; } };
  const [hotkey, language, streaming, engine, mode, tone, translateTarget, ollamaModel, wkModels, openaiKeyInfo, openaiModel, uiLocaleInfo] = await Promise.all([
    safe(() => api.getHotkey?.()),
    safe(() => api.getLanguage?.()),
    safe(() => api.getStreaming?.()),
    safe(() => api.getEngine?.()),
    safe(() => api.getMode?.()),
    safe(() => api.getTone?.()),
    safe(() => api.getTranslateTarget?.()),
    safe(() => api.getOllamaModel?.()),
    safe(() => api.listWhisperModels?.()),
    safe(() => api.getOpenAiKey?.()),
    safe(() => api.getOpenAiModel?.()),
    safe(() => api.getUiLocale?.()),
  ]);

  // Apply UI locale BEFORE painting any translated DOM so the first render
  // is already in the user's chosen language (no flash of English).
  if (uiLocaleInfo?.locale && window.i18n) {
    window.i18n.setLocale(uiLocaleInfo.locale);
    if (uiLocaleSel) uiLocaleSel.value = uiLocaleInfo.locale;
  }
  applyTranslations();

  if (hotkey && hotkeySel) hotkeySel.value = hotkey;
  applyHotkeyHint(hotkey || 'rshift-double');

  if (language && langSel) langSel.value = language;

  if (streamingSel) streamingSel.value = streaming === false ? 'off' : 'on';

  if (engine && engineSel) engineSel.value = engine;
  applyEngineVisibility(engine || 'whisperkit');
  renderEngineCards(engine || 'whisperkit');

  if (mode && modeSel) modeSel.value = mode;
  applyModeVisibility(modeSel?.value || 'off');

  if (tone && toneSel) toneSel.value = tone;

  if (translateTarget && translateTargetSel) translateTargetSel.value = translateTarget;

  if (ollamaModel) savedOllamaModel = ollamaModel;

  if (whisperModelSel && wkModels) {
    while (whisperModelSel.options.length > 1) whisperModelSel.remove(1);
    for (const name of wkModels.available || []) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      whisperModelSel.appendChild(opt);
    }
    whisperModelSel.value = wkModels.selected || '';
  }

  applyOpenAiKeyHint(openaiKeyInfo);
  if (openaiModel && openaiModelSel) openaiModelSel.value = openaiModel;

  settingsReady = true;
}

// Paint the OpenAI key input's placeholder based on current storage state.
// Called (a) once at boot, and (b) every time the user switches TO the
// openai engine, so the hint reflects reality instead of going blank.
function applyOpenAiKeyHint(info) {
  if (!openaiKeyInput) return;
  // Always clear the value so the secret isn't sitting in the DOM.
  openaiKeyInput.value = '';
  openaiKeyInput.disabled = false;
  if (!info) {
    openaiKeyInput.placeholder = 'sk-...';
    return;
  }
  if (info.fromEnv) {
    openaiKeyInput.placeholder = t('field.openaiKey.placeholderFromEnv');
    openaiKeyInput.disabled = true;
  } else if (info.hasKey) {
    openaiKeyInput.placeholder = info.encrypted
      ? t('field.openaiKey.placeholderEncrypted')
      : t('field.openaiKey.placeholderPlaintext');
  } else {
    openaiKeyInput.placeholder = t('field.openaiKey.placeholder');
  }
}

async function refreshOpenAiKeyHint() {
  if (!api?.getOpenAiKey) return;
  try {
    const info = await api.getOpenAiKey();
    applyOpenAiKeyHint(info);
  } catch {}
}

// Each setter guard: only write once `settingsReady` is true, so the
// initial DOM defaults never clobber the restored config values.

hotkeySel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  const mode = hotkeySel.value;
  try {
    const res = await api.setHotkey(mode);
    if (res?.ok) {
      const label = hotkeySel.options[hotkeySel.selectedIndex].textContent;
      toast(t('toast.hotkey', { label }));
      applyHotkeyHint(mode);
      setTimeout(refresh, 400);
    } else {
      toast(t('toast.hotkeyFail'));
    }
  } catch (err) {
    toast(t('toast.changeFail', { message: err.message }));
  }
});

langSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  await api.setLanguage?.(langSel.value);
  toast(t('toast.lang', { label: langSel.options[langSel.selectedIndex].textContent }));
});

streamingSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  const enabled = streamingSel.value === 'on';
  await api.setStreaming?.(enabled);
  toast(t('toast.streaming', { label: enabled ? t('field.streaming.on') : t('field.streaming.off') }));
});

modeSel?.addEventListener('change', async () => {
  applyModeVisibility(modeSel.value);
  if (!settingsReady) return;
  await api.setMode?.(modeSel.value);
  lastStatusFingerprint = '';
  refresh();
});

toneSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  await api.setTone?.(toneSel.value);
});

translateTargetSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  await api.setTranslateTarget?.(translateTargetSel.value);
  toast(t('toast.translateTarget', { label: translateTargetSel.options[translateTargetSel.selectedIndex].textContent }));
});

engineSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  const engine = engineSel.value;
  await api.setEngine?.(engine);
  applyEngineVisibility(engine);
  renderEngineCards(engine);
  // When coming back to OpenAI, the password input might be stale — refresh
  // its placeholder to reflect whether a key is currently stored/encrypted.
  if (engine === 'openai') refreshOpenAiKeyHint();
  const label = engineSel.options[engineSel.selectedIndex]?.textContent || engine;
  toast(t('toast.engineChange', { label }));
  lastStatusFingerprint = '';
  setTimeout(refresh, 500);
});

// ----- Engine card picker -----
// Replaces the plain <select> with a visual card grid. Cards delegate to
// the hidden <select> (fire change event) so the existing engine change
// handler stays the single source of truth.
const engineGridEl = $('engineGrid');
const ENGINE_CARDS = [
  {
    id: 'whisperkit',
    name: 'WhisperKit',
    badge: { cls: 'local', label: 'Local' },
    descKey: 'engineCard.whisperkit.desc',
    metrics: [
      { labelKey: 'engineCard.latency', value: '~0.6s' },
      { labelKey: 'engineCard.quality', value: '★★★★☆' },
    ],
  },
  {
    id: 'apple',
    name: 'Apple Speech',
    badge: { cls: 'local', label: 'Local' },
    descKey: 'engineCard.apple.desc',
    metrics: [
      { labelKey: 'engineCard.latency', value: '~0.3s' },
      { labelKey: 'engineCard.quality', value: '★★★☆☆' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    badge: { cls: 'cloud', label: 'Cloud' },
    descKey: 'engineCard.openai.desc',
    metrics: [
      { labelKey: 'engineCard.latency', value: '~1.2s' },
      { labelKey: 'engineCard.quality', value: '★★★★★' },
    ],
  },
  {
    id: 'whisper.cpp',
    name: 'whisper.cpp',
    badge: { cls: 'experimental', label: 'Batch' },
    descKey: 'engineCard.cpp.desc',
    metrics: [
      { labelKey: 'engineCard.latency', value: 'batch' },
      { labelKey: 'engineCard.quality', value: '★★★☆☆' },
    ],
  },
];

function renderEngineCards(selectedEngine) {
  if (!engineGridEl) return;
  engineGridEl.innerHTML = '';
  for (const spec of ENGINE_CARDS) {
    const card = document.createElement('div');
    card.className = 'engine-card' + (selectedEngine === spec.id ? ' selected' : '');
    card.setAttribute('data-engine', spec.id);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <div class="top">
        <span class="name"></span>
        <span class="badge ${spec.badge.cls}"></span>
      </div>
      <div class="desc"></div>
      <div class="metrics">
        <div class="metric"><span class="l"></span><b></b></div>
        <div class="metric"><span class="l"></span><b></b></div>
      </div>
      <div class="selected-mark" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="10" height="10"><path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    `;
    card.querySelector('.name').textContent = spec.name;
    card.querySelector('.badge').textContent = spec.badge.label;
    card.querySelector('.desc').textContent = t(spec.descKey);
    const metricEls = card.querySelectorAll('.metric');
    spec.metrics.forEach((m, i) => {
      metricEls[i].querySelector('.l').textContent = t(m.labelKey);
      metricEls[i].querySelector('b').textContent = m.value;
    });
    card.addEventListener('click', () => selectEngineCard(spec.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectEngineCard(spec.id); }
    });
    engineGridEl.appendChild(card);
  }
}

function selectEngineCard(id) {
  if (!engineSel || engineSel.value === id) return;
  engineSel.value = id;
  engineSel.dispatchEvent(new Event('change'));
}

whisperModelSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  const name = whisperModelSel.value;
  await api.setWhisperModel?.(name);
  toast(name ? `모델: ${name} (재로딩 중)` : '자동 선택 (재로딩 중)');
  lastStatusFingerprint = '';
  setTimeout(refresh, 500);
});

modelInput?.addEventListener('change', async () => {
  if (!settingsReady) return;
  if (!modelInput.value) return;
  savedOllamaModel = modelInput.value;
  await api.setOllamaModel?.(savedOllamaModel);
  toast(t('toast.ollamaModel', { label: savedOllamaModel }));
});

openaiKeyInput?.addEventListener('change', async () => {
  if (!settingsReady) return;
  const raw = openaiKeyInput.value.trim();
  // Empty value = user wants to clear. Non-empty = save as the new key.
  const res = await api.setOpenAiKey?.(raw);
  if (res?.ok) {
    toast(raw
      ? (res.encrypted ? t('toast.openaiKeySavedEncrypted') : t('toast.openaiKeySaved'))
      : t('toast.openaiKeyDeleted'));
    await refreshOpenAiKeyHint();
    lastStatusFingerprint = '';
    refresh();
  } else {
    toast(res?.reason ? t('toast.openaiKeyFailReason', { reason: res.reason }) : t('toast.openaiKeyFail'));
  }
});

openaiModelSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  const model = openaiModelSel.value;
  await api.setOpenAiModel?.(model);
  toast(t('toast.openaiModel', { label: model }));
});

uiLocaleSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  const loc = uiLocaleSel.value;
  await api.setUiLocale?.(loc);
  if (window.i18n) window.i18n.setLocale(loc);
  applyTranslations();
  // Re-render the dynamic status + stats rows so their strings pick up the
  // new locale immediately without waiting for the next 4-second poll.
  lastStatusFingerprint = '';
  refresh();
  refreshStats();
  refreshStatsCharts();
  refreshKpiTiles();
  refreshHistory();
  const label = window.i18n?.LOCALE_LABELS?.[loc] || loc;
  toast(t('toast.uiLocale', { label }));
});

// ---- Sidebar nav: page routing ----
//
// Each sidebar item maps to exactly one .page section. Clicking shows that
// page and hides the rest. The non-page sections (firstRunBanner,
// recentCard) keep their own show/hide logic and stack above the active
// page when visible.
function wireSidebarNavigation() {
  const contentEl = document.getElementById('content');
  const navItems = Array.from(document.querySelectorAll('.nav-item'));
  const pages = Array.from(document.querySelectorAll('.page'));
  if (!contentEl || !navItems.length || !pages.length) return;

  const pageIds = new Set(pages.map((p) => p.id));

  const showPage = (id) => {
    if (!pageIds.has(id)) return;
    pages.forEach((p) => {
      if (p.id === id) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    });
    navItems.forEach((a) => a.classList.toggle('active', a.dataset.section === id));
    contentEl.scrollTop = 0;
    try { sessionStorage.setItem('listenk:active-page', id); } catch {}
  };

  navItems.forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.dataset.section || (a.getAttribute('href') || '').replace(/^#/, '');
      if (!id) return;
      showPage(id);
    });
  });

  // Restore last-viewed page across reloads (falls back to first nav item).
  let initial = '';
  try { initial = sessionStorage.getItem('listenk:active-page') || ''; } catch {}
  if (!initial || !pageIds.has(initial)) initial = navItems[0]?.dataset.section || '';
  showPage(initial);
}

// Wire sidebar nav immediately so clicks respond even if the IPC-based
// settings restore below is slow on first run.
wireSidebarNavigation();

(async () => {
  await restoreSettings();
  refresh();
  refreshNavCounts();
  setInterval(() => {
    refresh();
    refreshStats();
    refreshStatsCharts();
    refreshKpiTiles();
    refreshNavCounts();
  }, 4000);
})();
