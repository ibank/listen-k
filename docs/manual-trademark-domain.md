---
updated: 2026-04-22
scope: Listen K — 상표 선행 조사(KIPO/USPTO/WIPO)와 listenk.com 도메인 확정·이메일·DNS 기본 세팅
related: docs/open-source-checklist.md, docs/monetization.md
---

# Manual 3 — 상표 검색 + 도메인 확정

"Listen K" 이름을 그대로 공개·판매하기 전에 **기존 등록상표와 충돌하는지** 확인하고, `listenk.com` 도메인이 실제 우리 손에 있는지 최종 점검합니다. 충돌이 발견되면 공개 전에 이름을 바꾸는 편이 훨씬 싸게 먹힙니다.

예상 소요: **1–3시간** (상표 검색 + 도메인 등록 + 이메일 포워딩까지).

---

## 1. 사전 이해 — indie 가 알아야 할 최소 상표법

- **상표는 국가·클래스 단위**로 등록됨. "US 에서 먼저 등록된 Listen K" 가 "한국 에서 Listen K" 를 자동으로 막지는 않지만, 분쟁 시 **사용 선후** 와 **혼동 가능성**이 따짐.
- **클래스 9**: "컴퓨터 소프트웨어, 다운로드 가능한 앱"
- **클래스 42**: "SaaS, 소프트웨어 개발 서비스"
- Listen K 는 **9 + 42** 두 클래스가 대상.
- "동일한" 단어만 문제가 아니라 **혼동 가능 (likelihood of confusion)** 이면 문제. "ListenK" vs "Listen-K" vs "Listenk" 모두 동일 취급될 수 있음.
- indie 단계에서 **자신이 출원할 필요는 당장 없음** — 공격 방지(타인 선점 방어)가 주 목적. 월 매출 $5k 넘기면 USPTO 출원 ($350/클래스) 을 고려.

---

## 2. 상표 검색 — 3개 데이터베이스

### 2.1 한국 — KIPRIS (kipris.or.kr)
1. https://www.kipris.or.kr/ 접속 → 상단 **상표** 탭
2. "상표 검색" 입력창에 `Listen K`, `ListenK`, `리슨케이`, `리슨K` 각각 검색
3. 각 결과에 대해 체크:
   - **출원/등록 상태**: "등록" 이면 현재 유효, "소멸/거절" 이면 무시해도 됨
   - **상품류**: 09, 42 가 포함되어 있는지
   - **권리자**: 누구인지
4. 유사 음·철자도 확인: `Listen`, `리슨` 단독으로 9·42 류에서 매우 강력한 등록이 있는지

**해석 가이드**:
- 9·42 류에서 `Listen K` / `ListenK` 동일 등록 → **강한 충돌, 이름 변경 권장**
- `Listen` 단독 등록 but 전혀 다른 분야 (예: 의류) → 괜찮음
- `Listen Notes`, `Listen Live` 등 유사 기업 → 혼동 가능성 **낮음** (결합 단어는 통상 약한 권리범위)

### 2.2 미국 — USPTO TMSearch (tmsearch.uspto.gov)
2024년 TESS 가 TMSearch 로 교체됨 (2026-04-22 확인).

1. https://tmsearch.uspto.gov/ 접속 (로그인 없이 기본 검색 가능)
2. Basic Word Mark Search
3. 검색어: `Listen K`, `ListenK`, `LISTEN K` (대소문자 무시되지만 여러 형태로 cross-check)
4. 필터
   - Status: `LIVE` (죽은 상표는 무시)
   - International Class: `009` 및 `042`
5. Similar marks 확인 (USPTO 는 "phonetic equivalents" 도 추천 검색 제공)

**해석 가이드**:
- 9·42 류 LIVE 에 동일/유사 → **이름 변경 또는 상표 변호사 상담 필수**
- 9 류 LIVE 지만 42 류 없음 → Listen K 가 웹서비스 아닌 "앱" 만 판매라면 40~50% 리스크
- DEAD/EXPIRED → 재출원 고려 가능하지만 권장하지 않음 (재활성화될 수 있음)

