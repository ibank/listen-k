const { execFileSync } = require('child_process');
const path = require('path');

// After electron-builder finishes packing the .app bundle, either:
//   a) a Developer ID identity was available and electron-builder signed it
//      properly — do nothing, re-signing ad-hoc would strip the signature and
//      break notarisation.
//   b) no identity was available (local dev builds, fresh checkouts) — apply
//      an ad-hoc signature so the bundle at least launches locally.
//
// execFileSync is used (not execSync with a shell-interpolated string) so
// that a pathological productFilename containing shell metacharacters can
// never escape into the command line.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  let hasDeveloperId = false;
  try {
    const out = execFileSync('codesign', ['-dv', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    hasDeveloperId = /Authority=Developer ID Application/.test(out);
  } catch (err) {
    // codesign -dv fails on unsigned bundles; inspect stderr too since it
    // writes everything there. Treat absence of a real Authority as unsigned.
    const combined = String((err && err.stderr) || '') + String((err && err.stdout) || '');
    hasDeveloperId = /Authority=Developer ID Application/.test(combined);
  }

  if (hasDeveloperId) {
    console.log('[after-pack] Developer ID signature detected; skipping ad-hoc re-sign');
    return;
  }

  console.log('[after-pack] ad-hoc signing app bundle:', appPath);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], { stdio: 'inherit' });
  console.log('[after-pack] ad-hoc signing done');
};
