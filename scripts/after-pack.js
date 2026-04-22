const { execSync } = require('child_process');
const path = require('path');

// After electron-builder finishes packing the .app bundle, either:
//   a) a Developer ID identity was available and electron-builder signed it
//      properly — do nothing, re-signing ad-hoc would strip the signature and
//      break notarisation.
//   b) no identity was available (local dev builds, fresh checkouts) — apply
//      an ad-hoc signature so the bundle at least launches locally.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  let hasDeveloperId = false;
  try {
    const out = execSync(`codesign -dv "${appPath}" 2>&1`, { encoding: 'utf8' });
    hasDeveloperId = /Authority=Developer ID Application/.test(out);
  } catch {
    // codesign -dv fails on unsigned bundles; treat as no real signature
  }

  if (hasDeveloperId) {
    console.log('[after-pack] Developer ID signature detected; skipping ad-hoc re-sign');
    return;
  }

  console.log('[after-pack] ad-hoc signing app bundle:', appPath);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  execSync(`codesign --verify --verbose=2 "${appPath}"`, { stdio: 'inherit' });
  console.log('[after-pack] ad-hoc signing done');
};
