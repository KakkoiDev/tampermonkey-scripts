<!--
Tampermonkey Scripts - talk deck. Plain markdown; slides split on `---`.
Built with Marp: `sh build.sh` (or `npx --yes @marp-team/marp-cli deck.md -o deck.html`).
Renders in any markdown viewer too.
-->

# Tampermonkey Scripts

## Vibe code features into your favorite websites

Add or fix features on any site you use - just by chatting with an AI.

`github.com/KakkoiDev/tampermonkey-scripts`

---

# The problem

Using the web can be frustrating:

- Sites have bugs.
- Features you want are missing.
- The features that exist don't fit your workflow.

You don't own the site, so normally you just live with it.

---

# The solution

**Tampermonkey + AI.**

Tampermonkey is a browser extension that runs your own JavaScript on any page. AI writes that JavaScript for you.

So you add or change features on the fly - just by chatting with an agent. No waiting on the site's team.

---

# How it works

1. Describe the feature you want to an AI agent.
2. It writes a **userscript** (a small `.user.js` file).
3. Paste it into Tampermonkey.
4. It runs automatically on the sites you told it to match.

Edit the file, reload the page, see the change live. No build step.

---

# Pros / Cons

| Pros | Cons |
|---|---|
| Add almost any feature you can think of | Only works in the browser (not native apps) |
| Easier than building a real extension | One-time setup takes 10-30 min |
| Runs live - edit, reload, done | You maintain it when the site changes |

:warning: Careful what you create - it runs with your logged-in access.

---

# Safety

A userscript runs **as you**, on your logged-in session.

- It can read and change anything on the page - Slack, Gmail, GitHub.
- Some scripts send data out - e.g. AI Translate posts message text to an AI API.
- AI-generated code is not automatically safe. Read it before you trust it.

Rule of thumb: read a script before you run it. If it sends data out (like AI Translate does), use a **local** model for sensitive text.

---

# Demo

- **Git:** load all comments
- **Git:** copy diff
- **Git:** copy title + link
- **Slack:** double-click to edit
- **Slack:** todo list
- **Slack:** delete unfurl
- **Slack:** AI translate (works with a local AI model)

---

# Demo 2

Build one, live:

- Create a new script from scratch (chat -> userscript).
- Release it to Greasy Fork.

---

# Try it

Everything is here, ready to install:

`github.com/KakkoiDev/tampermonkey-scripts`

1. Install the **Tampermonkey** browser extension.
2. Open the repo, click any script's **Greasy Fork** link, hit **Install**.
3. Want to build your own? See "Build your own" in the README.

---

# Have fun!

Questions?

`github.com/KakkoiDev/tampermonkey-scripts`
