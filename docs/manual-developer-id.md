---
updated: 2026-04-22
scope: Listen K — Apple Developer Program 가입부터 Developer ID 인증서·`.p12`·app-specific password 준비까지
related: docs/open-source-checklist.md, .github/workflows/release.yml
---

# Manual 1 — Apple Developer ID 인증서 준비

이 문서는 "Apple 계정은 있지만 Developer Program 에 가입한 적 없음" 상태에서 **Listen K 의 공증된 DMG 를 자동으로 빌드할 수 있는 상태** 까지 한 번에 안내합니다. 완료 후 산출물 4가지:

- Developer ID Application 인증서 (Keychain + `.p12` 파일)
- Team ID (10자리)
- App-specific password (notarytool 전용)
- `package.json` 에서 `mac.identity: null` 제거

예상 소요: **하루 (심사 대기 12–48시간 포함)**. 실제 작업 시간은 30–40분.

---

## 1. Apple Developer Program 가입

### 1.1 준비물
- 본인 명의 **Apple ID** (2단계 인증 활성화 필수)
- 신용카드 (연회비 **USD $99** 선결제)
- 본인 확인용 사진 있는 신분증 (Apple 이 요청할 수 있음)
- (Organization 가입 시) D-U-N-S 번호 — 한국 법인은 NICE 평가정보에서 무료 발급

### 1.2 Individual vs Organization
- **Individual** (추천, Listen K 에 적합)
  - 인증서의 "Developer ID Application: <실명>" 으로 표시됨
  - D-U-N-S 불필요, 즉시 신청 가능
  - 단, 개인 이름이 앱 Gatekeeper 에 노출됨
- **Organization**
  - "Developer ID Application: <회사명>" 표시
  - D-U-N-S 번호 + 법인 증빙 필요, 심사 3–5일
  - 팀 확장·퇴사 대비 좋음. indie 단계에선 과도함

### 1.3 가입 절차
1. https://developer.apple.com/programs/enroll/ 접속
2. "Start Your Enrollment" 클릭 후 Apple ID 로그인
3. **Individual** 선택 → 개인정보 입력 (실명·주소는 신분증과 일치해야 함)
4. 약관 동의 → 결제 ($99, 카드 즉시 승인)
5. Apple 리뷰 대기 (Individual: 수 시간–2일)

### 1.4 가입 확인
- https://developer.apple.com/account 에서 "Membership" 탭이 보이면 성공
- **Team ID** (10자리 문자+숫자)가 이 페이지에 표시됨 → 메모

---

## 2. CSR (Certificate Signing Request) 생성

Keychain Access 가 표준 도구. 터미널 `openssl` 로도 가능하지만 Apple 도구 경로가 실수가 적음.

### 2.1 Keychain Access 로 CSR 만들기
1. Applications → Utilities → **Keychain Access** 실행
2. 메뉴 → Keychain Access → **Certificate Assistant** → **Request a Certificate From a Certificate Authority…**
3. 대화상자 입력
   - User Email Address: `hello@listenk.com`
   - Common Name: `ibank` (본인 실명, 가입 때와 일치)
   - CA Email Address: 비워둠
   - Request is: **Saved to disk** 선택 + "Let me specify key pair information" 체크
4. Continue → 2048-bit RSA 선택 → 파일명 `ListenK-CSR.certSigningRequest` 저장

생성 시 Keychain 에 해당 key pair 의 private key 가 **login keychain** 에 자동으로 저장됨. 이 개인키가 없으면 이후 인증서가 무쓸모해집니다.

---

## 3. Developer ID Application 인증서 발급

### 3.1 인증서 생성
1. https://developer.apple.com/account/resources/certificates/list 접속
2. `+` 버튼 → **Software** 섹션에서 **Developer ID Application** 선택 → Continue
3. "G2 Sub-CA (Xcode 11.4.1 or later)" 선택 → Continue
4. 이전 단계에서 만든 `.certSigningRequest` 파일 업로드 → Continue
5. `developerID_application.cer` 다운로드

### 3.2 Keychain 에 설치
- `.cer` 파일 더블클릭 → Keychain Access 에 자동 설치됨
- 설치 위치: **login** keychain (기본)

### 3.3 검증
```bash
security find-identity -v -p codesigning
```
출력에 다음과 같은 줄이 보이면 성공:
```
1) ABC1234567890DEF... "Developer ID Application: ibank (TEAMID12AB)"
```

---

