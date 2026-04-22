---
updated: 2026-04-22
scope: Listen K — GitHub Actions Release workflow 에 필요한 5개 secret 등록과 검증
related: docs/manual-developer-id.md, .github/workflows/release.yml
---

# Manual 2 — GitHub Secrets 등록

[Manual 1](manual-developer-id.md) 에서 준비한 자격들을 GitHub Actions 가 쓸 수 있도록 **Repository Secret** 으로 등록합니다. 5개 모두 없으면 `release.yml` 이 `::error::MAC_CERTIFICATE_BASE64 not set` 같이 빠르게 실패합니다.

예상 소요: **15분**.

---

## 1. 전제 조건

- [Manual 1](manual-developer-id.md) 완료
  - `ListenK-DeveloperID.p12` 파일과 그 비밀번호
  - Team ID
  - App-specific password
- `ibank/ListenK` 레포의 **Settings** 접근 권한 (소유자 본인이면 자동)

---

## 2. 등록할 secret 목록

| Secret 이름 | 소스 | 형식 |
|---|---|---|
| `MAC_CERTIFICATE_BASE64` | Manual 1 §4 의 `.p12` 파일 | base64 문자열 |
| `MAC_CERTIFICATE_PASSWORD` | `.p12` 내보낼 때 설정한 비밀번호 | 평문 |
| `APPLE_ID` | Apple Developer 계정 이메일 | `hello@listenk.com` 같은 이메일 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Manual 1 §5 에서 발급 | `xxxx-xxxx-xxxx-xxxx` |
| `APPLE_TEAM_ID` | Manual 1 §6 | 10자리 (예: `TEAMID12AB`) |

이 이름들은 [`release.yml`](../.github/workflows/release.yml) 과 정확히 일치해야 합니다 — 오타 주의.

---

## 3. `.p12` 를 base64 로 변환

터미널에서:
```bash
base64 -i ListenK-DeveloperID.p12 | pbcopy
```
이 명령 하나로 clipboard 에 base64 한 줄이 복사됩니다. 바로 4절 붙여넣기에 씁니다.

### 3.1 검증 (붙여넣기 전)
```bash
base64 -i ListenK-DeveloperID.p12 | wc -c
```
보통 5,000 – 10,000 바이트. 10KB 이내여야 GitHub Secret 크기 제한(48KB)에 여유.

### 3.2 주의
- `pbcopy` 는 macOS 전용. Linux 면 `base64 -w0 ListenK-DeveloperID.p12 | xclip -selection clipboard`.
- 이 base64 문자열은 **`.p12` 그 자체와 동급으로 민감**. 스크린샷 금지, 터미널 히스토리에 남기지 말 것 (`HISTFILE=/dev/null` 또는 공백 prefix `<space>base64 ...`).

---

## 4. GitHub Secret 등록

### 4.1 경로
1. https://github.com/ibank/ListenK 접속
2. **Settings** 탭
3. 좌측 **Secrets and variables** → **Actions**
4. "Repository secrets" 섹션의 **New repository secret** 클릭

### 4.2 각 secret 입력

**MAC_CERTIFICATE_BASE64**
- Name: `MAC_CERTIFICATE_BASE64`
- Secret: 3절에서 clipboard 에 있는 base64 문자열 붙여넣기
- Add secret

**MAC_CERTIFICATE_PASSWORD**
- Name: `MAC_CERTIFICATE_PASSWORD`
- Secret: `.p12` export 시 설정한 비밀번호 (평문)
- Add secret

**APPLE_ID**
- Name: `APPLE_ID`
- Secret: Apple Developer 계정 이메일 (예: `hello@listenk.com`)
- Add secret

**APPLE_APP_SPECIFIC_PASSWORD**
- Name: `APPLE_APP_SPECIFIC_PASSWORD`
- Secret: Manual 1 §5 에서 발급한 `xxxx-xxxx-xxxx-xxxx`
- Add secret

**APPLE_TEAM_ID**
- Name: `APPLE_TEAM_ID`
- Secret: Manual 1 §6 의 10자리 Team ID
- Add secret

### 4.3 등록 후 확인
- Settings → Secrets and variables → Actions 화면에 5개 모두 "Updated X seconds ago" 로 표시
- **값은 다시 볼 수 없음** (편집만 가능). 분실 시 해당 소스에서 재취득 후 Update.

