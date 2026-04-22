---
updated: 2026-04-22
scope: Listen K open-source release readiness
related: docs/monetization.md
---

# Listen K 오픈소스 공개 준비 체크리스트

> 대상 리포: `ibank/ListenK` (현재 private). 전략은 [monetization.md](monetization.md) 모델 3 — **OSS 소스 + Developer ID 서명 DMG 유료** 하이브리드. 이 문서는 "public 토글 누르기 전까지" 해야 할 일 전부를 순서대로 정리합니다.

현재 audit 결과 (2026-04-22):
- LICENSE 없음
- `package.json`: `author / license / repository / homepage / bugs` 필드 모두 누락
- `.github/` 디렉토리 없음 (이슈·PR 템플릿, CI 없음)
- CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / CHANGELOG 없음
- 시크릿 누출 없음 ✅ (placeholder `sk-...` 만 HTML 에 존재)
- `git log` 히스토리 깨끗 ✅

---

## 1. 먼저 결정해야 할 것 (Pre-decisions)

### 1.1 라이선스 선택
- [ ] **MIT** *(추천)* — 하이브리드 모델과 정합. 포크·상업 이용 허용하되 ATTRIBUTION 만 요구. WhisperKit / whisper.cpp / Ollama 모두 MIT 라 호환 문제 없음.
- [ ] 대안 고려: **Apache 2.0** (특허 조항 명시, enterprise 친화) · **AGPL-3.0** (클라우드 재판매 방지, 하지만 Listen K 는 로컬 앱이라 비대칭) · **PolyForm Noncommercial** (OSI 비공인, "osi-approved open source" 타이틀 포기)
- 결론: **MIT** 로 가면 "보여주되 유료 바이너리로 돈 번다" 전략에 마찰 최소

### 1.2 레포 전략
- [ ] 기존 private 레포 그대로 public 전환 (히스토리 clean 해서 옵션 A)
- [ ] fresh public 레포로 squash push (민감 커밋 있으면 옵션 B)
  - → 현재 스캔상 시크릿 없으므로 **옵션 A 가능**

### 1.3 CLA/DCO
- [ ] **DCO 권장** (`Signed-off-by` 커밋 라인). CLA 보다 가볍고 indie 규모에 충분
- [ ] 향후 dual-license / 상업 라이선스 필요해지면 그때 CLA 도입 검토

### 1.4 Pro 기능 gating 전략 (재확인)
- [ ] 모든 코드 OSS 공개, **유료는 공증 DMG 그 자체** (Pro 기능 gating 없음) — Listen K 는 이게 맞음: 기능 분리하면 포크 동기 높아짐
- [ ] 단 하나 예외: 라이선스 키 검증 모듈은 public key 만 소스에 두고 signing key 는 private ([Keygen 오프라인 가이드](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/)) — 기능 차별 없이 "정식 빌드 증명" 용도

---

## 2. 레포 정리 (Repo hygiene)

### 2.1 `package.json` 메타데이터 보강 (확정값)
- [ ] `"author": "ibank <hello@listenk.com>"`
- [ ] `"license": "MIT"`
- [ ] `"repository": {"type": "git", "url": "https://github.com/ibank/ListenK.git"}`
- [ ] `"homepage": "https://listenk.com"`
- [ ] `"bugs": {"url": "https://github.com/ibank/ListenK/issues", "email": "hello@listenk.com"}`
- [ ] `"keywords": ["whisper", "dictation", "macos", "korean", "whisperkit", "electron", "ollama"]`

### 2.2 개인정보 / 머신-특정 경로 스캔
- [ ] `/Users/ibank` 하드코딩 여부 전수 검색 (있으면 `app.getPath()` / `os.homedir()` 로 교체)
- [ ] 개발자 개인 번들 ID, 테스트 경로 제거
- [ ] `scripts/*.sh` 안 절대경로 확인
- [ ] `.env.example` 파일 추가 (실제 `.env` 는 없지만 기대 변수 문서화)

### 2.3 히스토리 스캔 (한 번 더)
- [ ] `gitleaks detect --source . --verbose` (brew install gitleaks)
- [ ] `trufflehog git file://. --only-verified`
- [ ] 누출 발견 시 `git filter-repo --replace-text` 또는 fresh repo 옵션으로 전환

### 2.4 `.gitignore` 보강
- [ ] `.claude/` 추가 (Claude Code 로컬 설정)
- [ ] `.env` 추가
- [ ] `.vscode/` 추가 (팀 합의 안 된 설정)
- [ ] `*.dmg`, `*.zip` (빌드 결과물)

