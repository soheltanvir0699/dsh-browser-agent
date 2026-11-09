# 🧭 Scout — Open-Source AI Browser Agent

> **Scout is a free, open-source AI browser agent that controls a real web browser to complete tasks you describe in plain English.** Tell it what to do — *"summarize my latest emails", "list the top 3 trending GitHub repos", "find wireless earbuds under $30"* — and Scout drives your real Chrome to read pages, click, fill forms, and use your own logged-in sessions, then brings back a clean answer. Powered by free LLMs (Groq, Google Gemini, or local Ollama) with a chatbot UI.

**Keywords:** AI browser agent · browser automation with AI · LLM web agent · autonomous web automation · Playwright AI agent · computer use agent · agentic browsing · open-source browser-use alternative · ChatGPT-style browser automation.

<p>
  <img alt="open source" src="https://img.shields.io/badge/open%20source-MIT-3c7d52">
  <img alt="node" src="https://img.shields.io/badge/Node.js-18%2B-c15f3c">
  <img alt="llm" src="https://img.shields.io/badge/LLM-Groq%20%7C%20Gemini%20%7C%20Ollama-5b5bd6">
</p>

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
git clone https://github.com/soheltanvir0699/scout-ai-browser-agent.git
cd scout-ai-browser-agent
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
   LLM_MODEL=openai/gpt-oss-20b
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

## 🔑 Using your logged-in sessions (sites that need sign-in)

Scout runs in a **dedicated Chrome profile** (`.agent-profile/`, git-ignored), separate from your everyday Chrome. There are two ways to be logged in — pick either.

### Option 1 — Sign in once (recommended, nothing copied)
Just run a task. The first time Scout hits a login page it **pauses and shows a "🔑 Sign-in needed" card**. Sign in **once** in the open Chrome window (use **"Sign in with Google"** where offered) and click **"I've signed in"**. The session is saved in the profile and **reused automatically forever** after. Do this once per site.

### Option 2 — Import your existing Chrome logins
Copy your real Chrome sessions into Scout so it starts already logged in:

```bash
# 1. Fully QUIT Chrome (Cmd+Q — no Chrome left running)
# 2. Import:
npm run import-profile
# 3. Start Scout (leave "Use my main Chrome" UNCHECKED):
npm run ui
```

