import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function chromiumPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  for (const root of [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const binary of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const candidate = path.join(root, dir, binary);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  throw new Error('Install Chromium with npx playwright install chromium or set CHROMIUM');
}
