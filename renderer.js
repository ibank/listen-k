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
const copyBtn = $('copyBtn');
const refreshBtn = $('refreshBtn');
const checkListEl = $('checkList');
const recentCard = $('recentCard');
const toastEl = $('toast');

rawEl.dataset.placeholder = '전사 결과가 여기에 표시됩니다.';
cleanEl.dataset.placeholder = '정제된 텍스트가 여기에 표시됩니다.';

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
  statusEl.textContent = text;
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
    setStatus(`마이크 실패: ${err.name}`, 'error');
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
  setStatus('녹음 중...');
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
    setStatus('녹음 데이터 없음', 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
    return;
  }

  window.listenk?.setState?.({ recording: false, processing: true });
  setStatus('변환 중... (Whisper)');

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

    if (finalTranscript.trim()) {
      await postProcessAndPaste(finalTranscript);
    } else {
      setStatus('음성이 감지되지 않음', 'error');
      window.listenk?.setState?.({ recording: false, processing: false });
    }
  } catch (err) {
    console.error('transcribe failed', err);
    setStatus('Whisper 오류', 'error');
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
  setStatus('취소됨');
  window.listenk?.setState?.({ recording: false, processing: false });
  setTimeout(() => setStatus('대기'), 1200);
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
  setStatus('붙여넣는 중...');
  let pasted = true;
  try {
    if (cleanedText && window.listenk?.paste) {
      await window.listenk.paste(cleanedText);
    }
    setStatus('완료', 'ok');
  } catch (pasteErr) {
    pasted = false;
    setStatus(`붙여넣기 실패: ${pasteErr.message}`, 'error');
  }

  if (cleanedText) {
    try {
      await window.listenk?.historyAppend?.({
        at: new Date().toISOString(),
        raw: (finalTranscript || '').trim(),
        clean: cleanedText,
        mode: modeSel?.value || 'rules',
        language: langSel?.value || 'ko-KR',
        pasted,
      });
      refreshHistory();
    } catch {}
  }

  window.listenk?.setState?.({ recording: false, processing: false });
  setTimeout(() => setStatus('대기'), 1500);
}

async function postProcessAndPaste(raw) {
  const mode = modeSel?.value || 'rules';
  if (mode === 'off') {
    setStatus('붙여넣는 중...');
    await finalizePaste(raw.trim());
    return;
  }
  if (mode === 'rules') {
    setStatus('규칙 정제 중...');
    await finalizePaste(cleanupWithRules(raw));
    return;
  }
  setStatus('Ollama 정제 중...');
  await cleanupWithOllama(raw);
}

function buildPrompt(raw) {
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

async function cleanupWithOllama(raw) {
  cleanEl.textContent = '';
  const prompt = buildPrompt(raw);
  const model = modelInput.value.trim() || 'gemma3:4b';

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
        } catch {}
      }
    }
    await finalizePaste(output.trim());
  } catch (err) {
    cleanEl.textContent = `Ollama 호출 실패: ${err.message}\n\n  brew install ollama && ollama serve\n  ollama pull ${model}`;
    setStatus('Ollama 오류', 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
  }
}

// ========== IPC wiring (record/cancel from main/HUD) ==========

// Legacy batch capture (used only when the streaming helper is unavailable).
// The streaming path is driven by main.js sending stream-partial/final IPC,
// so the toggle-record fallback is gated by streamingActive below.
let streamingActive = false;
let latestPartial = '';

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
    showRecent();
    rawEl.textContent = '(취소됨)';
    setStatus('취소됨');
    window.listenk?.setState?.({ recording: false, processing: false });
    setTimeout(() => setStatus('대기'), 1200);
    return;
  }
  cancelRecord();
});

window.listenk?.onStreamPartial?.((text) => {
  streamingActive = true;
  latestPartial = text || '';
  setStatus('듣는 중...');
  showRecent();
  rawEl.textContent = latestPartial;
});

