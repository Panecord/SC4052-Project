# CloneMe — Personal Assistant-as-a-Service

Your AI-powered digital clone. CloneMe decomposes personal assistant capabilities into independent microservices (email, calendar, trends, code generation) orchestrated by a Claude AI agent. Describe a task in plain English and CloneMe acts on it across your digital life.

---

## Features

- **AI Chat** — agentic Claude loop with real-time SSE streaming, tool-call cards, per-tab conversation history, and max-tokens continuation
- **Email** — Gmail (OAuth2), Outlook, and Yahoo Mail (IMAP); search, read, summarise
- **Calendar** — Google Calendar 7-day view with AI-powered event creation
- **Trends** — live aggregation from Mastodon, HackerNews, GitHub, Reddit, and YouTube
- **Vibe-Coding** — describe an app → Claude generates code → private GitHub repo created → local preview served instantly
- **Build History** — SQLite-backed project registry; view, preview, and delete all AI-generated repositories with their original prompts
- **Research Pipeline** — web search + webpage reader to inform builds before code generation

---

## Prerequisites

- Python 3.10+
- API keys: Anthropic (required), GitHub (for builds), Google OAuth (email + calendar), Mastodon (optional), YouTube (optional)

---

## Setup

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd CloneMe
```

### 2. Create a virtual environment and install dependencies

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 3. Configure environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) — scopes: `repo` |
| `GITHUB_USERNAME` | Your GitHub username |
| `GOOGLE_CLIENT_ID/SECRET` | [console.cloud.google.com](https://console.cloud.google.com/) — enable Gmail + Calendar APIs, create OAuth2 Web credentials, add `http://localhost:5000/api/google/callback` as a redirect URI |
| `MASTODON_ACCESS_TOKEN` | `https://<your-instance>/settings/applications` — scopes: `read:statuses write:statuses` |
| `YOUTUBE_API_KEY` | [console.cloud.google.com](https://console.cloud.google.com/) — enable YouTube Data API v3 |
| `FLASK_SECRET_KEY` | Any random string — generate with `python -c "import secrets; print(secrets.token_hex(32))"` |

> All keys except `ANTHROPIC_API_KEY` are optional — the app runs without them (those features just won't be available).

> **Never commit your `.env` file.** It is already listed in `.gitignore`.

---

## Running the app

```bash
python app.py
# or double-click start.bat on Windows
```

Then open:

```
http://localhost:5000
```

---

## How it works

1. **Chat** — type any request. CloneMe routes it to the right service automatically.
2. **Blueprint phase** (for build requests) — Claude Haiku analyses your request and shows a plan. Confirm to build.
3. **Build phase** — Claude generates all source files, creates a private GitHub repo, pushes the code, and saves a local preview.
4. **Results** — live preview URL, GitHub repo link, and full source appear in the Output panel.
5. **Follow-ups** — each tab keeps conversation history, so "make it better" or "add dark mode" works in context.

If a response hits the token limit, a **Continue →** button appears to resume seamlessly.

---

## Project structure

```
CloneMe/
├── app.py              # Flask backend + Claude agentic loop
├── requirements.txt
├── .env.example        # Copy to .env and fill in your keys
├── .gitignore
├── cloneme.db          # SQLite project registry (auto-created on first run)
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── state.js
│   ├── utils.js
│   ├── chat.js         # SSE consumer, tool cards, history, continue flow
│   ├── email.js
│   ├── calendar.js
│   ├── trends.js
│   ├── tasks.js
│   └── app.js
└── previews/           # Auto-created — locally served AI-generated apps
```

---

## Troubleshooting

**Red health dot in the header** — the API key for that service is missing or invalid. Check your `.env` file and restart the server.

**Port already in use** — run on a different port:
```bash
flask run --port 5001
```

**`ModuleNotFoundError`** — make sure your virtual environment is activated before running.

**Exchange Online / NTU email not working** — Microsoft has disabled Basic Auth for Exchange Online. Outlook personal accounts work; school/corporate accounts require OAuth2 Modern Auth (not yet implemented).
