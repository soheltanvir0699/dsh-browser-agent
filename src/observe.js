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
  const MAX = 150;

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
  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim().slice(0, 4000);

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