window.listenk?.onStreamFinal?.(async (text) => {
  console.log('[renderer] stream-final received, length=', (text || '').length);
  const finalText = (text || latestPartial || '').trim();
  streamingActive = false;
  latestPartial = '';
  showRecent();
  rawEl.textContent = finalText;

  if (!finalText) {
    setStatus('음성이 감지되지 않음', 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
    setTimeout(() => setStatus('대기'), 1200);
    return;
  }

  try {
    await postProcessAndPaste(finalText);
  } catch (err) {
    console.error('[renderer] postProcessAndPaste failed', err);
    setStatus(`후처리 실패: ${err.message}`, 'error');
    window.listenk?.setState?.({ recording: false, processing: false });
  }
});

window.listenk?.onToast?.((msg) => {
  if (msg) toast(msg, 2500);
});

window.listenk?.onStreamError?.((message) => {
  streamingActive = false;
  setStatus(`스트리밍 오류: ${message}`, 'error');
  cleanEl.textContent = message;
  window.listenk?.setState?.({ recording: false, processing: false });
});

copyBtn?.addEventListener('click', async () => {
  const text = cleanEl.textContent.trim() || rawEl.textContent.trim();
  if (!text) return;
  await copyToClipboard(text);
  toast('복사됨');
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
      return { state: 'ok', glyph: '✓', desc: '허용됨' };
    case 'denied':
      return { state: 'err', glyph: '✕', desc: '거부됨. 시스템 설정에서 허용해주세요.' };
    case 'not-determined':
      return { state: 'warn', glyph: '!', desc: '아직 허용 요청 전입니다.' };
    case 'restricted':
      return { state: 'err', glyph: '✕', desc: '기기 정책으로 제한됨.' };
    default:
      return { state: 'warn', glyph: '?', desc: String(status) };
  }
}

async function renderStatus(statusArg) {
  const s = statusArg || (await window.listenk.getStatus());
  const rows = [];

  const mic = describeMic(s.mic);
  rows.push(buildCheckRow({
    state: mic.state,
    glyph: mic.glyph,
    title: '마이크 접근',
    desc: mic.desc,
    actions: s.mic === 'not-determined'
      ? [{ label: '허용 요청', primary: true, onClick: async () => { await window.listenk.requestMic(); refresh(); } }]
      : s.mic === 'denied' || s.mic === 'restricted'
      ? [{ label: '시스템 설정 열기', onClick: () => window.listenk.openSettingsPane('mic') }]
      : [],
  }));

  const targetPath = s.packaged ? s.appBundlePath : s.fnListenerPath;
  const targetLabel = s.packaged ? 'Listen K.app' : 'fn-listener';

  const imCoveredByAx = s.inputMonitoring && s.accessibility;

  rows.push(buildCheckRow({
    state: s.inputMonitoring ? 'ok' : 'err',
    glyph: s.inputMonitoring ? '✓' : '✕',
    title: '단축키 감지',
    desc: s.inputMonitoring
      ? (imCoveredByAx
          ? '허용됨 · 손쉬운 사용 권한에 자동 포함'
          : '허용됨 · 입력 모니터링')
      : `시스템 설정 → 개인정보 보호 및 보안 → 입력 모니터링 (또는 손쉬운 사용) 에서 ${targetLabel} 을 허용하세요.\n${targetPath || ''}`,
    actions: s.inputMonitoring ? [] : [
      { label: '시스템 설정 열기', primary: true, onClick: () => window.listenk.openSettingsPane('input-monitoring') },
      targetPath && { label: 'Finder 에서 보기', onClick: () => window.listenk.showInFinder(targetPath) },
      targetPath && {
        label: '경로 복사',
        onClick: async () => { await copyToClipboard(targetPath); toast('경로 복사됨'); },
      },
    ].filter(Boolean),
  }));

  const axTargetPath = s.packaged ? s.appBundlePath : s.pasteHelperPath;
  const axTargetLabel = s.packaged ? 'Listen K.app' : 'paste-helper';

  rows.push(buildCheckRow({
    state: s.accessibility ? 'ok' : 'err',
    glyph: s.accessibility ? '✓' : '✕',
    title: '자동 붙여넣기',
    desc: s.accessibility
      ? '허용됨 · 손쉬운 사용'
      : `시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 ${axTargetLabel} 을 허용하세요.\n${axTargetPath || ''}`,
    actions: s.accessibility ? [] : [
      { label: '시스템 설정 열기', primary: true, onClick: () => window.listenk.openSettingsPane('accessibility') },
      axTargetPath && { label: 'Finder 에서 보기', onClick: () => window.listenk.showInFinder(axTargetPath) },
      axTargetPath && {
        label: '경로 복사',
        onClick: async () => { await copyToClipboard(axTargetPath); toast('경로 복사됨'); },
      },
    ].filter(Boolean),
  }));

  const engineOk = s.engine === 'whisperkit';
  const streamStatus = s.streamReady
    ? '스트리밍 준비됨'
    : '스트리밍 초기화 중… (첫 실행은 Core ML 컴파일로 ~1분)';

  rows.push(buildCheckRow({
    state: engineOk ? 'ok' : 'err',
    glyph: engineOk ? '✓' : '✕',
    title: '전사 엔진',
    desc: engineOk
      ? `WhisperKit (Core ML · Metal GPU)\n${streamStatus}\n${s.transcribeHelper?.path || ''}`
      : '전사 엔진을 빌드해주세요: npm run build:transcribe',
    actions: engineOk ? [] : [
      {
        label: '빌드 명령 복사',
        primary: true,
        onClick: async () => {
          await copyToClipboard('npm run build:transcribe');
          toast('"npm run build:transcribe" 복사됨');
        },
      },
    ],
  }));

  rows.push(buildCheckRow({
    state: s.whisperKitModel ? 'ok' : 'err',
    glyph: s.whisperKitModel ? '✓' : '✕',
    title: '전사 모델',
    desc: s.whisperKitModel
      ? `WhisperKit Core ML\n${s.whisperKitModel.path}`
      : '모델 파일이 없습니다. 다운로드: npm run model:whisperkit',
    actions: s.whisperKitModel ? [] : [
      {
        label: '다운로드 명령 복사',
        onClick: async () => {
          await copyToClipboard('npm run model:whisperkit');
          toast('"npm run model:whisperkit" 복사됨');
        },
      },
    ],
  }));

  if (currentHotkey === 'fn') {
    rows.push(buildCheckRow({
      state: 'info',
      glyph: 'ⓘ',
      title: 'macOS fn 키 동작 설정',
      desc: '시스템 설정 → 키보드 → "🌐/fn 키 누름" 을 "아무 작업 안 함" 으로 설정하세요.',
      actions: [
        { label: '키보드 설정 열기', onClick: () => window.listenk.openSettingsPane('keyboard') },
      ],
    }));
  }

  const mode = modeSel?.value;
  const hasGemma = s.ollama?.models?.some((m) => m.startsWith('gemma3'));
  if (mode === 'ollama' || s.ollama?.running) {
    let ollamaState, ollamaDesc, ollamaActions = [];
    if (!s.ollama?.running) {
      ollamaState = mode === 'ollama' ? 'err' : 'info';
      ollamaDesc = 'localhost:11434 응답 없음. “ollama serve” 가 실행 중인지 확인하세요.';
      ollamaActions = [{
        label: '실행 명령 복사',
        onClick: async () => { await copyToClipboard('brew services start ollama'); toast('복사됨'); },
      }];
    } else if (!hasGemma) {
      ollamaState = mode === 'ollama' ? 'warn' : 'info';
      ollamaDesc = `실행 중 · 모델 없음 (${(s.ollama.models || []).join(', ') || '—'})`;
      ollamaActions = [{
        label: 'pull 명령 복사',
        onClick: async () => { await copyToClipboard('ollama pull gemma3:4b'); toast('복사됨'); },
      }];
    } else {
      ollamaState = 'ok';
      ollamaDesc = `실행 중 · ${s.ollama.models.join(', ')}`;
    }
    rows.push(buildCheckRow({
      state: ollamaState,
      glyph: ollamaState === 'ok' ? '✓' : ollamaState === 'warn' ? '!' : ollamaState === 'err' ? '✕' : 'ⓘ',
      title: `Ollama ${mode === 'ollama' ? '(필수)' : '(선택)'}`,
      desc: ollamaDesc,
      actions: ollamaActions,
    }));
  }

  checkListEl.innerHTML = '';
  rows.forEach((r) => checkListEl.appendChild(r));
}

const firstRunBanner = $('firstRunBanner');

let lastStatusFingerprint = '';
async function refresh() {
  try {
    const status = await window.listenk.getStatus();
    // The welcome banner stays visible only while the engine hasn't
    // come up yet — once streamReady flips true it retires permanently
    // for the rest of the session.
    if (firstRunBanner) {
      if (status.engine === 'whisperkit' && !status.streamReady && !firstRunBanner.dataset.shown) {
        firstRunBanner.hidden = false;
        firstRunBanner.dataset.shown = 'true';
      } else if (status.streamReady) {
        firstRunBanner.hidden = true;
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
    if (same) return `오늘 ${hh}:${mm}`;
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mo}/${dd} ${hh}:${mm}`;
  } catch {
    return iso || '';
  }
}

function buildHistoryRow(entry) {
  const row = document.createElement('div');
  row.className = 'history-item';
  row.innerHTML = `
    <div class="history-body">
      <div class="history-text"></div>
      <div class="history-meta"></div>
    </div>
    <div class="history-actions">
      <button class="ghost" data-action="copy">복사</button>
      <button class="ghost" data-action="paste">붙여넣기</button>
    </div>
  `;
  row.querySelector('.history-text').textContent = entry.clean || entry.raw || '';
  const meta = [
    formatHistoryTimestamp(entry.at),
    entry.mode || '',
    entry.language || '',
    entry.pasted === false ? '미붙여넣음' : '',
  ].filter(Boolean).join(' · ');
  row.querySelector('.history-meta').textContent = meta;

  row.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    await copyToClipboard(entry.clean || entry.raw || '');
    toast('복사됨');
  });
  row.querySelector('[data-action="paste"]').addEventListener('click', async () => {
    const text = entry.clean || entry.raw || '';
    if (!text) return;
    try {
      await window.listenk.paste(text);
      toast('다시 붙여넣기 완료');
    } catch (err) {
      toast(`실패: ${err.message}`);
    }
  });
  return row;
}

async function refreshHistory() {
  if (!historyListEl) return;
  try {
    const entries = await window.listenk.historyList(50);
    historyListEl.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '아직 전사 이력이 없습니다. 단축키로 한 번 받아써 보세요.';
      historyListEl.appendChild(empty);
      return;
    }
    entries.forEach((e) => historyListEl.appendChild(buildHistoryRow(e)));
  } catch (err) {
    console.warn('[history] refresh failed', err);
  }
}

historyClearBtn?.addEventListener('click', async () => {
  if (!confirm('전사 이력을 모두 삭제할까요?')) return;
  await window.listenk.historyClear();
  refreshHistory();
  toast('이력 삭제됨');
});

refreshHistory();

refreshBtn?.addEventListener('click', () => {
  lastStatusFingerprint = '';  // force redraw on user-initiated refresh
  refresh();
  refreshHistory();
});
modeSel?.addEventListener('change', () => {
  lastStatusFingerprint = '';
  refresh();
});

langSel?.addEventListener('change', () => {
  window.listenk?.setLanguage?.(langSel.value);
  toast(`언어: ${langSel.options[langSel.selectedIndex].textContent}`);
});
if (langSel) window.listenk?.setLanguage?.(langSel.value);

(async () => {
  try {
    const enabled = await window.listenk?.getStreaming?.();
    if (streamingSel) streamingSel.value = enabled === false ? 'off' : 'on';
  } catch {}
})();

streamingSel?.addEventListener('change', async () => {
  const enabled = streamingSel.value === 'on';
  await window.listenk?.setStreaming?.(enabled);
  toast(`실시간 표시: ${enabled ? '켜짐' : '꺼짐'}`);
});

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
  const hintEls = document.querySelectorAll('#hotkeyHint');
  const label = HOTKEY_LABELS[currentHotkey] || '⇧⇧';
  hintEls.forEach((el) => { el.textContent = label; });
}

(async () => {
  try {
    const current = await window.listenk.getHotkey();
    if (current && hotkeySel) hotkeySel.value = current;
    applyHotkeyHint(current);
  } catch (err) {
    console.warn('[hotkey] load failed', err);
  }
})();

hotkeySel?.addEventListener('change', async () => {
  const mode = hotkeySel.value;
  try {
    const res = await window.listenk.setHotkey(mode);
    if (res?.ok) {
      const label = hotkeySel.options[hotkeySel.selectedIndex].textContent;
      toast(`단축키: ${label}`);
      applyHotkeyHint(mode);
      setTimeout(refresh, 400);
    } else {
      toast('단축키 변경 실패');
    }
  } catch (err) {
    toast(`변경 실패: ${err.message}`);
  }
});

refresh();
setInterval(refresh, 4000);
