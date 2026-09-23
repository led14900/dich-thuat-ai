/**
 * afterPack.js — electron-builder afterPack hook
 *
 * Runs rcedit with FULL version strings + icon.
 * electron-builder's built-in rcedit call fails due to file locking
 * (Windows Defender scans the newly created exe), so we disable it
 * via signAndEditExecutable: false and do it ourselves with delay + retry.
 */
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  // Find rcedit
  const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  let rceditPath = null;

  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir)) {
      const candidate = path.join(cacheDir, entry, 'rcedit-x64.exe');
      if (fs.existsSync(candidate)) {
        rceditPath = candidate;
        break;
      }
    }
  }

  if (!rceditPath) {
    console.warn('[afterPack] rcedit not found, skipping resource edit');
    return;
  }

  const appInfo = context.packager.appInfo;
  const productName = appInfo.productFilename || appInfo.productName || 'AI Translate';
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] EXE not found: ${exePath}`);
    return;
  }

  // Build rcedit args: icon + all version strings
  const args = [exePath];

  // Icon
  if (fs.existsSync(iconPath)) {
    args.push('--set-icon', iconPath);
  }

  // Version strings (ASCII only to prevent rcedit crash)
  const sanitize = (s) => (s || '').replace(/[^\x20-\x7E]/g, '');

  args.push('--set-version-string', 'FileDescription', sanitize(appInfo.description || appInfo.productName));
  args.push('--set-version-string', 'ProductName', sanitize(appInfo.productName));
  args.push('--set-version-string', 'LegalCopyright', sanitize(`Copyright 2026 ${appInfo.companyName || appInfo.productName}`));
  args.push('--set-version-string', 'InternalName', sanitize(appInfo.productName));
  args.push('--set-version-string', 'OriginalFilename', '');
  args.push('--set-version-string', 'CompanyName', sanitize(appInfo.companyName || appInfo.productName));

  // File & product version
  const fileVersion = appInfo.shortVersion || appInfo.buildVersion || '1.0.0';
  const productVersion = appInfo.version || '1.0.0.0';
  args.push('--set-file-version', fileVersion);
  args.push('--set-product-version', productVersion);

  // Retry with delay (Windows Defender file lock)
  const maxRetries = 4;
  const delays = [2000, 3000, 5000, 8000]; // escalating delays

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await new Promise(r => setTimeout(r, delays[attempt]));
    try {
      execFileSync(rceditPath, args, { timeout: 30000 });
      console.log(`[afterPack] OK — icon + version strings embedded (attempt ${attempt + 1})`);
      return;
    } catch (err) {
      console.warn(`[afterPack] Attempt ${attempt + 1}/${maxRetries} failed: ${err.message}`);
    }
  }

  console.error('[afterPack] All retries failed — EXE will have no icon/version strings');
};