### 2.3 국제 — WIPO Global Brand Database (branddb.wipo.int)
1. https://branddb.wipo.int/ 접속
2. `Listen K` / `ListenK` 검색
3. Designation 에 KR, US, JP, CN 집중 확인
4. Madrid Protocol 경유한 한국·일본·중국 보호 상표 확인

일본·중국 진출 계획이 있다면 WIPO 로 한 번에 훑는 게 효율적.

### 2.4 구글 + 앱스토어 "실사용" 조사
공식 등록이 없어도 사용 선행자가 권리를 주장할 수 있으므로:
- Google `"Listen K" dictation`, `"ListenK" whisper` 검색
- Mac App Store / Setapp / Product Hunt 에서 동명 앱 존재 여부
- GitHub `listen-k`, `listenk` 레포
- Domain 현황 (`listenk.com` 외 `listenk.app`, `listenk.io`, `listenk.dev` 누가 갖고 있는지)

---

## 3. 검색 결과 해석 플로우차트

```
9·42 류 KR/US 동일 상표 등록? ─── YES ──→ [이름 변경]
                              │
                              NO
                              ↓
9·42 류 KR/US LIVE 유사 상표? ── YES ──→ 변호사 상담 / 변경 권장
                              │
                              NO
                              ↓
구글·앱스토어 동명 사용 중? ── YES ──→ 같은 클래스면 변경, 다른 클래스면 통과 가능
                              │
                              NO
                              ↓
                          [이름 유지, 공개 진행]
                          (선택) USPTO 출원은 매출 발생 후 검토
```

---

## 4. 이름 변경이 필요한 경우 대체 후보

만약 "Listen K" 가 막힌다면:
- `Listo` (listo.app) — 간결, 스페인어 "준비됐어" 중의어
- `Tekst` (tekst.app) — 네덜란드어 "텍스트"
- `Keulos` / `Keuloq` — 완전 신조어 (검색 충돌 0 확률)
- `Typeless K` (typeless.app) — "키보드 없이" 연상, K 유지
- `Voiscribe` — voice + scribe, 9·42류 확인 필요

작명 후 다시 §2 상표 검색 반복.

---

## 5. listenk.com 도메인 — 등록 상태 확인

### 5.1 현재 소유자 조회
```bash
whois listenk.com
```

결과 해석:
- `No match for "LISTENK.COM"` → **미등록, 즉시 가능**
- `Registrar: ...` 나오면 누군가 소유 중 — `Registry Expiration Date` 확인

### 5.2 등록 가능한 상태라면 바로 구입
추천 등록처 (2026년 indie 기준):
- **Cloudflare Registrar** — 도메인 원가 ($9.15 .com) + 부가기능 무료. 강력 추천
- **Namecheap** — UI 친절, WhoisGuard 무료
- **Porkbun** — 가격 경쟁력 + API 깔끔
- 회피 권장: GoDaddy (renewal 인상, 업셀 스팸)

소요: 5분, ~$12/년.

### 5.3 누군가 소유 중이라면
- 최근 활동 있는지 사이트 방문
- parking page → 백오더 서비스 (Cloudflare, Namecheap 가능)
- 명함형 이메일 수신 중 → 이메일로 매수 문의 (보통 3–4자리 USD 요구)
- 혹은 대체 TLD 로 선회:
  - `listenk.app` — Google 소유 TLD, 강제 HTTPS. Mac 앱에 적합
  - `listenk.io` — 개발자 선호, $39/년 정도
  - `getlistenk.com` — 동일 서비스명 유지하며 가용성 확보 (Superwhisper 도 `superwhisper.com`)
  - `listenk.dev` — Google 소유 TLD, 강제 HTTPS
- 선회 확정 시 관련 문서 (`package.json.homepage`, `.github/FUNDING.yml`, `docs/open-source-checklist.md`, `CONTRIBUTING.md`) 일괄 업데이트 필요