On first launch, Chrome may ask to use **"Chrome Safe Storage"** from your keychain — click **Allow** (that's how it decrypts *its own* cookies). Most sites come over logged in. **Gmail/Google may still re-auth once** because Google now binds sessions to the device (DBSC); after you sign in once, it persists.

### Why it copies instead of reading your live browser
Silently reading and decrypting a running browser's cookie/password store is exactly how credential-stealing malware works — so Scout never does that. Instead:
- **Option 1** signs in through a real browser you control.
- **Option 2** copies your profile locally; **Chrome itself** decrypts its own cookies via your keychain. Scout never reads or decrypts a credential, and nothing leaves your machine (`.agent-profile/` is git-ignored).

> **Note on "Use my main Chrome" (CDP):** attaching over `--remote-debugging-port=9222` exists, but **Chrome 136+ blocks remote debugging on your main profile** for security, so it can't carry your real logins. Use Option 1 or 2 instead.

### A note on CAPTCHAs
Scout avoids Google Search (it blocks automation) and prefers DuckDuckGo or going directly to the target site. If a human-verification page still appears, Scout **pauses and asks you to solve it** in the window, then continues. It never tries to bypass a bot check.

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
| `public/index.html` | The chatbot UI (Markdown rendering via vendored marked + DOMPurify) |
| `index.js` | CLI entry point |
| `import-profile.js` | Copy your Chrome logins into the agent profile |
| `src/browser.js` | Launch dedicated profile / attach over CDP |
| `src/observe.js` | Snapshot the page: visible text + interactive elements |
| `src/actions.js` | Execute one action (robust click/type) |
| `src/agent.js` | The observe → decide → act loop (login/CAPTCHA handoff, loop guard) |
| `src/llm.js` | OpenAI-compatible model call (JSON-mode fallback + retry) |
| `src/config.js` | Provider-neutral configuration |

---

## 🩺 Troubleshooting

| Problem | Fix |
|---|---|
| **`json_validate_failed` / "Failed to generate JSON"** | Set `LLM_JSON_MODE=false` in `.env` (default). Reasoning models like `gpt-oss` answer in prose; strict JSON mode rejects it. |
| **`model does not exist`** (Groq) | Model names change. List yours: `curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $LLM_API_KEY"` and update `LLM_MODEL`. |
| **Task hangs or is very slow** | Use a fast model. `openai/gpt-oss-20b` is quick on large pages; `gpt-oss-120b` can stall on big prompts. Set it in the ⚙ settings or `.env`. |
| **Rate limit (429)** | Free-tier limit — wait a minute, or switch model/provider in `.env`. |
| **Raw Markdown shown in chat** | Hard-refresh the page (**Cmd/Ctrl + Shift + R**) to clear the cached old page. |
| **Not logged into a site** | Use sign-in handoff (Option 1) or `npm run import-profile` (Option 2) above. |
| **Port 3000 busy** | `PORT=4000 npm run ui`. |

---

## 💡 Use cases

- **Inbox & chat triage** — summarize your latest Gmail, Discord, or Slack messages
- **Research & monitoring** — pull trending GitHub repos, Hacker News, prices, docs
- **Shopping & comparison** — search products and compare prices across sites
- **Web automation without code** — fill forms, search, click through flows in plain English
- **Personal assistant on logged-in apps** — check notifications on X, LinkedIn, YouTube
- **A free, local alternative** to paid AI browser agents and computer-use tools

---

## ❓ FAQ

### What is Scout?
Scout is an **open-source AI browser agent**: a tool that uses a large language model (LLM) to control a real web browser and complete tasks you describe in natural language, such as reading pages, clicking, filling forms, and extracting information.

### Is Scout free?
Yes. Scout is MIT-licensed and open source, and it runs on **free LLM providers** — Groq (`gpt-oss`), Google Gemini's free tier, or a fully local model via Ollama. No paid API is required.

### How is Scout different from Selenium or Playwright scripts?
Selenium/Playwright need you to write code for every step. Scout takes a **plain-English instruction** and an LLM decides each action on the fly, adapting to the page — no selectors or scripts to maintain.

### How is it different from Browser Use, or OpenAI/Anthropic computer use?
Scout is a lightweight, self-hostable, open-source alternative. It drives your **own installed Chrome** with your **own logged-in sessions**, runs on free models, and keeps everything local. There's no cloud dependency and no per-task fee.

### Does Scout steal my cookies or passwords?
No. Scout **never reads or decrypts** your browser's cookie or password store. You either sign in once in the agent's window (the session then persists), or import a local copy of your profile that **Chrome itself** decrypts. Nothing is sent anywhere except the page text the model needs to pick the next action.

### Which AI models does Scout support?
Any OpenAI-compatible endpoint: **Groq**, **Google Gemini**, **DeepSeek**, **OpenAI**, or local **Ollama** models (Qwen, Llama, etc.). Switch with one line in `.env` or the in-app settings.

### Does it work with sites that require login (Gmail, Discord, X, LinkedIn)?
Yes. When Scout hits a sign-in page it pauses and lets you log in once; the session is saved and reused. See *Using your logged-in sessions* above.

### What do I need to run it?
Node.js 18+, Google Chrome, and a free Groq API key. Then `npm install` and `npm run ui`.

---

## 🤝 Contributing

Issues and PRs welcome. Please keep the core principle intact: **no cookie-store or password-store extraction** — the agent gets logged-in sessions by operating a real browser you control, not by reading Chrome's encrypted stores.

If Scout is useful to you, a ⭐ on GitHub helps others discover it.

## 📄 License

[MIT](LICENSE) © Sohel Rana
