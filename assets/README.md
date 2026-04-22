# Assets

This directory holds marketing and documentation assets referenced from the
main `README.md` and project website. Keep binary files small (prefer
optimised `.webp` or compressed `.gif` / `.mp4`) so the repository clone
stays lean.

## Expected files

| File | Purpose | Recommended size |
|---|---|---|
| `demo.gif` | Short loop shown at the top of the README | ≤ 2 MB, ≤ 1920×1080, 15 fps |
| `hud.png` | Screenshot of the floating HUD | ≤ 400 KB, 2× retina |
| `dashboard.png` | Screenshot of the main dashboard | ≤ 400 KB, 2× retina |
| `tray.png` | Screenshot of the tray popover | ≤ 300 KB, 2× retina |
| `banner.png` | Social preview / Product Hunt header (1200×630) | ≤ 500 KB |

## How to produce them

- **Screenshots**: `Cmd-Shift-4` then drag over the window, or use Xcode's
  Simulator screenshot tool. Run in Light mode for social previews and Dark
  mode for the default README (the app ships with dark as primary).
- **Demo GIF**: record with `Cmd-Shift-5` → "Record Selected Portion", then
  convert to GIF with `ffmpeg -i recording.mov -vf "fps=15,scale=960:-1"
  -loop 0 demo.gif`. Optimise with `gifsicle -O3 demo.gif -o demo.gif`.
- **Banner**: design in Figma / Sketch, export at 2× and downscale with
  `cwebp -q 85 banner.png -o banner.webp` for the website.

## Git LFS

Large binary assets (> 1 MB each) that change frequently should move to
Git LFS. Add a `.gitattributes` entry before committing:

```
*.gif filter=lfs diff=lfs merge=lfs -text
*.mp4 filter=lfs diff=lfs merge=lfs -text
```
