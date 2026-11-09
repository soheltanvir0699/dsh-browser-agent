/**
 * Builds a compact, model-friendly snapshot of the page:
 *   - tags every interactive element with data-agent-id="N"
 *   - returns [{ id, tag, role, text }] so the model can refer to elements by id
 * Actions then locate elements with [data-agent-id="N"] — stable within a step.
 */

const COLLECT = () => {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
    // must be within (or near) the viewport
    return r.bottom > 0 && r.top < innerHeight + 1 && r.right > 0 && r.left < innerWidth + 1;
  };

  const selector =
    'a,button,input,textarea,select,[role=button],[role=link],[role=tab],' +
    '[role=checkbox],[role=menuitem],[onclick],[contenteditable=""],[contenteditable=true]';

  const seen = new Set();
  const out = [];
  let id = 0;

  for (const el of document.querySelectorAll(selector)) {
    if (seen.has(el) || !isVisible(el)) continue;
    seen.add(el);

    const label =
      (el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('name') ||
        el.value ||
        el.innerText ||
        el.getAttribute('title') ||
        '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);

    el.setAttribute('data-agent-id', String(id));
    out.push({
      id,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || el.getAttribute('type') || '',
      text: label,
    });
    id++;
  }
  return out;
};

export async function observe(page) {
  // Wait for the page to settle so we don't snapshot a mid-navigation DOM
  // (the main cause of stale-element misfires on the next action).
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const elements = await page.evaluate(COLLECT);
  const title = await page.title().catch(() => '');
  const url = page.url();
  return { url, title, elements };
}

export function renderObservation({ url, title, elements }) {
  const lines = elements.map(
    (e) => `[${e.id}] <${e.tag}${e.role ? ` ${e.role}` : ''}> ${e.text || '(no text)'}`
  );
  return `URL: ${url}\nTITLE: ${title}\nINTERACTIVE ELEMENTS:\n${lines.join('\n')}`;
}
