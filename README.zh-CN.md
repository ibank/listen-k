[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文**

# Listen K

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/ibank/ListenK)](https://github.com/ibank/ListenK/releases)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-blue)](https://developer.apple.com/macos/)
[![Star on GitHub](https://img.shields.io/github/stars/ibank/ListenK?style=social)](https://github.com/ibank/ListenK)

面向 Apple Silicon Mac 的**本地 AI 语音听写**应用,在英语之外**一流支持韩语、日语、简体中文**。双击 Right Shift 即可呼出浮动 HUD,实时显示语音文本,再次双击便会自动粘贴到当前焦点的输入框。

<p align="center">
  <img src="assets/demo.gif" alt="Listen K 演示" width="720" />
  <br />
  <sub><i>演示资源: 添加 <code>demo.gif</code> 的方法见 <a href="assets/README.md">assets/README.md</a>。</i></sub>
</p>

- **引擎**: WhisperKit (默认,`openai_whisper-large-v3-turbo`) · Apple Speech · whisper.cpp · OpenAI API (BYOK)
- **后处理**: 规则式 (默认,零依赖) · 关闭 · Ollama (Gemma 等本地模型) · OpenAI 文体润色
- **默认配置下数据不出本机** — WhisperKit + 规则后处理完全本地运行
- **界面** 提供韩语 · 英语 · 日语 · 简体中文,根据系统区域自动切换
- **目标**: Apple Silicon · macOS 14 (Sonoma) 或更高
- **许可**: MIT — 源代码开放,签名公证的 DMG 在 [listenk.com](https://listenk.com) 售卖

## 为什么选 Listen K?

macOS 上的听写应用已经有几款不错的产品。Listen K 占据的是这样一块位置:

| | Listen K | [Superwhisper](https://superwhisper.com) | [Wispr Flow](https://wisprflow.ai) | [MacWhisper](https://goodsnooze.gumroad.com/l/macwhisper) | [Whisper Notes](https://whispernotes.app) | Apple 听写 |
|---|---|---|---|---|---|---|
| **源代码** | MIT 开源 | 闭源 | 闭源 | 闭源 | 闭源 | 闭源 |
| **默认本地处理** | ✅ | ✅ | ❌ (云端) | ✅ | ✅ | ✅ |
| **中日韩质量** | 针对 CJK 专项调优的提示词 | 良好 | 良好 | 参差 | 良好 | 长篇中日韩较弱 |
| **自动粘贴到焦点应用** | ✅ | ✅ | ✅ | 手动复制 | 手动复制 | 仅系统范围 |
| **快捷键灵活度** | 5 种 (含 fn) | 3 种 | 仅 fn | 1 种 | 1 种 | 固定 |
| **定价** | 源码免费 · 签名 DMG $29 | $8.49/月 · $249 终身 | $15/月 | $79.99 终身 | $6.99 买断 | 免费 (随 OS) |
| **多语言界面** | ko / en / ja / zh-CN | 仅 en | 仅 en | 仅 en | 仅 en | 系统区域 |

如果你每天使用中文写作,希望听写文本不离开本机,又不想订阅服务,那么 Listen K 适合你。

> 欢迎提交翻译改进 PR。当前版本基于初版机器翻译,期待母语贡献者的精细打磨。

---

## 安装

### 公证版 (Developer ID 签名后的标准路径)
1. 从 [Releases](https://github.com/ibank/ListenK/releases) 下载最新 `ListenK-x.y.z-arm64.dmg`
2. 打开后将 Listen K 拖入 Applications
3. 启动 — 首次运行时仪表盘会自动打开
4. 按提示授予 2 项权限
   - **辅助功能**: 添加 `/Applications/Listen K.app` (覆盖快捷键检测和自动粘贴)
   - **麦克风**: 首次录音时自动弹窗
5. (可选) 使用 Ollama 后处理: `brew install ollama && ollama pull gemma3:4b`

首次启动时 Core ML 编译模型大约需要 40 秒。完成后下次启动便可立即就绪。

### Ad-hoc 开发版 (v0.3 及以前)
若你拿到的是公证前的版本,需要绕过一次 Gatekeeper:
- 快速: `xattr -cr "/Applications/Listen K.app"`
- 或: 系统设置 → 隐私与安全 → "Listen K 已被阻止" 旁的 **仍要打开**

## 用法

1. 把光标放到要插入文字的位置
2. **⇧⇧** (双击 Right Shift) — HUD 出现并开始录音
3. 说话 (HUD 中实时显示文字)
4. 再次 **⇧⇧** 或 HUD 的 `✓` — 后处理 → 自动粘贴到焦点应用
5. 取消: HUD 的 `✕`

**备用快捷键**: `⌥⌥` / `⌃⌃` / `⌘⌘` / `fn`,可在设置中修改。点击菜单栏图标可打开托盘弹窗。

---

## 配置

持久化于 `~/Library/Application Support/Listen K/config.json` (由应用自动写入):

| 键 | 值 | 说明 |
|---|---|---|
| `hotkey` | `rshift-double` (默认) · `ropt-double` · `rctl-double` · `rcmd-double` · `fn` | 全局快捷键 |
| `engine` | `whisperkit` (默认) · `apple-speech` · `whisper-cpp` · `openai` | 转录引擎 |
| `language` | `ko-KR` · `en-US` · `ja-JP` · `zh-CN` | Whisper 语言提示 |
| `locale` | `ko` · `en` · `ja` · `zh-CN` | 界面语言 (默认随系统区域) |
| `theme` | `system` (默认) · `light` · `dark` | 主题 |
| `streaming` | `true` (默认) · `false` | HUD 是否实时显示文字 |
| `mode` | `rules` (默认) · `off` · `ollama` · `openai` | 后处理 |

首次运行标记: 同目录下 `.first-run-done` (删除后下次启动会再次自动打开仪表盘)

---

## 从源码构建

要求: macOS 14+、Apple Silicon、Xcode 15+、Node.js 20 LTS。

```bash
git clone https://github.com/ibank/ListenK.git
cd ListenK
npm install
npm run build:helper       # Swift 辅助程序: fn-listener, paste-helper, focus-helper
npm run build:transcribe   # bin/transcribe-helper (WhisperKit)
npm run model:whisperkit   # Core ML 模型 (~632 MB) → models/whisperkit/

npm start                  # 开发模式
npm run dist               # DMG 构建 (predist 自动执行上述 3 个命令)
npm run icon               # 重新生成图标
```

切换其他模型变体:
```bash
bash scripts/download-whisperkit-model.sh openai_whisper-base
bash scripts/download-whisperkit-model.sh openai_whisper-large-v3-v20240930_626MB
```
应用会自动选择 `models/whisperkit/` 下质量优先级最高的模型。

## 故障排除

- **HUD 出现但没有文字**: 在终端用 `npm start` 启动并查看 `[audio] buf=` 日志。如果 buf 始终为 0,说明缺少麦克风权限。
- **幻听 (没说话却出现 "Thank you for watching" 等)**: 麦克风正在采集静音。请确认应用 bundle 已被授予麦克风权限。`turbo` 模型比小模型幻听少。
- **⇧⇧ 没反应**: 查看仪表盘的 "快捷键检测" 行。辅助功能开启后该行显示绿色。如仍无反应,请把双击 Right Shift 的间隔保持在 380ms 以内。
- **焦点恢复失败,粘贴跑到 Listen K 自己里**: 多半是 bundle id 识别失败,多见于焦点对象不是标准 macOS 应用 (例如浏览器标签内的网页 widget)。
- **Core ML 加载超过 1 分钟**: 可能在编译 Neural Engine (目前代码仅使用 cpuAndGPU,正常约 40 秒)。`rm -rf ~/Library/Caches/transcribe-helper` 后重试。

---

## 参与贡献

欢迎 Issue、PR 与翻译。请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [Code of Conduct](CODE_OF_CONDUCT.md)。安全问题请按 [SECURITY.md](SECURITY.md) 流程私下报告。

## 许可

MIT — 详见 [LICENSE](LICENSE)。所含第三方库的许可见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。

## 商标

**Listen K** 名称、徽标和应用图标 © 2026 ibank,**不在源码 MIT 许可范围内**。如需 fork,请使用你自己的名称和图标。

## 支持项目

在 [listenk.com](https://listenk.com) 购买公证版 DMG 直接资助开发。也可通过 [GitHub Sponsors](https://github.com/sponsors/ibank) 进行持续赞助。

## 路线图

- [x] 浅色模式 (`prefers-color-scheme`)
- [x] 转录历史
- [x] Apple Speech / OpenAI / whisper.cpp 引擎支持
- [x] 4 种语言界面
- [ ] 自动更新 (`electron-updater`,公证之后)
- [ ] 按应用切换语气和风格
- [ ] 个人词汇表 / 自定义发音词典
- [ ] 团队许可
