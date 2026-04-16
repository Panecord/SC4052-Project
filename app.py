"""
CloneMe — Your Digital Clone
Personal Assistant-as-a-Service (PAaS)

Decomposed services communicating via RESTful APIs:
  • AI Agent service   — /api/chat, /api/clarify
  • Email service      — /api/gmail/*
  • Calendar service   — /api/calendar/*
  • Trends service     — /api/trends, /api/inspirations
  • Tasks service      — /api/tasks
  • Repo/deploy service— uses GitHub + Mastodon tools
"""

from flask import Flask, request, Response, send_from_directory, jsonify, redirect, session
from flask_cors import CORS
import anthropic
import json
import logging
import os
import re
import time
import base64
import threading
import imaplib
import email as email_lib
from email.header import decode_header as _decode_header
import uuid
import requests as req_lib
import httpx
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
import pathlib
import html

try:
    from ddgs import DDGS as _DDGS
    DDG_AVAILABLE = True
except ImportError:
    try:
        from duckduckgo_search import DDGS as _DDGS  # older package name
        DDG_AVAILABLE = True
    except ImportError:
        DDG_AVAILABLE = False

# ── Logging setup ─────────────────────────────────────────────────────────────
import sys as _sys

# Force stdout to flush after every line regardless of how python is invoked
_sys.stdout.reconfigure(line_buffering=True)
_sys.stderr.reconfigure(line_buffering=True)

_LOG_FILE = pathlib.Path(__file__).parent / "cloneme.log"
_fmt = logging.Formatter("%(asctime)s [CloneMe] %(levelname)-5s  %(message)s", datefmt="%H:%M:%S")

class _FlushHandler(logging.StreamHandler):
    def emit(self, record):
        super().emit(record)
        self.flush()

_sh = _FlushHandler(_sys.stderr)   # stderr — same stream Flask uses
_sh.setFormatter(_fmt)

_fh = logging.FileHandler(_LOG_FILE, encoding="utf-8")
_fh.setFormatter(_fmt)

logging.root.setLevel(logging.INFO)
logging.root.handlers = [_sh, _fh]

logging.getLogger("werkzeug").setLevel(logging.INFO)
log = logging.getLogger("cloneme")

# ── Optional Google libraries ─────────────────────────────────────────────────
try:
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from google.auth.transport.requests import Request as GoogleRequest
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False

load_dotenv(pathlib.Path(__file__).parent / ".env", override=True)

app = Flask(__name__, static_folder="frontend")
# Secret key required for Flask session (stores OAuth code_verifier between /auth and /callback)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "cloneme-dev-secret-change-in-prod")
CORS(app)

# ── Config ────────────────────────────────────────────────────────────────────
_anthropic      = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
GITHUB_TOKEN    = os.getenv("GITHUB_TOKEN", "")
GITHUB_USERNAME = os.getenv("GITHUB_USERNAME", "")
MASTODON_TOKEN  = os.getenv("MASTODON_ACCESS_TOKEN", "")
MASTODON_BASE   = os.getenv("MASTODON_API_BASE_URL", "https://mastodon.social")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")
GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

BASE_DIR     = pathlib.Path(__file__).parent
PREVIEWS_DIR = BASE_DIR / "previews"
TOKENS_FILE  = BASE_DIR / "google_tokens.json"
IMAP_FILE    = BASE_DIR / "imap_accounts.json"
BUILDS_FILE  = BASE_DIR / "builds.json"
PREVIEWS_DIR.mkdir(exist_ok=True)

IMAP_SERVERS = {
    "outlook": {"server": "imap-mail.outlook.com", "port": 993},
    "yahoo":   {"server": "imap.mail.yahoo.com",   "port": 993},
}

# Startup config summary
log.info("─" * 50)
log.info("CloneMe starting up")
log.info("  Anthropic key : %s", "✓ set" if os.getenv("ANTHROPIC_API_KEY") else "✗ MISSING")
log.info("  GitHub        : %s", "✓ set" if os.getenv("GITHUB_TOKEN") else "✗ not set")
log.info("  Mastodon      : %s", "✓ set" if os.getenv("MASTODON_ACCESS_TOKEN") else "✗ not set")
log.info("  YouTube key   : %s", "✓ set" if os.getenv("YOUTUBE_API_KEY") else "✗ not set")
log.info("  Google OAuth  : %s", "✓ set" if (os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET")) else "✗ not configured")
log.info("  Google libs   : %s", "✓ available" if GOOGLE_AVAILABLE else "✗ not installed")
log.info("  Tokens file   : %s", "✓ exists" if TOKENS_FILE.exists() else "✗ not found (not yet connected)")
log.info("─" * 50)

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

ALLOWED_MODELS = {"claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"}
DEFAULT_MODEL  = "claude-haiku-4-5-20251001"

# ── Background task queue ─────────────────────────────────────────────────────
_tasks: dict[str, dict] = {}
_tasks_lock = threading.Lock()

# ── Truncated-session store (max_tokens continuations) ────────────────────────
_truncated_sessions: dict[str, dict] = {}
_truncated_lock = threading.Lock()

def _new_task(name: str, description: str) -> str:
    tid = str(uuid.uuid4())[:8]
    with _tasks_lock:
        _tasks[tid] = {
            "id": tid, "name": name, "description": description,
            "status": "running",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None, "result": None,
        }
    return tid

def _finish_task(tid: str, status: str, result=None):
    with _tasks_lock:
        if tid in _tasks:
            _tasks[tid]["status"] = status
            _tasks[tid]["result"] = result
            _tasks[tid]["completed_at"] = datetime.now(timezone.utc).isoformat()

def _get_google_creds():
    if not GOOGLE_AVAILABLE:
        log.warning("Google libs not available")
        return None
    if not TOKENS_FILE.exists():
        log.debug("No tokens file — Google not connected yet")
        return None
    try:
        data = json.loads(TOKENS_FILE.read_text())
        creds = Credentials(
            token=data.get("token"),
            refresh_token=data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=GOOGLE_CLIENT_ID,
            client_secret=GOOGLE_CLIENT_SECRET,
            scopes=GOOGLE_SCOPES,
        )
        # If expired (or no access token) try refreshing with the refresh token
        if (creds.expired or not creds.token) and creds.refresh_token:
            log.info("Google token expired — refreshing…")
            creds.refresh(GoogleRequest())
            TOKENS_FILE.write_text(json.dumps({
                "token":         creds.token,
                "refresh_token": creds.refresh_token,
                "email":         data.get("email", ""),
            }))
            log.info("Google token refreshed successfully")
        if creds.valid:
            return creds
        # Token present but no expiry info — treat as valid if we have a token
        if creds.token and not creds.expired:
            return creds
        log.error("Credentials not valid: token=%s  expired=%s", bool(creds.token), creds.expired)
        return None
    except Exception as ex:
        log.error("_get_google_creds error: %s", ex)
        return None

# ── Tool definitions ──────────────────────────────────────────────────────────
TOOLS = [
    # ── Repo & deploy tools
    {
        "name": "create_github_repo",
        "description": "Create a new PRIVATE GitHub repository. Call before pushing any files.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Repo name in kebab-case"},
                "description": {"type": "string"},
            },
            "required": ["name", "description"],
        },
    },
    {
        "name": "push_files_to_repo",
        "description": (
            "Push all source files to GitHub AND save locally for preview. "
            "Batch ALL files (index.html, style.css, app.js, README.md) in one call."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "repo_name": {"type": "string"},
                "files": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"},
                            "content": {"type": "string"},
                        },
                        "required": ["path", "content"],
                    },
                },
                "commit_message": {"type": "string", "default": "feat: initial commit"},
            },
            "required": ["repo_name", "files"],
        },
    },
    {
        "name": "post_to_mastodon",
        "description": "Post an announcement to Mastodon with hashtags.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "Post text, max 500 chars"},
            },
            "required": ["status"],
        },
    },
    # ── Email tools
    {
        "name": "get_email_inbox",
        "description": (
            "Fetch the user's Gmail inbox. Returns emails with sender, subject, date, and snippet. "
            "Use this to answer questions about the user's emails or to summarize their inbox."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "max_results": {"type": "integer", "default": 10},
                "query": {
                    "type": "string",
                    "description": "Gmail search query, e.g. 'is:unread', 'from:boss@company.com'",
                },
            },
        },
    },
    # ── Calendar tools
    {
        "name": "get_calendar_events",
        "description": "Fetch upcoming events from Google Calendar.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days_ahead": {"type": "integer", "default": 7, "description": "How many days ahead"},
            },
        },
    },
    {
        "name": "create_calendar_event",
        "description": "Create a new event in Google Calendar.",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Event title"},
                "description": {"type": "string"},
                "start_datetime": {"type": "string", "description": "ISO 8601, e.g. '2026-04-16T14:00:00'"},
                "end_datetime":   {"type": "string", "description": "ISO 8601"},
                "timezone": {"type": "string", "default": "Asia/Singapore"},
            },
            "required": ["summary", "start_datetime", "end_datetime"],
        },
    },
    # ── Trends tool
    {
        "name": "fetch_trends",
        "description": (
            "Fetch trending content from social media and tech platforms. "
            "Use this to analyse what's popular right now and provide insights."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "enum": ["mastodon", "hackernews", "github", "youtube", "reddit", "all"],
                    "description": "Platform to fetch trends from",
                },
            },
            "required": ["source"],
        },
    },
    # ── Research tools (enhance the trends → build pipeline)
    {
        "name": "web_search",
        "description": (
            "Search the web for information. Use this to research a trending topic before building "
            "an app, look up best practices, or find inspiration. Returns titles, URLs, and snippets."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query":       {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer", "default": 6, "description": "Number of results (max 10)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_webpage",
        "description": (
            "Fetch and read the text content of any URL — an HN article, GitHub README, Reddit post, "
            "or any source_url from the trends feed. Use this to understand what to build before "
            "starting, or to gather context for a more accurate app."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url":       {"type": "string", "description": "The URL to fetch"},
                "max_chars": {"type": "integer", "default": 4000, "description": "Max characters to return"},
            },
            "required": ["url"],
        },
    },
    {
        "name": "star_github_repo",
        "description": (
            "Star a GitHub repository on the user's behalf. Use when the user asks to star a repo "
            "they found in the GitHub trending feed, e.g. 'star this repo for me'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "repo_full_name": {
                    "type": "string",
                    "description": "Repository in 'owner/repo' format, e.g. 'vercel/next.js'",
                },
            },
            "required": ["repo_full_name"],
        },
    },
]

# ── GitHub service ────────────────────────────────────────────────────────────
def _gh(method: str, path: str, **kw) -> req_lib.Response:
    return getattr(req_lib, method)(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"token {GITHUB_TOKEN}",
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=20, **kw,
    )

