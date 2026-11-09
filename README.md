# 🧭 Browser Agent

An open-source **AI browser agent** with a chatbot UI. Describe a task in plain language and it drives a **real Chrome window** to do it — searching, clicking, filling forms, reading pages — step by step, while you watch the live progress.

Powered by any OpenAI-compatible model. Works great with **free providers** like Groq and Google Gemini, or a local model via Ollama.

> **Privacy by design:** the agent operates *inside* a real, logged-in browser session the same way you do. It **never extracts or decrypts** your cookies or saved passwords. You log into sites yourself (once) and the session persists — there is no credential-harvesting code in this repo, and PRs adding any will not be accepted.

---

## ✨ Features

- 💬 **Chatbot UI** — type a task, watch the agent think and act in real time
- 🔴 **Live work status** — see *Reading → Thinking → Acting* with a step-by-step log
- 🌐 **Drives real Chrome** — uses your installed Chrome, follows new tabs, recovers from errors
- 🧠 **Any model** — Groq, Gemini, DeepSeek, OpenAI, or a local Ollama model (one `.env` change)
- ✅ **Human-in-the-loop** — approve each action, or run in Auto mode
- 🔒 **No credential theft** — logins are yours, done in a real browser; nothing is harvested
- 🪶 **Tiny footprint** — flat token usage per step (stays within free-tier rate limits)

---

## 🚀 Quick start

### 1. Requirements
- [Node.js](https://nodejs.org) 18+
- [Google Chrome](https://www.google.com/chrome/) installed

### 2. Install
```bash
git clone https://github.com/soheltanvir0699/dsh-browser-agent.git
cd dsh-browser-agent
npm install
```

### 3. Add a model (free)
```bash
cp .env.example .env
```
Open `.env` and set a provider. **Groq is free, fast, and recommended:**

1. Get a free key (no credit card) at **https://console.groq.com/keys**
2. Put it in `.env`:
   ```env
   LLM_BASE_URL=https://api.groq.com/openai/v1
   LLM_API_KEY=gsk_your_key_here
   LLM_MODEL=openai/gpt-oss-120b
   ```

<details>
<summary>Other free / local providers</summary>

**Google Gemini** (free): key at https://aistudio.google.com/apikey
```env
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=your_gemini_key
LLM_MODEL=gemini-2.0-flash
```

**Local Ollama** (offline, free — needs decent RAM/CPU):
```env
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:3b
```
</details>

### 4. Run the chatbot UI
```bash
npm run ui
```
Open **http://localhost:3000**, type an instruction, and hit **Run**. A real Chrome window opens and the agent gets to work.

> Groq model names change over time. If you see *"model does not exist"*, list what your key can use:
> `curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $LLM_API_KEY"`

---

## 🖥️ CLI (no UI)

```bash
# ask once
node index.js --task "search the weather in Dhaka and tell me the forecast"

# start on a page, auto-approve every action
node index.js --url https://news.ycombinator.com --auto --task "summarize the top 3 stories"
```
Without `--auto`, it asks before each action (Enter = yes, `n` = skip, `q` = quit).

---

## 🔑 Logging into sites

The agent uses a **dedicated Chrome profile** (`.agent-profile/`, created on first run), separate from your main Chrome. The first time a task needs a login, log in manually in the open window — the session is saved and reused next time. Chrome's own password manager autofills; the agent just submits.

> **Want your main profile's logins?** You can attach to a Chrome you start with `--remote-debugging-port=9222` and tick *"Use my main Chrome"* in the UI. Note: Chrome 136+ blocks remote debugging on the default profile for security, so the dedicated profile above is the recommended path.

---

## ⚙️ How it works

```
Your logged-in Chrome  ──►  observe page (interactive elements + ids)
        ▲                              │
        │                              ▼
   run action  ◄──  LLM picks ONE action (click / type / navigate / done)
```

Each step sends the model a small prompt — the task, a short history, and only the *current* page — then executes the single action it returns, until the task is `done`.

| File | Purpose |
|------|---------|
| `server.js` | Web server + live event stream (SSE) for the UI |
| `public/index.html` | The chatbot UI |
| `index.js` | CLI entry point |
| `src/browser.js` | Launch dedicated profile / attach over CDP |
| `src/observe.js` | Snapshot the page into a model-friendly element list |
| `src/actions.js` | Execute one action |
| `src/agent.js` | The observe → decide → act loop |
| `src/llm.js` | OpenAI-compatible model call (with retry) |
| `src/config.js` | Provider-neutral configuration |

---

## 🤝 Contributing

Issues and PRs welcome. Please keep the core principle intact: **no cookie-store or password-store extraction** — the agent gets logged-in sessions by operating a real browser you control, not by reading Chrome's encrypted stores.

## 📄 License

[MIT](LICENSE) © Sohel Rana
