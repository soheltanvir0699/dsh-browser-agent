/**
 * Minimal OpenAI-compatible chat client (DeepSeek / Groq / Gemini / Ollama…).
 *
 * IMPORTANT: this uses node:https directly instead of the global `fetch`.
 * Node's `fetch` (undici) shares a connection pool that Playwright can leave in
 * a bad state, which made model calls HANG indefinitely while a browser was
 * open. A plain https request uses its own socket + a real socket timeout, so a
 * stalled model call can never freeze a task.
 *
 * Resilience: retry without strict JSON mode when a backend rejects it; retry on
 * 429; salvage the model's output from `failed_generation`; time out at 50s.
 */
import https from 'node:https';
import http from 'node:http';

function postJSON(urlStr, headers, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const body = JSON.stringify(bodyObj);
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, text: data }));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('LLM request timed out')));
    req.write(body);
    req.end();
  });
}

export async function chat({ baseUrl, apiKey, model, messages, jsonMode = true }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    Connection: 'close',
  };
  const body = (useJson) => ({
    model,
    messages,
    temperature: 0,
    max_tokens: 6000,
    ...(/gpt-oss/i.test(model) ? { reasoning_effort: process.env.LLM_REASONING || 'low' } : {}),
    ...(useJson ? { response_format: { type: 'json_object' } } : {}),
  });
  const call = (useJson) => postJSON(url, headers, body(useJson), 50000);

  const jsonModeTrouble = (txt) =>
    /response_format|json_object|json[_ ]?validate|validate\s+json|failed_generation|adjust your prompt/i.test(txt);

  let res = await call(jsonMode);

  // JSON mode rejected/failed — retry once without it.
  if (res.status >= 400 && jsonMode && (res.status === 400 || res.status === 422) && jsonModeTrouble(res.text)) {
    res = await call(false);
  }

  // Rate limited — back off and retry a couple of times.
  for (let attempt = 0; res.status === 429 && attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
    res = await call(jsonMode);
  }

  if (res.status >= 400) {
    // Salvage the model's intended output from `failed_generation` (tool_use_failed, etc.).
    try {
      const fg = JSON.parse(res.text)?.error?.failed_generation;
      if (fg && String(fg).trim()) {
        try {
          const obj = JSON.parse(fg);
          if (obj && obj.arguments) return JSON.stringify(obj.arguments);
        } catch {}
        return String(fg);
      }
    } catch {}
    if (res.status === 429)
      throw new Error('Rate limit reached on the free tier. Wait a minute and try again, or switch model/provider in .env.');
    throw new Error(`LLM API ${res.status}: ${String(res.text).slice(0, 400)}`);
  }

  let content = '';
  try { content = JSON.parse(res.text).choices?.[0]?.message?.content ?? ''; } catch {}

  // Empty generation under JSON mode — retry once without it.
  if ((!content || !content.trim()) && jsonMode) {
    const r2 = await call(false);
    if (r2.status < 400) {
      try { content = JSON.parse(r2.text).choices?.[0]?.message?.content ?? content; } catch {}
    }
  }

  return content;
}
