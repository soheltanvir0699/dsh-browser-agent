import 'dotenv/config';

/**
 * Provider-neutral config. Point LLM_BASE_URL at any OpenAI-compatible endpoint:
 *   - Local Ollama:   http://localhost:11434/v1   (free, offline)
 *   - DeepSeek:        https://api.deepseek.com
 *   - Groq / Gemini / OpenRouter free tiers, etc.
 * Falls back to the older DEEPSEEK_* vars for backward compatibility.
 */
export function loadConfig() {
  const apiKey =
    process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || 'ollama'; // Ollama ignores the key
  const baseUrl =
    process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  // Default OFF: strict JSON mode makes reasoning models (gpt-oss) 400 when they
  // answer in prose. We keep it off and parse tolerantly instead. Set
  // LLM_JSON_MODE=true only for providers where it helps (e.g. DeepSeek).
  const jsonMode = (process.env.LLM_JSON_MODE ?? 'false') === 'true';
  // Run the browser invisibly (no window). Logins/CAPTCHAs can't be solved in
  // headless, so it suits already-logged-in profiles (e.g. after import-profile).
  const headless = (process.env.HEADLESS ?? 'false') === 'true';

  // Optional VISION model, used only when the agent gets stuck: it screenshots
  // the page and asks a vision model what to do next. Needs a vision-capable
  // model (Gemini free tier works; Groq gpt-oss does not). If VISION_API_KEY is
  // unset, Scout reuses the main provider only if it already looks vision-capable.
  const visionKey = process.env.VISION_API_KEY || '';
  const visionBaseUrl =
    process.env.VISION_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
  const visionModel = process.env.VISION_MODEL || 'gemini-2.0-flash';
  const mainIsVision = /gemini|gpt-4|llama-4|scout|maverick|vision|pixtral|qwen.*vl/i.test(model);
  const vision = visionKey
    ? { apiKey: visionKey, baseUrl: visionBaseUrl, model: visionModel }
    : mainIsVision
    ? { apiKey, baseUrl, model }
    : null;

  return { apiKey, baseUrl, model, jsonMode, headless, vision };
}
