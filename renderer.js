const $ = (id) => document.getElementById(id);

const recordBtn = $('recordBtn');
const rawEl = $('raw');
const cleanEl = $('clean');
const statusEl = $('status');
const langSel = $('lang');
const modelInput = $('model');
const toneSel = $('tone');
const cleanBtn = $('cleanBtn');
const copyBtn = $('copyBtn');
const modeSel = $('mode');

rawEl.dataset.placeholder = '녹음을 시작하고 멈추면 여기에 Whisper 결과가 표시됩니다...';
cleanEl.dataset.placeholder = 'Whisper 결과가 Ollama로 정제되어 여기에 표시됩니다.';

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

function renderRaw() {
  rawEl.textContent = finalTranscript;
}

async function startRecognition() {
  console.log('[renderer] startRecognition()');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    console.log('[renderer] got mic stream, tracks=', micStream.getTracks().length);
  } catch (err) {
    console.error('[renderer] mic permission/capture failed', err);
    setStatus(`마이크 실패: ${err.name} — ${err.message}`, 'error');
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
  recordBtn.classList.add('recording');
  recordBtn.querySelector('.label').textContent = '녹음 중지';
  setStatus('녹음 중...');
  window.typeless?.setState?.({ recording: true, processing: false });
}

async function stopRecognition() {
  if (!recording) return;
  recording = false;

  recordBtn.classList.remove('recording');
  recordBtn.querySelector('.label').textContent = '녹음 시작';

  try {
    processor.disconnect();
    source.disconnect();
    micStream.getTracks().forEach((t) => t.stop());
  } catch {}

  if (pcmChunks.length === 0) {
    setStatus('녹음 데이터 없음', 'error');
    window.typeless?.setState?.({ recording: false, processing: false });
    return;
  }

  window.typeless?.setState?.({ recording: false, processing: true });
  setStatus('변환 중... (Whisper)');

  const flat = flattenChunks(pcmChunks);
  const samples16k =
    sourceSampleRate === 16000 ? flat : await resampleTo16k(flat, sourceSampleRate);
  const wav = encodeWAV(samples16k);

  try {
    const text = await window.typeless.transcribe({
      wavBuffer: wav,
      language: langSel.value,
    });

    finalTranscript = cleanWhisperOutput(text);
    renderRaw();

    if (finalTranscript.trim()) {
      await postProcessAndPaste(finalTranscript);
    } else {
      setStatus('음성이 감지되지 않음', 'error');
      window.typeless?.setState?.({ recording: false, processing: false });
    }
  } catch (err) {
    console.error('transcribe failed', err);
    setStatus(`Whisper 오류`, 'error');
    cleanEl.textContent = err.message;
    window.typeless?.setState?.({ recording: false, processing: false });
  } finally {
    if (audioContext) {
      try { await audioContext.close(); } catch {}
      audioContext = null;
    }
  }
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

async function cancelRecord() {
  console.log('[renderer] cancelRecord()');
  if (!recording) return;
  recording = false;

  recordBtn.classList.remove('recording');
  recordBtn.querySelector('.label').textContent = '녹음 시작';

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
  window.typeless?.setState?.({ recording: false, processing: false });
  setTimeout(() => setStatus('대기'), 1200);
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

recordBtn.addEventListener('click', () => {
  console.log('[renderer] record button clicked, recording=', recording);
  toggleRecord();
});
if (window.typeless?.onToggleRecord) {
  window.typeless.onToggleRecord(() => {
    console.log('[renderer] toggle-record IPC received, recording=', recording);
    toggleRecord();
  });
  console.log('[renderer] onToggleRecord handler registered');
} else {
  console.warn('[renderer] window.typeless missing — preload failed?');
}

window.typeless?.onCancelRecord?.(() => {
  console.log('[renderer] cancel-record IPC received');
  cancelRecord();
});

cleanBtn.addEventListener('click', () => {
  const text = rawEl.textContent.trim();
  if (!text) return;
  finalTranscript = text;
  postProcessAndPaste(text);
});

copyBtn.addEventListener('click', async () => {
  const text = cleanEl.textContent.trim() || rawEl.textContent.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('클립보드에 복사됨', 'ok');
  setTimeout(() => setStatus('준비됨'), 1500);
});

function buildPrompt(raw) {
  const tone = toneSel.value;
  const toneInstruction = {
    neutral: '자연스럽고 깔끔한 문어체로',
    formal: '격식 있는 존댓말로',
    casual: '친근한 구어체로',
    email: '이메일에 적합한 정중하고 간결한 톤으로',
  }[tone] || '자연스럽게';

  return `당신은 음성 받아쓰기 결과를 정제하는 편집기입니다. 아래 원문은 사용자의 발화를 받아쓴 것입니다. 다음 규칙을 따르세요.

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
  try {
    if (cleanedText && window.typeless?.paste) {
      await window.typeless.paste(cleanedText);
    }
    setStatus('완료', 'ok');
  } catch (pasteErr) {
    setStatus(`붙여넣기 실패: ${pasteErr.message}`, 'error');
  }
  window.typeless?.setState?.({ recording: false, processing: false });
  setTimeout(() => setStatus('대기'), 1500);
}

async function postProcessAndPaste(raw) {
  const mode = modeSel?.value || 'rules';

  if (mode === 'off') {
    setStatus('정제 없이 붙여넣는 중...');
    await finalizePaste(raw.trim());
    return;
  }

  if (mode === 'rules') {
    setStatus('규칙 기반 정제 중...');
    const cleaned = cleanupWithRules(raw);
    await finalizePaste(cleaned);
    return;
  }

  setStatus('Ollama 정제 중...');
  await cleanupWithOllama(raw);
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
      const errText = await res.text();
      throw new Error(`Ollama ${res.status}: ${errText}`);
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
    cleanEl.textContent = `Ollama 호출 실패: ${err.message}\n\nOllama가 실행 중인지 확인:\n  brew install ollama\n  ollama serve\n  ollama pull ${model}`;
    setStatus('Ollama 오류', 'error');
    window.typeless?.setState?.({ recording: false, processing: false });
  }
}
