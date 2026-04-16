# OpenClaw — PA-as-a-Service

An agentic app builder powered by Claude. Describe an app, and OpenClaw generates the code, pushes it to a private GitHub repo, serves a live local preview, and posts an announcement to Mastodon.

---

## Prerequisites

- Python 3.10+
- API keys for Anthropic, GitHub, and Mastodon (details below)

---

## Setup

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd openclaw
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

Open `.env` and set each value:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) — scopes: `repo` |
| `GITHUB_USERNAME` | Your GitHub username |
| `MASTODON_ACCESS_TOKEN` | `https://<your-instance>/settings/applications` — scopes: `write:statuses`, `read:statuses` |
| `MASTODON_API_BASE_URL` | Your Mastodon instance URL, e.g. `https://mastodon.social` |

> Mastodon is optional. The app builds and deploys without it if the token is left blank.

---

## Running the app

```bash
python app.py
```

Then open your browser at:

```
http://localhost:5000
```

The Flask server serves the frontend automatically — no separate frontend build step needed.

---

## How it works

1. **Describe your app** in the chat input (or pick an idea from the left sidebar).
2. **Blueprint phase** — Claude Haiku analyses your request and shows a plan (features, tech stack, complexity). Confirm to proceed.
3. **Build phase** — Claude Sonnet generates all source files, creates a private GitHub repo, pushes the code, and saves a local preview.
4. **Results** — live preview URL, GitHub repo link, and full source appear in the Output panel on the right.

---

## Project structure

```
openclaw/
├── app.py              # Flask backend + Claude agentic loop
├── requirements.txt
├── .env.example
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── previews/           # Auto-created — stores built apps for local preview
```

---

## Troubleshooting

**Red health dot in the header** — the corresponding API key is missing or invalid. Check your `.env` file and restart the server.

**Port already in use** — run on a different port:
```bash
flask run --port 5001
```

**`ModuleNotFoundError`** — make sure your virtual environment is activated before running.
