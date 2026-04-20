# Listen K (MVP)

macOS용 AI 음성 받아쓰기 앱. **fn 키 한 번 = 녹음 시작 / 한 번 더 = 포커스된 입력 필드에 자동 붙여넣기**. 로컬 Whisper.cpp로 STT, 로컬 Ollama(Gemma)로 필러 제거·정제. 외부 클라우드 전송 없음.

## 사전 준비 (최초 1회)

### 1) 의존성 설치
```bash
brew install whisper-cpp ollama
xcode-select --install          # swiftc 필요 (fn 키 감지 헬퍼 빌드용)
```

### 2) Node 의존성 + 모델
```bash
npm install
npm run build:helper            # Swift 헬퍼 bin/fn-listener 컴파일
npm run model:base              # Whisper ggml-base.bin 다운로드 (~142MB)
```

### 3) Ollama 모델
```bash
ollama serve                    # 백그라운드 데몬 (brew services start ollama)
ollama pull gemma3:4b
```

## 실행

```bash
npm start
```

### 최초 실행 시 권한 허용 3가지

1. **마이크** — 자동 프롬프트. 허용.
2. **입력 모니터링** (fn 키 감지) — 시스템 설정 → 개인정보 보호 및 보안 → 입력 모니터링 → `bin/fn-listener` 를 허용.
3. **손쉬운 사용** (타 앱에 붙여넣기) — 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용 → Electron/Listen K 를 허용.

### macOS 키보드 설정 (중요)

시스템 설정 → 키보드 → `🌐/fn 키 누름` 을 **"아무 작업 안 함"** 으로 설정하세요. 기본값 "받아쓰기" 등으로 두면 macOS 자체 기능이 fn을 먼저 소비해 우리 앱이 감지 못 합니다.

## 사용법

앱이 실행되면 메뉴바에 상태 아이콘이 표시되고 창은 숨겨진 채 대기합니다.

1. 텍스트를 입력할 앱(메모, 메일, Slack, VS Code 등)에서 커서를 원하는 입력 필드에 둠
2. **fn 키** 한 번 누름 → 녹음 시작 (메뉴바 🔴)
3. 말함
4. **fn 키** 한 번 더 누름 → Whisper 변환 → Gemma 정제 → **자동으로 ⌘V 로 붙여넣음**

대체 단축키: `⌘⇧Space`

메뉴바 아이콘을 클릭하면 전사 이력을 볼 수 있는 창이 뜹니다.

## 파일 구조

- `native/fn-listener.swift` — CGEventTap으로 fn 키 감지, stdout에 `FN_DOWN` 출력
- `bin/fn-listener` — 컴파일된 바이너리 (빌드 후 생성)
- `main.js` — Electron 메인. 헬퍼 실행, whisper-cli 호출, 클립보드 + ⌘V 전송, Tray
- `preload.js` — IPC 브릿지
- `index.html` / `styles.css` / `renderer.js` — 창 UI + PCM 캡처 + Ollama 호출
- `scripts/build-helper.sh` — swiftc 빌드
- `scripts/download-model.sh` — Whisper 모델 다운로더

## 환경변수

- `WHISPER_MODEL=/path/to/model.bin` — Whisper 모델 경로 오버라이드

## 트러블슈팅

- **fn 눌러도 반응 없음**: `bin/fn-listener` 가 입력 모니터링 권한을 받았는지 확인. macOS 키보드 설정에서 fn 키 동작이 "아무 작업 안 함"인지 확인.
- **붙여넣기 실패**: 손쉬운 사용 권한 미허용. 시스템 설정에서 Electron 또는 터미널(개발 중) 허용.
- **"whisper-cli 설치 필요"**: `brew install whisper-cpp`.
- **Ollama 호출 실패**: `ollama serve` 실행 중인지, `ollama list` 에 `gemma3:4b` 있는지 확인.

## 배포 (.dmg 빌드)

### 빌드
```bash
npm run dist
```

`dist/Listen K-0.1.0-arm64.dmg`, `dist/Listen K-0.1.0-x64.dmg` 가 생성됩니다.
(`predist` 가 자동으로 Swift 헬퍼를 빌드합니다. 모델은 `npm run model:base` 로 미리 받아두세요.)

### 설치 받는 사용자에게 안내할 것

1. **DMG 열고 Applications 로 드래그**
2. **첫 실행**: macOS 가 "확인되지 않은 개발자" 라며 막음 → Finder에서 우클릭 → `열기` → 다이얼로그에서 다시 `열기`
3. **사전 요구사항** (사용자가 따로 설치):
   - `brew install whisper-cpp` — STT 엔진 (번들에 미포함)
   - (선택) `brew install ollama && ollama pull gemma3:4b` — Ollama 모드 사용 시
4. **권한 3종 허용** (시스템 설정 → 개인정보 보호 및 보안):
   - **마이크**: 첫 녹음 시 자동 프롬프트
   - **입력 모니터링**: `Listen K.app/Contents/Resources/bin/fn-listener` 추가
   - **손쉬운 사용**: `Listen K.app/Contents/Resources/bin/paste-helper` 추가
5. **macOS 키보드 설정**: `🌐/fn 키 누름` → `아무 작업 안 함`

### 서명·공증 없이 배포할 때 주의

- 서명이 ad-hoc 이므로 사용자가 우클릭→열기 한 번 필요
- 앱 업데이트 시 매번 같은 헬퍼 권한을 다시 허용해야 할 수 있음 (해시 변경)
- 본격 배포는 Apple Developer 가입 후 `Developer ID Application` 인증서로 서명 + `notarytool` 공증 필요

## 다음 단계 (로드맵)

- [ ] 스트리밍 STT (whisper.cpp stream + VAD)
- [ ] 앱별 톤 자동 전환 (frontmost 앱 감지)
- [ ] 사용자 어투 학습
- [ ] 전사 이력 저장 및 검색