# ── Build registry helpers ────────────────────────────────────────────────────
def _load_builds() -> list:
    if BUILDS_FILE.exists():
        try:
            return json.loads(BUILDS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []

def _save_builds(builds: list):
    BUILDS_FILE.write_text(json.dumps(builds, indent=2), encoding="utf-8")

def _upsert_build(repo_name: str, patch: dict, defaults: dict = None):
    """Update an existing build record or insert a new one.
    `patch` always overwrites. `defaults` only apply when creating a new record."""
    builds = _load_builds()
    for b in builds:
        if b.get("repo_name") == repo_name:
            b.update(patch)
            _save_builds(builds)
            return
    new_entry = {"repo_name": repo_name, **(defaults or {})}
    new_entry.update(patch)
    builds.insert(0, new_entry)
    _save_builds(builds)

# ── GitHub tool functions ─────────────────────────────────────────────────────
def _tool_create_github_repo(name: str, description: str) -> dict:
    import random, string
    candidates = [name] + [f"{name}-{random.randint(2, 99)}" for _ in range(4)]
    for candidate in candidates:
        r = _gh("post", "/user/repos", json={
            "name": candidate, "description": description, "private": True, "auto_init": True,
        })
        if r.status_code == 201:
            d = r.json()
            _upsert_build(candidate, {
                "description": description,
                "repo_url":    d["html_url"],
                "full_name":   d["full_name"],
                "created_at":  datetime.now(timezone.utc).isoformat(),
                "status":      "creating",
                "files_count": 0,
            })
            return {"success": True, "repo_url": d["html_url"], "full_name": d["full_name"],
                    "repo_name": candidate}
        if r.status_code == 422 and "already exists" in r.text:
            continue  # try next candidate
        return {"success": False, "error": f"HTTP {r.status_code}: {r.text[:300]}"}
    return {"success": False, "error": f"Could not find an available name for '{name}'"}

def _tool_push_files_to_repo(
    repo_name: str, files: list, commit_message: str = "feat: initial commit"
) -> dict:
    results = []
    for f in files:
        path, content = f["path"], f["content"]
        api_path = f"/repos/{GITHUB_USERNAME}/{repo_name}/contents/{path}"
        existing = _gh("get", api_path)
        payload  = {
            "message": commit_message,
            "content": base64.b64encode(content.encode()).decode(),
        }
        if existing.status_code == 200:
            payload["sha"] = existing.json()["sha"]
        r = _gh("put", api_path, json=payload)
        results.append({
            "path":    path,
            "success": r.status_code in (200, 201),
            "url":     r.json().get("content", {}).get("html_url", "")
                       if r.status_code in (200, 201) else "",
            "error":   "" if r.status_code in (200, 201) else r.text[:150],
        })
    # Save locally for instant preview
    preview_dir = PREVIEWS_DIR / repo_name
    preview_dir.mkdir(parents=True, exist_ok=True)
    for f in files:
        dest = preview_dir / f["path"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(f["content"], encoding="utf-8")
    ok = sum(1 for r in results if r["success"])
    # Update build registry
    _upsert_build(
        repo_name,
        patch={
            "repo_url":    f"https://github.com/{GITHUB_USERNAME}/{repo_name}",
            "status":      "ready" if ok > 0 else "error",
            "files_count": ok,
            "pushed_at":   datetime.now(timezone.utc).isoformat(),
            "preview_url": f"/preview/{repo_name}/",
        },
        defaults={
            "description": "",
            "full_name":   f"{GITHUB_USERNAME}/{repo_name}",
            "created_at":  datetime.now(timezone.utc).isoformat(),
        },
    )
    return {
        "success":     ok > 0,
        "files_pushed": ok,
        "total_files": len(files),
        "results":     results,
        "repo_url":    f"https://github.com/{GITHUB_USERNAME}/{repo_name}",
        "preview_url": f"http://localhost:5000/preview/{repo_name}/",
    }

def _tool_post_to_mastodon(status: str) -> dict:
    if not MASTODON_TOKEN:
        return {"success": False, "error": "MASTODON_ACCESS_TOKEN not configured"}
    r = req_lib.post(
        f"{MASTODON_BASE}/api/v1/statuses",
        headers={"Authorization": f"Bearer {MASTODON_TOKEN}"},
        json={"status": status[:500]},
        timeout=15,
    )
    if r.status_code == 200:
        d = r.json()
        return {"success": True, "post_url": d.get("url", ""), "id": d.get("id", "")}
    return {"success": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}

# ── Email service ─────────────────────────────────────────────────────────────
def _tool_get_email_inbox(max_results: int = 10, query: str = "", page_token: str = "") -> dict:
    log.info("EMAIL  fetching inbox  max=%d  query=%r  page_token=%r", max_results, query, page_token[:8] if page_token else "")
    if not GOOGLE_AVAILABLE:
        log.error("EMAIL  Google libraries not installed")
        return {"success": False, "error": "Google libraries not installed. Run: pip install -r requirements.txt"}
    creds = _get_google_creds()
    if not creds:
        log.warning("EMAIL  no valid credentials — not connected")
        return {"success": False, "error": "Gmail not connected. Click 'Connect Google' in the Email section."}
    try:
        service = build("gmail", "v1", credentials=creds)
        params  = {"userId": "me", "maxResults": min(max_results, 50)}
        if query:
            params["q"] = query
        if page_token:
            params["pageToken"] = page_token
        result      = service.users().messages().list(**params).execute()
        messages    = result.get("messages", [])
        next_page   = result.get("nextPageToken", "")
        log.info("EMAIL  found %d message IDs — fetching metadata…", len(messages))
        emails   = []
        for msg in messages:
            detail = service.users().messages().get(
                userId="me", id=msg["id"], format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            ).execute()
            hdrs = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
            emails.append({
                "id":      msg["id"],
                "from":    hdrs.get("From", ""),
                "subject": hdrs.get("Subject", "(no subject)"),
                "date":    hdrs.get("Date", ""),
                "snippet": detail.get("snippet", ""),
                "unread":  "UNREAD" in detail.get("labelIds", []),
            })
        log.info("EMAIL  returning %d emails", len(emails))
        return {"success": True, "emails": emails, "count": len(emails), "next_page_token": next_page}
    except Exception as e:
        log.error("EMAIL  inbox fetch failed: %s", e)
        return {"success": False, "error": str(e)}

# ── Calendar service ──────────────────────────────────────────────────────────
def _tool_get_calendar_events(days_ahead: int = 7, from_date: "str | None" = None) -> dict:
    log.info("CALENDAR  fetching events  days_ahead=%d  from=%s", days_ahead, from_date or "now")
    if not GOOGLE_AVAILABLE:
        log.error("CALENDAR  Google libraries not installed")
        return {"success": False, "error": "Google libraries not installed"}
    creds = _get_google_creds()
    if not creds:
        log.warning("CALENDAR  no valid credentials — not connected")
        return {"success": False, "error": "Calendar not connected. Click 'Connect Google' in the Calendar section."}
    try:
        service = build("calendar", "v3", credentials=creds)
        if from_date:
            try:
                now = datetime.fromisoformat(from_date).replace(
                    hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
            except ValueError:
                now = datetime.now(timezone.utc)
        else:
            now = datetime.now(timezone.utc)
        end = now + timedelta(days=days_ahead)
        result  = service.events().list(
            calendarId="primary",
            timeMin=now.isoformat(),
            timeMax=end.isoformat(),
            singleEvents=True,
            orderBy="startTime",
        ).execute()
        events = []
        for e in result.get("items", []):
            start = e["start"].get("dateTime", e["start"].get("date", ""))
            end_t = e["end"].get("dateTime", e["end"].get("date", ""))
            events.append({
                "id":          e["id"],
                "summary":     e.get("summary", "(no title)"),
                "start":       start,
                "end":         end_t,
                "location":    e.get("location", ""),
                "description": e.get("description", ""),
                "all_day":     "date" in e["start"],
            })
        log.info("CALENDAR  returning %d events", len(events))
        return {"success": True, "events": events, "count": len(events)}
    except Exception as e:
        log.error("CALENDAR  events fetch failed: %s", e)
        return {"success": False, "error": str(e)}

def _tool_create_calendar_event(
    summary: str, start_datetime: str, end_datetime: str,
    description: str = "", timezone: str = "Asia/Singapore"
) -> dict:
    log.info("CALENDAR  creating event %r  %s → %s", summary, start_datetime, end_datetime)
    if not GOOGLE_AVAILABLE:
        log.error("CALENDAR  Google libraries not installed")
        return {"success": False, "error": "Google libraries not installed"}
    creds = _get_google_creds()
    if not creds:
        log.warning("CALENDAR  no valid credentials — not connected")
        return {"success": False, "error": "Calendar not connected"}
    try:
        service = build("calendar", "v3", credentials=creds)
        event   = {
            "summary":     summary,
            "description": description,
            "start":       {"dateTime": start_datetime, "timeZone": timezone},
            "end":         {"dateTime": end_datetime,   "timeZone": timezone},
        }
        created = service.events().insert(calendarId="primary", body=event).execute()
        log.info("CALENDAR  event created  id=%s", created["id"])
        return {"success": True, "event_id": created["id"], "link": created.get("htmlLink", ""), "summary": summary}
    except Exception as e:
        log.error("CALENDAR  create event failed: %s", e)
        return {"success": False, "error": str(e)}

# ── Trends service ────────────────────────────────────────────────────────────
def _fetch_hackernews() -> list:
    log.info("TRENDS  fetching HackerNews Show HN stories")
    try:
        ids   = req_lib.get("https://hacker-news.firebaseio.com/v0/showstories.json", timeout=8).json()[:40]
        items = []
        for id_ in ids:
            try:
                d = req_lib.get(f"https://hacker-news.firebaseio.com/v0/item/{id_}.json", timeout=5).json()
                if not d or d.get("type") != "story":
                    continue
                title = d.get("title", "").replace("Show HN: ", "").strip()
                items.append({
                    "title":      title,
                    "description": f"{d.get('score', 0)} points · {d.get('descendants', 0)} comments",
                    "prompt":     f"Build a web app inspired by: {title}",
                    "source":     "hackernews",
                    "source_url": d.get("url") or f"https://news.ycombinator.com/item?id={id_}",
                    "tags":       ["hn", "show-hn"],
                })
                if len(items) >= 20:
                    break
            except Exception:
                continue
        log.info("TRENDS  HackerNews returned %d items", len(items))
        return items
    except Exception as e:
        log.error("TRENDS  HackerNews fetch failed: %s", e)
        return [{"error": str(e)}]

def _fetch_github_trending() -> list:
    log.info("TRENDS  fetching GitHub trending repos")
    try:
        since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
        r = req_lib.get(
            "https://api.github.com/search/repositories",
            headers={"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"},
            params={"q": f"created:>{since} language:javascript OR language:typescript OR language:python",
                    "sort": "stars", "per_page": 20},
            timeout=8,
        )
        items = []
        for repo in r.json().get("items", []):
            desc = repo.get("description") or "A trending open-source project"
            items.append({
                "title":       repo["name"].replace("-", " ").replace("_", " ").title(),
                "description": desc[:100],
                "prompt":      f"Build a web app similar to {repo['name']}: {desc}",
                "source":      "github",
                "source_url":  repo["html_url"],
                "tags":        (repo.get("topics") or [])[:3] + [f"⭐ {repo['stargazers_count']:,}"],
            })
        log.info("TRENDS  GitHub returned %d repos", len(items))
        return items
    except Exception as e:
        log.error("TRENDS  GitHub fetch failed: %s", e)
        return [{"error": str(e)}]

def _fetch_mastodon_trends() -> list:
    log.info("TRENDS  fetching Mastodon trending tags + statuses")
    items = []
    try:
        r = req_lib.get(f"{MASTODON_BASE}/api/v1/trends/tags", params={"limit": 20}, timeout=8)
        if r.status_code == 200:
            for tag in r.json():
                name = tag["name"]
                uses = tag.get("history", [{}])[0].get("uses", "?")
                items.append({
                    "title":       f"#{name}",
                    "description": f"Trending on Mastodon · {uses} posts today",
                    "prompt":      f"Create a web app dashboard about #{name} — show stats, timeline, and related content",
                    "source":      "mastodon",
                    "source_url":  f"{MASTODON_BASE}/tags/{name}",
                    "tags":        ["mastodon", "trending", f"#{name}"],
                    "is_tag":      True,
                })
        else:
            log.warning("TRENDS  Mastodon tags HTTP %d", r.status_code)
    except Exception as e:
        log.error("TRENDS  Mastodon tags fetch failed: %s", e)
    try:
        headers = {"Authorization": f"Bearer {MASTODON_TOKEN}"} if MASTODON_TOKEN else {}
        r = req_lib.get(f"{MASTODON_BASE}/api/v1/trends/statuses", params={"limit": 15},
                        headers=headers, timeout=6)
        if r.status_code == 200:
            for post in r.json():
                text = re.sub(r"<[^>]+>", " ", post.get("content", "")).strip()[:120]
                if len(text) > 20:
                    items.append({
                        "title":       text[:70] + ("…" if len(text) > 70 else ""),
                        "description": f"Trending post · {post.get('reblogs_count', 0)} boosts",
                        "prompt":      f"Build an interactive visualisation inspired by: {text}",
                        "source":      "mastodon",
                        "source_url":  post.get("url", ""),
                        "tags":        ["mastodon", "trending"],
                        "is_tag":      False,
                    })
        else:
            log.warning("TRENDS  Mastodon statuses HTTP %d", r.status_code)
    except Exception as e:
        log.error("TRENDS  Mastodon statuses fetch failed: %s", e)
    log.info("TRENDS  Mastodon returned %d items", len(items))
    return items or [{"error": "No trends available from Mastodon"}]

def _fetch_youtube_trends() -> list:
    log.info("TRENDS  fetching YouTube trending videos")
    if not YOUTUBE_API_KEY:
        log.warning("TRENDS  YOUTUBE_API_KEY not set — skipping")
        return [{"error": "YOUTUBE_API_KEY not set in .env"}]
    try:
        r = req_lib.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={
                "part":       "snippet,statistics",
                "chart":      "mostPopular",
                "maxResults": 15,
                "key":        YOUTUBE_API_KEY,
                "regionCode": "US",
            },
            timeout=8,
        )
        items = []
        for video in r.json().get("items", []):
            snip  = video["snippet"]
            stats = video.get("statistics", {})
            views = int(stats.get("viewCount", 0))
            items.append({
                "title":       snip["title"],
                "description": snip.get("channelTitle", "") + f" · {views:,} views",
                "prompt":      f"Create a web app or analysis inspired by the YouTube trend: {snip['title']}",
                "source":      "youtube",
                "source_url":  f"https://youtube.com/watch?v={video['id']}",
                "tags":        ["youtube", snip.get("categoryId", ""), f"👁 {views:,}"],
            })
        log.info("TRENDS  YouTube returned %d videos", len(items))
        return items
    except Exception as e:
        log.error("TRENDS  YouTube fetch failed: %s", e)
        return [{"error": str(e)}]

def _fetch_reddit_trends() -> list:
    log.info("TRENDS  fetching Reddit r/all hot posts")
    try:
        r = req_lib.get(
            "https://www.reddit.com/r/all/hot.json",
            params={"limit": 25},
            headers={"User-Agent": "CloneMe/1.0 (Personal Assistant)"},
            timeout=8,
        )
        items = []
        for post in r.json().get("data", {}).get("children", []):
            d = post["data"]
            items.append({
                "title":       d["title"],
                "description": f"r/{d['subreddit']} · {d['score']:,} upvotes · {d['num_comments']} comments",
                "prompt":      f"Build a web app or data visualisation inspired by: {d['title']}",
                "source":      "reddit",
                "source_url":  f"https://reddit.com{d['permalink']}",
                "tags":        ["reddit", f"r/{d['subreddit']}"],
                "subreddit":   f"r/{d['subreddit']}",
                "score":       d.get("score", 0),
                "is_tag":      False,
            })
        log.info("TRENDS  Reddit returned %d posts", len(items))
        return items
    except Exception as e:
        log.error("TRENDS  Reddit fetch failed: %s", e)
        return [{"error": str(e)}]

def _tool_fetch_trends(source: str = "all") -> dict:
    log.info("TRENDS  request  source=%r", source)
    fetchers = {
        "mastodon":    _fetch_mastodon_trends,
        "hackernews":  _fetch_hackernews,
        "github":      _fetch_github_trending,
        "youtube":     _fetch_youtube_trends,
        "reddit":      _fetch_reddit_trends,
    }
    if source != "all":
        fn = fetchers.get(source)
        print(f"  📈 fetching trends: {source}", flush=True, file=_sys.stderr)
        result = fn() if fn else []
        print(f"  📈 {source} → {len(result)} items", flush=True, file=_sys.stderr)
        log.info("TRENDS  single source %r → %d items", source, len(result))
        return {"success": True, "source": source, "items": result}
    print(f"  📈 fetching all trends…", flush=True, file=_sys.stderr)
    results = {k: v() for k, v in fetchers.items()}
    print(f"  📈 all sources done", flush=True, file=_sys.stderr)
    log.info("TRENDS  all sources complete")
    return {"success": True, "sources": results}

# ── Research tools (support the trends → build pipeline) ─────────────────────

def _tool_web_search(query: str, max_results: int = 6) -> dict:
    """Search the web via DuckDuckGo — no API key required."""
    log.info("SEARCH  query=%r  max=%d", query, max_results)
    if not DDG_AVAILABLE:
        return {"success": False, "error": "duckduckgo-search not installed. Run: pip install duckduckgo-search"}
    try:
        results = list(_DDGS().text(query, max_results=min(max_results, 10)))
        items = [{"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")} for r in results]
        log.info("SEARCH  returned %d results", len(items))
        return {"success": True, "query": query, "results": items}
    except Exception as e:
        log.error("SEARCH  failed: %s", e)
        return {"success": False, "error": str(e)}


def _tool_read_webpage(url: str, max_chars: int = 4000) -> dict:
    """Fetch a URL and return its readable text content — useful for reading
    HackerNews articles, GitHub READMEs, Reddit posts, or any source_url from trends."""
    log.info("WEBPAGE  fetching %s", url)
    try:
        resp = req_lib.get(url, timeout=12, headers={"User-Agent": "Mozilla/5.0 CloneMe/1.0"})
        resp.raise_for_status()
        raw = resp.text
        # Strip script/style blocks entirely
        raw = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', raw)
        # Strip all remaining HTML tags
        text = re.sub(r'<[^>]+>', ' ', raw)
        # Decode HTML entities
        text = html.unescape(text)
        # Collapse whitespace
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n\s*\n+', '\n\n', text).strip()
        truncated = len(text) > max_chars
        log.info("WEBPAGE  extracted %d chars (truncated=%s)", len(text), truncated)
        return {"success": True, "url": url, "text": text[:max_chars], "truncated": truncated}
    except Exception as e:
        log.error("WEBPAGE  failed: %s", e)
        return {"success": False, "error": str(e)}


def _tool_star_github_repo(repo_full_name: str) -> dict:
    """Star a GitHub repository on the user's behalf (e.g. 'owner/repo-name').
    Use this when the user asks to star a repo they found in the trends feed."""
    log.info("GITHUB  starring %s", repo_full_name)
    if not GITHUB_TOKEN:
        return {"success": False, "error": "GITHUB_TOKEN not configured"}
    r = _gh("put", f"/user/starred/{repo_full_name}", data=b"")
    if r.status_code == 204:
        log.info("GITHUB  starred %s", repo_full_name)
        return {"success": True, "repo": repo_full_name, "url": f"https://github.com/{repo_full_name}"}
    return {"success": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}


# Curated app ideas
CURATED_IDEAS = [
    {"title": "Real-time Weather Dashboard",
     "description": "Beautiful weather with forecasts, wind maps, and UV index",
     "prompt": "Create a real-time weather dashboard using the Open-Meteo API (free, no key). Show current conditions, 7-day forecast, hourly chart (Chart.js), wind speed, UV index, and a dynamic background that changes with conditions.",
     "source": "curated", "source_url": "", "tags": ["weather", "api", "charts"]},
    {"title": "Gmail Inbox Analyser",
     "description": "Visualise your email patterns, busiest senders, and response times",
     "prompt": "Build a Gmail inbox analytics dashboard. Show email volume over time, top senders, average response time, busiest hours of the day, and label distribution. Use Chart.js for visualizations.",
     "source": "curated", "source_url": "", "tags": ["email", "analytics", "charts"]},
    {"title": "Mastodon Social Dashboard",
     "description": "Track trending topics and analyse your Mastodon feed with AI",
     "prompt": "Create a Mastodon social dashboard using the public Mastodon API. Show trending hashtags chart, trending posts, follower stats, and a feed reader. Include an AI-powered trend analysis section.",
     "source": "curated", "source_url": "", "tags": ["mastodon", "social", "trends"]},
    {"title": "Pomodoro Focus Timer",
     "description": "Focus timer with task list, session history, and statistics",
     "prompt": "Build a Pomodoro timer with configurable intervals, task list, session history chart, keyboard shortcuts, browser notifications, and localStorage. Dark mode, smooth animations.",
     "source": "curated", "source_url": "", "tags": ["productivity", "timer", "localStorage"]},
    {"title": "GitHub Profile Analyser",
     "description": "Visualise any GitHub user's contributions and language stats",
     "prompt": "Create a GitHub profile analyser using the public GitHub API. Enter any username to see: contribution heatmap, top languages pie chart, repo stars, most active times, and pinned repos.",
     "source": "curated", "source_url": "", "tags": ["github", "api", "data-viz"]},
    {"title": "Reddit Hot Topics Tracker",
     "description": "Track rising posts across subreddits in real time",
     "prompt": "Build a Reddit trending topics tracker using the Reddit public JSON API. Show hot posts from r/all, filter by subreddit, upvote sparklines, post growth rate, and a word cloud of trending terms.",
     "source": "curated", "source_url": "", "tags": ["reddit", "trends", "real-time"]},
    {"title": "Crypto Price Tracker",
     "description": "Live crypto prices with 7-day charts via free CoinGecko API",
     "prompt": "Create a cryptocurrency tracker using CoinGecko (no key). Top 20 coins, 7-day sparklines, portfolio tracker, price alerts in localStorage, and a market cap leaderboard.",
     "source": "curated", "source_url": "", "tags": ["crypto", "finance", "charts"]},
    {"title": "Space Dashboard",
     "description": "ISS location, astronauts in space, and NASA APOD",
     "prompt": "Build a space dashboard: ISS real-time location on a Leaflet map, current astronauts (Open Notify API), NASA APOD (free key), upcoming launches. Dark theme with space aesthetic.",
     "source": "curated", "source_url": "", "tags": ["space", "api", "maps"]},
]

# ── Tool executor ─────────────────────────────────────────────────────────────
_TOOL_FNS = {
    "create_github_repo":   _tool_create_github_repo,
    "push_files_to_repo":   _tool_push_files_to_repo,
    "post_to_mastodon":     _tool_post_to_mastodon,
    "get_email_inbox":      _tool_get_email_inbox,
    "get_calendar_events":  _tool_get_calendar_events,
    "create_calendar_event": _tool_create_calendar_event,
    "fetch_trends":         _tool_fetch_trends,
    "web_search":           _tool_web_search,
    "read_webpage":         _tool_read_webpage,
    "star_github_repo":     _tool_star_github_repo,
}

def execute_tool(name: str, inp: dict) -> dict:
    fn = _TOOL_FNS.get(name)
    if not fn:
        log.error("AGENT  unknown tool requested: %s", name)
        return {"error": f"Unknown tool: {name}"}
    try:
        print(f"  ⚙  {name}", flush=True, file=_sys.stderr)
        log.info("AGENT  tool call → %s  input=%s", name, str(inp)[:120])
        result = fn(**inp)
        ok = result.get("success", True)
        log.info("AGENT  tool result ← %s  success=%s", name, ok)
        if not ok:
            log.warning("AGENT  tool %s returned error: %s", name, result.get("error", ""))
        return result
    except Exception as e:
        log.error("AGENT  tool %s raised exception: %s", name, e)
        return {"error": str(e)}

# ── System prompts ────────────────────────────────────────────────────────────
INTENT_SYSTEM = """You are a technical product analyst. Extract the user's app intent and output ONLY valid JSON.

Schema (all fields required):
{
  "title": "Short app name, 3-5 words",
  "description": "One sentence describing the app and its main value",
  "features": ["feature 1", "feature 2", "feature 3"],
  "apis": [{"name": "API name", "usage": "what it provides", "auth": "none | free-key | oauth"}],
  "tech_stack": ["HTML5", "CSS3", "Chart.js"],
  "style": "e.g. dark minimal, colourful dashboard",
  "complexity": "simple | moderate | complex",
  "repo_name": "kebab-case-repo-name"
}

Rules: features 3-6 items, apis real public APIs, tech_stack max 6 CDN libraries, repo_name lowercase kebab."""

SYSTEM_PROMPT = """You are CloneMe, the user's digital clone — a personal AI assistant that runs tasks in the background so they don't have to.

You have these capabilities:
1. **Build & deploy apps**: Create GitHub repos, generate complete web apps, push code, announce on Mastodon
2. **Email management**: Read Gmail inbox, summarise emails, identify action items and urgent messages
3. **Calendar management**: View upcoming events, create new meetings and reminders
4. **Trend analysis**: Fetch and analyse trending content from Mastodon, HackerNews, GitHub, YouTube, Reddit
5. **Research**: Search the web and read any webpage to gather context before building

## Build workflow — always follow this order:
When asked to build an app (especially from a trend), follow these steps in order:
1. **Discover** — if no trend context is provided, call fetch_trends first
2. **Read source** — call read_webpage on the trend's source_url to understand it deeply
3. **Research** — call web_search for best practices, features, and implementation ideas
4. **Build** — call create_github_repo then push_files_to_repo with ALL files in one call
5. **Star** — if the build was inspired by a GitHub trending repo, call star_github_repo
6. **Announce** — optionally post to Mastodon

After completing a build, end your response with this exact line (replace the placeholders):
BUILD_COMPLETE: repo={repo_name} | title={human readable project title} | features={comma-separated list of 4-6 key features to develop}

This triggers the user to set project milestones on their calendar.

## General rules:
- Use only vanilla HTML/CSS/JS or CDN-hosted libraries (Chart.js, Leaflet, Alpine.js, etc.)
- Use free, no-auth APIs where possible (Open-Meteo, CoinGecko, etc.)
- Style beautifully — dark mode preferred, smooth animations, great typography
- Always include README.md with setup instructions
- When building: generate complete, working code — no placeholders, no TODOs

For email analysis:
- Summarise key points concisely
- Flag urgent/important messages
- Identify action items with clear owners and deadlines

For trend analysis:
- Identify the most interesting trending content
- Explain WHY it's trending and what it signals
- Suggest how the user could engage, post, or build something related"""

# ── SSE helper ────────────────────────────────────────────────────────────────
def _sse(t: str, **kw) -> str:
    return f"data: {json.dumps({'type': t, **kw})}\n\n"

# ── Agentic streaming loop ────────────────────────────────────────────────────
def run_agent_stream(prompt: str, intent: dict = None, model: str = DEFAULT_MODEL,
                     messages: list = None, prior_messages: list = None):
    print(f"  → agent starting", flush=True, file=_sys.stderr)
    log.info("AGENT  starting stream  model=%s  prompt=%r", model, (prompt or '')[:80])

    if messages is None:
        # Build current user content
        if intent:
            blueprint    = json.dumps(intent, indent=2)
            user_content = (
                f"User request: {prompt}\n\n"
                f"Pre-analysed blueprint (follow this precisely):\n{blueprint}\n\n"
                f"Use the repo_name from the blueprint. Implement every listed feature."
            )
        else:
            user_content = prompt

        if prior_messages:
            # Resume from prior conversation history sent by the frontend
            messages = list(prior_messages)
            messages.append({"role": "user", "content": user_content})
        else:
            messages = [{"role": "user", "content": user_content}]
        yield _sse("status", message="My clone is thinking…")
    else:
        # Continuation after max_tokens — ask the model to carry on
        messages.append({"role": "user", "content": "Please continue from where you left off."})
        yield _sse("status", message="Continuing…")

    iteration = 0
    while True:
        iteration += 1
        log.info("AGENT  LLM call #%d  messages=%d", iteration, len(messages))

        # Stream tokens as they arrive so the SSE connection stays alive during
        # long generation (e.g. writing full file contents for push_files_to_repo).
        # Retry up to 3 times if the TCP connection is dropped mid-stream.
        _MAX_STREAM_RETRIES = 3
        response = None
        for _attempt in range(_MAX_STREAM_RETRIES):
            try:
                with _anthropic.messages.stream(
                    model=model,
                    max_tokens=16000,
                    system=SYSTEM_PROMPT,
                    tools=TOOLS,
                    messages=messages,
                ) as stream:
                    _last_ping  = time.time()
                    _active_tool_name = None  # tracks which tool's input is being generated
                    for event in stream:
                        if event.type == "content_block_start":
                            cb = getattr(event, "content_block", None)
                            if cb and getattr(cb, "type", None) == "tool_use":
                                _active_tool_name = getattr(cb, "name", None)
                                if _active_tool_name:
                                    yield _sse("tool_generating", name=_active_tool_name)
                                    _last_ping = time.time()
                        elif event.type == "content_block_stop":
                            _active_tool_name = None
                        elif (event.type == "content_block_delta"
                                and hasattr(event.delta, "text")
                                and event.delta.text):
                            yield _sse("text", content=event.delta.text)
                            _last_ping = time.time()
                        elif event.type == "content_block_delta":
                            # Tool input being generated (input_json_delta) — no visible
                            # text but we must keep the SSE connection alive.
                            now = time.time()
                            if now - _last_ping >= 5:
                                yield _sse("ping")
                                _last_ping = now
                    response = stream.get_final_message()
                break  # stream completed successfully
            except httpx.RemoteProtocolError as _e:
                log.warning("AGENT  stream dropped on attempt %d/%d: %s",
                            _attempt + 1, _MAX_STREAM_RETRIES, _e)
                if _attempt < _MAX_STREAM_RETRIES - 1:
                    _delay = 2 ** _attempt  # 1s, 2s, 4s
                    yield _sse("status",
                               message=f"Connection dropped — retrying in {_delay}s "
                                       f"({_attempt + 2}/{_MAX_STREAM_RETRIES})…")
                    time.sleep(_delay)
                else:
                    raise
        if response is None:
            raise RuntimeError("Stream loop exited without a response")

        log.info("AGENT  LLM response  stop_reason=%s  content_blocks=%d",
                 response.stop_reason, len(response.content))

        if response.stop_reason == "end_turn":
            log.info("AGENT  finished (end_turn) after %d LLM calls", iteration)
            break

        if response.stop_reason == "max_tokens":
            log.warning("AGENT  max_tokens hit — saving continuation session")
            # Preserve the partial assistant turn so the model can continue
            messages.append({"role": "assistant", "content": response.content})
            sid = str(uuid.uuid4())[:12]
            with _truncated_lock:
                _truncated_sessions[sid] = {
                    "messages":   messages,
                    "model":      model,
                    "created_at": time.time(),
                }
            yield _sse("truncated", session_id=sid)
            break

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                log.info("AGENT  invoking tool: %s", block.name)
                # Ping before the tool call so the frontend watchdog is reset
                # right before the potentially-long synchronous execution window.
                yield _sse("ping")
                yield _sse("tool_call", id=block.id, name=block.name, input=block.input)
                result = execute_tool(block.name, block.input)
                yield _sse("tool_result", id=block.id, name=block.name, result=result)
                tool_results.append({
                    "type":        "tool_result",
                    "tool_use_id": block.id,
                    "content":     json.dumps(result),
                })
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user",      "content": tool_results})
        else:
            log.warning("AGENT  unexpected stop_reason=%s — breaking", response.stop_reason)
            break

    yield _sse("done")
    log.info("AGENT  stream complete")

# ══════════════════════════════════════════════════════════════════════════════
# API Routes
# ══════════════════════════════════════════════════════════════════════════════

# ── Google OAuth service ──────────────────────────────────────────────────────
_GOOGLE_AUTH_URI  = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
_OAUTH_REDIRECT   = "http://localhost:5000/api/google/callback"

@app.route("/api/google/auth")
def google_auth():
    log.info("OAUTH  /auth — starting Google OAuth flow")
    if not GOOGLE_AVAILABLE:
        log.error("OAUTH  Google libraries not installed")
        return jsonify({"error": "Google libraries not installed. Run: pip install -r requirements.txt"}), 500
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        log.error("OAUTH  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in .env")
        return jsonify({
            "error": "Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env"
        }), 500

    import secrets as _sec, urllib.parse as _up
    state = _sec.token_urlsafe(32)
    # Persist state in a file so it survives even if session cookie is lost
    (BASE_DIR / ".oauth_state.tmp").write_text(state)

    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  _OAUTH_REDIRECT,
        "response_type": "code",
        "scope":         " ".join(GOOGLE_SCOPES),
        "state":         state,
        "access_type":   "offline",
        "prompt":        "consent",
    }
    auth_url = _GOOGLE_AUTH_URI + "?" + _up.urlencode(params)
    log.info("OAUTH  redirecting user to Google consent screen")
    return redirect(auth_url)

