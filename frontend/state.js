/* ── Shared DOM refs ─────────────────────────────────────────────────────────
   Loaded first so every module can reference these constants.
   ──────────────────────────────────────────────────────────────────────────── */
const promptInput    = document.getElementById('prompt-input');
const sendBtn        = document.getElementById('send-btn');
const modelSelect    = document.getElementById('model-select');
const chatFeed       = document.getElementById('chat-feed');

/* ── App-wide state ──────────────────────────────────────────────────────────*/
let currentSection     = 'trends';
let currentTrendSource = 'mastodon';
let emailFilter        = '';
let currentEmailId     = null;
let _ideasSource       = 'curated';

/* ── Chat tab state ──────────────────────────────────────────────────────────*/
let tabs         = [];
let activeTabIdx = 0;
function currentTab() { return tabs[activeTabIdx]; }

/* ── Agent abort controller ──────────────────────────────────────────────────*/
let _agentAbort = null;
