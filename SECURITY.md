# Security Policy

## Supported versions

Listen K is released from the `main` branch. Security fixes are applied only
to the latest minor release. Older versions receive no backports.

| Version       | Supported          |
|---------------|--------------------|
| 0.5.x         | ✅                 |
| < 0.5         | ❌                 |

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security problems.

Use one of these private channels:

1. **GitHub Private Vulnerability Reporting** (preferred) —
   https://github.com/ibank/listen-k/security/advisories/new
2. **Email** — hello@listenk.com
   Subject line: `[security] <short description>`
   Include: affected version, reproduction steps, platform details, and
   whether you would like public credit in the advisory.

### Response SLA

- **Acknowledgement**: within 72 hours (best-effort; solo maintainer)
- **Initial assessment**: within 7 days
- **Patch for critical issues**: target 30 days from confirmation
- **Disclosure**: coordinated with the reporter; default is a GitHub Security
  Advisory once a patch is released

### Scope

In scope:

- Accessibility-permission misuse (paste-helper, focus-helper, fn-listener)
- IPC boundary between renderer and main process
- `safeStorage`-encrypted OpenAI key handling
- Local file handling (config, stats, history)
- Update channel integrity (signature, notarization, stapling)

Out of scope:

- Vulnerabilities in **OpenAI**, **Ollama**, **Apple frameworks**, or the
  **Whisper model weights** themselves — report those upstream
- Social-engineering attacks that require tricking the user into granting
  permissions the app legitimately needs
- Denial-of-service against a single user's own machine (the app runs locally)
- Issues in ad-hoc-signed development builds that do not exist in the
  Developer-ID signed distribution

### No bug bounty

This is an unfunded indie project. We cannot pay bounties. We will credit
reporters in the advisory unless anonymity is requested.

## Security-relevant settings users should know

- **Accessibility permission** lets Listen K paste into any focused app. If
  you grant it, treat Listen K as trusted — revoke in System Settings →
  Privacy & Security → Accessibility if you stop using the app.
- **OpenAI API key** is stored in the macOS Keychain via
  `Electron.safeStorage`. If you suspect key leakage, rotate at
  https://platform.openai.com/api-keys and clear the value in the Listen K
  dashboard.
- **Ollama** listens on `127.0.0.1:11434` by default. Listen K does not
  expose it externally, but do not run Ollama on a public interface.