def _oauth_html(ok: bool, title: str, lines: list, redirect_to: str = "/") -> str:
    """Return a visible HTML page shown in the browser after OAuth, then JS-redirect."""
    colour  = "#10b981" if ok else "#ef4444"
    icon    = "✓" if ok else "✗"
    rows    = "".join(f"<li>{l}</li>" for l in lines)
    return f"""<!doctype html><html><head><meta charset=utf-8>
<title>{title}</title>
<style>body{{font-family:system-ui;background:#0d0d14;color:#e2e8f0;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0}}
.box{{background:#1a1a2e;border:1px solid #2a2a3e;border-radius:12px;padding:32px;
max-width:480px;width:100%}}
h2{{color:{colour};margin:0 0 16px}}
ul{{padding-left:20px;line-height:2}}
.redirect{{margin-top:20px;font-size:12px;color:#64748b}}</style></head>
<body><div class="box">
<h2>{icon} {title}</h2><ul>{rows}</ul>
<p class="redirect">Redirecting in <span id="t">3</span>s…
<a href="{redirect_to}" style="color:#8b5cf6">click here if not redirected</a></p>
</div>
<script>
let n=3;
const el=document.getElementById('t');
const iv=setInterval(()=>{{n--;el.textContent=n;if(n<=0){{clearInterval(iv);
window.location.href='{redirect_to}';}}}},1000);
</script></body></html>"""

