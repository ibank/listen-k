[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh-CN.md)

# Listen K

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/ibank/listen-k)](https://github.com/ibank/listen-k/releases)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-blue)](https://developer.apple.com/macos/)
[![Star on GitHub](https://img.shields.io/github/stars/ibank/listen-k?style=social)](https://github.com/ibank/listen-k)

Apple Silicon Mac 向けの **ローカル AI 音声入力** アプリ。**韓国語・日本語・中国語のファーストクラス対応** と英語をサポート。Right Shift を 2 回タップすると HUD が表示され、話した内容がリアルタイムで表示されます。もう一度 2 回タップすると、フォーカスされていたアプリの入力欄に自動でペーストされます。


- **エンジン**: WhisperKit (デフォルト, `openai_whisper-large-v3-turbo`) · Apple Speech · whisper.cpp · OpenAI API (BYOK)
- **後処理**: ルールベース (デフォルト, 依存 0) · 無効 · Ollama (Gemma など) · OpenAI による文体整形
- **デフォルト設定では一切外部送信しない** — WhisperKit + ルール後処理は 100% ローカル
- **UI** は韓国語 · 英語 · 日本語 · 簡体字中国語、システムロケールから自動選択
- **対象**: Apple Silicon · macOS 14 (Sonoma) 以降
- **ライセンス**: MIT — ソース公開、署名・公証済み DMG は [listenk.com](https://listenk.com) で販売

## なぜ Listen K か?

macOS 向けの音声入力アプリは既に良いものがいくつもあります。Listen K は次のポジションに位置します:

| | Listen K | [Superwhisper](https://superwhisper.com) | [Wispr Flow](https://wisprflow.ai) | [MacWhisper](https://goodsnooze.gumroad.com/l/macwhisper) | [Whisper Notes](https://whispernotes.app) | Apple 音声入力 |
|---|---|---|---|---|---|---|
| **ソース公開** | MIT オープンソース | 非公開 | 非公開 | 非公開 | 非公開 | 非公開 |
| **デフォルトでローカル処理** | ✅ | ✅ | ❌ (クラウド) | ✅ | ✅ | ✅ |
| **韓国語・日本語・中国語の品質** | CJK 専用プロンプト調整 | 良好 | 良好 | 不安定 | 良好 | 長文 CJK は弱い |
| **フォーカス先への自動ペースト** | ✅ | ✅ | ✅ | 手動コピー | 手動コピー | システム内のみ |
| **ホットキーの自由度** | 5 種 (fn 含む) | 3 種 | fn のみ | 1 種 | 1 種 | 固定 |
| **価格** | ソース無料 · 署名 DMG $29 | $8.49/月 · $249 永久 | $15/月 | $79.99 永久 | $6.99 買い切り | 無料 (OS 同梱) |
| **多言語 UI** | ko / en / ja / zh-CN | en のみ | en のみ | en のみ | en のみ | システムロケール |

日本語で毎日文章を書き、テキストをマシンの外に出さず、サブスクは避けたい方に最適です。

> 翻訳の改善 PR は歓迎します。本ファイルは初版機械翻訳ベースであり、ネイティブによる仕上げ磨きを募集しています。

---

## インストール

### 公証済みリリース (Developer ID 署名後の本番経路)
1. [Releases](https://github.com/ibank/listen-k/releases) から最新の `ListenK-x.y.z-arm64.dmg` をダウンロード
2. 開いて Listen K を Applications にドラッグ
3. 起動 — 初回起動時にダッシュボードが自動で開きます
4. 案内に従って 2 つの権限を許可
   - **アクセシビリティ**: `/Applications/Listen K.app` を追加 (ホットキー検出と自動ペースト両方をカバー)
   - **マイク**: 初回録音時に自動でプロンプト
5. (任意) Ollama 後処理を使うには: `brew install ollama && ollama pull gemma3:4b`

初回起動時に Core ML がモデルをコンパイルするため約 40 秒待機します。キャッシュ後は即座に準備完了になります。

### Ad-hoc 開発ビルド (v0.3 以下)
公証前のビルドを入手された場合、初回のみ Gatekeeper 回避が必要です:
- 短縮: `xattr -cr "/Applications/Listen K.app"`
- または: システム設定 → プライバシーとセキュリティ → "Listen K はブロックされました" の横の **このまま開く**

## 使い方

1. テキストを入れたい場所にカーソルを置く
2. **⇧⇧** (Right Shift を 2 回タップ) — HUD が表示され録音開始
3. 話す (HUD にリアルタイムで文字が流れる)
4. 再度 **⇧⇧** または HUD の `✓` — 後処理 → フォーカス先に自動ペースト
5. キャンセル: HUD の `✕`

**代替ホットキー**: `⌥⌥` / `⌃⌃` / `⌘⌘` / `fn`、設定で変更可能。メニューバーアイコンクリックでトレイポップオーバーが開きます。

---

## 設定

`~/Library/Application Support/Listen K/config.json` に永続化されます (アプリが直接更新):

| キー | 値 | 説明 |
|---|---|---|
| `hotkey` | `rshift-double` (デフォルト) · `ropt-double` · `rctl-double` · `rcmd-double` · `fn` | グローバルホットキー |
| `engine` | `whisperkit` (デフォルト) · `apple` · `whisper.cpp` · `openai` | 文字起こしエンジン |
| `language` | `ko-KR` · `en-US` · `ja-JP` · `zh-CN` | Whisper 言語ヒント |
| `uiLocale` | `ko` · `en` · `ja` · `zh-CN` | UI 言語 (デフォルトはシステムロケール) |
| `theme` | `system` (デフォルト) · `light` · `dark` | テーマ |
| `streaming` | `true` (デフォルト) · `false` | HUD でリアルタイム文字を表示するか |
| `mode` | `rules` (デフォルト) · `off` · `ollama` · `translate` | 後処理 |

初回起動マーカー: 同じディレクトリの `.first-run-done` (削除すると再度ダッシュボードが自動で開きます)

---

## ソースからビルド

要件: macOS 14+, Apple Silicon, Xcode 15+, Node.js 20 LTS。

```bash
git clone https://github.com/ibank/listen-k.git
cd listen-k
npm install
npm run build:helper       # Swift ヘルパー: fn-listener, paste-helper, focus-helper
npm run build:transcribe   # bin/transcribe-helper (WhisperKit)
npm run model:whisperkit   # Core ML モデル (~632 MB) → models/whisperkit/

npm start                  # 開発モード
npm run dist               # DMG ビルド (predist で上記 3 つを自動実行)
npm run icon               # アイコン再生成
```

別のモデルバリアントに切り替える:
```bash
bash scripts/download-whisperkit-model.sh openai_whisper-base
bash scripts/download-whisperkit-model.sh openai_whisper-large-v3-v20240930_626MB
```
`models/whisperkit/` 以下のフォルダから品質優先順位順に自動選択されます。

## プロジェクト構成

```
main.js                         Electron メイン: IPC, 状態, トレイ, ヘルパー管理
preload*.js                     contextIsolation ブリッジ (main / HUD / tray)
index.html + renderer.js        ダッシュボード (ステータス, 設定, 統計, 履歴)
hud.html + hud.js               フローティング HUD (波形 / ライブテキスト / ✕ / ✓)
tray.html + tray.js             メニューバー ポップオーバー
i18n.js                         4ロケール辞書 (ko/en/ja/zh-CN) + t(key, params)
styles.css / hud.css / tray.css デザインシステム

native/fn-listener.swift        CGEventTap (修飾キー二重タップ / fn)
native/paste-helper.swift       アクセシビリティ確認 + CGEventPost ⌘V
native/focus-helper.swift       NSWorkspace フロントモストの保存/復元
native/transcribe-helper/       WhisperKit AudioStreamTranscriber Swift パッケージ
native/translate-helper/        MLX ベース翻訳 Swift パッケージ (実験的)

scripts/build-*.sh              Swift ヘルパーのビルド
scripts/smoke.sh                バイナリ存在確認 + ストリーム起動チェック
scripts/after-pack.js           electron-builder afterPack (アドホック or Developer ID)
```

## トラブルシューティング

- **HUD が出るがテキストが表示されない**: ターミナルで `npm start` を実行し `[audio] buf=` ログを確認。buf が 0 のままならマイク権限が不足。
- **幻覚 (発話していないのに "Thank you for watching" など)**: マイクが無音を取り込んでいます。アプリバンドルにマイク権限が付与されているか確認。`turbo` モデルは小さいモデルより幻覚が少ない。
- **⇧⇧ を押しても反応しない**: ダッシュボードの「ホットキー検出」行を確認。アクセシビリティが有効なら緑。それでも反応しない場合は Right Shift の 2 回タップ間隔を 380ms 以内に。
- **フォーカス復元失敗、ペーストが Listen K に入る**: バンドル ID 認識失敗が多い。一般的な macOS アプリでない場合に発生 (Web ブラウザのタブ内ウィジェットなど)。
- **Core ML 読み込みが 1 分以上**: Neural Engine コンパイルが走っている可能性 (現状コードは cpuAndGPU のみ使うため通常 ~40 秒)。`rm -rf ~/Library/Caches/transcribe-helper` 後に再実行。

---

## コントリビュート

Issue・PR・翻訳 を歓迎します。[CONTRIBUTING.md](CONTRIBUTING.md) と [Code of Conduct](CODE_OF_CONDUCT.md) を参照。セキュリティ問題は [SECURITY.md](SECURITY.md) の手順で。

## ライセンス

MIT — [LICENSE](LICENSE) 参照。同梱ライブラリのライセンスは [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) に記載。

## 商標

**Listen K** という名称、ロゴ、アプリアイコンは © 2026 ibank が保有しており、**ソースコードの MIT ライセンスには含まれません**。フォークする場合は独自の名称とアイコンに変更してください。

## プロジェクトのサポート

[listenk.com](https://listenk.com) で公証済み DMG を購入することで開発資金になります。[GitHub Sponsors](https://github.com/sponsors/ibank) からの継続的な支援も可能です。

## ロードマップ

- [x] ライトモード (`prefers-color-scheme`)
- [x] 文字起こし履歴
- [x] Apple Speech / OpenAI / whisper.cpp エンジン対応
- [x] 4 ロケール UI
- [ ] 自動アップデート (`electron-updater`、公証後)
- [ ] アプリ別トーン・スタイル自動切替
- [ ] 個人辞書 / カスタム発音辞書
- [ ] チームライセンス
