---
updated: 2026-04-22
scope: Listen K monetization strategy
---

# Listen K 수익화 전략 (2026년 4월 기준)

> 본 문서는 Listen K (macOS 전용, 로컬 Whisper 기반 AI 받아쓰기 앱, v0.3.0 private) 의 수익화 전략 초안입니다. 모든 가격·수수료는 2026년 4월 기준 공개 자료를 출처로 인용했으며, 추정치는 "추정" 으로 명시했습니다.

---

## 1. 현재 포지셔닝 요약

Listen K 는 이미 "로컬 우선 + macOS 네이티브 UX + CJK 1급 지원" 이라는 세 축이 모두 갖춰진 상태이므로, 수익화 전략은 이 세 축을 **가격으로 번역하는 작업**이 되어야 합니다. 단순히 "싼 Superwhisper" 를 만들면 Whisper Notes ($6.99) 와 경쟁해야 하고, 단순히 "고급 AI 받아쓰기" 를 표방하면 Wispr Flow ($15/월, 700M 밸류에이션, [TechCrunch 2025-11-20](https://techcrunch.com/2025/11/20/as-its-voice-dectation-app-takes-off-wispr-secures-25m-from-notable-capital/)) 와 정면 충돌합니다. Listen K 의 sweet spot 은 **한/일/중 유저를 위한 프리미엄 로컬 받아쓰기** 입니다.

---

## 2. 2026년 4월 경쟁 앱 가격·모델 맵

| 앱 | 가격 (USD) | 비즈니스 모델 | 처리 방식 | 출처 |
|---|---|---|---|---|
| **Superwhisper** | Free / $8.49월 / $84.99년 / $249.99 LT | Freemium + Lifetime | 로컬 (기본) + BYOK 클라우드 | [Voibe 2026 가격 리뷰](https://www.getvoibe.com/resources/superwhisper-pricing/) |
| **Wispr Flow** | Free (2,000 words/주) / $15월 / $144년 ($12월) / Teams $10–12/seat | 구독 전용 (Freemium hard-cap) | 클라우드 중심 | [Wispr Flow Pricing](https://wisprflow.ai/pricing) |
| **MacWhisper** | Free tier / $8.99월 or $29.99년 or $79.99 LT (Pro) | Freemium + Lifetime (Gumroad) | 로컬 Whisper / BYOK | [MacWhisper (Gumroad)](https://goodsnooze.gumroad.com/l/macwhisper), [MacWhisper 리뷰 2026](https://daveswift.com/macwhisper/) |
| **Whisper Notes** | $6.99 (iOS+macOS Universal, 10k words 트라이얼) | One-time only | 100% 로컬 | [whispernotes.app](https://whispernotes.app) |
| **Aiko** | App Store paid (Universal), 14-day TestFlight 트라이얼 | One-time (App Store) | 100% 로컬 Whisper large-v2 | [Sindre Sorhus · Aiko](https://sindresorhus.com/aiko) |
| **BetterDictation** | $39 lifetime | One-time | 로컬 | [Voibe Alternatives](https://www.getvoibe.com/resources/alternatives/) |
| **Aqua Voice** | $8–10/월 ($96–120/년) | 구독 전용 | 클라우드 (Avalon 모델) | [Aqua Voice 리뷰](https://www.voicetypingtools.com/tools/aqua-voice) |
| **TalkTastic** | Free (베타) | 미정 | 하이브리드 | [Voibe Alternatives](https://www.getvoibe.com/resources/alternatives/) |
| **MacGPT** | Free + $20 upgrade (BYOK) | One-time upgrade | BYOK | [MacGPT (Gumroad)](https://goodsnooze.gumroad.com/l/menugpt) |
| **Apple Dictation / Apple Intelligence** | $0 (M1+ 기본 포함, 온디바이스) | 무료 | 로컬 | [Apple Intelligence](https://www.apple.com/apple-intelligence/), [MacRumors 2025-06](https://www.macrumors.com/2025/06/18/apple-transcription-api-faster-than-whisper/) |

### 핵심 관찰

1. **가격 스펙트럼이 $6.99 ~ $249.99 로 매우 넓다.** Whisper Notes 의 $6.99 가 하한, Superwhisper Lifetime $249.99 가 상한이다.
2. **로컬 우선 진영은 거의 다 one-time / lifetime 을 제공한다** (Whisper Notes, Aiko, BetterDictation, MacWhisper, Superwhisper Lifetime). 반대로 **클라우드 진영 (Wispr Flow, Aqua) 은 구독 전용**이다. 이유: 로컬 처리는 developer 가 지속 비용이 안 들기 때문.
3. **Wispr Flow 가 2025년 11월 $25M Series A 확장으로 $700M 밸류에이션까지** 오르며 시장에 "voice dictation = large opportunity" 라는 시그널을 주었다 ([PRNewswire](https://www.prnewswire.com/news-releases/wispr-raises-25m-to-build-its-voice-operating-system-302621858.html)). 그러나 이건 enterprise 진입 (Fortune 500 중 270곳) 을 노린 스토리이지 한국어 유저 중심 사이드 프로젝트와는 결이 다르다.
4. **macOS Tahoe 의 Apple SpeechAnalyzer API 가 Whisper Large V3 Turbo 대비 ~55% 빠르다** ([MacStories hands-on](https://www.macstories.net/stories/hands-on-how-apples-new-speech-apis-outpace-whisper-for-lightning-fast-transcription/)) — 속도 측면에서 무료 대안이 강해졌다. 단, 이것은 개발자 API이고 **Apple 소비자 Dictation 은 여전히 한국어·일본어 긴 문장 + 전문 용어에서 Whisper 기반에 밀린다** ([Voibe: Apple vs Whisper](https://www.getvoibe.com/resources/apple-dictation-vs-openai-whisper/)).

---

## 3. 수익화 모델별 특성 (2026 트렌드)

### 3.1 One-time Purchase (Buyout / Lifetime)
- 2026년에 **소비자 선호가 다시 회복 중**: one-time / lifetime 비중이 2023년 6.4% → 2025년 10.3% 로 상승 ([RevenueCat · State of Subscription Apps 2026 요약](https://www.revenuecat.com/state-of-subscription-apps/), 인용 출처 [Influencers Time 2025](https://www.influencers-time.com/subscription-fatigue-in-2025-one-time-buys-vs-subscriptions/)).
- 로컬 처리 앱에 특히 적합: 개발자 서버 비용이 없으므로 "한 번 사면 영원히" 가 유지 가능.
- 단점: 대규모 MRR 가 안 나와서 VC 스토리가 어려움. → Listen K 에는 오히려 적합(소규모 + bootstrap).

### 3.2 Subscription (Monthly / Annual)
- RevenueCat 2026 보고서: **hard paywall** 의 Day-35 trial-to-paid 전환율 median 10.7% vs freemium 2.1% (약 5배 차이) ([RevenueCat 2026 요약 블로그](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/)).
- 클라우드 의존 앱에 적합. Listen K 는 로컬 우선이므로 **순수 구독만으로 포지셔닝하면 "왜 Apple Dictation 놔두고 매달 내지?" 라는 저항이 큼**.

### 3.3 Freemium with Usage Limits
- Wispr Flow 의 "Mac 2,000 words/주" 모델이 대표적. 무료 유저를 훅으로 걸어 유료로 전환시키는 구조.
- 로컬 처리는 대역폭·연산이 "유저 기기" 에서 일어나므로 **분량 제한의 명분이 약하다** (Apple Dictation 은 무제한인데 왜 제한?).
- Listen K 라면 **기능 게이팅** (예: 후처리 AI, 커스텀 단축어, 팀 공유) 이 더 합리적.

### 3.4 BYOK (Bring Your Own Key)
- MacGPT, MacWhisper, Superwhisper Pro 가 채택.
- 장점: 개발자 책임 소멸, 파워유저에게 명분.
- 단점: 일반 유저에게는 장벽. Listen K 는 이미 Ollama 로컬 + OpenAI BYOK 지원 중 → **유지하되 기본값은 Ollama 로 두는 설정이 중요**.

### 3.5 Pay-as-you-go Credits (Operator Key)
- Superwhisper, Wispr Flow 가 클라우드 후처리에 일부 사용.
- Listen K 가 직접 OpenAI 대행을 한다면 마진 모델이 되지만 **로컬 우선 철학과 충돌**. 권장하지 않음.

### 3.6 Lifetime + Major Version Upgrade Fee
- Sketch, Kaleidoscope 등이 사용해 온 고전 모델. 2026년 다시 부활 중.
- Listen K 라면 **"v1.x 평생 + v2 로 올릴 때 할인 업그레이드"** 형태가 어울림.

### 3.7 결제 인프라 선택 (수수료 비교, 2026)

| 채널 | 수수료 | MoR (세금/VAT 대행) | 출처 |
|---|---|---|---|
| **Mac App Store** | 30%, Small Business Program 가입 시 **15%** (연 매출 $1M 이하) | O (Apple 이 전부) | [Apple SBP](https://developer.apple.com/app-store/small-business-program/), [RevenueCat SBP 가이드 2026](https://www.revenuecat.com/blog/engineering/small-business-program/) |
| **Paddle** | 5% + $0.50/거래 | O | [Paddle Help](https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf), [UserJot 수수료 비교](https://userjot.com/blog/stripe-polar-lemon-squeezy-gumroad-transaction-fees) |
| **Lemon Squeezy** | 5% + $0.50/거래 | O | [UserJot 비교](https://userjot.com/blog/stripe-polar-lemon-squeezy-gumroad-transaction-fees) |
| **Gumroad** | 10% + 2.9%/거래 (base), MoR | O | [Veloxthemes 비교](https://veloxthemes.com/blog/polar-vs-lemonsqueezy-vs-gumroad) |
| **Stripe (직접)** | 2.9% + $0.30/거래 | X (개발자가 세금 처리) | [UserJot 비교](https://userjot.com/blog/stripe-polar-lemon-squeezy-gumroad-transaction-fees) |
| **Polar** | 4%/거래 | O | [Veloxthemes 비교](https://veloxthemes.com/blog/polar-vs-lemonsqueezy-vs-gumroad) |
| **Setapp 번들** | Developer 최대 90% (기본 70%) | O (MacPaw) | [Setapp Developers](https://setapp.com/developers), [Setapp Distributing Revenue](https://docs.setapp.com/docs/distributing-revenue) |

- **Apple Developer Program**: 연 99 USD, notarization 은 추가 비용 없음 ([Apple Developer Membership](https://developer.apple.com/support/compare-memberships/)).
- **OpenAI Whisper API**: $0.006/분 (2026년 1월 기준 유지), GPT-4o Mini Transcribe 는 $0.003/분 ([InvertedStone 계산기](https://invertedstone.com/calculators/whisper-pricing), [DiyAI 2026 요약](https://diyai.io/ai-tools/speech-to-text/openai-whisper-api-pricing-2026/)). BYOK 채택 시 Listen K 는 이 비용을 지지 않지만, 만약 operator key 로 팀 플랜을 열면 마진 계산에 반영 필요.

### 3.8 Mac App Store vs 직접판매 — Listen K 시나리오

Listen K 는 **글로벌 핫키 + 포커스 앱에 자동 붙여넣기** 를 쓰는데, 이건 **accessibility + input monitoring + apple events** 권한을 요구합니다. Mac App Store 샌드박스에서도 accessibility 는 entitlement 로 가능하지만, **임의 앱에 텍스트를 붙여넣는 범위** 는 리뷰에서 반복 거부될 위험이 큽니다 (Superwhisper, MacWhisper, Wispr Flow 전부 **App Store 외 직접 배포** 를 주력으로 하는 이유).

→ **1순위: 직접 배포 (Developer ID + notarization) + Paddle/Lemon Squeezy**
→ 2순위: MAS 에는 축소된 "Sandbox-friendly 에디션" 만 (혹은 아예 생략)

---

## 4. 2026년 기회 / 위협 분석

### 기회
- **Apple Dictation 이 여전히 긴 한국어·전문어에서 약함** ([Voibe · Apple vs Whisper](https://www.getvoibe.com/resources/apple-dictation-vs-openai-whisper/)) — Listen K 의 CJK 우위가 유효.
- **구독 피로감 + Wispr Flow 대안 수요** — 구독 없이 프라이버시 지키려는 한/일 사용자가 두드러진 니치.
- **Ollama/MLX 로컬 LLM 대중화** — Listen K 의 Ollama 후처리 옵션은 "내 API 비용 제로" 스토리가 구체화됨.
- **Setapp 의 macOS 번들 플랫폼 파워** — 개발자 분배 기본 70%, 마케팅 +20% ([Setapp 분배 정책](https://docs.setapp.com/docs/distributing-revenue)). 개별 앱 인지도가 낮을 때 유저 유입 채널로 유효.

### 위협
- **Apple SpeechAnalyzer API** 가 55% 빠름 ([MacStories](https://www.macstories.net/stories/hands-on-how-apples-new-speech-apis-outpace-whisper-for-lightning-fast-transcription/)) → 다음 세대 Whisper Notes/Aiko 가 Apple API 채택 시 속도·배터리 격차 벌어질 수 있음. Listen K 도 장기적으로 Apple Speech + WhisperKit 하이브리드 고려 필요.
- **Wispr Flow 의 글로벌 영업력** ($700M 밸류, Fortune 500 중 270곳 계약) — 기업 시장은 포기하고 개인/소호에 집중하는 것이 현실적.
- **Whisper Notes $6.99** 의 가격 앵커링 — "$20 받는 이유" 를 분명히 소통해야 함.
- **Ad-hoc 서명 상태** — Developer ID 없이는 "손상된 앱" 경고 때문에 유료 판매 불가능. 선결 과제.

---

## 5. Listen K 맞춤 시나리오 4선

> 공통 가정: 앱 런칭 후 6개월차, **영어권 유저 유입은 보수적** (Product Hunt 4위권 추정), 한국/일본 커뮤니티 집중 마케팅.
> 모든 숫자는 **추정** 이며 근거는 하단 각 섹션에 명시.

### 시나리오 A — **Lifetime + Ollama Pro 게이팅 (추천 기본값)**

- **가격 구조**
  - Free: 로컬 Whisper tiny/base 모델, 한글 자동 서식 기본, 후처리 LLM 비활성, 월 10,000 단어 상한 (soft) — Apple Dictation 대비 "정확도 +한국어 후처리" 맛보기
  - Pro (one-time **$29**): 모든 Whisper 모델, Ollama 후처리 + OpenAI BYOK, 통계 페이지, 모든 커스텀 모드
  - Pro Lifetime 업그레이드 옵션: major v2 출시 시 50% 할인 업그레이드 ($15)
- **타겟 유저**
  - 한국/일본 개발자, 블로거, 번역가, 리서처
  - "Whisper Notes $6.99 보단 비싸지만 Superwhisper $249 보단 싸게" — **중간 슬롯**
- **예상 월매출 (추정)**
  - 월 방문 1,500명 (한국 커뮤니티 geekbuying/GeekNews/PH + 일본 Qiita) × 방문→설치 10% = 150 설치/월 × 무료→유료 15% (Listen K 의 niche fit + 가격저항 낮음으로 freemium 평균 2.1% 보다 높게 가정) = **22 유료/월 × $29 = $638/월**
  - 12개월 누적 유저 180명 기준 → $5,220 매출
  - 결제 채널: Paddle (5% + $0.50) → 실수령 $29 × 0.95 − $0.50 ≈ **$27.05/판매**
- **초기 launch 비용**
  - Apple Developer Program: $99/년 ([Apple](https://developer.apple.com/support/compare-memberships/))
  - Paddle 셋업: $0 (starter)
  - 웹사이트: $0 (GitHub Pages 또는 Cloudflare Pages)
  - 도메인: $15/년 추정
  - 총 초기 현금 지출 **$115 이내**
- **리스크**
  - $29 가 한국/일본 유저에게 "약간 비쌈" 으로 느껴질 수 있음 → 런칭 프로모 $19 로 1개월 한정 권장
  - Free 상한 10,000 words/월 이 너무 헐거우면 전환율 깨짐 → 분석 후 3개월차에 조정
- **6개월 로드맵**
  - M0: Developer ID 취득, notarization 파이프라인, Paddle 계정, 웹사이트 v1
  - M1: Public beta (TestFlight 아님, 직접 배포), PH + GeekNews + Qiita 런칭
  - M2: 결제 on, 한/영/일 가격 페이지
  - M3: Setapp 지원 신청 (채택 심사에 1–2개월)
  - M4: 일본어 LLM 프롬프트 튜닝 완료 → 일본 재런칭
  - M5–M6: Team 라이선스 (5-pack $99, 10-pack $179) 추가

### 시나리오 B — **구독 전용 ("Pro Only" )**

- **가격 구조**: Free (동일) / Pro $4.99월 or $39년
- 타겟: 지속적 업데이트를 기대하는 프로덕티비티 헤비유저
- 예상 월매출: 150 설치 × 전환 10.7% (hard paywall median, [RevenueCat 2026](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/)) = 16 유료/월, 연간 요금으로 절반 유도 → MRR 약 (8 × $4.99) + (8 × $3.25) = **$66/월 런칭 2개월 → 누적 +$1,000/월 예상 by M6**
- 리스크 (큼)
  - Listen K 는 로컬 처리 → 유저 심리적 "매달 돈 낼 이유" 가 약함
  - Whisper Notes $6.99 원타임 대비 "7개월이면 본전 넘김" 이라는 계산이 즉시 나옴
  - 취소율이 높아 LTV 방어가 어려움
- 언제 이 모델이 맞나: 클라우드 후처리를 Listen K 가 operator key 로 제공할 때만 — 현재 철학에 반함

### 시나리오 C — **저가 One-time ($12.99) — "Whisper Notes+" 포지션**

- 가격: $12.99 one-time, Pro/Free 구분 없이 풀 기능
- 타겟: 가격 민감 + 한국어 품질이 중요한 학생/프리랜서
- 예상 월매출: 전환율 freemium 없이 direct → **추정 방문→구매 3.5%** 가정 × 1,500 방문 = 52명 × $12.99 = **$675/월** — 시나리오 A 와 유사하지만 객단가가 낮아서 지속 확장성이 떨어짐
- 장점: 경쟁 앱 ($6.99 Whisper Notes) 대비 명분 ("한국어 고급 후처리 + HUD + Ollama") 이 있으면 $12.99 가 먹힘
- 리스크: 업그레이드 수익화 경로가 없음 → 미래 v2 는 paid upgrade 로만 수익 가능

### 시나리오 D — **Setapp 전용 / 번들 분배**

- 가격: Setapp 회원 무료 (월 $9.99 번들) → Listen K 는 분배금 70% × 사용가중치 ([Setapp](https://docs.setapp.com/docs/distributing-revenue))
- 타겟: 이미 Setapp 을 쓰는 Mac power-user (2026년 기준 Setapp 회원 수십만 규모, [Setapp Stats 2026](https://www.techlila.com/setapp-subscription-statistics/))
- 예상 월매출 (추정): 앱이 번들 내 상위 25% 사용 앱 그룹에 들어갈 경우, 유저 1명당 월 $0.30~$0.80 분배 (보수적). 유저 1,000명 도달 시 월 **$300–$800**
- 장점: 마케팅 부담 없음, Apple Dev Program 이미 요구된 Developer ID signed build 만 있으면 됨, 세금 처리 MacPaw 가 전담
- 리스크: Setapp 심사 1–3개월 소요, Superwhisper/MacWhisper 둘 다 이미 있는지 확인 필요 (MacWhisper 는 과거 Setapp 등장 이력 있음 — 현재 확인 필요)
- 6개월 로드맵: M1 Setapp 지원 → M3 심사 통과 → M3~ 번들 수익 + 시나리오 A/C 의 direct 판매 병행 (Setapp 은 **독점 요구 안 함**)

---

## 6. 최종 추천

**시나리오 A (one-time $29 + freemium + major version upgrade) 를 기본으로 하고, 3개월 뒤 시나리오 D (Setapp 병행) 를 추가**.

근거:
1. Listen K 는 **서버 비용이 0** 에 가까워 구독 정당화가 약하다. 로컬 앱 + one-time 이 철학과 가격이 정합한다.
2. $29 는 Whisper Notes($6.99)·BetterDictation($39)·MacWhisper Pro($79.99) 사이 **빈 슬롯**이고, 한국/일본 타겟 가격민감도에서 "한 달 점심값" 수준이라 덜 저항적이다.
3. CJK 후처리 품질은 소프트웨어 업데이트로 계속 개선할 가치가 있으므로 **v2 에서 유료 업그레이드**로 장기 수익 흐름을 만들 수 있다.
4. Setapp 은 추가 비용·전용 계약 없이 **도달률만 늘리는 레버**가 된다 (MacWhisper, NotePlan, Text-Workflow 등 Setapp 에 포함된 indie 앱 수가 많음, [Setapp Developers](https://setapp.com/developers)).

**명시적으로 배제한 모델과 그 이유:**
- 구독 전용 → 로컬 우선 + Apple Dictation 무료 경쟁자 있음 (시나리오 B 리스크 문단)
- Operator-key 클라우드 대행 → 프라이버시 약속 훼손 및 OpenAI API 비용 리스크
- Mac App Store 주력 → 핫키/글로벌 붙여넣기 권한 리뷰 리스크 + 30% 수수료 (Small Business Program 후 15%)

---

## 7. 실행 체크리스트

### 7.1 Apple Developer 인프라
- [ ] **Apple Developer Program 가입 — $99/년** ([Apple](https://developer.apple.com/support/compare-memberships/))
- [ ] Developer ID Application 인증서 생성
- [ ] `codesign --deep --options runtime` 로 모든 번들 재서명 (WhisperKit, ggml dylib, Swift 헬퍼 포함)
- [ ] `xcrun notarytool submit` 자동화 (CI 에 env: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, TEAM_ID)
- [ ] Stapling (`xcrun stapler staple`) 로 오프라인 설치 시에도 Gatekeeper 통과
- [ ] Hardened Runtime + 필요 entitlements: `com.apple.security.device.microphone`, accessibility (input monitoring 은 TCC 유저 프롬프트)
- [ ] (선택) Small Business Program 등록 시 MAS 판매 수수료 30% → 15% ([Apple SBP](https://developer.apple.com/app-store/small-business-program/))

### 7.2 결제 인프라 결정
- [ ] **1순위 Paddle** — 5% + $0.50, MoR 로 EU VAT / 일본 소비세 / 한국 부가세 전부 대행, indie SaaS 표준 ([Paddle VAT 페이지](https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf))
- [ ] 2순위 Lemon Squeezy — 동 수수료, UI 가 가볍고 라이선스 키 기본 제공
- [ ] 회피 권장: Gumroad (10%+2.9% 로 수수료 거의 2배)
- [ ] Stripe 직접은 한국 사업자등록 + 국경세 직접 처리 부담 있어 indie 에는 비추
- [ ] 결제 후 웹훅 → 라이선스 키 발급 endpoint (Cloudflare Workers 또는 Vercel Functions, 월 $0~)

### 7.3 라이선스 키 시스템 (로컬 우선 철학 반영)
- [ ] **Keygen.sh** 또는 **Lemon Squeezy License API** 또는 **자체 Ed25519 서명 키**
  - Keygen 오프라인 라이선스 파일 모델: Ed25519 서명, AES-256-GCM 암호화 옵션 ([Keygen 오프라인 가이드](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/))
- [ ] 기본 검증 흐름: 첫 실행 시 온라인 1회 활성화 → 이후 서명 파일만으로 오프라인 검증 (Listen K 의 에어갭 환경 대응)
- [ ] 디바이스 수 제한: 2대 (가족 공유 수준)
- [ ] 라이선스 강제 종료 금지 (네트워크 끊어도 기존 서명 파일 유효) — 로컬 철학과 일관

### 7.4 트라이얼 / 환불 / 가족 공유 정책
- [ ] **14일 full-feature 트라이얼** (Wispr Flow 와 동일, 카드 미요구) — hard paywall 로 전환율 확보 ([RevenueCat 2026](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/))
- [ ] 환불: Paddle 의 표준 30-day refund 수용, 이유 무관
- [ ] 가족 공유: 1 라이선스 = 2 디바이스 (Listen K 유저가 동일인일 가능성 높으므로 애플 Family Sharing 흉내낼 필요 없음). MAS 버전 내면 Family Sharing 자동 지원 ([Apple Family Sharing](https://www.apple.com/family-sharing/))
- [ ] 교육/비영리 할인: MacWhisper 처럼 25% 할인 이메일 요청 프로세스

### 7.5 공식 웹사이트 최소 요건
- [ ] Landing: 데모 영상 (한/영/일) + 핵심 카피 "로컬 처리, macOS 네이티브, CJK 1급"
- [ ] /pricing: 가격표 + FAQ (Apple Dictation 과의 차이 명시)
- [ ] /privacy + /terms: Paddle 이 법적 MoR 이므로 상품 약관만 필요
- [ ] /download: Developer ID 서명된 DMG, 체크섬
- [ ] /changelog: 릴리즈 노트 (한/영/일)
- [ ] 이메일 수집 → 런칭 리스트 (Buttondown, $9/월)

### 7.6 마케팅 초기 채널
- **Product Hunt** (영어권 도달): Walkie 가 2026년 4월 6일 런칭해 227 upvotes 로 #4 ([Hunted Space · Walkie](https://hunted.space/dashboard/b150)) → Listen K 도 비슷한 카테고리에서 상위 10위 가능 추정
- **Hacker News Show HN**: "Show HN: Listen K – offline Whisper dictation with Korean/Japanese first-class" 각도로
- **한국 커뮤니티**: GeekNews (news.hada.io), Clien, 브런치 기술 에세이, 한국 Mac 유저 페이스북 그룹
- **일본 커뮤니티**: Qiita, Zenn, note.com (macOS 카테고리)
- **중국 간체 커뮤니티**: 小红书/V2EX/少数派 — 다만 macOS 유저 기반이 일본보다 얇으므로 2순위
- **유튜브 리뷰**: Sindre Sorhus (Aiko 제작자) 같은 인디 계정, Mac 한국어 유튜버 "소프트뱅크TV" 류에 직접 이메일 피칭

---

## 8. 핵심 요약 (Executive Summary)

1. **가격**: Listen K Pro **$29 one-time** + Free 티어 (월 10k 단어, 후처리 LLM 비활성), v2 유료 업그레이드 $15
2. **결제**: Paddle (MoR, 5% + $0.50) + Keygen.sh 오프라인 라이선스
3. **배포**: Developer ID + notarization 직접 배포를 주력으로, 3개월 뒤 Setapp 번들 병행

출처와 숫자 근거는 본문 각 섹션 인라인 링크 참조.