@app.route("/api/google/callback")
def google_callback():
    log.info("OAUTH  /callback hit — args: %s", dict(request.args))
    # Clean up any leftover temp files from previous attempts
    for _f in (".oauth_state.tmp", ".oauth_pkce.tmp"):
        p = BASE_DIR / _f
        if p.exists():
            p.unlink(missing_ok=True)

    # ── Early-exit guards ──────────────────────────────────────────────────────
    if not GOOGLE_AVAILABLE:
        log.error("OAUTH  Google libraries not installed")
        return _oauth_html(False, "Google libraries missing",
                           ["Run: pip install -r requirements.txt",
                            "Then restart the server."])

    error_param = request.args.get("error")
    if error_param:
        log.warning("OAUTH  Google returned error: %s", error_param)
        return _oauth_html(False, "Google sign-in cancelled",
                           [f"Google said: {error_param}",
                            "Go back and try Connect Google again."])

    code = request.args.get("code")
    if not code:
        log.warning("OAUTH  no code in callback")
        return _oauth_html(False, "No authorisation code",
                           ["Google did not return a code.",
                            "Go back and try Connect Google again."])

    # ── Token exchange — plain HTTP POST, no PKCE (server-side web flow) ─────────
    try:
        import requests as _req
        log.info("OAUTH  exchanging code for tokens…")
        tr = _req.post(_GOOGLE_TOKEN_URI, data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  _OAUTH_REDIRECT,
            "grant_type":    "authorization_code",
        }, timeout=15)
        td = tr.json()
        if "error" in td:
            raise RuntimeError(f"{td['error']}: {td.get('error_description', '')}")

        access_token  = td.get("access_token", "")
        refresh_token = td.get("refresh_token", "")
        log.info("OAUTH  token exchange OK  access=%s  refresh=%s",
                 bool(access_token), bool(refresh_token))

        creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri=_GOOGLE_TOKEN_URI,
            client_id=GOOGLE_CLIENT_ID,
            client_secret=GOOGLE_CLIENT_SECRET,
            scopes=GOOGLE_SCOPES,
        )
        log.info("OAUTH  fetch_token OK  token=%s  refresh=%s",
                 bool(creds.token), bool(creds.refresh_token))

        warn_lines = []
        if not creds.refresh_token:
            msg = ("No refresh token returned. Visit "
                   "https://myaccount.google.com/permissions, remove CloneMe, then reconnect.")
            log.warning("OAUTH  %s", msg)
            warn_lines.append(f"⚠ {msg}")

        # ── Fetch user email (best-effort) ─────────────────────────────────────
        user_email = ""
        try:
            svc = build("oauth2", "v2", credentials=creds)
            info = svc.userinfo().get().execute()
            user_email = info.get("email", "")
            log.info("OAUTH  user email: %s", user_email)
        except Exception as ex:
            log.warning("OAUTH  could not fetch user email (non-fatal): %s", ex)

        # ── Save tokens ────────────────────────────────────────────────────────
        TOKENS_FILE.write_text(json.dumps({
            "token":         creds.token,
            "refresh_token": creds.refresh_token,
            "email":         user_email,
        }))
        log.info("OAUTH  tokens saved  user=%s  file=%s", user_email or "(unknown)", TOKENS_FILE)

        ok_lines = [
            f"Connected as: {user_email or '(email unknown)'}",
            f"Access token: {'✓ received' if creds.token else '✗ missing'}",
            f"Refresh token: {'✓ received' if creds.refresh_token else '⚠ not returned'}",
            "Tokens saved — you will be redirected to the app.",
        ] + warn_lines

        return _oauth_html(True, "Google connected!", ok_lines, redirect_to="/?connected=google")

    except Exception as e:
        log.error("OAUTH  callback exception: %s", e, exc_info=True)
        return _oauth_html(False, "Unexpected error",
                           [f"Exception: {e}",
                            "Check the cloneme.log file next to app.py for details."])

