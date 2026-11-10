/**
 * Encrypted credential vault — stores per-site { email, password } so Scout can
 * auto-fill a login when cookies don't carry. Local-only and git-ignored.
 *
 * Encryption: AES-256-GCM. The key comes from SCOUT_VAULT_KEY (a passphrase you
 * set — recommended). If that's unset, a random key is generated once and kept
 * in .scout-vault.key next to the data — convenient but NOT secure against
 * someone who can read your files, so prefer SCOUT_VAULT_KEY for anything real.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VAULT = path.resolve(process.env.SCOUT_VAULT_FILE || './.scout-vault.json');
const KEYFILE = path.resolve('./.scout-vault.key');

function getKey() {
  if (process.env.SCOUT_VAULT_KEY) {
    return crypto.scryptSync(process.env.SCOUT_VAULT_KEY, 'scout-vault-salt', 32);
  }
  try {
    if (fs.existsSync(KEYFILE)) return Buffer.from(fs.readFileSync(KEYFILE, 'utf8').trim(), 'hex');
  } catch {}
  const k = crypto.randomBytes(32);
  try { fs.writeFileSync(KEYFILE, k.toString('hex'), { mode: 0o600 }); } catch {}
  return k;
}

function enc(text, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(b64, key) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

function load() { try { return JSON.parse(fs.readFileSync(VAULT, 'utf8')); } catch { return {}; } }
function store(obj) { try { fs.writeFileSync(VAULT, JSON.stringify(obj, null, 2), { mode: 0o600 }); } catch {} }

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); }
}

export function saveCred(domain, email, password) {
  if (!domain || !email || !password) return false;
  const key = getKey();
  const data = load();
  data[domain] = { email: enc(email, key), password: enc(password, key), savedAt: new Date().toISOString() };
  store(data);
  return true;
}

export function getCred(domain) {
  try {
    const e = load()[domain];
    if (!e) return null;
    const key = getKey();
    return { email: dec(e.email, key), password: dec(e.password, key) };
  } catch {
    return null;
  }
}
