import { chromium } from 'playwright';
import path from 'node:path';

/**
 * Two ways to get a browser the agent can drive:
 *
 *  launchProfile()  — launches the system Chrome with a DEDICATED profile dir.
 *                     You log into sites once; sessions persist in that dir and
 *                     are reused on later runs. Nothing is extracted or decrypted —
 *                     the agent simply operates inside a real, logged-in browser.
 *
 *  connectCDP()     — attaches to a Chrome YOU already started with:
 *                       "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *                         --remote-debugging-port=9222
 *                     This uses your actual main profile and all its logins.
 *                     (Close other Chrome windows first — Chrome allows one debug host.)
 */

export async function launchProfile({ profileDir, headless = false }) {
  const userDataDir = path.resolve(profileDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome', // uses the Chrome you already have installed — no download
    headless,
    viewport: null, // use the real window size
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page, close: () => context.close() };
}

export async function connectCDP({ endpoint = 'http://localhost:9222' } = {}) {
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  // Don't close the user's real browser on exit — just disconnect.
  return { context, page, close: () => browser.close() };
}
