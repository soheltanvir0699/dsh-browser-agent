#!/usr/bin/env node
/**
 * Imports YOUR real Chrome profile (cookies / logged-in sessions) into the
 * agent's dedicated profile, so the agent starts already signed in.
 *
 * It only COPIES files on your own machine into ./.agent-profile (git-ignored).
 * Chrome itself decrypts its own cookies via your macOS keychain on launch —
 * this script never reads or decrypts any credential. Nothing is sent anywhere.
 *
 * Usage:  1) Quit Google Chrome completely (Cmd+Q)
 *         2) node import-profile.js        (or: npm run import-profile)
 *         3) npm run ui   — leave "Use my main Chrome" UNCHECKED
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const DST = path.resolve(process.env.AGENT_PROFILE_DIR || './.agent-profile');

// Chrome must normally be closed for a clean copy. With --live we copy anyway
// (Chrome stays open) — useful for quick tests, but the snapshot can be slightly
// stale and session cookies may be mid-write.
const live = process.argv.includes('--live') || process.env.IMPORT_LIVE === '1';

let running = '';
try { running = execSync('pgrep -x "Google Chrome" || true').toString().trim(); } catch {}
if (running && !live) {
  console.error('\n⚠️  Google Chrome is still running.');
  console.error('   Quit it completely (Cmd+Q), then run this again — OR pass --live to copy while it stays open.');
  console.error('   A profile copied while Chrome is writing to it can be stale or logged out.\n');
  process.exit(1);
}
if (running && live) {
  console.warn('⚠️  --live: copying while Chrome is OPEN. The snapshot may be slightly stale.\n');
}

if (!existsSync(path.join(SRC, 'Default'))) {
  console.error('Could not find your Chrome profile at:\n  ' + SRC);
  process.exit(1);
}

console.log('Importing your Chrome logins into the agent profile…');
console.log('  from: ' + SRC + '/Default');
console.log('  to:   ' + DST + '/Default\n');

mkdirSync(path.join(DST, 'Default'), { recursive: true });

// 2. "Local State" holds the key Chrome uses to decrypt your cookies. Required.
copyFileSync(path.join(SRC, 'Local State'), path.join(DST, 'Local State'));

// 3. Copy the Default profile, skipping big caches and lock files.
const excludes = [
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache',
  'GrShaderCache', 'ShaderCache', 'Service Worker/CacheStorage',
  'Service Worker/ScriptCache', 'component_crx_cache', 'extensions_crx_cache',
  'Singleton*',
].map((e) => `--exclude=${JSON.stringify(e)}`).join(' ');

execSync(`rsync -a --delete ${excludes} ${JSON.stringify(SRC + '/Default/')} ${JSON.stringify(DST + '/Default/')}`, {
  stdio: 'inherit',
});

// 4. Drop stale single-instance locks so Chrome won't think the profile is busy.
for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
  rmSync(path.join(DST, f), { force: true });
  rmSync(path.join(DST, 'Default', f), { force: true });
}

console.log('\n✅ Done — your sessions are now in the agent profile.');
console.log('   Start it:  npm run ui   (leave "Use my main Chrome" UNCHECKED)');
console.log('   On first launch, Chrome may ask to use "Chrome Safe Storage" from your keychain — click Allow.');
console.log('   Note: Gmail/Google may still re-prompt (device-bound sessions); most other sites will be logged in.\n');
