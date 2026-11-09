# Contributing to Scout

Thanks for your interest in improving **Scout**, the open-source AI browser agent! Issues and pull requests are welcome.

## The one hard rule

**No credential extraction, ever.** Scout gets logged-in sessions by operating a real browser the user controls — it never reads or decrypts Chrome's cookie store or password store. PRs that add cookie/password-store extraction, or that exfiltrate sessions anywhere, will be closed. This is the core principle of the project.

Also: **don't add bot-detection evasion.** Scout avoids sites that block automation and hands CAPTCHAs to the human; it does not try to defeat them.

## Getting set up

```bash
git clone https://github.com/soheltanvir0699/scout-ai-browser-agent.git
cd scout-ai-browser-agent
npm install
cp .env.example .env     # add a free Groq key from https://console.groq.com/keys
npm run ui               # http://localhost:3000
```

Requirements: Node.js 18+ and Google Chrome installed.

## Project layout

| Area | Where |
|------|-------|
| Chatbot UI | `public/index.html` |
| Web server + event stream | `server.js` |
| CLI | `index.js` |
| Agent loop (observe → decide → act) | `src/agent.js` |
| Page snapshot | `src/observe.js` |
| Action execution | `src/actions.js` |
| LLM client | `src/llm.js` |
| Config (providers) | `src/config.js` |

## Good first contributions

- **New LLM providers** — anything OpenAI-compatible works via `.env`; add docs/examples for more.
- **Better action robustness** — dropdowns, file uploads, iframes, shadow DOM.
- **Smarter page observation** — richer element labels, better text extraction.
- **UI polish** — accessibility, mobile layout, keyboard shortcuts.
- **Reliability on tricky sites** — strategies that help the agent finish faster.

## Pull request guidelines

1. Keep changes focused; one logical change per PR.
2. Match the existing code style (plain modern JS, no build step, minimal dependencies).
3. Test your change by running a few real tasks through `npm run ui`.
4. Describe **what** changed and **why**, and include a before/after note or screenshot for UI changes.
5. Never commit `.env`, API keys, or anything under `.agent-profile/` (all git-ignored).

## Reporting bugs

Open an issue with the steps to reproduce, the task you gave Scout, your provider/model, and what happened vs. what you expected. The step log from the UI is very helpful.

Thanks for helping make Scout better! ⭐
