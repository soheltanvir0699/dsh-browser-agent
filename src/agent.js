import { observe, renderObservation } from './observe.js';
import { runAction } from './actions.js';
import { chat } from './llm.js';

const SYSTEM_PROMPT = `You are a browser agent. You control a real web browser to complete the user's task.

Each turn you receive the current page as a list of interactive elements, each with a numeric id.
Respond with ONE action as JSON (no prose), choosing from:

  {"thought": "...", "action": {"type": "navigate", "url": "https://..."}}
  {"thought": "...", "action": {"type": "click", "id": 5}}
  {"thought": "...", "action": {"type": "type", "id": 3, "text": "hello", "submit": true}}
  {"thought": "...", "action": {"type": "press", "key": "Enter"}}
  {"thought": "...", "action": {"type": "scroll", "direction": "down"}}
  {"thought": "...", "action": {"type": "wait", "ms": 1500}}
  {"thought": "...", "action": {"type": "done", "answer": "final result or summary for the user"}}

Rules:
- Only reference element ids that appear in the CURRENT PAGE list.
- For searches, prefer going DIRECTLY to the relevant site (e.g. youtube.com for a song/video, wikipedia.org for facts) or use https://duckduckgo.com. Avoid google.com/search — it frequently blocks automation with a CAPTCHA.
- If the answer is already visible on the current page, use "done" IMMEDIATELY — do not click deeper or navigate away to "confirm" it.
- Be efficient: aim to finish in as few steps as possible. Avoid opening extra links when the page already shows what you need.
- If a login form appears and you don't have credentials, use "done" and tell the user to log in manually in the open browser, then re-run.
- Never guess passwords. Never try to extract stored credentials.
- Prefer "type" with "submit": true for search boxes.
- When the task is complete, use "done" with a clear answer.`;

function describeAction(a) {
  switch (a.type) {
    case 'navigate': return `Opening ${a.url}`;
    case 'click': return `Clicking element [${a.id}]`;
    case 'type': return `Typing “${(a.text ?? '').slice(0, 40)}”${a.submit ? ' and searching' : ''}`;
    case 'press': return `Pressing ${a.key}`;
    case 'scroll': return `Scrolling ${a.direction || 'down'}`;
    case 'wait': return 'Waiting for the page…';
    default: return 'Working…';
  }
}

function parseAction(raw) {
  // Be tolerant of stray text / code fences around the JSON.
  const match = raw.match(/\{[\s\S]*\}/);
  const json = match ? match[0] : raw;
  const obj = JSON.parse(json);
  return obj.action ? obj : { thought: '', action: obj };
}

// Detect CAPTCHA / "unusual traffic" bot-walls so we can hand off to the human.
async function botWall(page) {
  const url = page.url().toLowerCase();
  if (url.includes('/sorry/') || url.includes('/captcha') || url.includes('ipv4check')) return true;
  try {
    return await page.evaluate(() => {
      const t = (document.title || '').toLowerCase();
      const b = (document.body?.innerText || '').slice(0, 2500).toLowerCase();
      const s = t + ' ' + b;
      return (
        /unusual traffic|are you a robot|not a robot|verify (you are |you're )?human|detected unusual|complete the security check/.test(s) ||
        !!document.querySelector('iframe[src*="recaptcha"], iframe[title*="recaptcha" i], #captcha, .g-recaptcha')
      );
    });
  } catch {
    return false;
  }
}

// Wait for the human to clear the bot-wall in the open window.
async function waitForHuman(page, maxMs, signal) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (signal?.stopped) return false;
    await page.waitForTimeout(2500);
    if (!(await botWall(page))) return true;
  }
  return false;
}

// Follow the user into whatever tab is now active (clicks often open new tabs).
function activePage(context, fallback) {
  if (!context) return fallback;
  const open = context.pages().filter((p) => !p.isClosed());
  const real = open.filter((p) => p.url() && p.url() !== 'about:blank');
  return (real.length ? real : open).at(-1) || fallback;
}

