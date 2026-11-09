/**
 * Minimal DeepSeek client (OpenAI-compatible chat completions).
 * Uses the global fetch in Node 18+. No SDK dependency.
 */

export async function chat({ baseUrl, apiKey, model, messages, jsonMode = true }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const call = (useJson) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        ...(useJson ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

  let res = await call(jsonMode);

  // Some local backends reject response_format — retry once without it.
  if (!res.ok && jsonMode) {
    const peek = await res.clone().text().catch(() => '');
    if (res.status === 400 && /response_format|format/i.test(peek)) {
      res = await call(false);
    }
  }

  // Rate limited (common on free tiers): back off and retry a couple of times.
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 4000;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await call(jsonMode);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429)
      throw new Error('Rate limit reached on the free tier. Wait a minute and try again, or switch model/provider in .env.');
    throw new Error(`LLM API ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}
