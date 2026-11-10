import { observe, renderObservation, annotatedScreenshot } from './observe.js';
import { runAction } from './actions.js';
import { chat } from './llm.js';

const SYSTEM_PROMPT = `You are a browser agent. You control a real web browser to complete the user's task.

Each turn you receive the CURRENT PAGE: its URL, its visible PAGE TEXT, and a list of
interactive elements each with a numeric id. Respond with ONE action as JSON (no prose):

  {"thought": "...", "action": {"type": "navigate", "url": "https://..."}}
  {"thought": "...", "action": {"type": "click", "id": 5}}
  {"thought": "...", "action": {"type": "type", "id": 3, "text": "hello", "submit": true}}
  {"thought": "...", "action": {"type": "scroll", "direction": "down"}}
  {"thought": "...", "action": {"type": "done", "answer": "the answer or result for the user"}}

How to work reliably:
- READ THE PAGE TEXT FIRST. If it already contains the answer, use "done" immediately with that answer. Do not click around to "confirm" what you can already read.
- Only reference element ids shown in the CURRENT PAGE list. Ids marked "(scroll)" are below the fold — use {"type":"scroll","direction":"down"} to bring them up before clicking.
- For searches, go DIRECTLY to the right site when you can (youtube.com for a song/video, wikipedia.org for facts, amazon.com for products) or use https://duckduckgo.com. Avoid google.com/search — it blocks automation with a CAPTCHA.
- Use "type" with "submit": true for search boxes.
- If the same action didn't change the page last time, do something different (a different element, scroll, or a direct navigate) — never repeat a failed action.
- Be efficient: finish in as few steps as possible. If after scrolling the info still isn't there, use "done" and report what you found.
- NEVER finish the task just because a login/sign-in page appears. The app automatically pauses for the user to sign in and then continues — so do not use "done" for that, just proceed with the task. Never guess passwords or extract stored credentials.

Interacting with complex pages (this is how you avoid getting stuck):
- PREFER A RESULTS URL over fighting a widget. Build the URL and navigate to it directly:
    • YouTube search → https://www.youtube.com/results?search_query=QUERY
    • Amazon search → https://www.amazon.com/s?k=QUERY
    • Google Maps search → https://www.google.com/maps/search/QUERY
    • Wikipedia → https://en.wikipedia.org/wiki/TOPIC
    • Google Flights (fill the form in the URL) → https://www.google.com/travel/flights?q=Flights%20from%20DAC%20to%20DXB%20on%20YYYY-MM-DD
  Use "+" or %20 for spaces. This skips autocomplete, date pickers and dropdowns entirely.
- Autocomplete / "search as you type" fields (locations, airports, products): type the text but do NOT set submit:true. Then WAIT one step and CLICK the matching option in the suggestion list. Pressing Enter on these often opens the wrong page.
- If a click or type FAILS, or an element becomes invisible, do NOT try the same element again. Switch strategy immediately: a different element, scroll, or a direct results URL.
- If typing in a search box doesn't show results, the page may be a landing page: click its main button first (e.g. "Check downloads", "Search", "Get started"), THEN use the search. Never type into the same box repeatedly.
- Date pickers and multi-field forms: if you can't set a field within 2 tries, continue with what is shown or report the best answer visible. Never loop on the same widget.
- You have limited steps — when you have enough information to answer, STOP and use "done".

Writing the final answer (the "done" answer):
- Give a COMPLETE, well-organized answer, not a one-line reply. Include the concrete details you saw on the page: names, numbers, dates, prices, ratings, authors, key points, and a source URL.
- Format with Markdown so it reads well (it is rendered richly): a short intro line, "## headings" to group sections, "- " bullets for lists, "**bold**" for labels, Markdown tables when comparing rows of data, and [text](url) links.
- If the user said "open X", briefly say what the page is, then the specific information they wanted.
- Only include what you actually saw on the page — never invent details. If something wasn't available, say so.`;

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
  const s = (raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  // Try to find a JSON action object anywhere in the text.
  const match = s.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      const parsed = obj.action ? obj : obj.type ? { thought: obj.thought || '', action: obj } : null;
      if (parsed?.action?.type) return parsed;
    } catch {}
  }

  // Salvage a "done" answer from MALFORMED JSON — gpt-oss often writes the
  // markdown answer with real line breaks, which is invalid JSON. Pull the
  // answer string out directly (this regex handles escaped quotes + raw newlines).
  if (/"type"\s*:\s*"done"/.test(s)) {
    const m = s.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      const answer = m[1]
        .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '')
        .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return { thought: '', action: { type: 'done', answer } };
    }
  }

  // Otherwise the model answered in prose/markdown — treat it as the answer.
  if (s) return { thought: '', action: { type: 'done', answer: s } };
  throw new Error('empty response');
}