export async function runAgent({ page, context, task, cfg, maxSteps = 25, confirm, onStep, signal }) {
  const emit = (ev) => { try { onStep?.(ev); } catch {} };
  const history = []; // compact log of what was done, kept small to save tokens
  const executed = []; // signatures of actions taken, for loop detection

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.stopped) return 'stopped by user';

    // Switch to the newest tab if a previous action opened one.
    page = activePage(context, page);
    await page.bringToFront().catch(() => {});

    // If a CAPTCHA / "unusual traffic" wall appears, hand off to the human.
    if (await botWall(page)) {
      emit({
        kind: 'captcha',
        step,
        text: 'A human-verification page appeared. Please solve it in the Chrome window — I\'ll continue automatically.',
      });
      const solved = await waitForHuman(page, 150000, signal);
      emit({ kind: 'activity', step, phase: 'reading', text: solved ? 'Verification cleared — continuing…' : 'Still blocked.' });
      if (!solved)
        return 'A verification/CAPTCHA page is blocking automation and was not solved in time. Tip: I avoid Google search for this reason — try again, or give a direct Start URL (e.g. youtube.com).';
    }

    // Break out of pointless repetition (e.g. clicking a link that does nothing).
    const tail = executed.slice(-4);
    if (tail.length === 4 && tail.every((s) => s === tail[0])) {
      emit({ kind: 'result', step, ok: false, text: 'stuck repeating the same action — stopping' });
      return "I got stuck repeating the same action with no progress. The link may open content I can't follow, or the task needs a different starting page. Try rephrasing or giving a direct Start URL.";
    }
    const stuck = executed.slice(-2).length === 2 && executed.at(-1) === executed.at(-2);

    emit({ kind: 'activity', step, phase: 'reading', text: 'Reading the page…' });
    const obs = await observe(page);
    emit({ kind: 'observation', step, url: obs.url, title: obs.title, count: obs.elements.length });
    const view = renderObservation(obs);

    // Rebuild a SMALL, fixed-size prompt each step: system + task + recent
    // history + only the CURRENT page. We never resend old page snapshots,
    // which keeps token usage flat and avoids free-tier rate limits.
    const recent = history.slice(-6).join('\n') || '(none yet)';
    const warn = stuck
      ? '\n⚠️ Your last action repeated with NO change to the page. Do NOT repeat it. ' +
        'Pick a DIFFERENT element, scroll, or use "done" with the information already visible.\n'
      : '';
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `TASK: ${task}\n\n` +
          `STEPS SO FAR:\n${recent}\n` +
          warn +
          `\nCURRENT PAGE (step ${step}):\n${view}\n\n` +
          `Respond with one action as JSON.`,
      },
    ];

    emit({ kind: 'activity', step, phase: 'thinking', text: 'Thinking…' });
    const raw = await chat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      jsonMode: cfg.jsonMode,
    });

    let parsed;
    try {
      parsed = parseAction(raw);
    } catch {
      history.push(`Step ${step}: model returned invalid JSON — retried`);
      continue;
    }

    const { thought, action } = parsed;
    console.log(`\n[step ${step}] ${thought || ''}`);
    console.log(`  → ${JSON.stringify(action)}`);
    emit({ kind: 'plan', step, thought: thought || '', action });

    if (action.type === 'done') {
      emit({ kind: 'done', step, answer: action.answer ?? '' });
      return action.answer ?? '(no answer)';
    }

    if (confirm) {
      const ok = await confirm(action);
      if (!ok) {
        history.push(`Step ${step}: ${describeAction(action)} — rejected by user`);
        emit({ kind: 'result', step, ok: false, text: 'rejected by user' });
        continue;
      }
    }

    emit({ kind: 'activity', step, phase: 'acting', text: describeAction(action) });
    executed.push(JSON.stringify(action));
    try {
      const result = await runAction(page, action);
      console.log(`  ✓ ${result}`);
      history.push(`Step ${step}: ${describeAction(action)} — ${result}`);
      emit({ kind: 'result', step, ok: true, text: result });
    } catch (err) {
      console.log(`  ✗ ${err.message}`);
      history.push(`Step ${step}: ${describeAction(action)} — FAILED: ${err.message}`);
      emit({ kind: 'result', step, ok: false, text: `action failed: ${err.message}` });
    }
  }

  return `stopped after ${maxSteps} steps without an explicit done`;
}
