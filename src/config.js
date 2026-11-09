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
  const jsonMode = (process.env.LLM_JSON_MODE ?? 'true') !== 'false';
  return { apiKey, baseUrl, model, jsonMode };
}
