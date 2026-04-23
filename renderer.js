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
const themeSel = $('theme');
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

// Engine readiness — updated on every status poll. When the engine is
// loaded and idle, the chip reads "준비됨" (Ready) in green instead of
// the neutral "대기" (Idle) so users see the app is warm at a glance.
let engineIsReady = false;
function setStatusIdleOrReady() {
  if (engineIsReady) setStatus(t('status.ready'), 'ok');
  else setStatus(t('status.idle'), '');
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
  setTimeout(() => setStatusIdleOrReady(), 1200);
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
  setTimeout(() => setStatusIdleOrReady(), 1500);
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

// Map the Whisper language hint (ko-KR / en-US / ja-JP / zh-CN / auto) to
// the 2-letter prompt bucket. `auto` and anything unrecognised fall through
// to English — smaller Ollama models (gemma3:4b) follow the system prompt
// more literally than they translate transcripts, so English instructions
// + an explicit "keep the original language" rule is the safest default.
function promptLocale() {
  const hint = (langSel && langSel.value) || 'auto';
  if (hint.startsWith('ko')) return 'ko';
  if (hint.startsWith('ja')) return 'ja';
  if (hint.startsWith('zh')) return 'zh';
  return 'en';
}

const CLEANUP_TONE = {
  ko: {
    neutral: '자연스럽고 깔끔한 문어체로',
    formal: '격식 있는 존댓말로',
    casual: '친근한 구어체로',
    email: '이메일에 적합한 정중하고 간결한 톤으로',
    _default: '자연스럽게',
  },
  en: {
    neutral: 'into clean, natural written prose',
    formal: 'in a formal, respectful tone',
    casual: 'in a friendly, conversational tone',
    email: 'in a polite, concise tone suitable for email',
    _default: 'naturally',
  },
  ja: {
    neutral: '自然で整った文体で',
    formal: '丁寧な敬語で',
    casual: '親しみやすい口語で',
    email: 'メールに適した丁寧で簡潔な文体で',
    _default: '自然に',
  },
  zh: {
    neutral: '改写成自然通顺的书面语',
    formal: '改写成正式、恭敬的语气',
    casual: '改写成亲切的口语',
    email: '改写成适合邮件的礼貌且简洁的语气',
    _default: '自然地',
  },
};

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

  const lang = promptLocale();
  const tones = CLEANUP_TONE[lang];
  const toneInstruction = tones[toneSel.value] || tones._default;

  if (lang === 'ko') {
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

  if (lang === 'ja') {
    return `あなたは音声入力の結果を整形する編集者です。以下は話者の発話をそのまま書き起こしたものです。

ルール:
1. 「えー」「あー」「そのー」「まあ」「um」「uh」「you know」などのフィラーを除去
2. 繰り返しを整理
3. 言い直しがある場合は最終的な意図に沿って文脈を合わせる
4. 箇条書きや段階的な内容は改行で整える
5. 句読点と大文字小文字を自然に復元
6. ${toneInstruction} 仕上げ、意味と原文の言語は維持
7. 翻訳しないこと。内容の要約や追加もしないこと。
8. 解説をつけず、整形後のテキストだけを出力。

原文:
"""
${raw}
"""

整形後のテキスト:`;
  }

  if (lang === 'zh') {
    return `你是一个语音听写结果整理编辑。以下原文是用户口述的逐字稿。

规则:
1. 删除 "嗯"、"啊"、"这个"、"那个"、"就是"、"um"、"uh"、"you know" 等填充词
2. 整理重复表述
3. 若有中途改口,按最终意图顺畅地改写
4. 如果讲到列表或步骤,用换行分隔
5. 自然还原标点和大小写
6. ${toneInstruction},但保留原意与原始语言
7. 不要翻译。不要总结或添加内容。
8. 不要加任何说明,只输出整理后的文本。

原文:
"""
${raw}
"""

整理后的文本:`;
  }

  // default: English
  return `You are an editor cleaning up a voice-dictation transcript. The text below is a word-for-word capture of the user speaking.

Rules:
1. Remove fillers like "um", "uh", "you know", "like", "so", "I mean".
2. Collapse repeated phrases.
3. When the speaker self-corrects mid-sentence, follow the final intent.
4. If they enumerated items or steps, use line breaks.
5. Restore punctuation and capitalisation naturally.
6. Rewrite ${toneInstruction}, but keep the meaning and the original language intact.
7. Do NOT translate. Do NOT summarise or add anything.
8. Output only the cleaned-up text — no commentary, no quotes, no preamble.

Source:
"""
${raw}
"""

Cleaned-up text:`;
}

async function cleanupWithOllama(raw, opts = {}) {
  cleanEl.textContent = '';
  const prompt = buildPrompt(raw, opts);
  // modelInput is now a <select>; fall back to a sensible default if Ollama
  // is offline or hasn't been listed yet.
  const model = (modelInput?.value || '').trim() || 'gemma4:e4b';

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
    setTimeout(() => setStatusIdleOrReady(), 1200);
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
    setTimeout(() => setStatusIdleOrReady(), 1200);
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
  // Accept any Gemma generation — the recommended default tracks the
  // latest family (currently gemma4:e4b) but a user pinned to gemma3
  // should still register as "has a usable Ollama model".
  const hasGemma = s.ollama?.models?.some((m) => m.startsWith('gemma'));
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
        onClick: async () => { await copyToClipboard('ollama pull gemma4:e4b'); toast(t('toast.copied')); },
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
//   2. first stream-partial (we'd never get one without ready)
//   3. any successful stream-final
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

    // Track engine readiness so the titlebar status chip can flip from
    // "대기" (grey) to "준비됨" (green) as soon as the stream helper or
    // the batch engine becomes usable.
    const batchEngines = ['whisper.cpp', 'openai'];
    const isBatch = batchEngines.includes(status.selectedEngine);
    const wasReady = engineIsReady;
    engineIsReady = status.engine !== 'none' && (Boolean(status.streamReady) || isBatch);
    // Repaint the chip only when the state actually changed AND we're
    // currently in an idle/ready state (no recording/processing flash on
    // screen we'd clobber).
    const currentKind = statusEl.dataset.kind || '';
    if (wasReady !== engineIsReady && !recording && !streamingActive
        && (currentKind === '' || currentKind === 'ok')) {
      setStatusIdleOrReady();
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

// ======================== Ollama model manager ========================
//
// Separate page with an "Installed" list (live from /api/tags) and a
// curated "Recommended" list the user can install in-app. Pull progress
// streams over IPC; deletes prompt for confirmation. The existing Ollama
// dropdown on the post-processing page stays in sync because it reads
// from the same /api/tags endpoint each refresh cycle.

// Refreshed 2026-04 from ollama.com/library for post-processing
// transcripts (cleanup + translate). Criteria: <10 GB on disk, strong
// multilingual (KR/JA/ZH/EN), still actively maintained on Ollama.
// qwen3.6 is intentionally excluded — it only ships at 35B today, too
// heavy for the target machines. gemma4 is the new default; gemma3:12b
// stays for higher-quality jobs.
const OLLAMA_RECOMMENDED = [
  { name: 'gemma4:e4b',     size: '3.4 GB', note: 'noteDefault',      kind: 'gemma' },
  { name: 'qwen3.5:4b',     size: '2.6 GB', note: 'noteMultilingual', kind: 'qwen' },
  { name: 'gemma3:12b',     size: '8.1 GB', note: 'noteHighQuality',  kind: 'gemma' },
  { name: 'llama3.2:3b',    size: '2.0 GB', note: 'noteFast',         kind: 'llama' },
  { name: 'qwen2.5:7b',     size: '4.7 GB', note: 'noteBalanced',     kind: 'qwen' },
  { name: 'phi4-mini:3.8b', size: '2.5 GB', note: 'notePhi4',         kind: 'phi' },
];

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v === 0) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ollamaKind(name) {
  const n = String(name || '').toLowerCase();
  if (n.startsWith('gemma'))  return 'gemma';
  if (n.startsWith('llama'))  return 'llama';
  if (n.startsWith('qwen'))   return 'qwen';
  if (n.startsWith('mistral'))return 'mistral';
  if (n.startsWith('phi'))    return 'phi';
  return '';
}

function ollamaIcoInitials(name) {
  const n = String(name || '').replace(/:.*$/, '');
  const m = n.match(/([a-z]+)(\d+)?/i);
  if (!m) return n.slice(0, 2).toUpperCase();
  const letter = m[1].slice(0, 1).toUpperCase();
  const num = m[2] || '';
  return letter + (num || '').slice(0, 1);
}

// Tracks in-flight pulls so we can show progress bars and cancel mid-way.
const ollamaPulling = new Map(); // name → { total, completed, status }
window.listenk?.onOllamaPullProgress?.((payload) => {
  if (!payload || !payload.name) return;
  const prev = ollamaPulling.get(payload.name) || {};
  const chunk = payload.chunk || {};
  const next = {
    status: chunk.status || prev.status || '…',
    completed: chunk.completed ?? prev.completed ?? 0,
    total: chunk.total ?? prev.total ?? 0,
  };
  ollamaPulling.set(payload.name, next);
  // Throttle render via RAF so rapid chunks don't thrash layout.
  if (!ollamaPullingRafPending) {
    ollamaPullingRafPending = true;
    requestAnimationFrame(() => {
      ollamaPullingRafPending = false;
      refreshOllamaPage({ skipListFetch: true });
    });
  }
});
let ollamaPullingRafPending = false;

function buildOllamaRow({ name, sizeText, kind, badgeKey, meta, actions, progress }) {
  const row = document.createElement('div');
  row.className = 'ollama-model';
  if (kind) row.setAttribute('data-kind', kind);
  row.innerHTML = `
    <div class="ico"></div>
    <div class="info">
      <div class="n"></div>
      <div class="meta"></div>
    </div>
  `;
  row.querySelector('.ico').textContent = ollamaIcoInitials(name);
  const nameEl = row.querySelector('.n');
  nameEl.textContent = name;
  if (badgeKey) {
    const badge = document.createElement('span');
    badge.className = 'used-badge';
    badge.textContent = t(badgeKey);
    nameEl.appendChild(badge);
  }
  const metaEl = row.querySelector('.meta');
  (meta || []).forEach((m) => {
    const s = document.createElement('span');
    if (m.cls) s.className = m.cls;
    s.textContent = m.text;
    metaEl.appendChild(s);
  });

  if (progress) {
    const barWrap = document.createElement('div');
    barWrap.className = 'ollama-progress';
    barWrap.innerHTML = `<div class="bar" style="width: ${Math.max(3, progress.pct)}%"></div>`;
    row.appendChild(barWrap);
    const pctLabel = document.createElement('div');
    pctLabel.className = 'ollama-progress-label';
    pctLabel.textContent = progress.label;
    row.appendChild(pctLabel);
  }

  if (actions && actions.length) {
    const wrap = document.createElement('div');
    wrap.className = 'ollama-model-actions';
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'btn-xs' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      btn.textContent = a.label;
      btn.addEventListener('click', a.onClick);
      wrap.appendChild(btn);
    });
    row.appendChild(wrap);
  }
  return row;
}