// Detect a sign-in wall so we can hand off to the human to log in (once).
async function needsLogin(page) {
  try {
    return await page.evaluate(() => {
      const hasPwd = !!document.querySelector(
        'input[type="password"]:not([type="hidden"]):not([aria-hidden="true"])'
      );
      const url = location.href.toLowerCase();
      const authUrl =
        /accounts\.google\.com|appleid\.apple\.com|login\.|\/login|\/signin|\/sign-in|\/sign_in|\/auth\/|\/sessions\/new|\/oauth/.test(
          url
        );
      const t = (document.title + ' ' + (document.body?.innerText || '').slice(0, 1200)).toLowerCase();
      const loginish =
        /sign in|log in|sign-in|log-in|continue with google|continue with apple|enter your password|choose an account/.test(
          t
        );
      // A visible password box is the strongest signal; otherwise an auth URL
      // that also reads like a login page.
      return hasPwd || (authUrl && loginish);
    });
  } catch {
    return false;
  }
}

// Wait for the human to sign in: resolve when they click "continue", when the
// login page goes away on its own (they signed in), on stop, or on timeout.
async function waitForLogin(getPage, signal, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (signal?.stopped) return false;
    if (signal?.continueLogin) {
      signal.continueLogin = false;
      return true;
    }
    await getPage().waitForTimeout(2500).catch(() => {});
    if (!(await needsLogin(getPage()))) return true;
  }
  return false;
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
  const ineffective = new Set(); // actions that changed nothing — never retry them
  const deadDesc = new Set(); // human labels of dead actions, shown to the model
  let lastSig = null; // signature of the last action we ran/skipped
  let lastDesc = null; // label of the last action
  let lastSnap = null; // page fingerprint after the last action
  let skips = 0; // how many times we've blocked a no-op repeat

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.stopped) return 'stopped by user';

    // Switch to the newest tab if a previous action opened one.
    page = activePage(context, page);
    await page.bringToFront().catch(() => {});

    // Observe FIRST so the page is fully settled before we decide anything —
    // otherwise a login/CAPTCHA page gets missed because it hasn't rendered yet.
    emit({ kind: 'activity', step, phase: 'reading', text: 'Reading the page…' });
    let obs = await observe(page);

    // If a CAPTCHA / "unusual traffic" wall appears, hand off to the human,
    // then re-observe the page they land on.
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
      page = activePage(context, page);
      await page.bringToFront().catch(() => {});
      obs = await observe(page);
    }

    // If a sign-in wall appears, PAUSE (keep the browser open) and let the user
    // log in once. The session is saved in the profile and reused next time.
    if (await needsLogin(page)) {
      emit({
        kind: 'login',
        step,
        text:
          'This site needs you to sign in. Please log in in the Chrome window (use your normal account or "Sign in with Google"), then click "I\'ve signed in". Your session is saved for next time.',
      });
      const ok = await waitForLogin(() => (page = activePage(context, page)), signal, 300000);
      emit({ kind: 'activity', step, phase: 'reading', text: ok ? 'Signed in — continuing…' : 'Sign-in not completed.' });
      if (!ok)
        return 'This site needs sign-in and it was not completed. Log in once in the open Chrome window, then re-run — the session will be saved and reused. (Or run `npm run import-profile` to bring in your existing Chrome logins.)';
      page = activePage(context, page);
      await page.bringToFront().catch(() => {});
      obs = await observe(page);
    }

    // Did the LAST action actually change the page? If not, remember it so we
    // never waste steps repeating something that does nothing.
    const snap = `${obs.url}|${obs.title}|${obs.elements.length}`;
    const lastDidNothing = lastSig && snap === lastSnap;
    if (lastDidNothing) { ineffective.add(lastSig); if (lastDesc) deadDesc.add(lastDesc); }
    lastSnap = snap;

    emit({ kind: 'observation', step, url: obs.url, title: obs.title, count: obs.elements.length });
    const view = renderObservation(obs);

    // Rebuild a SMALL, fixed-size prompt each step: system + task + recent
    // history + only the CURRENT page. We never resend old page snapshots,
    // which keeps token usage flat and avoids free-tier rate limits.
    const recent = history.slice(-6).join('\n') || '(none yet)';
    const warn = lastDidNothing
      ? '\n⚠️ Your last action did NOT change the page — it had no effect. Do something COMPLETELY DIFFERENT: ' +
        'click a different element (e.g. a "Search", "Check", "Go" or results button), scroll, navigate to another URL, ' +
        'or use "done" to report what you found. Do NOT repeat the same action.\n'
      : '';
    const deadList = deadDesc.size
      ? `\nDO NOT choose these — they do NOTHING on this page:\n${[...deadDesc].map((d) => '- ' + d).join('\n')}\n`
      : '';
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `TASK: ${task}\n\n` +
          `STEPS SO FAR:\n${recent}\n` +
          warn +
          deadList +
          `\nCURRENT PAGE (step ${step}):\n${view}\n\n` +
          `Respond with one action as JSON.`,
      },
    ];

    // When stuck AND a vision model is available, SCREENSHOT the page and let
    // the vision model pick the next move (it can see dropdowns/buttons the
    // text list misses). Otherwise do the normal fast text step.
    let raw;
    if (lastDidNothing && cfg.vision) {
      emit({ kind: 'activity', step, phase: 'thinking', text: '📸 Looking at the screenshot…' });
      const shot = await annotatedScreenshot(page);
      const visionMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `TASK: ${task}\n\nYour last action did nothing. LOOK at the screenshot and choose a DIFFERENT next action. ` +
                `Orange numbered badges mark clickable elements; their numbers are the ids below.${deadList}\n\n` +
                `ELEMENTS:\n${view}\n\nRespond with one action as JSON.`,
            },
            shot ? { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot}` } } : { type: 'text', text: '(no screenshot)' },
          ],
        },
      ];
      try {
        raw = await chat({ baseUrl: cfg.vision.baseUrl, apiKey: cfg.vision.apiKey, model: cfg.vision.model, messages: visionMessages, jsonMode: false });
      } catch (e) {
        emit({ kind: 'result', step, ok: false, text: `vision step failed: ${String(e.message).slice(0, 80)}` });
      }
    }
    if (raw === undefined) {
      emit({ kind: 'activity', step, phase: 'thinking', text: 'Thinking…' });
      raw = await chat({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages,
        jsonMode: cfg.jsonMode,
      });
    }

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

    const sig = JSON.stringify(action);

    // Hard block: if this exact action already proved to do nothing, refuse to
    // run it again and force a different approach (prevents the stuck loop).
    if (['click', 'type', 'navigate'].includes(action.type) && ineffective.has(sig)) {
      skips += 1;
      history.push(
        `Step ${step}: "${describeAction(action)}" already had NO effect — skipped. Must try a different element/button or use done.`
      );
      emit({ kind: 'result', step, ok: false, text: 'that action does nothing here — trying a different approach' });
      lastSig = sig;
      lastDesc = describeAction(action);
      if (skips >= 3) {
        emit({ kind: 'result', step, ok: false, text: 'no approach is making progress — stopping' });
        return "I couldn't make progress on this page — the control I needed didn't respond. Try giving me a direct Start URL for the exact page, or rephrase the task. (Note: app download counts are often only shown as ranges, or only to the app's owner.)";
      }
      continue;
    }

    emit({ kind: 'activity', step, phase: 'acting', text: describeAction(action) });
    executed.push(sig);
    lastSig = sig;
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

  return "I reached the step limit without finishing. Here's what I can suggest: give me a direct Start URL for the exact page, or rephrase the task into a smaller step.";
}