@app.route("/api/google/status")
def google_status():
    if not GOOGLE_AVAILABLE:
        return jsonify({"connected": False, "reason": "Google libraries not installed"})
    if not TOKENS_FILE.exists():
        return jsonify({"connected": False, "reason": "Not connected"})
    try:
        data  = json.loads(TOKENS_FILE.read_text())
        creds = _get_google_creds()
        return jsonify({
            "connected": creds is not None,
            "email":     data.get("email", ""),
        })
    except Exception:
        return jsonify({"connected": False, "reason": "Token error"})

@app.route("/api/google/disconnect", methods=["POST"])
def google_disconnect():
    if TOKENS_FILE.exists():
        TOKENS_FILE.unlink()
    return jsonify({"success": True})

# ── Email service ─────────────────────────────────────────────────────────────
@app.route("/api/gmail/inbox")
def gmail_inbox():
    q          = request.args.get("q", "")
    max_res    = int(request.args.get("limit", 30))
    page_token = request.args.get("pageToken", "")
    log.info("EMAIL  /inbox  limit=%d  q=%r  page_token=%s", max_res, q, bool(page_token))
    result = _tool_get_email_inbox(max_results=max_res, query=q, page_token=page_token)
    if not result.get("success"):
        log.warning("EMAIL  /inbox failed: %s", result.get("error"))
    return jsonify(result)

@app.route("/api/gmail/message/<msg_id>")
def gmail_message(msg_id):
    log.info("EMAIL  /message/%s", msg_id)
    creds = _get_google_creds()
    if not creds:
        log.warning("EMAIL  /message — not connected")
        return jsonify({"success": False, "error": "Not connected"}), 401
    try:
        service = build("gmail", "v1", credentials=creds)
        detail  = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
        # Extract plain-text body
        def _get_body(payload):
            if payload.get("mimeType") == "text/plain":
                data = payload.get("body", {}).get("data", "")
                return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace") if data else ""
            for part in payload.get("parts", []):
                body = _get_body(part)
                if body:
                    return body
            return ""
        hdrs = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
        log.info("EMAIL  message fetched  subject=%r", hdrs.get("Subject", ""))
        return jsonify({
            "success": True,
            "id":      msg_id,
            "from":    hdrs.get("From", ""),
            "subject": hdrs.get("Subject", "(no subject)"),
            "date":    hdrs.get("Date", ""),
            "body":    _get_body(detail.get("payload", {}))[:8000],
        })
    except Exception as e:
        log.error("EMAIL  message fetch failed: %s", e)
        return jsonify({"success": False, "error": str(e)})

# ── IMAP service (Outlook / Yahoo) ───────────────────────────────────────────
def _imap_load_accounts() -> dict:
    if IMAP_FILE.exists():
        try:
            return json.loads(IMAP_FILE.read_text())
        except Exception:
            pass
    return {}

def _imap_save_accounts(data: dict):
    IMAP_FILE.write_text(json.dumps(data, indent=2))

def _imap_header_str(raw) -> str:
    """Decode an RFC2047-encoded email header to a plain string."""
    parts = _decode_header(raw or "")
    out = []
    for chunk, enc in parts:
        if isinstance(chunk, bytes):
            out.append(chunk.decode(enc or "utf-8", errors="replace"))
        else:
            out.append(str(chunk))
    return "".join(out)

def _imap_friendly_error(provider: str, raw_err: str) -> str:
    """Turn a raw IMAP error into a human-readable message."""
    s = raw_err.lower()
    if "basicauthblocked" in s or "basic auth" in s or "authfailed" in s.replace("_", ""):
        if provider == "outlook":
            return (
                "Microsoft has disabled Basic Auth IMAP for this account. "
                "School/work accounts (e.g. NTU @e.ntu.edu.sg) require OAuth — "
                "not supported via IMAP. Use a personal @outlook.com / @hotmail.com "
                "account instead, and enable IMAP + generate an App Password at "
                "account.microsoft.com → Security."
            )
        return "Basic authentication is blocked. Generate an App Password in your account security settings."
    if "invalid credentials" in s or "authentication failed" in s or "logon denied" in s:
        return "Wrong email or password. For Outlook/Yahoo, use an App Password, not your main password."
    if "too many" in s or "rate" in s:
        return "Too many login attempts — wait a few minutes and try again."
    return raw_err

def _imap_connect(provider: str):
    accounts = _imap_load_accounts()
    creds = accounts.get(provider)
    if not creds:
        return None, f"{provider.title()} account not connected"
    cfg = IMAP_SERVERS.get(provider)
    if not cfg:
        return None, f"Unknown provider: {provider}"
    try:
        mail = imaplib.IMAP4_SSL(cfg["server"], cfg["port"])
        mail.login(creds["email"], creds["password"])
        return mail, None
    except imaplib.IMAP4.error as e:
        return None, _imap_friendly_error(provider, str(e))
    except Exception as e:
        return None, str(e)

