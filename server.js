#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { launchProfile, connectCDP } from './src/browser.js';
import { runAgent } from './src/agent.js';
import { loadConfig } from './src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cfg = loadConfig();

function providerOf(baseUrl) {
  return /groq/.test(baseUrl) ? 'Groq'
    : /deepseek/.test(baseUrl) ? 'DeepSeek'
    : /googleapis/.test(baseUrl) ? 'Gemini'
    : /localhost|127\.0\.0\.1/.test(baseUrl) ? 'Local'
    : 'LLM';
}

// Persist updated settings to .env so they survive a restart.
function persistEnv(updates) {
  const envPath = path.join(__dirname, '.env');
  let lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n') : [];
  for (const [k, v] of Object.entries(updates)) {
    let found = false;
    lines = lines.map((l) => (l.startsWith(k + '=') ? ((found = true), `${k}=${v}`) : l));
    if (!found) lines.push(`${k}=${v}`);
  }
  writeFileSync(envPath, lines.join('\n'));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- single-session state (one task at a time keeps the UI simple) ---
const session = {
  running: false,
  clients: new Set(),   // SSE response objects
  signal: { stopped: false },
  pendingConfirm: null, // { resolve } when awaiting approval
  browser: null,        // { page, close }
};

function broadcast(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of session.clients) res.write(line);
}

// Expose the active model/provider for the UI badge (never returns the key)
app.get('/config', (req, res) => {
  res.json({
    provider: providerOf(cfg.baseUrl),
    model: cfg.model,
    hasKey: !!(cfg.apiKey && cfg.apiKey !== 'ollama'),
    running: session.running,
  });
});

// Update the API key and/or model from the UI (persists to .env)
app.post('/settings', (req, res) => {
  const { apiKey, model } = req.body || {};
  const updates = {};
  if (typeof apiKey === 'string' && apiKey.trim()) { cfg.apiKey = apiKey.trim(); updates.LLM_API_KEY = cfg.apiKey; }
  if (typeof model === 'string' && model.trim()) { cfg.model = model.trim(); updates.LLM_MODEL = cfg.model; }
  if (Object.keys(updates).length) { try { persistEnv(updates); } catch {} }
  res.json({ ok: true, provider: providerOf(cfg.baseUrl), model: cfg.model, hasKey: !!(cfg.apiKey && cfg.apiKey !== 'ollama') });
});

// SSE stream of agent events
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ kind: 'hello', running: session.running })}\n\n`);
  session.clients.add(res);
  req.on('close', () => session.clients.delete(res));
});

// Approve / reject / stop
app.post('/control', (req, res) => {
  const { command } = req.body || {};
  if (command === 'stop') {
    session.signal.stopped = true;
    session.pendingConfirm?.resolve(false);
    session.pendingConfirm = null;
  } else if (command === 'approve') {
    session.pendingConfirm?.resolve(true);
    session.pendingConfirm = null;
  } else if (command === 'reject') {
    session.pendingConfirm?.resolve(false);
    session.pendingConfirm = null;
  } else if (command === 'continue') {
    // user finished signing in / solving a wall
    session.signal.continueLogin = true;
  }
  res.json({ ok: true });
});

// Start a task
app.post('/run', async (req, res) => {
  if (session.running) return res.status(409).json({ error: 'a task is already running' });
  if (!cfg.apiKey) return res.status(400).json({ error: 'DEEPSEEK_API_KEY not set in .env' });

  const { task, startUrl, mode = 'profile', auto = false } = req.body || {};
  if (!task || !task.trim()) return res.status(400).json({ error: 'task is required' });

  session.running = true;
  session.signal = { stopped: false };
  res.json({ ok: true });

  const confirm = auto
    ? null
    : (action) =>
        new Promise((resolve) => {
          session.pendingConfirm = { resolve };
          broadcast({ kind: 'awaiting_confirm', action });
        });

  try {
    broadcast({ kind: 'status', text: 'launching browser…' });
    session.browser =
      mode === 'cdp'
        ? await connectCDP()
        : await launchProfile({
            profileDir: process.env.AGENT_PROFILE_DIR || './.agent-profile',
            headless: false,
          });

    const page = session.browser.page;
    if (startUrl) await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    else if (page.url() === 'about:blank')
      await page.goto('https://duckduckgo.com', { waitUntil: 'domcontentloaded' });

    broadcast({ kind: 'status', text: `running: ${task}` });
    const answer = await runAgent({
      page,
      context: session.browser.context,
      task,
      cfg,
      confirm,
      signal: session.signal,
      onStep: broadcast,
    });
    broadcast({ kind: 'finished', answer });
  } catch (err) {
    let text = err.message;
    if (mode === 'cdp' && /ECONNREFUSED|9222/.test(text)) {
      text =
        'CDP could not reach Chrome on port 9222 — and on Chrome 136+ it cannot use your ' +
        'main profile\'s logins anyway (Google blocks it). To be logged in: UNCHECK "Use my ' +
        'main Chrome", then either sign in once when the agent prompts you, or quit Chrome and ' +
        'run "npm run import-profile" to copy your sessions into the agent.';
    }
    broadcast({ kind: 'error', text });
  } finally {
    await session.browser?.close().catch(() => {});
    session.browser = null;
    session.pendingConfirm = null;
    session.running = false;
    broadcast({ kind: 'idle' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  dsh-browser-agent UI → http://localhost:${PORT}\n`);
});
