---
updated: 2026-04-22
scope: Listen K — end-to-end release runbook (version bump → public DMG)
audience: maintainer performing a release
related: .github/workflows/release.yml, CHANGELOG.md
---

# Release Procedure

From a clean `main` branch to a published, notarised, Developer-ID-signed DMG
on the Releases page. Target time: **~30 minutes of active work**, plus
~20 minutes of CI.

## 0. Prerequisites (one-time)

- [x] Apple Developer Program membership is active and a Developer ID
      Application certificate exists locally (and the matching `.p12`
      has been exported).
- [x] The five GitHub Actions secrets are registered:
      `MAC_CERTIFICATE_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`,
      `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (see
      [`.github/workflows/release.yml`](../.github/workflows/release.yml)
      for the names expected by the workflow).
- [x] An RC tag dry-run has succeeded at least once.
- [x] `npm ci` works on a clean checkout.
- [x] `bash scripts/smoke.sh` is green locally.

If any of those are red, stop and fix them before releasing.

---

## 1. Pre-flight checks

```bash
# Clean working tree?
git status
git diff --stat origin/main..HEAD
```

- [ ] Working tree is clean (or only release-prep changes)
- [ ] No WIP commits with `[skip ci]`, `fixup!`, or `squash!`
- [ ] `CHANGELOG.md` `[Unreleased]` section lists every user-visible change
      since the last tag
- [ ] README badges and version references are still accurate
- [ ] `smoke.sh` passes locally

## 2. Decide the version

Follow [Semantic Versioning](https://semver.org/):

- `patch` (0.3.**x**): bug fixes, i18n tweaks, docs
- `minor` (0.**x**.0): new features that keep config.json forward-compatible
- `major` (**x**.0.0): breaking config changes, removed engines, UI overhaul

Check the `[Unreleased]` section:

| If it contains | Bump |
|---|---|
| Only "Fixed" entries | patch |
| "Added" or "Changed" entries, but config and IPC are backwards-compatible | minor |
| A `config.json` migration, removed IPC, or stripped engine | major |

## 3. Bump the version

```bash
# replace 0.4.0 with the chosen version
npm version 0.4.0 --no-git-tag-version
```

This edits `package.json` only. Do **not** let npm create the tag yet — we
want the bump, CHANGELOG update, and tag in one reviewable commit.

## 4. Finalise the CHANGELOG

Rename `[Unreleased]` to `[0.4.0] — 2026-04-22` and add a fresh empty
`[Unreleased]` section above it:

```markdown
## [Unreleased]

### Added
### Changed
### Fixed

## [0.4.0] — 2026-04-22

### Added
- ... existing items ...
```

Update the compare links at the bottom of the file:

```markdown
[Unreleased]: https://github.com/ibank/listen-k/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/ibank/listen-k/compare/v0.3.0...v0.4.0
```

## 5. Commit and tag

```bash
git add package.json CHANGELOG.md
git commit -s -m "Release v0.4.0

See CHANGELOG.md for release notes."

