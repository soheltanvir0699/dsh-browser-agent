/**
 * Executes one action chosen by the model. Returns a short result string that
 * is fed back into the next observation so the model sees what happened.
 */

const byId = (page, id) => page.locator(`[data-agent-id="${id}"]`).first();

export async function runAction(page, action) {
  switch (action.type) {
    case 'navigate': {
      await page.goto(action.url, { waitUntil: 'domcontentloaded' });
      return `navigated to ${action.url}`;
    }
    case 'click': {
      await byId(page, action.id).click({ timeout: 10000 });
      // a click may trigger navigation — let it start before the next observe
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      return `clicked [${action.id}]`;
    }
    case 'type': {
      const el = byId(page, action.id);
      await el.click({ timeout: 10000 });
      await el.fill(action.text ?? '', { timeout: 10000 });
      if (action.submit) {
        await el.press('Enter');
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      }
      return `typed into [${action.id}]${action.submit ? ' + Enter' : ''}`;
    }
    case 'press': {
      await page.keyboard.press(action.key);
      return `pressed ${action.key}`;
    }
    case 'scroll': {
      const dy = action.direction === 'up' ? -800 : 800;
      await page.mouse.wheel(0, dy);
      return `scrolled ${action.direction || 'down'}`;
    }
    case 'wait': {
      await page.waitForTimeout(Math.min(action.ms ?? 1000, 8000));
      return `waited ${action.ms ?? 1000}ms`;
    }
    case 'done':
      return `DONE: ${action.answer ?? ''}`;
    default:
      return `unknown action: ${JSON.stringify(action)}`;
  }
}