def _tool_get_imap_inbox(provider: str, max_results: int = 30, offset: int = 0) -> dict:
    log.info("IMAP  %s inbox  max=%d  offset=%d", provider, max_results, offset)
    mail, err = _imap_connect(provider)
    if mail is None:
        return {"success": False, "error": err or "Connection failed"}
    try:
        mail.select("INBOX")
        status, search_data = mail.search(None, "ALL")
        if status != "OK":
            return {"success": False, "error": "INBOX search failed"}
        ids = search_data[0].split()
        ids = ids[::-1]  # newest first
        total = len(ids)
        page  = ids[offset: offset + max_results]
        emails = []
        for uid in page:
            try:
                uid_str = uid.decode() if isinstance(uid, bytes) else str(uid)
                st, msg_data = mail.fetch(uid_str,
                    "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
                if st != "OK" or not msg_data or not msg_data[0]:
                    continue
                item = msg_data[0]
                if not isinstance(item, tuple):
                    continue
                raw_header = item[1] if isinstance(item[1], bytes) else b""
                flags_str  = item[0].decode() if isinstance(item[0], bytes) else ""
                msg = email_lib.message_from_bytes(raw_header)
                emails.append({
                    "id":      uid_str,
                    "from":    _imap_header_str(msg.get("From", "")),
                    "subject": _imap_header_str(msg.get("Subject", "(no subject)")),
                    "date":    msg.get("Date", ""),
                    "snippet": "",
                    "unread":  "\\Seen" not in flags_str,
                    "provider": provider,
                })
            except Exception as ex:
                log.debug("IMAP  skip uid %s: %s", uid, ex)
        mail.logout()
        log.info("IMAP  %s returned %d emails (total=%d)", provider, len(emails), total)
        return {"success": True, "emails": emails, "count": len(emails),
                "total": total, "offset": offset}
    except Exception as e:
        log.error("IMAP  %s inbox failed: %s", provider, e)
        return {"success": False, "error": str(e)}

def _tool_get_imap_message(provider: str, msg_id: str) -> dict:
    log.info("IMAP  %s message %s", provider, msg_id)
    mail, err = _imap_connect(provider)
    if mail is None:
        return {"success": False, "error": err or "Connection failed"}
    try:
        mail.select("INBOX")
        st, fetch_data = mail.fetch(msg_id, "(RFC822)")
        if st != "OK" or not fetch_data or not fetch_data[0]:
            return {"success": False, "error": "Message not found"}
        item = fetch_data[0]
        raw  = item[1] if isinstance(item, tuple) and isinstance(item[1], bytes) else b""
        msg  = email_lib.message_from_bytes(raw)

        def _get_text(m) -> str:
            if m.get_content_type() == "text/plain":
                payload = m.get_payload(decode=True)
                charset = m.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace") if isinstance(payload, bytes) else ""
            if m.is_multipart():
                for part in m.get_payload():
                    t = _get_text(part)
                    if t:
                        return t
            return ""

        mail.logout()
        return {
            "success": True,
            "id":      msg_id,
            "from":    _imap_header_str(msg.get("From", "")),
            "subject": _imap_header_str(msg.get("Subject", "(no subject)")),
            "date":    msg.get("Date", ""),
            "body":    _get_text(msg)[:8000],
        }
    except Exception as e:
        log.error("IMAP  message fetch failed: %s", e)
        return {"success": False, "error": str(e)}

@app.route("/api/email/connect", methods=["POST"])
def email_connect():
    data     = request.get_json(force=True)
    provider = data.get("provider", "").lower()
    em       = data.get("email", "").strip()
    pw       = data.get("password", "").strip()
    if provider not in IMAP_SERVERS:
        return jsonify({"success": False, "error": f"Unknown provider: {provider}"}), 400
    if not em or not pw:
        return jsonify({"success": False, "error": "Email and password are required"}), 400

    # Test the connection before saving
    cfg = IMAP_SERVERS[provider]
    try:
        test = imaplib.IMAP4_SSL(cfg["server"], cfg["port"])
        test.login(em, pw)
        test.logout()
    except imaplib.IMAP4.error as e:
        return jsonify({"success": False, "error": _imap_friendly_error(provider, str(e))})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

    accounts = _imap_load_accounts()
    accounts[provider] = {"email": em, "password": pw}
    _imap_save_accounts(accounts)
    log.info("IMAP  saved %s account for %s", provider, em)
    return jsonify({"success": True, "provider": provider, "email": em})

@app.route("/api/email/disconnect", methods=["POST"])
def email_disconnect():
    data     = request.get_json(force=True)
    provider = data.get("provider", "").lower()
    accounts = _imap_load_accounts()
    if provider in accounts:
        del accounts[provider]
        _imap_save_accounts(accounts)
    return jsonify({"success": True})

@app.route("/api/email/status")
def email_status():
    accounts = _imap_load_accounts()
    result = {}
    for p, creds in accounts.items():
        result[p] = {"connected": True, "email": creds.get("email", "")}
    return jsonify(result)

@app.route("/api/email/inbox")
def email_inbox():
    provider   = request.args.get("provider", "").lower()
    max_res    = int(request.args.get("limit", 30))
    offset     = int(request.args.get("offset", 0))
    if provider not in IMAP_SERVERS:
        return jsonify({"success": False, "error": f"Unknown provider: {provider}"}), 400
    return jsonify(_tool_get_imap_inbox(provider, max_res, offset))

@app.route("/api/email/message/<provider>/<msg_id>")
def email_message(provider, msg_id):
    if provider not in IMAP_SERVERS:
        return jsonify({"success": False, "error": f"Unknown provider: {provider}"}), 400
    return jsonify(_tool_get_imap_message(provider, msg_id))

# ── Calendar service ──────────────────────────────────────────────────────────
@app.route("/api/calendar/events")
def calendar_events():
    days      = int(request.args.get("days", 7))
    from_date = request.args.get("from", None)
    log.info("CALENDAR  /events  days=%d  from=%s", days, from_date or "now")
    result = _tool_get_calendar_events(days_ahead=days, from_date=from_date)
    if not result.get("success"):
        log.warning("CALENDAR  /events failed: %s", result.get("error"))
    return jsonify(result)

@app.route("/api/calendar/create", methods=["POST"])
def calendar_create():
    data = request.get_json(force=True)
    log.info("CALENDAR  /create  summary=%r", data.get("summary", ""))
    result = _tool_create_calendar_event(
        summary        = data.get("summary", ""),
        start_datetime = data.get("start", ""),
        end_datetime   = data.get("end", ""),
        description    = data.get("description", ""),
        timezone       = data.get("timezone", "Asia/Singapore"),
    )
    if not result.get("success"):
        log.warning("CALENDAR  /create failed: %s", result.get("error"))
    return jsonify(result)

# ── Trends service ────────────────────────────────────────────────────────────
@app.route("/api/trends")
def api_trends():
    source = request.args.get("source", "all")
    log.info("TRENDS  /trends  source=%r", source)
    return jsonify(_tool_fetch_trends(source))

@app.route("/api/trends/detail")
def api_trend_detail():
    source = request.args.get("source", "")
    url    = request.args.get("url", "")
    tag    = request.args.get("tag", "").lstrip("#")
    log.info("TRENDS  /detail  source=%s  tag=%s  url=%s", source, tag, url[:60] if url else "")

    if source == "mastodon" and tag:
        return jsonify(_trend_detail_mastodon(tag))
    if source == "hackernews" and url:
        return jsonify(_trend_detail_hn(url))
    if source == "github" and url:
        return jsonify(_trend_detail_github(url))
    if source == "reddit" and url:
        return jsonify(_trend_detail_reddit(url))
    if source == "youtube" and url:
        return jsonify(_trend_detail_youtube(url))
    return jsonify({"success": False, "error": "No detail available for this item"})

def _trend_detail_mastodon(tag: str) -> dict:
    try:
        headers = {"Authorization": f"Bearer {MASTODON_TOKEN}"} if MASTODON_TOKEN else {}
        r = req_lib.get(f"{MASTODON_BASE}/api/v1/timelines/tag/{tag}",
                        params={"limit": 20}, headers=headers, timeout=8)
        if r.status_code != 200:
            return {"success": False, "error": f"HTTP {r.status_code}"}
        posts = []
        for s in r.json():
            text = re.sub(r"<[^>]+>", " ", s.get("content", "")).strip()
            text = re.sub(r"\s{2,}", " ", text)
            if len(text) < 10:
                continue
            posts.append({
                "author":  s.get("account", {}).get("display_name") or s.get("account", {}).get("username", ""),
                "content": text[:280],
                "boosts":  s.get("reblogs_count", 0),
                "likes":   s.get("favourites_count", 0),
                "url":     s.get("url", ""),
            })
        return {"success": True, "type": "mastodon_posts", "posts": posts}
    except Exception as e:
        return {"success": False, "error": str(e)}

def _trend_detail_hn(url: str) -> dict:
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        item_id = parse_qs(parsed.query).get("id", [None])[0]
        if not item_id:
            # Try to find in URL path
            m = re.search(r"item\?id=(\d+)", url)
            item_id = m.group(1) if m else None
        if not item_id:
            return {"success": False, "error": "No item ID found in URL"}
        story = req_lib.get(f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json", timeout=6).json()
        kids  = (story.get("kids") or [])[:6]
        comments = []
        for kid in kids:
            try:
                c = req_lib.get(f"https://hacker-news.firebaseio.com/v0/item/{kid}.json", timeout=4).json()
                if not c or c.get("deleted") or c.get("dead"):
                    continue
                text = re.sub(r"<[^>]+>", " ", c.get("text", "")).strip()
                text = re.sub(r"\s{2,}", " ", text)
                if text:
                    comments.append({"by": c.get("by", ""), "text": text[:300]})
            except Exception:
                continue
        return {
            "success":   True,
            "type":      "hn_story",
            "story_url": story.get("url", ""),
            "score":     story.get("score", 0),
            "by":        story.get("by", ""),
            "n_comments": story.get("descendants", 0),
            "comments":  comments,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

def _trend_detail_github(url: str) -> dict:
    try:
        m = re.search(r"github\.com/([^/]+/[^/?#]+)", url)
        if not m:
            return {"success": False, "error": "Invalid GitHub URL"}
        full_name = m.group(1)
        r = _gh("get", f"/repos/{full_name}")
        if r.status_code != 200:
            return {"success": False, "error": f"GitHub HTTP {r.status_code}"}
        repo = r.json()
        readme = ""
        try:
            rr = _gh("get", f"/repos/{full_name}/readme")
            if rr.status_code == 200:
                raw = base64.b64decode(rr.json().get("content", "").replace("\n", "")).decode("utf-8", errors="replace")
                raw = re.sub(r"#{1,6}\s*", "", raw)
                raw = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", raw)
                raw = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", raw)
                raw = re.sub(r"[`*_>]", "", raw)
                readme = re.sub(r"\n{3,}", "\n\n", raw).strip()[:600]
        except Exception:
            pass
        return {
            "success":     True,
            "type":        "github_repo",
            "full_name":   repo.get("full_name", ""),
            "description": repo.get("description", ""),
            "stars":       repo.get("stargazers_count", 0),
            "forks":       repo.get("forks_count", 0),
            "language":    repo.get("language", ""),
            "topics":      (repo.get("topics") or [])[:8],
            "homepage":    repo.get("homepage", ""),
            "readme":      readme,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

def _trend_detail_reddit(url: str) -> dict:
    try:
        # Reddit JSON API: append .json to the post URL
        json_url = url.rstrip("/") + ".json"
        r = req_lib.get(json_url, headers={"User-Agent": "CloneMe/1.0"}, timeout=8)
        if r.status_code != 200:
            return {"success": False, "error": f"HTTP {r.status_code}"}
        data    = r.json()
        post    = data[0]["data"]["children"][0]["data"]
        selftxt = post.get("selftext", "").strip()[:600]
        comments_raw = data[1]["data"]["children"][:6] if len(data) > 1 else []
        comments = []
        for c in comments_raw:
            cd = c.get("data", {})
            body = cd.get("body", "").strip()
            if body and body != "[deleted]" and body != "[removed]":
                comments.append({
                    "by":    cd.get("author", ""),
                    "text":  body[:280],
                    "score": cd.get("score", 0),
                })
        return {
            "success":   True,
            "type":      "reddit_post",
            "title":     post.get("title", ""),
            "subreddit": post.get("subreddit_name_prefixed", ""),
            "score":     post.get("score", 0),
            "n_comments": post.get("num_comments", 0),
            "selftext":  selftxt,
            "comments":  comments,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

def _trend_detail_youtube(url: str) -> dict:
    try:
        m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", url)
        if not m:
            return {"success": False, "error": "No video ID in URL"}
        vid = m.group(1)
        if not YOUTUBE_API_KEY:
            return {"success": False, "error": "YouTube API key not configured"}
        r = req_lib.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={"part": "snippet,statistics", "id": vid, "key": YOUTUBE_API_KEY},
            timeout=8,
        )
        items = r.json().get("items", [])
        if not items:
            return {"success": False, "error": "Video not found"}
        item  = items[0]
        snip  = item["snippet"]
        stats = item.get("statistics", {})
        return {
            "success":     True,
            "type":        "youtube_video",
            "title":       snip.get("title", ""),
            "channel":     snip.get("channelTitle", ""),
            "description": snip.get("description", "")[:500],
            "published":   snip.get("publishedAt", ""),
            "views":       int(stats.get("viewCount", 0)),
            "likes":       int(stats.get("likeCount", 0)),
            "comments":    int(stats.get("commentCount", 0)),
            "thumbnail":   snip.get("thumbnails", {}).get("medium", {}).get("url", ""),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.route("/api/inspirations")
def api_inspirations():
    source = request.args.get("source", "curated")
    log.info("TRENDS  /inspirations  source=%r", source)
    if source == "hackernews": return jsonify(_fetch_hackernews())
    if source == "github":     return jsonify(_fetch_github_trending())
    if source == "mastodon":   return jsonify(_fetch_mastodon_trends())
    if source == "youtube":    return jsonify(_fetch_youtube_trends())
    if source == "reddit":     return jsonify(_fetch_reddit_trends())
    return jsonify(CURATED_IDEAS)

@app.route("/api/trends/subreddit")
def api_trends_subreddit():
    """Fetch hot posts from a specific subreddit for drill-down view."""
    name = request.args.get("name", "").strip().lstrip("r/")
    if not name or not re.match(r'^[A-Za-z0-9_]+$', name):
        return jsonify({"success": False, "error": "Invalid subreddit name"})
    try:
        r = req_lib.get(
            f"https://www.reddit.com/r/{name}/hot.json",
            params={"limit": 25},
            headers={"User-Agent": "CloneMe/1.0"},
            timeout=8,
        )
        if r.status_code != 200:
            return jsonify({"success": False, "error": f"HTTP {r.status_code}"})
        posts = []
        for child in r.json().get("data", {}).get("children", []):
            d = child.get("data", {})
            title = d.get("title", "")
            posts.append({
                "title":      title,
                "author":     d.get("author", ""),
                "score":      d.get("score", 0),
                "n_comments": d.get("num_comments", 0),
                "url":        f"https://reddit.com{d.get('permalink', '')}",
                "subreddit":  d.get("subreddit_name_prefixed", f"r/{name}"),
                "prompt":     f"Build a web app inspired by: {title}",
            })
        log.info("TRENDS  subreddit r/%s returned %d posts", name, len(posts))
        return jsonify({"success": True, "posts": posts})
    except Exception as e:
        log.error("TRENDS  subreddit fetch failed: %s", e)
        return jsonify({"success": False, "error": str(e)})

@app.route("/api/trends/search")
def api_trends_search():
    """Platform-native search: queries the actual source API."""
    source = request.args.get("source", "").strip()
    query  = request.args.get("q", "").strip()
    if not query:
        return jsonify([])
    log.info("SEARCH  source=%s  q=%s", source, query[:60])
    if source == "mastodon":   return jsonify(_search_mastodon(query))
    if source == "hackernews": return jsonify(_search_hackernews(query))
    if source == "github":     return jsonify(_search_github(query))
    if source == "reddit":     return jsonify(_search_reddit(query))
    if source == "youtube":    return jsonify(_search_youtube(query))
    return jsonify([{"error": f"Search not supported for source '{source}'"}])

def _search_mastodon(query: str) -> list:
    items = []
    headers = {"Authorization": f"Bearer {MASTODON_TOKEN}"} if MASTODON_TOKEN else {}
    try:
        r = req_lib.get(f"{MASTODON_BASE}/api/v2/search",
            params={"q": query, "type": "hashtags", "limit": 10, "resolve": "false"},
            headers=headers, timeout=8)
        if r.status_code == 200:
            for tag in r.json().get("hashtags", []):
                name = tag["name"]
                items.append({
                    "title":      f"#{name}",
                    "description": f"Mastodon hashtag",
                    "prompt":     f"Create a web app dashboard about #{name} — stats, timeline, related content",
                    "source":     "mastodon",
                    "source_url": f"{MASTODON_BASE}/tags/{name}",
                    "tags":       ["mastodon", f"#{name}"],
                    "is_tag":     True,
                })
    except Exception as e:
        log.warning("SEARCH  Mastodon hashtag search failed: %s", e)
    try:
        r = req_lib.get(f"{MASTODON_BASE}/api/v2/search",
            params={"q": query, "type": "statuses", "limit": 15, "resolve": "false"},
            headers=headers, timeout=8)
        if r.status_code == 200:
            for s in r.json().get("statuses", []):
                text = re.sub(r"<[^>]+>", " ", s.get("content", "")).strip()
                text = re.sub(r"\s{2,}", " ", text)[:120]
                if len(text) > 10:
                    items.append({
                        "title":      text[:70] + ("…" if len(text) > 70 else ""),
                        "description": f"Post · {s.get('reblogs_count', 0)} boosts · {s.get('favourites_count', 0)} likes",
                        "prompt":     f"Build an interactive app inspired by: {text}",
                        "source":     "mastodon",
                        "source_url": s.get("url", ""),
                        "tags":       ["mastodon"],
                        "is_tag":     False,
                    })
    except Exception as e:
        log.warning("SEARCH  Mastodon status search failed: %s", e)
    return items or [{"error": f"No Mastodon results for '{query}'"}]

def _search_hackernews(query: str) -> list:
    try:
        r = req_lib.get("https://hn.algolia.com/api/v1/search",
            params={"query": query, "tags": "story", "hitsPerPage": 20},
            timeout=8)
        items = []
        for hit in r.json().get("hits", []):
            title = (hit.get("title") or "").replace("Show HN: ", "").strip()
            if not title:
                continue
            items.append({
                "title":       title,
                "description": f"{hit.get('points', 0)} points · {hit.get('num_comments', 0)} comments",
                "prompt":      f"Build a web app inspired by: {title}",
                "source":      "hackernews",
                "source_url":  hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}",
                "tags":        ["hn"],
            })
        log.info("SEARCH  HN returned %d hits", len(items))
        return items or [{"error": f"No HN results for '{query}'"}]
    except Exception as e:
        log.error("SEARCH  HN search failed: %s", e)
        return [{"error": str(e)}]

def _search_github(query: str) -> list:
    try:
        r = req_lib.get(
            "https://api.github.com/search/repositories",
            headers={"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"},
            params={"q": query, "sort": "stars", "per_page": 20},
            timeout=8)
        items = []
        for repo in r.json().get("items", []):
            desc = repo.get("description") or "An open-source project"
            items.append({
                "title":       repo["name"].replace("-", " ").replace("_", " ").title(),
                "description": desc[:100],
                "prompt":      f"Build a web app similar to {repo['name']}: {desc}",
                "source":      "github",
                "source_url":  repo["html_url"],
                "tags":        (repo.get("topics") or [])[:3] + [f"⭐ {repo['stargazers_count']:,}"],
            })
        log.info("SEARCH  GitHub returned %d repos", len(items))
        return items or [{"error": f"No GitHub results for '{query}'"}]
    except Exception as e:
        log.error("SEARCH  GitHub search failed: %s", e)
        return [{"error": str(e)}]

def _search_reddit(query: str) -> list:
    try:
        r = req_lib.get(
            "https://www.reddit.com/search.json",
            params={"q": query, "type": "link", "limit": 25, "sort": "relevance"},
            headers={"User-Agent": "CloneMe/1.0"},
            timeout=8)
        items = []
        for child in r.json().get("data", {}).get("children", []):
            d = child.get("data", {})
            title = d.get("title", "")
            if not title:
                continue
            items.append({
                "title":       title,
                "description": f"r/{d.get('subreddit', '')} · {d.get('score', 0):,} upvotes · {d.get('num_comments', 0)} comments",
                "prompt":      f"Build a web app or data visualisation inspired by: {title}",
                "source":      "reddit",
                "source_url":  f"https://reddit.com{d.get('permalink', '')}",
                "tags":        ["reddit", f"r/{d.get('subreddit', '')}"],
                "subreddit":   f"r/{d.get('subreddit', '')}",
                "score":       d.get("score", 0),
                "is_tag":      False,
            })
        log.info("SEARCH  Reddit returned %d posts", len(items))
        return items or [{"error": f"No Reddit results for '{query}'"}]
    except Exception as e:
        log.error("SEARCH  Reddit search failed: %s", e)
        return [{"error": str(e)}]

def _search_youtube(query: str) -> list:
    if not YOUTUBE_API_KEY:
        return [{"error": "YOUTUBE_API_KEY not configured"}]
    try:
        r = req_lib.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={"part": "snippet", "q": query, "type": "video",
                    "maxResults": 15, "key": YOUTUBE_API_KEY, "regionCode": "US"},
            timeout=8)
        items = []
        for v in r.json().get("items", []):
            snip   = v["snippet"]
            vid_id = v.get("id", {}).get("videoId", "")
            items.append({
                "title":       snip["title"],
                "description": snip.get("channelTitle", ""),
                "prompt":      f"Create a web app or analysis inspired by the YouTube video: {snip['title']}",
                "source":      "youtube",
                "source_url":  f"https://youtube.com/watch?v={vid_id}",
                "tags":        ["youtube", snip.get("channelTitle", "")],
            })
        log.info("SEARCH  YouTube returned %d videos", len(items))
        return items or [{"error": f"No YouTube results for '{query}'"}]
    except Exception as e:
        log.error("SEARCH  YouTube search failed: %s", e)
        return [{"error": str(e)}]

# ── Tasks service ─────────────────────────────────────────────────────────────
@app.route("/api/tasks")
def api_tasks():
    with _tasks_lock:
        sorted_tasks = sorted(_tasks.values(), key=lambda t: t["created_at"], reverse=True)[:50]
    running  = sum(1 for t in sorted_tasks if t["status"] == "running")
    log.debug("TASKS  listing %d tasks  (%d running)", len(sorted_tasks), running)
    return jsonify(sorted_tasks)

# ── AI Agent service ──────────────────────────────────────────────────────────
@app.route("/api/clarify", methods=["POST"])
def clarify():
    data   = request.get_json(force=True)
    prompt = data.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "prompt required"}), 400
    resp = _anthropic.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=700,
        system=INTENT_SYSTEM,
        messages=[{"role": "user", "content": f"App request: {prompt}"}],
    )
    raw = resp.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        intent = json.loads(raw)
        return jsonify({"success": True, "intent": intent})
    except json.JSONDecodeError:
        return jsonify({"success": False, "error": "Intent parsing failed"})

