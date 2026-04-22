[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

# Listen K

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/ibank/listen-k)](https://github.com/ibank/listen-k/releases)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-blue)](https://developer.apple.com/macos/)
[![Star on GitHub](https://img.shields.io/github/stars/ibank/listen-k?style=social)](https://github.com/ibank/listen-k)

Apple Silicon macOS 용 **로컬 AI 음성 받아쓰기**. Right Shift 를 두 번 탭하면 HUD 가 뜨고, 말한 내용이 실시간으로 표시된 뒤 한 번 더 탭하면 포커스된 앱의 입력 필드에 자동으로 붙여넣어집니다.

**한국어·일본어·중국어 1급 지원** + 영어. UI 는 4개 언어 (ko / en / ja / zh-CN) 자동 전환.


- **전사 엔진**: WhisperKit (기본, `openai_whisper-large-v3-turbo`) · Apple Speech · whisper.cpp · OpenAI API (BYOK)
- **후처리**: 규칙 기반 (기본, 의존성 0) · 끄기 · Ollama (Gemma 등 로컬 모델) · OpenAI 문체 정제
- **기본값에선 전송 없음**: WhisperKit + 규칙 후처리 조합은 100% 로컬
- **대상**: Apple Silicon macOS 14 (Sonoma) 이상
- **라이선스**: MIT — 소스 공개, 공증된 DMG 는 [listenk.com](https://listenk.com) 에서 판매

## 다른 앱과 무엇이 다른가?

macOS 받아쓰기 앱은 이미 좋은 것들이 많습니다. Listen K 는 그 중 특정 자리를 차지합니다:

| | Listen K | [Superwhisper](https://superwhisper.com) | [Wispr Flow](https://wisprflow.ai) | [MacWhisper](https://goodsnooze.gumroad.com/l/macwhisper) | [Whisper Notes](https://whispernotes.app) | Apple Dictation |
|---|---|---|---|---|---|---|
| **소스 공개** | MIT 오픈소스 | 비공개 | 비공개 | 비공개 | 비공개 | 비공개 |
| **기본값 로컬 처리** | ✅ | ✅ | ❌ (클라우드) | ✅ | ✅ | ✅ |
| **한·일·중 품질** | CJK 프롬프트 튜닝 1급 | 양호 | 양호 | 혼재 | 양호 | 긴 한국어/일본어 약함 |
| **포커스 앱 자동 붙여넣기** | ✅ | ✅ | ✅ | 수동 복사 | 수동 복사 | 시스템 한정 |
| **단축키 옵션** | 5종 (fn 포함) | 3종 | fn 전용 | 1종 | 1종 | 고정 |
| **가격** | 소스 무료 · 서명 DMG $29 | $8.49/월 · $249 평생 | $15/월 | $79.99 평생 | $6.99 단일구매 | 무료 (OS 번들) |
| **다국어 UI** | ko / en / ja / zh-CN | en | en | en | en | 시스템 로케일 |

매일 한국어·일본어·중국어로 글을 쓰면서 받아쓴 텍스트가 기기 밖으로 나가지 않기를 원하고, 구독은 피하고 싶다면 Listen K 가 잘 맞습니다.

---

## 설치 (DMG)

### 공증 릴리즈 (Developer ID 서명 후 기본 경로)
1. [Releases](https://github.com/ibank/listen-k/releases) 에서 최신 `ListenK-x.y.z-arm64.dmg` 다운로드
2. 열어서 Listen K 를 Applications 로 드래그
3. 최초 실행 시 대시보드가 자동으로 열립니다
4. 안내에 따라 권한 2가지 허용
   - **손쉬운 사용**: `/Applications/Listen K.app` 추가 (단축키 감지 + 자동 붙여넣기 둘 다 커버)
   - **마이크**: 첫 녹음 시 자동 프롬프트
5. (선택) Ollama 후처리: `brew install ollama && ollama pull gemma3:4b`

첫 실행 시 Core ML 이 모델을 컴파일하면서 ~40초 대기합니다. 캐시되면 이후엔 바로 준비됩니다.

### Ad-hoc 개발 빌드 (v0.3 이하)
공증 전 빌드를 받으신 경우 Gatekeeper 우회가 1회 필요:
- 빠름: `xattr -cr "/Applications/Listen K.app"`
- 또는: 시스템 설정 → 개인정보 보호 및 보안 → "Listen K 가 차단되었습니다" 옆 **그래도 열기**

## 사용법

1. 텍스트를 넣을 곳에 커서 두기
2. **⇧⇧** (Right Shift 두 번 탭) — HUD 뜨면서 녹음 시작
3. 말하기 (HUD 에 실시간 텍스트 흐름)
4. **⇧⇧** 또는 HUD `✓` — 후처리 → 포커스된 입력 필드에 자동 붙여넣기
5. 취소: HUD `✕`

**대체 단축키**: `⌥⌥` / `⌃⌃` / `⌘⌘` / `fn`, 설정에서 변경. 메뉴바 아이콘 클릭으로 트레이 팝오버 열기.

---

## 설정

`~/Library/Application Support/Listen K/config.json` 에 지속됨 (앱이 직접 갱신):

| 키 | 값 | 설명 |
|---|---|---|
| `hotkey` | `rshift-double` (기본) · `ropt-double` · `rctl-double` · `rcmd-double` · `fn` | 전역 핫키 |
| `engine` | `whisperkit` (기본) · `apple` · `whisper.cpp` · `openai` | 전사 엔진 |
| `language` | `ko-KR` · `en-US` · `ja-JP` · `zh-CN` | Whisper 언어 힌트 |
| `uiLocale` | `ko` · `en` · `ja` · `zh-CN` | UI 언어 (기본: 시스템 로케일) |
| `theme` | `system` (기본) · `light` · `dark` | 테마 |
| `streaming` | `true` (기본) · `false` | HUD 실시간 텍스트 표시 |
| `mode` | `rules` (기본) · `off` · `ollama` · `translate` | 후처리 |

첫 실행 마커: 같은 디렉토리 `.first-run-done` (지우면 다시 대시보드 자동 오픈)

---

## 소스에서 빌드

요건: macOS 14+, Apple Silicon, Xcode 15+, Node.js 20 LTS.

```bash
git clone https://github.com/ibank/listen-k.git
cd listen-k
npm install
npm run build:helper       # bin/fn-listener, paste-helper, focus-helper (Swift)
npm run build:transcribe   # bin/transcribe-helper (WhisperKit)
npm run model:whisperkit   # Core ML 모델 (~632 MB) → models/whisperkit/

npm start                  # 개발 모드
npm run dist               # DMG 빌드 (predist 로 위 3개 자동 실행)
npm run icon               # 아이콘 재생성
```

다른 모델 변형으로 바꾸려면:
```bash
bash scripts/download-whisperkit-model.sh openai_whisper-base
bash scripts/download-whisperkit-model.sh openai_whisper-large-v3-v20240930_626MB
```
`models/whisperkit/` 밑 폴더 중 품질 우선순위 순서대로 자동 선택.

## 프로젝트 구조

```
main.js                         Electron main: IPC, 상태, Tray, 헬퍼 라이프사이클
preload*.js                     contextIsolation 브릿지 (main / HUD / tray)
index.html + renderer.js        대시보드 (상태, 설정, 통계, 최근 전사)
hud.html + hud.js               플로팅 HUD (파형 / 실시간 텍스트 / ✕ / ✓)
tray.html + tray.js             메뉴바 트레이 팝오버
i18n.js                         4개 로케일 (ko/en/ja/zh-CN) + t(key, params)
styles.css / hud.css / tray.css 디자인 시스템

native/fn-listener.swift        CGEventTap (modifier double-tap / fn)
native/paste-helper.swift       Accessibility check + CGEventPost ⌘V
native/focus-helper.swift       NSWorkspace frontmost 저장/복구
native/transcribe-helper/       WhisperKit AudioStreamTranscriber Swift Package
native/translate-helper/        MLX 기반 번역 Swift Package (실험)

scripts/build-*.sh              Swift 헬퍼 빌드
scripts/smoke.sh                이진 존재 + stream ready 검증
scripts/after-pack.js           electron-builder afterPack (ad-hoc 또는 Developer ID)
```

## 트러블슈팅

- **HUD 뜨는데 텍스트가 안 나옴**: 터미널에서 `npm start` 로 실행해 `[audio] buf=` 로그 확인. buf 가 0 에서 멈추면 마이크 권한 누락.
- **환각 (말 안 했는데 "Thank you for watching" 등)**: 마이크가 무음을 받는 중. 앱 번들에 마이크 권한 부여했는지 확인. `turbo` 모델이 작은 모델보다 환각이 적음.
- **⇧⇧ 눌러도 반응 없음**: 대시보드 "단축키 감지" 행 확인. 손쉬운 사용이 켜져 있으면 초록. 그래도 안 되면 Right Shift 두 번 탭 간격을 380ms 이내로.
- **포커스 복구 실패, 붙여넣기가 Listen K 에 들어감**: 대부분 번들 ID 인식 실패. 일반 macOS 앱이 아닐 때 발생 (웹 브라우저 탭 내부 위젯 등).
- **Core ML 로딩 > 1분**: ANE 컴파일을 돌고 있을 수 있음 (현재 코드는 cpuAndGPU 만 쓰므로 정상적으로는 ~40초). `rm -rf ~/Library/Caches/transcribe-helper` 후 재실행.

---

## 기여하기

이슈, PR, 번역 환영합니다. [CONTRIBUTING.md](CONTRIBUTING.md) 와 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 참조. 보안 이슈는 [SECURITY.md](SECURITY.md) 절차로.

## 라이선스

MIT — [LICENSE](LICENSE). 번들 라이브러리의 라이선스는 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## 상표

"Listen K" 이름과 로고·아이콘은 © 2026 ibank 소유이며 **MIT 라이선스 범위에 포함되지 않습니다**. 포크 시 앱 이름·아이콘은 자체 식별자로 변경해주세요.

## 후원

공증된 DMG 는 [listenk.com](https://listenk.com) 에서 구입 가능 — 개발 지속에 직접적인 도움이 됩니다.
프로젝트를 지속 후원하려면 [GitHub Sponsors](https://github.com/sponsors/ibank) 를 통해서도 가능합니다.

## 로드맵

- [x] 라이트 모드 (`prefers-color-scheme`)
- [x] 전사 이력 저장
- [x] Apple Speech / OpenAI / whisper.cpp 엔진 지원
- [x] 4개 로케일 UI
- [ ] 자동 업데이트 (electron-updater, 공증 이후)
- [ ] 앱별 톤/스타일 자동 전환
- [ ] 사용자 어투 학습 (vocab / 커스텀 발음 사전)
- [ ] 팀 라이선스
