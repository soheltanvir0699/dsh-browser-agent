/**
 * Builds a compact, model-friendly snapshot of the page:
 *   - tags every interactive element with data-agent-id="N" (so actions can
 *     locate it with [data-agent-id="N"])
 *   - also returns the page's visible TEXT, so the model can actually read and
 *     answer questions, not just see buttons.
 */

const COLLECT = () => {
  const isDisplayed = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return !(s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0');
  };
  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight + 1 && r.right > 0 && r.left < innerWidth + 1;
  };

  const selector =
    'a,button,input,textarea,select,[role=button],[role=link],[role=tab],' +
    '[role=checkbox],[role=menuitem],[role=option],[onclick],[contenteditable=""],[contenteditable=true]';

  const seen = new Set();
  const out = [];
  let id = 0;
  const MAX = 90;

  for (const el of document.querySelectorAll(selector)) {
    if (seen.has(el) || !isDisplayed(el)) continue;
    seen.add(el);

    const label = (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.value ||
      el.innerText ||
      el.getAttribute('title') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    el.setAttribute('data-agent-id', String(id));
    out.push({
      id,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || el.getAttribute('type') || '',
      text: label,
      vp: inViewport(el) ? 1 : 0,
    });
    id++;
    if (id >= MAX) break;
  }

  // Visible page text — what a human would actually read.
  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim().slice(0, 2800);

  return { elements: out, text };
};

export async function observe(page) {
  // Wait for the page to settle so we don't snapshot a mid-navigation DOM.
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);

  let data = { elements: [], text: '' };
  try {
    data = await page.evaluate(COLLECT);
  } catch {
    // transient navigation during evaluate — one quick retry
    await page.waitForTimeout(500);
    try {
      data = await page.evaluate(COLLECT);
    } catch {}
  }
  const title = await page.title().catch(() => '');
  const url = page.url();
  return { url, title, elements: data.elements, text: data.text };
}

// Draw numbered badges over each tagged element, screenshot, remove them.
// Lets a vision model pick an element by its id ("set-of-marks" prompting).
export async function annotatedScreenshot(page) {
  await page
    .evaluate(() => {
      document.querySelectorAll('.__scout_mark__').forEach((e) => e.remove());
      for (const el of document.querySelectorAll('[data-agent-id]')) {
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > innerHeight) continue;
        const id = el.getAttribute('data-agent-id');
        const box = document.createElement('div');
        box.className = '__scout_mark__';
        box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:1.5px solid #c15f3c;border-radius:3px;z-index:2147483647;pointer-events:none;box-sizing:border-box`;
        const lab = document.createElement('div');
        lab.className = '__scout_mark__';
        lab.textContent = id;
        lab.style.cssText = `position:fixed;left:${r.left}px;top:${Math.max(0, r.top - 13)}px;background:#c15f3c;color:#fff;font:bold 11px/1.2 sans-serif;padding:0 3px;border-radius:3px;z-index:2147483647;pointer-events:none`;
        document.body.appendChild(box);
        document.body.appendChild(lab);
      }
    })
    .catch(() => {});
  let b64 = '';
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 55 });
    b64 = buf.toString('base64');
  } catch {}
  await page.evaluate(() => document.querySelectorAll('.__scout_mark__').forEach((e) => e.remove())).catch(() => {});
  return b64;
}

export function renderObservation({ url, title, elements, text }) {
  const lines = elements.map(
    (e) => `[${e.id}] <${e.tag}${e.role ? ` ${e.role}` : ''}>${e.vp ? '' : ' (scroll)'} ${e.text || '(no text)'}`
  );
  return (
    `URL: ${url}\nTITLE: ${title}\n\n` +
    `PAGE TEXT:\n${text || '(no readable text)'}\n\n` +
    `INTERACTIVE ELEMENTS (ids to click/type; "(scroll)" = below the fold):\n${lines.join('\n')}`
  );
}