@app.route("/api/chat", methods=["POST"])
def chat():
    data        = request.get_json(force=True)
    prompt      = data.get("prompt", "").strip()
    intent      = data.get("intent")
    model       = data.get("model", DEFAULT_MODEL)
    history     = data.get("history", [])      # [{role, content}] from the frontend tab
    repo_context = data.get("repoContext")     # {repoName, repoUrl} if follow-up on existing build
    if model not in ALLOWED_MODELS:
        log.warning("CHAT  unsupported model %r — falling back to %s", model, DEFAULT_MODEL)
        model = DEFAULT_MODEL
    if not prompt:
        log.warning("CHAT  empty prompt received")
        return {"error": "prompt is required"}, 400

    # Build prior-messages list from frontend history (text only, capped at 20)
    prior_messages = None
    if history:
        prior_messages = []
        for h in history[-20:]:
            role    = h.get("role", "")
            content = str(h.get("content", "")).strip()
            if role in ("user", "assistant") and content:
                prior_messages.append({"role": role, "content": content})
        if not prior_messages:
            prior_messages = None
        else:
            log.info("CHAT  history  : %d prior messages", len(prior_messages))

    print(f"\n{'─'*55}", flush=True, file=_sys.stderr)
    print(f"  PROMPT  [{model}]", flush=True, file=_sys.stderr)
    print(f"  {prompt[:300]}", flush=True, file=_sys.stderr)
    print(f"{'─'*55}", flush=True, file=_sys.stderr)
    log.info("CHAT  ── new request ─────────────────────────────────")
    log.info("CHAT  model  : %s", model)
    log.info("CHAT  prompt : %s", prompt[:300])
    # Prepend repo context to prompt so agent knows which repo to update
    effective_prompt = prompt
    if repo_context and isinstance(repo_context, dict):
        repo_name = repo_context.get("repoName", "")
        repo_url  = repo_context.get("repoUrl", "")
        if repo_name:
            effective_prompt = (
                f"[Existing repo: {repo_name}"
                + (f" — {repo_url}" if repo_url else "")
                + f"]\n\n{prompt}"
            )
            log.info("CHAT  repo context injected: %s", repo_name)

    tid = _new_task("AI Chat", prompt[:80])

    def _stream_and_track():
        try:
            for chunk in run_agent_stream(effective_prompt, intent, model,
                                          prior_messages=prior_messages):
                yield chunk
        except Exception as e:
            log.error("CHAT  stream error: %s", e, exc_info=True)
            yield _sse("text", content=f"\n\n**Error:** {e}")
            yield _sse("done")   # always unlock the frontend
        finally:
            _finish_task(tid, "done")
            log.info("CHAT  task %s finished", tid)

    return Response(
        _stream_and_track(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.route("/api/chat/continue", methods=["POST"])
def chat_continue():
    data       = request.get_json(force=True)
    session_id = data.get("session_id", "").strip()
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    with _truncated_lock:
        sess = _truncated_sessions.pop(session_id, None)
    if not sess:
        return jsonify({"error": "Session not found or already used"}), 404

    # Evict stale sessions (older than 30 minutes) while we have the lock
    _now = time.time()
    with _truncated_lock:
        stale = [k for k, v in _truncated_sessions.items() if _now - v["created_at"] > 1800]
        for k in stale:
            del _truncated_sessions[k]

    tid = _new_task("AI Chat (continue)", "Continuing truncated response")
    log.info("CHAT  continuing session %s  model=%s", session_id, sess["model"])

    def _stream_and_track():
        try:
            for chunk in run_agent_stream(None, None, sess["model"], sess["messages"]):
                yield chunk
        except Exception as e:
            log.error("CHAT CONTINUE  error: %s", e, exc_info=True)
            yield _sse("text", content=f"\n\n**Error:** {e}")
            yield _sse("done")
        finally:
            _finish_task(tid, "done")
            log.info("CHAT CONTINUE  task %s finished", tid)

    return Response(
        _stream_and_track(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ── Google debug endpoint ─────────────────────────────────────────────────────
@app.route("/api/google/debug")
def google_debug():
    """Returns credential state — use this to diagnose OAuth issues."""
    info = {
        "google_available":   GOOGLE_AVAILABLE,
        "client_id_set":      bool(GOOGLE_CLIENT_ID),
        "client_secret_set":  bool(GOOGLE_CLIENT_SECRET),
        "tokens_file_exists": TOKENS_FILE.exists(),
        "tokens_path":        str(TOKENS_FILE),
    }
    if TOKENS_FILE.exists():
        try:
            raw = json.loads(TOKENS_FILE.read_text())
            info["saved_email"]         = raw.get("email", "")
            info["has_token"]           = bool(raw.get("token"))
            info["has_refresh_token"]   = bool(raw.get("refresh_token"))
            creds = _get_google_creds()
            info["creds_valid"]         = creds is not None
            if creds:
                info["creds_token_present"]  = bool(creds.token)
                info["creds_expired"]        = creds.expired
                info["creds_expiry"]         = str(creds.expiry)
        except Exception as ex:
            info["parse_error"] = str(ex)
    return jsonify(info)

# ── Health check ──────────────────────────────────────────────────────────────
@app.route("/api/health")
def health():
    google_status_val = False
    if GOOGLE_AVAILABLE and TOKENS_FILE.exists():
        creds = _get_google_creds()
        google_status_val = creds is not None
    checks = {
        "anthropic": bool(os.getenv("ANTHROPIC_API_KEY")),
        "github":    bool(GITHUB_TOKEN and GITHUB_USERNAME),
        "mastodon":  bool(MASTODON_TOKEN),
        "google":    google_status_val,
        "youtube":   bool(YOUTUBE_API_KEY),
    }
    return jsonify({"status": "ok" if checks["anthropic"] else "degraded", "checks": checks})

# ── Preview server ────────────────────────────────────────────────────────────
@app.route("/preview/<path:filename>")
def preview(filename):
    parts = filename.split("/", 1)
    repo  = parts[0]
    rest  = parts[1] if len(parts) > 1 else "index.html"
    return send_from_directory(PREVIEWS_DIR / repo, rest)

@app.route("/api/previews")
def list_previews():
    dirs = [d.name for d in PREVIEWS_DIR.iterdir() if d.is_dir()]
    return jsonify(dirs)

# ── Build registry API ────────────────────────────────────────────────────────
@app.route("/api/builds")
def list_builds():
    builds = _load_builds()
    tracked = {b["repo_name"] for b in builds}
    # Surface any legacy preview folders not yet in the registry
    if PREVIEWS_DIR.exists():
        for d in sorted(PREVIEWS_DIR.iterdir(), key=lambda p: -p.stat().st_ctime):
            if d.is_dir() and d.name not in tracked:
                builds.append({
                    "repo_name":   d.name,
                    "description": "",
                    "repo_url":    f"https://github.com/{GITHUB_USERNAME}/{d.name}" if GITHUB_USERNAME else "",
                    "full_name":   f"{GITHUB_USERNAME}/{d.name}" if GITHUB_USERNAME else d.name,
                    "created_at":  datetime.fromtimestamp(d.stat().st_ctime, tz=timezone.utc).isoformat(),
                    "status":      "ready",
                    "files_count": sum(1 for _ in d.rglob("*") if _.is_file()),
                    "preview_url": f"/preview/{d.name}/",
                    "legacy":      True,
                })
    for b in builds:
        b["has_preview"] = (PREVIEWS_DIR / b["repo_name"]).is_dir()
    return jsonify(builds)

@app.route("/api/builds/<repo_name>", methods=["DELETE"])
def delete_build(repo_name):
    import shutil
    # Validate name (prevent path traversal)
    if not re.match(r'^[a-zA-Z0-9_\-\.]+$', repo_name):
        return jsonify({"success": False, "error": "Invalid repo name"}), 400

    github_deleted = False
    github_error   = None
    if GITHUB_TOKEN and GITHUB_USERNAME:
        r = _gh("delete", f"/repos/{GITHUB_USERNAME}/{repo_name}")
        if r.status_code == 204:
            github_deleted = True
        elif r.status_code == 404:
            github_deleted = True  # already gone
        else:
            github_error = f"GitHub returned {r.status_code}"

    preview_dir = PREVIEWS_DIR / repo_name
    if preview_dir.exists():
        shutil.rmtree(preview_dir)

    builds = _load_builds()
    builds = [b for b in builds if b.get("repo_name") != repo_name]
    _save_builds(builds)

    return jsonify({"success": True, "github_deleted": github_deleted, "github_error": github_error})

# ── Static frontend ───────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory("frontend", "index.html")

@app.route("/<path:path>")
def frontend_files(path):
    return send_from_directory("frontend", path)

def _heartbeat():
    """Print a timestamp every 60 s so you know the server is alive."""
    while True:
        time.sleep(60)
        print(f"  ♥  still running — {time.strftime('%H:%M:%S')}", flush=True, file=_sys.stderr)

if __name__ == "__main__":
    log.info("Starting Flask dev server on http://127.0.0.1:5000")
    log.info("Log file: %s", _LOG_FILE)
    print(f"\n  ✓  CloneMe ready at http://127.0.0.1:5000", flush=True, file=_sys.stderr)
    print(f"  ✓  Open that URL in your browser, then logs appear here as you use the app.\n", flush=True, file=_sys.stderr)
    threading.Thread(target=_heartbeat, daemon=True).start()
    app.run(debug=False, host="0.0.0.0", port=5000, threaded=True)