async function refreshOllamaPage(opts = {}) {
  const installedList = $('ollamaInstalledList');
  const recommendedList = $('ollamaRecommendedList');
  const emptyEl = $('ollamaEmpty');
  const diskEl = $('ollamaDiskUsage');
  const installedSubEl = $('ollamaInstalledSub');
  const installedBox = $('ollamaInstalledBox');
  const recommendedBox = $('ollamaRecommendedBox');
  const navCountEl = $('navCountOllama');
  if (!installedList || !recommendedList) return;

  // Only re-fetch on demand — progress-tick renders reuse the last list.
  if (!opts.skipListFetch || !refreshOllamaPage._last) {
    refreshOllamaPage._last = await window.listenk?.ollamaList?.();
  }
  const data = refreshOllamaPage._last || { running: false, models: [] };
  const running = Boolean(data.running);
  if (emptyEl) emptyEl.hidden = running;
  if (installedBox) installedBox.hidden = !running;

  const installed = data.models || [];
  const totalBytes = installed.reduce((s, m) => s + (m.size || 0), 0);
  const activeModel = modelInput?.value || savedOllamaModel || '';

  if (diskEl) {
    diskEl.textContent = running
      ? t('page.ollama.diskUsage', { size: fmtBytes(totalBytes), n: installed.length })
      : t('page.ollama.sub');
  }
  if (installedSubEl) {
    installedSubEl.textContent = running ? t('page.ollama.installedSub', { n: installed.length }) : '';
  }
  if (navCountEl) {
    if (running && installed.length > 0) {
      navCountEl.textContent = String(installed.length);
      navCountEl.hidden = false;
    } else {
      navCountEl.hidden = true;
    }
  }

  // ── Installed list ──
  installedList.innerHTML = '';
  if (running && installed.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = t('page.ollama.emptyInstalled');
    installedList.appendChild(empty);
  }
  installed.forEach((m) => {
    const isActive = m.name === activeModel;
    const meta = [
      { text: fmtBytes(m.size), cls: 'size' },
    ];
    if (m.modifiedAt) {
      const d = new Date(m.modifiedAt);
      if (!Number.isNaN(d.valueOf())) {
        meta.push({ text: d.toLocaleDateString() });
      }
    }
    const actions = [];
    if (!isActive) {
      actions.push({
        label: t('page.ollama.switch'),
        primary: true,
        onClick: async () => {
          if (!modelInput) return;
          savedOllamaModel = m.name;
          await window.listenk?.setOllamaModel?.(m.name);
          // Keep the post-processing dropdown in sync so both pages agree.
          const opt = Array.from(modelInput.options).find((o) => o.value === m.name);
          if (opt) modelInput.value = m.name;
          toast(t('toast.ollamaModel', { label: m.name }));
          refreshOllamaPage();
        },
      });
    }
    actions.push({
      label: t('page.ollama.delete'),
      danger: true,
      onClick: async () => {
        if (!confirm(t('page.ollama.confirmDelete', { name: m.name }))) return;
        const res = await window.listenk?.ollamaDelete?.(m.name);
        if (res?.ok) {
          toast(t('page.ollama.deleted', { name: m.name }));
          refreshOllamaPage();
        } else {
          toast(t('page.ollama.deleteFail', { message: res?.error || '?' }));
        }
      },
    });

    installedList.appendChild(buildOllamaRow({
      name: m.name,
      kind: ollamaKind(m.name),
      badgeKey: isActive ? 'page.ollama.inUse' : null,
      meta,
      actions,
    }));
  });

  // ── Recommended list (filter out already installed) ──
  recommendedList.innerHTML = '';
  const installedNames = new Set(installed.map((m) => m.name));
  const notInstalled = OLLAMA_RECOMMENDED.filter((r) => !installedNames.has(r.name));
  if (recommendedBox) recommendedBox.hidden = !running || notInstalled.length === 0;
  notInstalled.forEach((spec) => {
    const pull = ollamaPulling.get(spec.name);
    if (pull) {
      const total = pull.total || 0;
      const completed = pull.completed || 0;
      const pct = total > 0 ? Math.min(99, Math.round((completed / total) * 100)) : 3;
      recommendedList.appendChild(buildOllamaRow({
        name: spec.name,
        kind: spec.kind,
        meta: [
          { text: spec.size, cls: 'size' },
          { text: pull.status || '…' },
        ],
        progress: { pct, label: total > 0 ? `${pct}%` : '…' },
        actions: [{
          label: t('page.ollama.cancel'),
          onClick: () => window.listenk?.ollamaPullCancel?.(spec.name),
        }],
      }));
      return;
    }
    recommendedList.appendChild(buildOllamaRow({
      name: spec.name,
      kind: spec.kind,
      meta: [
        { text: spec.size, cls: 'size' },
        { text: t(`page.ollama.${spec.note}`) },
      ],
      actions: [{
        label: t('page.ollama.install'),
        primary: true,
        onClick: async () => {
          ollamaPulling.set(spec.name, { status: t('page.ollama.starting'), total: 0, completed: 0 });
          refreshOllamaPage({ skipListFetch: true });
          const res = await window.listenk?.ollamaPull?.(spec.name);
          ollamaPulling.delete(spec.name);
          if (res?.ok) toast(t('page.ollama.installed', { name: spec.name }));
          else if (res?.aborted) toast(t('page.ollama.cancelled'));
          else toast(t('page.ollama.installFail', { message: res?.error || '?' }));
          refreshOllamaPage();
        },
      }],
    }));
  });
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

// Hero action buttons. "Record now" now goes through the same main-side
// entry point as the hotkey and the tray "toggle record" item
// (`trigger-record` → `handleFnPress()` on main). That's the branch that
// handles HUD display, streaming-vs-batch routing, and focus restore.
// The previous version called `toggleRecord()` directly, which entered
// the legacy batch-only path and left the user without a HUD or a
// reachable stop control.
const heroRecBtn = $('heroRecBtn');
const heroRecLabel = heroRecBtn?.querySelector('.hero-rec-label');
const heroHotkeyBtn = $('heroHotkeyBtn');
heroRecBtn?.addEventListener('click', async () => {
  if (heroRecBtn.dataset.state === 'processing') return;
  try { await window.listenk?.triggerRecord?.(); } catch {}
});

// Mirror main.js's recording state into the button. Three states:
//   idle       → red dot + "Record now"
//   recording  → red stop square + "Stop" + pulse
//   processing → spinner + "Processing…" + disabled
function setHeroRecState(state) {
  if (!heroRecBtn) return;
  heroRecBtn.dataset.state = state;
  heroRecBtn.disabled = (state === 'processing');
  if (!heroRecLabel) return;
  if (state === 'recording')       heroRecLabel.textContent = t('hero.recStop');
  else if (state === 'processing') heroRecLabel.textContent = t('hero.recProcessing');
  else                             heroRecLabel.textContent = t('hero.recNow');
}
setHeroRecState('idle');

window.listenk?.onRecordState?.(({ isRecording, isProcessing }) => {
  if (isProcessing)     setHeroRecState('processing');
  else if (isRecording) setHeroRecState('recording');
  else                  setHeroRecState('idle');
});

// Initial sync on boot — covers the case where the dashboard mounts
// while a recording is already in flight (rare, but avoids a stale
// "Record now" flash before the first push event).
(async () => {
  try {
    const s = await window.listenk?.getRecordState?.();
    if (s) {
      if (s.isProcessing)     setHeroRecState('processing');
      else if (s.isRecording) setHeroRecState('recording');
    }
  } catch {}
})();

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

// ── WhisperKit model catalog (Engine page) ───────────────────────────
// Tracks in-flight downloads so the UI can show a progress bar + cancel
// button instead of the default install action. Keyed by model name;
// value shape: { fraction, status }. Progress events stream from main.
const wkPulling = new Map();

function fmtMB(mb) {
  if (!mb) return '—';
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function wkInitials(tag) {
  // Short, distinct 1-2 letter label in the circle icon. Matches tag.
  return String(tag || '').slice(0, 1).toUpperCase();
}

function renderWkCatalog(entries) {
  const listEl = $('wkCatalogList');
  if (!listEl) return;
  listEl.innerHTML = '';
  for (const m of entries) {
    const row = document.createElement('div');
    row.className = 'wk-model';
    row.setAttribute('data-tag', m.tag);

    const ico = document.createElement('div');
    ico.className = 'ico';
    ico.textContent = wkInitials(m.tag);
    row.appendChild(ico);

    const info = document.createElement('div');
    info.className = 'info';
    const n = document.createElement('div');
    n.className = 'n';
    const labelText = t(`page.whisperkit.label.${m.tag}`) || m.label;
    n.textContent = labelText;
    if (m.isActive) {
      const used = document.createElement('span');
      used.className = 'badge';
      used.textContent = t('page.whisperkit.badge.active');
      n.appendChild(used);
    } else if (m.bundled) {
      const b = document.createElement('span');
      b.className = 'badge badge--bundled';
      b.textContent = t('page.whisperkit.badge.bundled');
      n.appendChild(b);
    }
    info.appendChild(n);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const descKey = `page.whisperkit.desc.${m.tag}`;
    const descText = t(descKey) || m.recommendedFor;
    meta.textContent = `${fmtMB(m.sizeMB)} · ${descText}`;
    info.appendChild(meta);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const pulling = wkPulling.get(m.name);
    if (pulling && pulling.status === 'downloading') {
      // In-flight: progress bar + cancel
      const bar = document.createElement('div');
      bar.className = 'wk-progress';
      const fill = document.createElement('div');
      fill.className = 'bar';
      fill.style.width = `${Math.round((pulling.fraction || 0) * 100)}%`;
      bar.appendChild(fill);
      actions.appendChild(bar);

      const pct = document.createElement('span');
      pct.className = 'wk-progress-label';
      pct.textContent = `${Math.round((pulling.fraction || 0) * 100)}%`;
      actions.appendChild(pct);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = t('page.whisperkit.cancel');
      cancelBtn.addEventListener('click', () => wkCancel(m.name));
      actions.appendChild(cancelBtn);
    } else if (m.installed) {
      // Installed: "Use this" (if not active) + Delete (if not bundled)
      if (!m.isActive) {
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'primary';
        useBtn.textContent = t('page.whisperkit.use');
        useBtn.addEventListener('click', () => wkSelect(m.name));
        actions.appendChild(useBtn);
      }
      if (!m.bundled) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'danger';
        delBtn.textContent = t('page.whisperkit.delete');
        delBtn.addEventListener('click', () => wkDelete(m.name, labelText));
        actions.appendChild(delBtn);
      }
    } else {
      // Not installed: Install button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'primary';
      btn.textContent = t('page.whisperkit.install');
      btn.addEventListener('click', () => wkDownload(m.name));
      actions.appendChild(btn);
    }

    row.appendChild(actions);
    listEl.appendChild(row);
  }
}

async function refreshWkCatalog() {
  if (!window.listenk?.whisperkitCatalog) return;
  try {
    const data = await window.listenk.whisperkitCatalog();
    if (data?.catalog) renderWkCatalog(data.catalog);
  } catch (err) {
    console.warn('[wk] catalog refresh failed', err);
  }
}

async function wkDownload(name) {
  wkPulling.set(name, { fraction: 0, status: 'downloading' });
  refreshWkCatalog();
  try {
    const res = await window.listenk.whisperkitDownload(name);
    if (res?.ok) {
      toast(t('page.whisperkit.installed', { name }));
    } else if (res?.cancelled) {
      toast(t('page.whisperkit.cancelled'));
    } else {
      toast(t('page.whisperkit.installFail', { message: res?.reason || '?' }));
    }
  } catch (err) {
    toast(t('page.whisperkit.installFail', { message: err.message }));
  } finally {
    wkPulling.delete(name);
    refreshWkCatalog();
    // Status dashboard + whisper model dropdown may now reflect new install.
    setTimeout(() => { refresh(); }, 100);
  }
}

async function wkCancel(name) {
  try { await window.listenk.whisperkitCancel(name); } catch {}
}

async function wkDelete(name, labelText) {
  if (!confirm(t('page.whisperkit.confirmDelete', { name: labelText }))) return;
  try {
    const res = await window.listenk.whisperkitDelete(name);
    if (res?.ok) {
      toast(t('page.whisperkit.deleted', { name: labelText }));
      refreshWkCatalog();
      setTimeout(() => refresh(), 100);
    } else if (res?.reason === 'busy') {
      toast(t('page.whisperkit.deleteBusy'));
    } else if (res?.reason === 'bundled') {
      toast(t('page.whisperkit.deleteBundled'));
    } else {
      toast(t('page.whisperkit.deleteFail', { message: res?.reason || '?' }));
    }
  } catch (err) {
    toast(t('page.whisperkit.deleteFail', { message: err.message }));
  }
}

async function wkSelect(name) {
  try {
    await window.listenk.setWhisperModel?.(name);
    toast(t('page.whisperkit.switched', { name }));
    refreshWkCatalog();
    setTimeout(() => refresh(), 200);
  } catch (err) {
    toast(t('page.whisperkit.installFail', { message: err.message }));
  }
}

window.listenk?.onWhisperkitDownloadProgress?.((payload) => {
  if (!payload || !payload.name) return;
  if (payload.status === 'downloading') {
    const prev = wkPulling.get(payload.name) || {};
    wkPulling.set(payload.name, {
      ...prev,
      fraction: payload.fraction || 0,
      completed: payload.completed,
      total: payload.total,
      status: 'downloading',
    });
    // Throttle UI re-renders: fraction ticks frequently but we only need
    // the bar to advance visibly. 200 ms feels fluid without thrashing.
    if (!window.__wkRenderScheduled) {
      window.__wkRenderScheduled = true;
      setTimeout(() => {
        window.__wkRenderScheduled = false;
        refreshWkCatalog();
      }, 200);
    }
  } else if (payload.status === 'complete' || payload.status === 'error' || payload.status === 'cancelled') {
    wkPulling.delete(payload.name);
    refreshWkCatalog();
  }
});

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
  // Hide the whole engine-options group when the selected engine has no
  // configurable options (Apple Speech · whisper.cpp) — otherwise users
  // see an empty framed box below the engine cards.
  const group = document.getElementById('engineOptions');
  const hasFields = engine === 'whisperkit' || engine === 'openai';
  if (group) group.hidden = !hasFields;

  const subEl = document.getElementById('engineOptionsSub');
  if (subEl) {
    const key = `page.engine.optionsSub.${engine}`;
    subEl.textContent = hasFields ? t(key) : '';
  }
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
  const [hotkey, language, streaming, engine, mode, tone, translateTarget, ollamaModel, wkModels, openaiKeyInfo, openaiModel, uiLocaleInfo, theme] = await Promise.all([
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
    safe(() => api.getTheme?.()),
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
  syncStreamingSeg();

  if (engine && engineSel) engineSel.value = engine;
  applyEngineVisibility(engine || 'whisperkit');
  renderEngineCards(engine || 'whisperkit');
  updateEngineChip(engine || 'whisperkit');

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

  // Theme — applyTheme paints the class on <html>; 'system' removes any
  // forced class so CSS @media takes over.
  const initialTheme = theme && ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
  if (themeSel) themeSel.value = initialTheme;
  applyTheme(initialTheme);

  settingsReady = true;
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  if (theme === 'light') root.classList.add('theme-light');
  else if (theme === 'dark') root.classList.add('theme-dark');
  // 'system' leaves no class so @media (prefers-color-scheme) drives it.
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
  syncStreamingSeg();
  await api.setStreaming?.(enabled);
  toast(t('toast.streaming', { label: enabled ? t('field.streaming.on') : t('field.streaming.off') }));
});

// Segmented-toggle UI: buttons drive the hidden <select>, fire its change
// event so the listener above runs exactly once regardless of which one
// the user clicked.
const streamingSegEl = $('streamingSeg');
function syncStreamingSeg() {
  if (!streamingSegEl || !streamingSel) return;
  streamingSegEl.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-value') === streamingSel.value);
  });
}
streamingSegEl?.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = btn.getAttribute('data-value');
    if (!streamingSel || streamingSel.value === v) return;
    streamingSel.value = v;
    streamingSel.dispatchEvent(new Event('change'));
  });
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
  const res = await api.setEngine?.(engine);
  // Main rejects the switch when a recording is live. Roll the UI back
  // so the user doesn't see a card marked active that isn't really active.
  if (res && res.ok === false && res.reason === 'busy') {
    engineSel.value = res.engine || engine;
    renderEngineCards(engineSel.value);
    toast(t('toast.engineBusy'));
    return;
  }
  applyEngineVisibility(engine);
  renderEngineCards(engine);
  updateEngineChip(engine);
  // When coming back to OpenAI, the password input might be stale — refresh
  // its placeholder to reflect whether a key is currently stored/encrypted.
  if (engine === 'openai') refreshOpenAiKeyHint();
  if (engine === 'whisperkit') refreshWkCatalog();
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
    recommended: true,
    badge: { cls: 'local', label: 'Local · Core ML · 632MB' },
    descKey: 'engineCard.whisperkit.desc',
    metrics: [
      { labelKey: 'engineCard.latency', value: '~0.4s' },
      { labelKey: 'engineCard.quality', value: '★★★★★' },
    ],
  },
  {
    id: 'apple',
    name: 'Apple Speech',
    badge: { cls: 'local', label: 'Local · 0MB' },
    descKey: 'engineCard.apple.desc',
    metrics: [
      { labelKey: 'engineCard.latency', value: '~0.2s' },
      { labelKey: 'engineCard.quality', value: '★★★☆☆' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    badge: { cls: 'cloud', label: 'Cloud · $0.006/min' },
    descKey: 'engineCard.openai.desc',
    metrics: [
      { labelKey: 'engineCard.latency', value: 'network' },
      { labelKey: 'engineCard.quality', value: '★★★★★' },
    ],
  },
  {
    id: 'whisper.cpp',
    name: 'whisper.cpp',
    badge: { cls: 'experimental', label: 'Local · GGML' },
    descKey: 'engineCard.cpp.desc',
    metrics: [
      { labelKey: 'engineCard.latency', value: 'batch' },
      { labelKey: 'engineCard.quality', value: '★★★★☆' },
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
    const nameEl = card.querySelector('.name');
    nameEl.textContent = spec.name;
    if (spec.recommended) {
      const rec = document.createElement('span');
      rec.className = 'engine-card-rec';
      rec.textContent = ' · ' + t('engineCard.recommended');
      nameEl.appendChild(rec);
    }
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
  toast(name ? t('toast.modelChange', { label: name }) : t('toast.modelAuto'));
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

themeSel?.addEventListener('change', async () => {
  if (!settingsReady) return;
  const v = themeSel.value;
  applyTheme(v);
  await api.setTheme?.(v);
  const label = themeSel.options[themeSel.selectedIndex]?.textContent || v;
  toast(t('toast.theme', { label }));
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
  // Engine cards + options sub-head both contain JS-assigned strings
  // that don't pick up data-i18n walks — re-run them explicitly.
  if (engineSel) {
    renderEngineCards(engineSel.value);
    applyEngineVisibility(engineSel.value);
  }
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
    updateBrandPage(id);
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

// ----- Titlebar brand breadcrumb + engine chip -----
// Centered title reads "Listen K · <current page>". Right-side engine chip
// shows which transcription engine is active so the user sees at a glance
// whether they're on local or cloud before recording.
const brandPageEl = $('brandPage');
const PAGE_I18N_KEY = {
  'sec-status': 'sidebar.nav.dashboard',
  'sec-engine': 'sidebar.nav.engine',
  'sec-input': 'sidebar.nav.input',
  'sec-post': 'sidebar.nav.post',
  'sec-history': 'sidebar.nav.history',
  'sec-stats': 'sidebar.nav.stats',
  'sec-usage': 'sidebar.nav.usage',
};
function updateBrandPage(sectionId) {
  if (!brandPageEl) return;
  const key = PAGE_I18N_KEY[sectionId] || 'sidebar.nav.dashboard';
  brandPageEl.setAttribute('data-i18n', key);
  brandPageEl.textContent = t(key);
}

const engineChipEl = $('engineChip');
const engineChipNameEl = $('engineChipName');
const ENGINE_CHIP_LABEL = {
  apple: 'Apple Speech',
  whisperkit: 'WhisperKit',
  'whisper.cpp': 'whisper.cpp',
  openai: 'OpenAI',
};
function updateEngineChip(engine) {
  if (!engineChipEl || !engineChipNameEl) return;
  if (!engine) { engineChipEl.hidden = true; return; }
  engineChipEl.setAttribute('data-engine', engine);
  engineChipNameEl.textContent = ENGINE_CHIP_LABEL[engine] || engine;
  engineChipEl.hidden = false;
}

// ======================== Onboarding overlay ========================
//
// Shown once on the first launch of a fresh install (no `onboardingDone`
// in config). Three steps: welcome → permissions → hotkey. Users can
// skip via the top-right × button — anything that writes
// `onboardingDone: true` dismisses it for future launches.
const onboardEl = $('onboard');
const onboardSteps = onboardEl?.querySelectorAll('.onboard-step');
const onboardStepDots = onboardEl?.querySelectorAll('.step-dot');
let onboardStep = 0;

function onboardShowStep(i) {
  onboardStep = Math.max(0, Math.min(2, i));
  onboardSteps?.forEach((el) => {
    const s = Number(el.getAttribute('data-step'));
    el.hidden = s !== onboardStep;
  });
  onboardStepDots?.forEach((d) => {
    const s = Number(d.getAttribute('data-step'));
    d.classList.toggle('active', s === onboardStep);
    d.classList.toggle('done', s < onboardStep);
  });
  if (onboardStep === 1) onboardRenderPermissions();
  if (onboardStep === 2) {
    onboardSyncHotkey();
    onboardRenderHotkeyHint();
  }
  // Intercept real hotkey presses only while the test step is active so
  // we don't accidentally start a recording during onboarding.
  const inTest = onboardStep === 2;
  try { window.listenk?.setOnboardingHotkeyTest?.(inTest); } catch {}
}

async function onboardRenderPermissions() {
  const listEl = $('onboardPermList');
  if (!listEl) return;
  let status = {};
  try { status = await window.listenk.getStatus(); } catch {}

  const items = [
    {
      key: 'mic',
      titleKey: 'onboard.perm.mic',
      descKey: 'onboard.perm.micDesc',
      granted: status.mic === 'granted',
      action: status.mic === 'granted'
        ? null
        : status.mic === 'not-determined'
          ? { labelKey: 'onboard.perm.request', fn: async () => { await window.listenk.requestMic(); setTimeout(onboardRenderPermissions, 300); } }
          : { labelKey: 'onboard.perm.openSettings', fn: () => window.listenk.openSettingsPane('mic') },
      iconSvg: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><rect x="6" y="2" width="4" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M4 8c0 2 1.8 3.5 4 3.5S12 10 12 8M8 11.5v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    },
    {
      key: 'ax',
      titleKey: 'onboard.perm.accessibility',
      descKey: 'onboard.perm.accessibilityDesc',
      granted: Boolean(status.accessibility),
      action: status.accessibility
        ? null
        : { labelKey: 'onboard.perm.openSettings', fn: () => window.listenk.openSettingsPane('accessibility') },
      iconSvg: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><circle cx="8" cy="4" r="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M8 6v4M5 8l3-2 3 2M6 14l2-4 2 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    },
    {
      key: 'im',
      titleKey: 'onboard.perm.inputMonitoring',
      descKey: 'onboard.perm.inputMonitoringDesc',
      granted: Boolean(status.inputMonitoring) || Boolean(status.accessibility),
      action: (status.inputMonitoring || status.accessibility)
        ? null
        : { labelKey: 'onboard.perm.openSettings', fn: () => window.listenk.openSettingsPane('input-monitoring') },
      iconSvg: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 8h.01M8 8h.01M11 8h.01M4.5 10.5h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    },
  ];

  listEl.innerHTML = '';
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'onboard-perm-item' + (item.granted ? ' granted' : '');
    el.innerHTML = `
      <div class="onboard-perm-ico">${item.iconSvg}</div>
      <div class="onboard-perm-body">
        <div class="onboard-perm-title"></div>
        <div class="onboard-perm-desc"></div>
      </div>
      <div class="onboard-perm-state"></div>
    `;
    el.querySelector('.onboard-perm-title').textContent = t(item.titleKey);
    el.querySelector('.onboard-perm-desc').textContent = t(item.descKey);
    const state = el.querySelector('.onboard-perm-state');
    if (item.granted) {
      const chip = document.createElement('span');
      chip.className = 'granted-chip';
      chip.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" fill="none"><path d="M3 8.5 L6.5 12 L13 4.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      chip.appendChild(document.createTextNode(' ' + t('onboard.perm.granted')));
      state.appendChild(chip);
    } else if (item.action) {
      const btn = document.createElement('button');
      btn.className = 'btn-hero ghost';
      btn.type = 'button';
      btn.textContent = t(item.action.labelKey);
      btn.addEventListener('click', item.action.fn);
      state.appendChild(btn);
    }
    listEl.appendChild(el);
  }
}

function onboardRenderHotkeyHint() {
  const hintEl = $('onboardHotkeyHint');
  const sel = $('onboardHotkey');
  if (!hintEl || !sel) return;
  const label = HOTKEY_LABELS[sel.value] || '⇧⇧';
  hintEl.textContent = t('onboard.hotkey.testHint', { label });

  // Reset the live-test box + apply the chosen hotkey glyph to the kbd.
  const testBox = $('onboardTestBox');
  const testKbd = $('onboardTestKbd');
  const testStatus = $('onboardTestStatus');
  if (testKbd) testKbd.textContent = label;
  if (testBox) testBox.setAttribute('data-state', 'waiting');
  if (testStatus) testStatus.textContent = t('onboard.hotkey.testPrompt');
}

// Apply the selected hotkey to fn-listener the moment the user picks it,
// so the step-3 test actually exercises the chosen binding (not whatever
// was set before the overlay opened).
async function onboardSyncHotkey() {
  const sel = $('onboardHotkey');
  if (!sel || !sel.value) return;
  try { await window.listenk?.setHotkey?.(sel.value); } catch {}
}

// Wire once: when fn-listener fires during the test, main emits a
// dedicated event so we don't trigger a real recording.
window.listenk?.onOnboardingHotkeyFired?.(() => {
  const testBox = $('onboardTestBox');
  const testStatus = $('onboardTestStatus');
  if (testBox) testBox.setAttribute('data-state', 'detected');
  if (testStatus) testStatus.textContent = t('onboard.hotkey.testDetected');
});

async function onboardFinish() {
  // Persist current onboarding-picked hotkey through the same IPC the
  // settings page uses, so nothing drifts out of sync.
  const onboardHotkeySel = $('onboardHotkey');
  if (onboardHotkeySel && onboardHotkeySel.value) {
    try { await window.listenk.setHotkey?.(onboardHotkeySel.value); } catch {}
  }
  try { await window.listenk.setOnboardingDone?.(true); } catch {}
  // Re-enable normal hotkey behaviour before the overlay goes away.
  try { await window.listenk.setOnboardingHotkeyTest?.(false); } catch {}
  onboardEl.hidden = true;
}

async function maybeShowOnboarding() {
  if (!onboardEl || !window.listenk?.getOnboardingDone) return;
  let done = false;
  try { done = await window.listenk.getOnboardingDone(); } catch {}
  if (done) { onboardEl.hidden = true; return; }
  // Translate static text before revealing.
  applyTranslations(onboardEl);
  // Default hotkey selection follows whatever main.js has persisted.
  try {
    const hk = await window.listenk.getHotkey?.();
    const sel = $('onboardHotkey');
    if (sel && hk) sel.value = hk;
  } catch {}
  onboardEl.hidden = false;
  onboardShowStep(0);
}

$('onboardStart')?.addEventListener('click', () => onboardShowStep(1));
$('onboardBack1')?.addEventListener('click', () => onboardShowStep(0));
$('onboardNext1')?.addEventListener('click', () => onboardShowStep(2));
$('onboardBack2')?.addEventListener('click', () => onboardShowStep(1));
$('onboardDone')?.addEventListener('click', () => onboardFinish());
$('onboardSkip')?.addEventListener('click', () => onboardFinish());
$('onboardHotkey')?.addEventListener('change', () => {
  onboardSyncHotkey();
  onboardRenderHotkeyHint();
});

// External navigation requests (from the tray popover's "History" / "Stats"
// items): just click the matching sidebar link so the same routing logic
// runs as if the user clicked it themselves.
window.listenk?.onNavigatePage?.((id) => {
  const link = document.querySelector(`.nav-item[data-section="${id}"]`);
  if (link) link.click();
});

// Wire sidebar nav immediately so clicks respond even if the IPC-based
// settings restore below is slow on first run.
wireSidebarNavigation();

// ── About card (Usage page) + sidebar version chip ────────────────
// Populated once on boot. The sidebar chip stays static; the update-check
// button rebuilds the status line on every click.
async function loadAppVersion() {
  try {
    const v = await window.listenk?.getAppVersion?.();
    if (!v) return;
    const sidebarEl = $('sidebarVersion');
    const aboutEl = $('aboutVersion');
    if (sidebarEl) sidebarEl.textContent = `v${v}`;
    if (aboutEl) aboutEl.textContent = `v${v}`;
  } catch {}
}

async function runUpdateCheck() {
  const btn = $('aboutUpdateBtn');
  const status = $('aboutUpdateStatus');
  if (!btn || !status) return;

  // If a build has already been downloaded in the background, the button
  // reads as "Restart & install" and this click should trigger the
  // restart path instead of hitting the network again.
  try {
    const state = await window.listenk?.getUpdateState?.();
    if (state && state.pendingUpdateVersion) {
      await installUpdateNow();
      return;
    }
  } catch {}

  btn.disabled = true;
  status.dataset.state = 'checking';
  status.textContent = t('usage.about.checking');
  try {
    const res = await window.listenk?.checkForUpdates?.();
    if (!res) throw new Error('ipc unavailable');
    if (!res.ok) {
      if (res.reason === 'dev') {
        status.dataset.state = 'idle';
        status.textContent = t('usage.about.devBuild');
      } else {
        status.dataset.state = 'error';
        status.textContent = t('usage.about.checkFailed', { reason: res.reason || '?' });
      }
      return;
    }
    if (res.updateAvailable) {
      status.dataset.state = 'update';
      status.textContent = t('usage.about.updateAvailable', { version: res.latestVersion });
    } else {
      status.dataset.state = 'ok';
      status.textContent = t('usage.about.upToDate', { version: res.currentVersion });
    }
  } catch (err) {
    status.dataset.state = 'error';
    status.textContent = t('usage.about.checkFailed', { reason: err.message || '?' });
  } finally {
    btn.disabled = false;
  }
}

// When main pushes a fresh update-state event, flip the Usage-page
// button label so it reads as "Restart & install" to match behaviour.
function syncAboutUpdateBtn({ pendingUpdateVersion }) {
  const btn = $('aboutUpdateBtn');
  if (!btn) return;
  if (pendingUpdateVersion) {
    btn.textContent = t('usage.about.restartInstall', { version: pendingUpdateVersion });
  } else {
    btn.textContent = t('usage.about.check');
  }
}

$('aboutUpdateBtn')?.addEventListener('click', runUpdateCheck);

// ── Update-ready banner (dashboard) ──────────────────────────────────
// v0.6.0 already pulled new builds in the background via electron-updater
// but only advertised them via a toast that vanished in seconds, and
// install was gated on the user happening to quit the app — easy to miss
// for a menubar-only app they never explicitly quit. This banner stays
// pinned to the top of the dashboard until the user either restarts to
// apply or dismisses for the current session.
let updateDismissedForSession = false;

function applyUpdateBanner({ pendingUpdateVersion }) {
  const banner = $('updateReadyBanner');
  if (!banner) return;
  if (!pendingUpdateVersion || updateDismissedForSession) {
    banner.hidden = true;
    return;
  }
  const descEl = $('updateReadyDesc');
  if (descEl) descEl.textContent = t('banner.update.descWithVersion', {
    version: pendingUpdateVersion,
  });
  banner.hidden = false;
}

async function installUpdateNow() {
  const btn = $('updateInstallBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('banner.update.installing');
  }
  try {
    const res = await window.listenk?.installUpdateNow?.();
    if (res && res.ok === false) {
      toast(t('banner.update.installFail', { reason: res.reason || '?' }));
      if (btn) { btn.disabled = false; btn.textContent = t('banner.update.install'); }
    }
    // Success path: main quits the app immediately — no UI follow-up needed.
  } catch (err) {
    toast(t('banner.update.installFail', { reason: err.message || '?' }));
    if (btn) { btn.disabled = false; btn.textContent = t('banner.update.install'); }
  }
}

$('updateInstallBtn')?.addEventListener('click', installUpdateNow);
$('updateDismissBtn')?.addEventListener('click', () => {
  updateDismissedForSession = true;
  const banner = $('updateReadyBanner');
  if (banner) banner.hidden = true;
});

window.listenk?.onUpdateState?.((state) => {
  applyUpdateBanner(state);
  syncAboutUpdateBtn(state);
});

// Seed the banner on boot in case the download already completed before
// the dashboard mounted (auto-updater check fires 10 s after launch).
(async () => {
  try {
    const s = await window.listenk?.getUpdateState?.();
    if (s) {
      applyUpdateBanner(s);
      syncAboutUpdateBtn(s);
    }
  } catch {}
})();

// ── Ollama empty-state banner action buttons ─────────────────────────
// Both the button and the inline link open the same Ollama download page
// via a dedicated purpose-specific IPC (no arbitrary URL exposure).
function openOllamaDownloadPage(event) {
  event?.preventDefault?.();
  window.listenk?.openOllamaDownload?.();
}
$('ollamaOpenDownloadBtn')?.addEventListener('click', openOllamaDownloadPage);
$('ollamaOpenDownload')?.addEventListener('click', openOllamaDownloadPage);
$('ollamaRefreshBtn')?.addEventListener('click', () => {
  refreshOllamaPage();
});

(async () => {
  await restoreSettings();
  loadAppVersion();
  // Onboarding dialog runs after settings are restored so it can show the
  // user's configured hotkey in step 3. It's a no-op if onboardingDone is
  // already true in config.
  maybeShowOnboarding();
  // Initial chip paint — refresh() will upgrade it to "준비됨" when the
  // stream helper reports ready. This just avoids showing a blank chip.
  setStatusIdleOrReady();
  refresh();
  refreshNavCounts();
  refreshOllamaPage();
  refreshWkCatalog();
  setInterval(() => {
    refresh();
    refreshStats();
    refreshStatsCharts();
    refreshKpiTiles();
    refreshNavCounts();
    refreshOllamaPage();
  }, 4000);
})();
