/* ── Pure helper utilities ───────────────────────────────────────────────────
   No DOM refs, no state. Safe to load before everything else.
   ──────────────────────────────────────────────────────────────────────────── */

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}

function handleKey(e) {
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendPrompt(); }
}

function relativeTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000)    return 'just now';
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return ''; }
}

function langFrom(p) {
  if (p.endsWith('.html')) return 'html';
  if (p.endsWith('.css'))  return 'css';
  if (p.endsWith('.js'))   return 'javascript';
  if (p.endsWith('.py'))   return 'python';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.md'))   return 'markdown';
  return 'plaintext';
}

function toolLabel(name) {
  return {
    create_github_repo:    'Create GitHub Repo',
    push_files_to_repo:    'Push Files to Repo',
    post_to_mastodon:      'Post to Mastodon',
    get_email_inbox:       'Read Gmail Inbox',
    get_calendar_events:   'Fetch Calendar Events',
    create_calendar_event: 'Create Calendar Event',
    fetch_trends:          'Fetch Trends',
  }[name] || name;
}

async function copyText(text, btn) {
  await navigator.clipboard.writeText(text).catch(() => {});
  const orig = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = orig; }, 1400);
}

function avatarColour(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return `hsl(${Math.abs(h) % 360},55%,40%)`;
}

function formatEmailDate(dateStr) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function formatCalTime(isoStr) {
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}