---

## 3. 서드파티 라이선스 감사

### 3.1 런타임 의존성 — 검증 완료 (2026-04-22, `gh api .../license`)

| 의존성 | SPDX | 번들링 | MIT 호환 |
|---|---|---|---|
| Electron 31 | MIT | runtime | ✅ |
| WhisperKit (argmaxinc) | MIT | Swift helper | ✅ |
| mlx-swift (ml-explore) | MIT | Swift helper (translate) | ✅ |
| mlx-swift-examples | MIT | Swift helper (translate) | ✅ |
| swift-argument-parser (Apple) | Apache-2.0 | Swift helper | ✅ (one-way 호환, NOTICE 유지 필요) |
| whisper.cpp (ggerganov) | MIT | optional | ✅ |
| Ollama | MIT | 외부 프로세스 | 영향 없음 |
| 프로덕션 npm deps | — | 0개 (전부 devDependencies) | ✅ |

**결론**: Listen K 를 **MIT 로 공개해도 법적 문제 없음**. 유일한 주의점은 Apache-2.0 인 swift-argument-parser 의 NOTICE/ATTRIBUTION 을 `THIRD_PARTY_LICENSES.md` 에 보존하는 것 ([Apache 2.0 Section 4](https://www.apache.org/licenses/LICENSE-2.0#redistribution)).

### 3.2 에셋 라이선스
- [ ] `build/icon.png` / HUD 사운드 / 폰트 — 제작 출처 명시. AI 생성이면 모델 약관 확인
- [ ] Apple SF Symbols 쓰고 있으면 "Apple 앱에서만 사용" 제약 확인 ([Apple SF Symbols License](https://developer.apple.com/fonts/))

### 3.3 공지 파일
- [ ] `THIRD_PARTY_LICENSES.md` 생성 — 주요 의존성의 원문 라이선스 포함
- [ ] `NOTICE` (Apache 2.0 선택 시만 필요)

---

## 4. 필수 레포 파일

### 4.1 루트
- [ ] **LICENSE** (MIT 텍스트, Year + Author)
- [ ] **README.md** (기존 한국어판 유지 + 개선) — 상단에 배지(build status, license, version), 데모 GIF, Quick install, Features, Screenshots, Build from source, Privacy, License 순
- [ ] **README.en.md** — 영어판 (global discovery 목적, GitHub 자체는 주 README 만 표시)
- [ ] **CHANGELOG.md** — Keep a Changelog 형식, v0.3.0 부터 소급 작성
- [ ] **CONTRIBUTING.md** — 빌드 요건, 테스트 방법, PR 규칙 (DCO 사인오프 명시)
- [ ] **CODE_OF_CONDUCT.md** — Contributor Covenant 2.1 복붙
- [ ] **SECURITY.md** — 취약점 보고 채널, 지원 버전, 응답 SLA

### 4.2 `.github/`
- [ ] `ISSUE_TEMPLATE/bug_report.yml` (macOS 버전, Listen K 버전, 재현 단계, 로그 경로)
- [ ] `ISSUE_TEMPLATE/feature_request.yml`
- [ ] `ISSUE_TEMPLATE/config.yml` — 구매·환불 문의는 이메일/결제 대시보드로 리다이렉트
- [ ] `PULL_REQUEST_TEMPLATE.md` — 체크리스트(테스트·빌드·smoke.sh·DCO)
- [ ] `FUNDING.yml` — GitHub Sponsors / Paddle 구매 링크
- [ ] `CODEOWNERS` — `@ibank *` (solo maintainer 명시)
- [ ] `dependabot.yml` — `npm` / `github-actions` 주간 업데이트

---

## 5. 빌드 재현성 (Build reproducibility)

### 5.1 환경 요건 문서화
- [ ] `BUILDING.md` 또는 README 섹션에:
  - macOS 14+ (Sonoma), Apple Silicon
  - Node.js 20.x LTS, npm 10+
  - Xcode 15+ (Swift 5.9+)
  - Rust (whisper.cpp 빌드 시) — 사용 안 하면 생략
  - cmake (선택)
- [ ] `.tool-versions` 또는 `.nvmrc` 추가

### 5.2 모델 다운로드 분리
- [ ] 현재 `scripts/download-whisperkit-model.sh` 이미 존재 ✅
- [ ] README 에 "모델은 라이선스 차이로 레포에 포함하지 않음, `npm run model:whisperkit` 로 다운로드" 명시
- [ ] Whisper 모델 라이선스 (MIT · Hugging Face 경유) 링크

### 5.3 Ad-hoc vs Developer ID 빌드 분기
- [ ] `scripts/after-pack.js` 에서 env `DEVELOPER_ID_APPLICATION` 있으면 정식 서명, 없으면 ad-hoc — 현재 로직 확인 후 문서화
- [ ] OSS 기여자가 `npm run dist:dir` 만으로도 앱 번들 만들 수 있어야 함 (서명 없이도 빌드 통과)

---

## 6. CI/CD (`.github/workflows/`)

public 레포이므로 **macOS runner 가 무료** ([GitHub Actions pricing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)).

### 6.1 워크플로우 4종
- [ ] `ci.yml` — PR/push 시: `node -c`, `bash scripts/smoke.sh` (모델 없이도 돌게 수정 필요), license-checker
- [ ] `build.yml` — PR 시 `npm run dist:dir` 로 ad-hoc 빌드 성공만 확인
- [ ] `release.yml` — 태그 push (`v*`) 시 Developer ID 서명 + notarize + GitHub Release 업로드 + 체크섬 생성
- [ ] `security.yml` — gitleaks, dependency-review 주간 스캔

### 6.2 GitHub Secrets 설정
- [ ] `APPLE_ID` (이메일)
- [ ] `APPLE_APP_SPECIFIC_PASSWORD` ([appleid.apple.com](https://appleid.apple.com/) 에서 생성)
- [ ] `APPLE_TEAM_ID`
- [ ] `DEVELOPER_ID_P12_BASE64` (Developer ID cert export, base64)
- [ ] `DEVELOPER_ID_P12_PASSWORD`
- [ ] `KEYCHAIN_PASSWORD` (임시 keychain 용)
- [ ] `PADDLE_WEBHOOK_SECRET` (결제 webhook 용, 별도 서버면 여기 불필요)

### 6.3 smoke.sh 조정
- [ ] 현재 모델 없으면 일부 step 실패 — public CI 에서 통과하도록 "모델 없으면 skip" 처리 이미 있는지 재확인 ([scripts/smoke.sh:57-60](../scripts/smoke.sh#L57-L60))

---

## 7. 보안 · 프라이버시 문서

### 7.1 SECURITY.md 핵심 항목
- [ ] 지원 버전 정책 (예: 최신 minor 만 보안 패치)
- [ ] 보고 채널: 이메일 또는 GitHub Private Vulnerability Reporting
- [ ] 응답 SLA (목표 72시간 confirm, 30일 patch)
- [ ] 보상 없음 명시 (indie 이므로 bounty 불가)

### 7.2 PRIVACY.md 또는 README 섹션
- [ ] 데이터 흐름 다이어그램: 음성 → WhisperKit(로컬) → [선택] Ollama(로컬) / OpenAI(BYOK)
- [ ] "기본 설정으로 기기를 벗어나는 데이터 없음" 명시
- [ ] OpenAI BYOK 선택 시 OpenAI 에 전송됨 — 이 경고를 UI+문서 양쪽에
- [ ] 권한 목록: 마이크 / 손쉬운 사용 / Apple Events — 각 사용처

### 7.3 위협 모델 (선택이지만 신뢰도 ↑)
- [ ] `THREAT_MODEL.md` — accessibility 권한 남용 가능성, paste-helper 공격 표면, fn-listener 이벤트 로깅 범위 명시

---

## 8. 커뮤니티 지속 가능성

### 8.1 Funding
- [ ] GitHub Sponsors 활성화 (한국 계정도 Stripe Connect 로 가능 — [GitHub Sponsors Docs](https://docs.github.com/en/sponsors))
- [ ] `.github/FUNDING.yml` 에 sponsors + paddle 구매 페이지 동시 노출
- [ ] README 상단에 "Buy signed build ($29)" + "Star on GitHub" 2개 CTA

### 8.2 릴리즈 정책
- [ ] Semver 준수 — v0.3.0 → v1.0.0 은 "공개 API 안정" 신호이므로 OSS 공개 타이밍에 맞춰 v0.4 로 번호 정리할지 결정
- [ ] Release notes 양식 (한/영 병기, 중요 변경은 bold)
- [ ] Breaking change 는 minor 전 deprecation 1개 사이클

### 8.3 국제화 기여 가이드
- [ ] `CONTRIBUTING_i18n.md` — 새 로케일 추가 절차 (`i18n.js` 의 4개 키 중 하나 복사 → 번역 → tray/hud 업데이트)
- [ ] 현재 4개 locale (ko/en/ja/zh-CN) 완료 ✅, 기여자 잠재 언어: es, pt-BR, de, fr, ru

---

## 9. Public 전환 D-Day 체크

레포를 private → public 전환하기 **직전** 마지막 확인:

- [ ] 위 1~8 항목 전부 완료
- [ ] `git log --all | grep -iE "(TODO|FIXME|XXX|HACK)"` 검토 — 민감 정보 지시 남아있는지
- [ ] `.github/` 의 모든 URL 이 `ibank/ListenK` 로 올바른지
- [ ] README 의 설치 링크 / 다운로드 링크가 public URL 로 동작
- [ ] `npm run smoke` 가 clean 환경에서 통과
- [ ] CI 워크플로우가 draft PR 로 1회 돌아 green ✅
- [ ] 태그 `v0.4.0-rc1` 으로 release workflow dry-run
- [ ] **GitHub Settings → General → Danger Zone → Change visibility → Public**

---

## 10. 공개 직후 (Launch)

### 10.1 공지 채널 (우선순위순)
- [ ] **GeekNews (news.hada.io)** — "Listen K – 한국어 1급 로컬 Whisper 받아쓰기 오픈소스화"
- [ ] **Hacker News Show HN** — "Show HN: Listen K – Offline Whisper dictation with Korean/Japanese first-class (macOS)"
- [ ] **Product Hunt** — OSS 런칭은 PH 와 잘 맞음
- [ ] **Qiita / Zenn / note.com** — 일본어 블로그 포스트
- [ ] Mac 앱 번들 / 리스트 사이트: [Awesome macOS](https://github.com/iCHAIT/awesome-macOS), [macOSicons](https://macosicons.com/) 제출

### 10.2 첫 주 운영
- [ ] 이슈 트리아지 24시간 이내
- [ ] README 우상단에 "한국어 · English · 日本語 · 简体中文" 탭
- [ ] Sponsors 초기 목표 설정 (예: "월 $100 달성 시 Developer ID 연회비 자동 충당")

### 10.3 30일 회고 지표
- [ ] GitHub Stars 목표: 500+
- [ ] 유료 DMG 판매: 50 copies ($29 × 50 = $1,450 직매출)
- [ ] Sponsors: 월 $50+
- [ ] PR / Issue: 10+ external contributor 참여

---

## 11. 예상 총 작업량

| 단계 | 소요 | 비용 |
|---|---|---|
| 1–4 (결정·정리·문서) | 1–2일 | $0 |
| 5 (빌드 재현성 검증) | 0.5일 | $0 |
| 6 (CI/CD) | 1일 | $0 (public 레포 무료) |
| 7 (보안 문서) | 0.5일 | $0 |
| 8–9 (커뮤니티·최종 체크) | 0.5일 | $0 |
| **Apple Developer Program** | 가입 1–2일 (심사) | **$99/년** |
| **도메인** (listenk.app 등) | 즉시 | $12–15/년 |
| **Total** | **4–5 영업일** | **$110–115 초기** |

---

## 12. 순서 권장

```
Week 1: 결정 확정 (라이선스·전략) → 레포 정리 → Apple Dev 가입
Week 2: 필수 문서 작성 + CI/CD 셋업 → Developer ID 파이프라인
Week 3: 공증 release 자동화 검증 → 도메인·웹사이트 최소 셋업
Week 4: 최종 audit → public 전환 → 공지
```

확정된 결정값 (2026-04-22):
1. 라이선스: **MIT** — 모든 의존성 MIT/Apache-2.0 이라 호환 검증 완료
2. 공개 이메일: **hello@listenk.com**
3. 도메인: **listenk.com** — `homepage` / `bugs.email` / 웹사이트 모두 연결

OSS 릴리즈 파일(LICENSE / THIRD_PARTY_LICENSES / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / CHANGELOG / `.github/` 템플릿 / CI 워크플로우) 생성 완료.

## Public 전환 전 남은 수동 작업 — 매뉴얼
순서대로 진행:
1. [Manual 1 — Apple Developer ID 인증서 준비](manual-developer-id.md)
2. [Manual 2 — GitHub Secrets 등록](manual-github-secrets.md)
3. [Manual 3 — 상표 검색 + 도메인 확정](manual-trademark-domain.md)

세 매뉴얼 완료 후 위 §9 의 Public 전환 D-Day 체크로 넘어갑니다.