git tag -a v0.4.0 -m "Release v0.4.0"
```

- [ ] `git log --oneline -2` shows the release commit immediately before HEAD
- [ ] `git tag --points-at HEAD` shows `v0.4.0`

## 6. Push — triggers CI

```bash
git push origin main
git push origin v0.4.0
```

The `release.yml` workflow starts automatically on the tag push.

## 7. Watch the build

```bash
gh run watch           # live log; ^C to exit without cancelling
# or:
gh run list --workflow=release.yml --limit=1
```

Typical steps and their red-flag signals:

| Step | Expected duration | Red flag |
|---|---|---|
| `npm ci` | < 1 min | lock-file drift |
| `build:helper` | 1–2 min | Xcode CLT version mismatch |
| `build:transcribe` | 2–3 min | WhisperKit SPM fetch failure — retry |
| `model:whisperkit` | 2–4 min | CDN timeout — retry |
| `Verify signing secrets` | instant | missing secret — re-check the five names in the workflow against Settings → Secrets and variables → Actions |
| `electron-builder --mac dmg` | 5–8 min | notarisation timeout (see §9.2) |
| `shasum` + `gh release create` | instant | auth error — regenerate `GITHUB_TOKEN` |

## 8. Validate the draft release

The workflow creates a **draft release**. Do not publish it until you have:

```bash
gh release view v0.4.0
gh release download v0.4.0 --dir /tmp/release-v0.4.0
cd /tmp/release-v0.4.0
shasum -c SHA256SUMS
```

- [ ] Checksum verifies
- [ ] `hdiutil verify ListenK-0.4.0-arm64.dmg` passes
- [ ] Mount the DMG and drag the app into a disposable Applications folder
- [ ] `spctl -a -t exec -vv '/tmp/mount/Listen K.app'` reports "accepted"
      (notarisation and stapling both succeeded)
- [ ] Launch the app on a Mac without quarantine bypass — no Gatekeeper
      warning appears
- [ ] Global hotkey, HUD, paste cycle all work end-to-end in one language

## 9. Publish

```bash
gh release edit v0.4.0 --draft=false --latest
```

Then announce:

- [ ] Post on [GeekNews (news.hada.io)](https://news.hada.io/submit) — Korean
- [ ] Post on Hacker News (`Show HN: Listen K v0.4.0 ...`) — English
- [ ] Post on Qiita / Zenn / note.com — Japanese
- [ ] Optional: Product Hunt (only for `minor` or bigger bumps)
- [ ] Pin a tweet / Bluesky / Threads post with demo GIF

## 10. Post-release

- [ ] Update `README.md` install instructions if the version is referenced
- [ ] Close the milestone in GitHub (if you use milestones)
- [ ] Watch `#issues` for the first 48 hours — hotfix patches land as
      `v0.4.1` following the same procedure

---

## Appendix

### 9.1 Hot-fix patch release
If a P0 bug ships in `v0.4.0`:

```bash
git checkout main
# fix + test
git commit -s -m "Fix ..."
npm version 0.4.1 --no-git-tag-version
# update CHANGELOG Unreleased → 0.4.1
git commit -am "Release v0.4.1"
git tag -a v0.4.1 -m "Release v0.4.1"
git push origin main v0.4.1
```

Skip Product Hunt for hotfixes.

### 9.2 Notarisation timeout
Apple's `notarytool` occasionally stalls >15 minutes. If the Actions run
exceeds 30 minutes on the `electron-builder` step:

1. Let it finish (it usually does) or cancel and re-run
2. If two consecutive runs fail: check https://developer.apple.com/system-status/
3. If Apple's service is up: verify the app-specific password is still
   valid (rotate at appleid.apple.com → Sign-In and Security → App-Specific
   Passwords, then update the `APPLE_APP_SPECIFIC_PASSWORD` secret).

### 9.3 Abort a release mid-flight
If you realise something is wrong after pushing the tag:

```bash
# delete the tag everywhere
git tag -d v0.4.0
git push --delete origin v0.4.0
# delete the draft release
gh release delete v0.4.0 -y
# reset main if the release commit is on it
git reset --hard HEAD~1
git push --force-with-lease origin main
```

The `--force-with-lease` (never plain `--force`) prevents clobbering work
someone else pushed since.

### 9.4 Rolling back a published release
If a critical issue is found **after** a release is public:

1. Publish a hotfix `v0.4.1` as fast as possible
2. Edit the `v0.4.0` release on GitHub and add a note at the top pointing
   to `v0.4.1` — **do not delete** the old release or its DMG; existing users
   have reference to that URL
3. Mark `v0.4.0` as "pre-release" if it is still served as `latest`:
   `gh release edit v0.4.0 --prerelease`
4. Make sure `v0.4.1` is marked `--latest`

Never unpublish a DMG — [auto-updaters](https://www.electron.build/auto-update)
rely on the URL persistence.