---

## 5. 검증 — Dry Run

실제 `v*.*.*` 태그 없이 secrets 가 제대로 주입되는지 확인하는 두 가지 방법.

### 5.1 방법 A: RC 태그로 전체 Release 워크플로우 실행 (추천)
```bash
# 먼저 CHANGELOG [Unreleased] 를 확인해서 현재 main 상태에 맞는 버전 결정
git tag -a v0.3.1-rc1 -m "Release workflow dry run"
git push origin v0.3.1-rc1
```
- GitHub → Actions → Release workflow 가 macos-14 러너에서 시작
- "Verify signing secrets are present" step 에서 5개 secret 이 모두 존재 확인
- 이후 빌드·서명·공증까지 돌고 **draft release** 가 생김 (`--draft` 플래그 때문)
- 문제가 있으면 로그에서 drift 지점 확인 후 재시도
- 성공 확인 후 **draft release 삭제 + RC 태그 삭제**:
  ```bash
  gh release delete v0.3.1-rc1 -y
  git push --delete origin v0.3.1-rc1
  git tag -d v0.3.1-rc1
  ```

### 5.2 방법 B: 워크플로우 파일을 임시 수정해 manual trigger
- `.github/workflows/release.yml` 에 일시적으로 `workflow_dispatch:` 를 추가해 UI 에서 실행
- 검증 후 PR revert 로 다시 제거
- 방법 A 대비 장점 없음 — 1회 쓰고 버릴 것

### 5.3 secret 누락 시 에러 예시
```
Run test -n "***"
::error::MAC_CERTIFICATE_BASE64 not set
Error: Process completed with exit code 1.
```
위 로그가 나오면 4절에서 해당 이름을 건너뛴 것.

### 5.4 서명 실패 시 흔한 원인
- `.p12` 에 private key 가 빠짐 → Manual 1 §4.1 에서 "Export 2 items" 가 아닌 "Export 1 item" 실행한 경우. 재-export.
- `MAC_CERTIFICATE_PASSWORD` 오타 → 재등록
- 인증서 revoke 상태 → developer.apple.com 에서 상태 확인

### 5.5 공증 실패 시 흔한 원인
- `APPLE_APP_SPECIFIC_PASSWORD` 를 Apple ID 본 비밀번호로 잘못 등록
- 2FA 미활성 (App-Specific Password 발급 자체가 안 됨)
- Team ID 에 하이픈·공백 등 오타

---

## 6. 회전(rotation) 정책

보안 사고 예방:

- **App-Specific Password**: 6개월마다 회전 권장. appleid.apple.com 에서 기존 revoke 후 재발급 → `APPLE_APP_SPECIFIC_PASSWORD` Update.
- **`.p12` (Developer ID 인증서)**: 유효기간 5년. 만료 3개월 전 새 인증서 발급 → 새 `.p12` export → `MAC_CERTIFICATE_BASE64` Update. 기존 인증서는 **revoke 하지 말 것** — 이미 서명·공증된 이전 릴리즈의 검증에 쓰임.
- **비밀번호 유출 의심** (예: base64 실수로 커밋된 경우): 즉시 `.p12` 재export (다른 비밀번호) → revoke 필요 없음, 그냥 새 파일로 Secret Update. 과거 릴리즈 재공증은 필요 없음.
- **Apple ID 계정 양도** (개인 → 법인 등): 모든 이전 인증서 revoke 는 **하지 말고**, 새 계정에서 새 Developer ID 발급 → 병행 후 다음 메이저 릴리즈부터 교체. 이전 릴리즈는 혼자서도 Gatekeeper 검증 유지.

---

## 7. 최종 체크리스트

Manual 3 (상표·도메인) 로 넘어가기 전:

- [ ] 5개 repository secret 등록 완료 (Settings 화면에서 5개 전부 보임)
- [ ] 방법 A 의 RC 태그 dry run 성공 (draft release 생성 + 산출물 `.dmg` 열림)
- [ ] draft release + RC 태그 정리 완료
- [ ] `.p12` 원본 파일 안전 보관 위치 메모 (1Password 등)
- [ ] 회전 스케줄 리마인더 설정 (6개월 app-specific password, 5년 인증서)

다음: [Manual 3 — 상표 검색 + 도메인 확정](manual-trademark-domain.md).
