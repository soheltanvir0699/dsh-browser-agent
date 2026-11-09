/**
 * Executes one action chosen by the model. Returns a short result string that
 * is fed back into the next observation so the model sees what happened.
 * Built to be resilient: scroll into view, fall back to a forced click, and
 * give a clear message instead of throwing when an element can't be used.
 */

const byId = (page, id) => page.locator(`[data-agent-id="${id}"]`).first();

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function robustClick(page, id) {
  const el = byId(page, id);
  if ((await el.count()) === 0) return `element [${id}] is no longer on the page — re-check the list`;
  await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  try {
    await el.click({ timeout: 8000 });
  } catch {
    // Something overlaps it or it's finicky — force the click.
    try {
      await el.click({ timeout: 4000, force: true });
    } catch (e) {
      return `could not click [${id}] (${String(e.message).split('\n')[0]}) — try a different element`;
    }
  }
  await settle(page);
  return `clicked [${id}]`;
}

export async function runAction(page, action) {
  switch (action.type) {
    case 'navigate': {
      let url = action.url || '';
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        return `could not open ${url} (${String(e.message).split('\n')[0]})`;
      }
      await settle(page);
      return `navigated to ${url}`;
    }

    case 'click':
      return await robustClick(page, action.id);

    case 'type': {
      const el = byId(page, action.id);
      if ((await el.count()) === 0) return `field [${action.id}] is gone — re-check the list`;
      await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
      try {
        await el.click({ timeout: 6000 }).catch(() => {});
        await el.fill('', { timeout: 6000 }).catch(() => {});
        await el.fill(action.text ?? '', { timeout: 8000 });
      } catch (e) {
        return `could not type into [${action.id}] (${String(e.message).split('\n')[0]})`;
      }
      if (action.submit) {
        await el.press('Enter').catch(() => {});
        await settle(page);
      }
      return `typed "${(action.text ?? '').slice(0, 40)}" into [${action.id}]${action.submit ? ' + Enter' : ''}`;
    }

    case 'press': {
      await page.keyboard.press(action.key).catch(() => {});
      await settle(page);
      return `pressed ${action.key}`;
    }

    case 'scroll': {
      const dy = action.direction === 'up' ? -900 : 900;
      await page.mouse.wheel(0, dy).catch(() => {});
      await page.waitForTimeout(400);
      return `scrolled ${action.direction || 'down'}`;
    }

    case 'wait': {
      await page.waitForTimeout(Math.min(Math.max(action.ms ?? 1000, 200), 8000));
      return `waited`;
    }

    case 'done':
      return `DONE: ${action.answer ?? ''}`;

    default:
      return `unknown action "${action.type}" — use navigate/click/type/scroll/done`;
  }
}