---

## 6. 도메인 취득 후 최소 세팅

### 6.1 이메일 포워딩 — `hello@listenk.com`
이메일 서버를 직접 운영할 필요 없음. **별칭 포워딩** 으로 기존 개인 Gmail 로 전달:

**옵션 A: Cloudflare Email Routing (무료)**
1. Cloudflare 대시보드 → listenk.com → **Email** → Email Routing
2. Destination: 개인 Gmail 등록 + 확인 메일 클릭
3. Custom Address: `hello` → 개인 Gmail
4. Catch-all: `*` → 개인 Gmail (오타 수신 보장)
5. MX/TXT 레코드 자동 추가 버튼 클릭

**옵션 B: ImprovMX (무료, Cloudflare 외부 DNS 일 때)**
1. improvmx.com → listenk.com 추가
2. 제공되는 MX 2개 + SPF TXT 복사 → 등록처 DNS 에 추가
3. Alias: `hello@listenk.com` → 개인 Gmail

**Gmail 에서 이 주소로 "보내기"**
- Gmail 설정 → 계정 → "다른 주소에서 메일 보내기" → `hello@listenk.com` 추가
- SMTP: ImprovMX / Cloudflare 는 전송까지는 제공하지 않으므로 Gmail 은 자기 서버로 보내고 `From` 만 listenk.com 으로 표기 → **DMARC/SPF alignment 실패** 가능성 있음
- 프로 레벨 필요 시 **Google Workspace ($6/월/user)** 로 승격 — `hello@listenk.com` 을 진짜 받은편지함으로

### 6.2 DNS 기본 세팅
도메인 등록 직후 설정:
```
A       @            <웹호스팅 IP>  (또는 CNAME to Vercel/Cloudflare Pages)
A       www          (@ 와 동일)
MX      @            (Email Routing 자동)
TXT     @            "v=spf1 include:_spf.mx.cloudflare.net ~all"
TXT     _dmarc       "v=DMARC1; p=none; rua=mailto:hello@listenk.com"
```
웹사이트는 아직 없더라도 **MX + SPF** 는 먼저 올려둬야 스팸 폴더 행 확률이 줄어듭니다.

### 6.3 GitHub 연결
- `package.json.homepage` → `https://listenk.com` (이미 설정됨)
- GitHub 레포 Settings → "Website" 필드에 `https://listenk.com` 입력
- 레포 소개 (About) 에도 도메인 노출

---

## 7. 최종 체크리스트

레포를 **private → public** 로 토글하기 직전 4가지:

- [ ] KIPRIS 9·42 류 "Listen K" / "ListenK" 검색 — 충돌 없음 확인
- [ ] USPTO TMSearch 9·42 류 LIVE — 충돌 없음 확인
- [ ] WIPO Global Brand Database 확인 (특히 KR/US/JP/CN designation)
- [ ] `whois listenk.com` — 본인 소유 상태
- [ ] Cloudflare Email Routing 으로 `hello@listenk.com` 수신 테스트 (본인 → hello@ → 개인 Gmail 도착 확인)
- [ ] `package.json`·`.github/FUNDING.yml` 등 도메인 참조 모두 최종 확정값
- [ ] (선택) 12개월 내 상표 출원 계획 메모 — 매출 $5k 도달 시점 트리거

---

## 8. 참고 링크

- KIPRIS 상표 검색 — https://www.kipris.or.kr/
- USPTO TMSearch — https://tmsearch.uspto.gov/
- WIPO Global Brand Database — https://branddb.wipo.int/
- Cloudflare Registrar — https://www.cloudflare.com/products/registrar/
- Cloudflare Email Routing 문서 — https://developers.cloudflare.com/email-routing/
- ImprovMX — https://improvmx.com/

3개 매뉴얼 모두 완료하면 [docs/open-source-checklist.md §9](open-source-checklist.md) 의 Public 전환 D-Day 체크로 넘어갑니다.
