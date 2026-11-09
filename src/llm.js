/**
 * Minimal OpenAI-compatible chat client (DeepSeek / Groq / Gemini / Ollama…).
 * Uses the global fetch in Node 18+. No SDK dependency.
 *
 * Resilience built in:
 *  - If strict JSON mode is rejected or fails validation (Groq's gpt-oss can
 *    return json_validate_failed with an empty generation), retry WITHOUT JSON
 *    mode — the caller's prompt already demands JSON and the parser is tolerant.
 *  - If the model returns empty content under JSON mode, retry without it.
 *  - Back off and retry on 429 rate limits.
 */

export async function chat({ baseUrl, apiKey, model, messages, jsonMode = true }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const call = (useJson) => {
    // Hard timeout so a hung request can never block a task forever.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    return fetch(url, {
      signal: ctrl.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        // Reasoning models (gpt-oss) spend tokens thinking before the answer;
        // without enough room the JSON gets cut off -> json_validate_failed.
        max_tokens: 6000,
        // Keep reasoning light so each step is fast (gpt-oss on Groq only).
        ...(/gpt-oss/i.test(model) ? { reasoning_effort: process.env.LLM_REASONING || 'low' } : {}),
        ...(useJson ? { response_format: { type: 'json_object' } } : {}),
      }),
    }).finally(() => clearTimeout(timer));
  };

  // Matches the various ways a backend signals "JSON mode didn't work".
  const jsonModeTrouble = (txt) =>
    /response_format|json_object|json[_ ]?validate|validate\s+json|failed_generation|adjust your prompt/i.test(
      txt
    );

  let res = await call(jsonMode);

  // JSON mode rejected or failed validation — retry once in plain mode.
  if (!res.ok && jsonMode) {
    const peek = await res.clone().text().catch(() => '');
    if ((res.status === 400 || res.status === 422) && jsonModeTrouble(peek)) {
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

  let data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? '';

  // Empty generation under JSON mode (gpt-oss sometimes does this) — retry plain.
  if ((!content || !content.trim()) && jsonMode) {
    const res2 = await call(false);
    if (res2.ok) {
      data = await res2.json();
      content = data.choices?.[0]?.message?.content ?? content;
    }
  }

  return content;
}
