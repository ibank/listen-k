const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log('[after-pack] ad-hoc signing app bundle:', appPath);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  execSync(`codesign --verify --verbose=2 "${appPath}"`, { stdio: 'inherit' });
  console.log('[after-pack] ad-hoc signing done');
};
