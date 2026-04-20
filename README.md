# Listen K

Apple Silicon macOS용 **로컬 AI 음성 받아쓰기**. Right Shift 를 두 번 탭하면 HUD 가 뜨고, 말한 내용이 실시간으로 표시된 뒤 한 번 더 탭하면 포커스된 앱의 입력 필드에 자동으로 붙여넣어집니다.

- **전사**: WhisperKit (Core ML · Metal GPU, `openai_whisper-large-v3-turbo` 기본)
- **후처리**: 규칙 기반(기본, 0-deps) / 끄기 / Ollama (Gemma) 중 선택
- **전송 없음**: 음성도 텍스트도 기기를 벗어나지 않음
- **대상**: Apple Silicon macOS 14+

---

## 설치 (DMG)

1. `dist/ListenK-0.1.0-arm64.dmg` 열고 Listen K 를 Applications 로 드래그
2. 첫 실행 전 Gatekeeper 우회 (아직 공증 전이라 1회 필요)
   - 빠름: `xattr -cr "/Applications/Listen K.app"`
   - 또는: 시스템 설정 → 개인정보 보호 및 보안 → "Listen K 가 차단되었습니다" 옆 **그래도 열기**
3. Applications 에서 Listen K 실행 — 최초 실행 시 대시보드가 자동으로 열립니다
4. 대시보드 안내를 따라 권한 2가지 허용
   - **손쉬운 사용**: `/Applications/Listen K.app` 추가 (단축키 감지 + 자동 붙여넣기 둘 다 커버)
   - **마이크**: 첫 녹음 시 자동 프롬프트
5. (선택) Ollama 후처리를 쓸 경우: `brew install ollama && ollama pull gemma3:4b`

첫 실행 시 Core ML 이 모델을 컴파일하면서 ~40초 대기합니다. 캐시되면 이후엔 바로 준비됩니다.

## 사용법

1. 텍스트를 넣을 곳에 커서 두기
2. **⇧⇧** (Right Shift 두 번 탭) — HUD 뜨면서 녹음 시작
3. 말하기 (HUD 에 실시간 텍스트 흐름)
4. **⇧⇧** 또는 HUD `✓` — 후처리 → 포커스된 입력 필드에 자동 붙여넣기
5. 취소: HUD `✕`

**대체 단축키**: `⌘⇧Space`. 메뉴바(⚪) 아이콘 클릭으로 대시보드 재열기.

---

## 설정

`~/Library/Application Support/Listen K/config.json` 에 지속됨 (앱이 직접 갱신):

| 키 | 값 | 설명 |
|---|---|---|
| `hotkey` | `rshift-double` (기본) · `ropt-double` · `rctl-double` · `rcmd-double` · `fn` | 전역 핫키 |
| `language` | `ko-KR` (기본) · `en-US` · `ja-JP` | Whisper 언어 힌트 |
| `streaming` | `true` (기본) · `false` | HUD 실시간 텍스트 표시 여부. off 는 녹음 완료 후 일괄 변환 |
| `mode` | `rules` (기본) · `off` · `ollama` | 후처리. Ollama 선택 시 `gemma3:4b` 필요 |

첫 실행 마커: 같은 디렉토리 `.first-run-done` (지우면 다시 대시보드 자동 오픈)

---

## 개발

```bash
brew install cmake         # (선택) whisper.cpp 정적 빌드가 필요할 때만
xcode-select --install     # swiftc

npm install
npm run build:helper       # bin/fn-listener, paste-helper, focus-helper
npm run build:transcribe   # bin/transcribe-helper (WhisperKit Swift Package)
npm run model:whisperkit   # Core ML 모델 (~632 MB) → models/whisperkit/

npm start                  # 개발 모드
npm run dist               # DMG 빌드 (predist 로 위 3개 자동 실행)
npm run icon               # 아이콘 재생성
```

다른 모델 변형으로 바꾸려면:
```bash
bash scripts/download-whisperkit-model.sh openai_whisper-large-v3-v20240930_turbo_632MB
# 또는
bash scripts/download-whisperkit-model.sh openai_whisper-base
```
`models/whisperkit/` 밑에 있는 폴더 중 품질 우선순위 순서대로 자동 선택됩니다.

## 구조

```
main.js                         Electron main: IPC, 상태, Tray, 헬퍼 라이프사이클
preload.js / preload-hud.js     contextIsolation 브릿지
index.html + renderer.js        대시보드 창 (상태, 설정, 최근 전사)
hud.html + hud.js               플로팅 HUD (파형 / 실시간 텍스트 / ✕ / ✓)
styles.css / hud.css            2026 darkfirst 디자인 시스템

native/fn-listener.swift        CGEventTap (modifier double-tap / fn)
native/paste-helper.swift       Accessibility check + CGEventPost ⌘V
native/focus-helper.swift       NSWorkspace frontmost 저장/복구
native/transcribe-helper/       Swift Package. WhisperKit AudioStreamTranscriber
                                + 배치 재전사 (--stream / --audio / --download)

scripts/build-helper.sh         3개 Swift 헬퍼 ad-hoc 서명 빌드
scripts/build-transcribe-helper.sh
scripts/download-whisperkit-model.sh
scripts/after-pack.js           electron-builder afterPack ad-hoc 서명
scripts/generate-icon.js        순수 Node PNG 인코더 (의존성 0)
```

## 트러블슈팅

- **HUD 뜨는데 텍스트가 안 나옴**: 터미널에서 `npm start` 로 실행해 `[audio] buf=` 로그 확인. buf 가 0 에서 멈추면 마이크 권한 누락.
- **환각 (말 안 했는데 "Thank you for watching" 등)**: 마이크가 무음을 받는 중. 앱 번들에 마이크 권한 부여했는지 확인. `openai_whisper-large-v3-turbo` 가 작은 모델보다 환각이 적음.
- **⇧⇧ 눌러도 반응 없음**: 대시보드 "단축키 감지" 행 확인. 손쉬운 사용이 켜져 있으면 초록. 그래도 안 되면 Right Shift 두 번 탭 간격을 380ms 이내로.
- **포커스 복구 실패, 붙여넣기가 Listen K 에 들어감**: `bin/focus-helper` 로그 확인. 대부분 앱 bundle id 인식 실패. 일반 macOS 앱이 아닐 때 발생 (웹 브라우저 탭 내부 위젯 등).
- **Core ML 로딩 > 1분**: ANE 컴파일을 돌고 있을 수 있음 (현재 코드는 cpuAndGPU 만 쓰므로 정상적으로는 ~40초). `rm -rf ~/Library/Caches/transcribe-helper` 후 재실행.

## 배포 정책

현재 ad-hoc 서명 only — 배포받은 사람이 위 Gatekeeper 우회를 한 번 해야 합니다. 정식 배포는 Apple Developer 가입 ($99/년) 후 `Developer ID Application` + `notarytool` 공증 경로로 이관 예정. 공증 후에는 우회 없이 더블클릭 실행.

## 로드맵

- [ ] 전사 이력 저장 및 재전사
- [ ] 앱별 톤/스타일 자동 전환
- [ ] 사용자 어투 학습 (vocab / 커스텀 발음 사전)
- [ ] 라이트 모드 (`prefers-color-scheme`)
- [ ] 자동 업데이트 (electron-updater, 공증 이후)