## 4. `.p12` 로 내보내기 (CI 이전용)

### 4.1 Keychain Access 에서 export
1. Keychain Access → "My Certificates" 카테고리
2. "Developer ID Application: ibank (TEAMID12AB)" 찾아 **오른쪽 삼각형 펼쳐서** 그 아래 private key 까지 함께 선택 (반드시 인증서 + 개인키 둘 다)
3. 오른쪽 클릭 → **Export 2 items…** → `ListenK-DeveloperID.p12`
4. 내보내기 비밀번호 설정 (GitHub Secret 으로 그대로 씀, 강한 비밀번호)

### 4.2 검증
```bash
# 비밀번호 입력 프롬프트에서 위에서 설정한 값 입력
openssl pkcs12 -info -in ListenK-DeveloperID.p12 -noout
```
"MAC verified OK" 가 출력되면 정상.

### 4.3 안전 보관
- `.p12` 파일은 **절대 레포·Slack·이메일·iCloud Drive 등에 남기지 말 것**
- 저장 위치 추천: 1Password / Bitwarden 의 첨부 파일, 또는 LUKS/VeraCrypt 암호화 디스크
- 분실 시: developer.apple.com 에서 인증서 revoke 후 재발급 (위 2–3 단계 반복)

---

## 5. App-Specific Password 생성 (notarytool 용)

공증(`notarytool submit`)에는 Apple ID 본 비밀번호가 아닌 **앱 전용 비밀번호**가 필요합니다. 2FA 환경에서 CI 가 로그인할 수 있는 유일한 방법.

### 5.1 발급 절차
1. https://appleid.apple.com/ 접속 → 로그인
2. 좌측 "Sign-In and Security" → "App-Specific Passwords"
3. `+ Generate Password` → 라벨 `notarytool-listenk-ci`
4. 생성된 비밀번호 `xxxx-xxxx-xxxx-xxxx` 즉시 복사 (한 번만 보임)
5. 1Password 등에 즉시 보관

### 5.2 주의
- 비밀번호 분실 시 revoke 후 재발급하는 길밖에 없음
- 라벨에 `ci` 를 명시해서 개인 장치 접근용과 섞이지 않게

---

## 6. Team ID 재확인

이미 Membership 페이지에서 확인했을 테지만 CI secret 에 넣기 직전 한 번 더:

```bash
# 인증서 Common Name 괄호 안의 값이 Team ID
security find-identity -v -p codesigning | grep "Developer ID Application"
```
결과 예: `"Developer ID Application: ibank (TEAMID12AB)"` → **TEAMID12AB** 가 Team ID.

---

## 7. `package.json` 수정

로컬 ad-hoc 빌드용으로 두었던 `mac.identity: null` 을 제거해야 electron-builder 가 환경변수의 인증서를 찾습니다.

### 7.1 현재 상태
```json
"mac": {
  ...
  "identity": null,
  "hardenedRuntime": false,
  "gatekeeperAssess": false
}
```

### 7.2 변경 후
```json
"mac": {
  ...
  "hardenedRuntime": true
}
```
변경점:
- `"identity": null` 라인 **삭제** — electron-builder 가 env `CSC_LINK` 로 인증서 찾도록
- `"hardenedRuntime": false` → `true` (공증 전제조건)
- `"gatekeeperAssess": false` 라인 **삭제** (기본값이 `false` 라 불필요)

### 7.3 영향
- `npm run dist` 를 Developer ID 없이 로컬에서 실행하면 "no identity found" 로 실패함. 로컬 ad-hoc 빌드가 필요할 땐 `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:dir` 로 우회 가능.
- CI 는 release.yml 에서 CLI 플래그로 모든 값을 넘기므로 영향 없음.

---

## 8. 최종 체크리스트

Manual 2 (GitHub Secrets) 로 넘어가기 전 모두 ✅ 확인:

- [ ] Apple Developer Program Active (Membership 페이지 초록 체크)
- [ ] `security find-identity -v -p codesigning` 에 Developer ID Application 표시
- [ ] `.p12` 파일 + 해당 비밀번호 안전 보관
- [ ] Team ID 10자리 기록
- [ ] App-specific password 기록
- [ ] `package.json` 수정 커밋 완료
- [ ] `npm run dist:dir` 빌드 성공 (로컬 ad-hoc 테스트는 `CSC_IDENTITY_AUTO_DISCOVERY=false` 로)

다음: [Manual 2 — GitHub Secrets 등록](manual-github-secrets.md).
