/* ── CloneMe — main init ─────────────────────────────────────────────────────
   Section routing · health check · Google OAuth status · init calls.
   All other logic lives in the section-specific modules loaded before this.
   ──────────────────────────────────────────────────────────────────────────── */

// ── Section routing ───────────────────────────────────────────────────────────
window.switchSection = function (name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${name}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${name}"]`)?.classList.add('active');
  currentSection = name;

  if (name === 'email')    loadEmails();
  if (name === 'calendar') loadCalendar();
  if (name === 'trends')   loadTrends(currentTrendSource);
  if (name === 'tasks')    loadTasks();
};

// ── Service health ────────────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const d   = await fetch('/api/health').then(r => r.json());
    const row = document.getElementById('health-row');
    if (!row) return;
    row.innerHTML = Object.entries(d.checks).map(([k, ok]) =>
      `<div class="hdot ${ok ? 'ok' : 'error'}" title="${k}: ${ok ? 'ok' : 'not configured'}">${k[0].toUpperCase()}</div>`
    ).join('');
  } catch {}
}

// ── Google OAuth status ───────────────────────────────────────────────────────
async function checkGoogleStatus() {
  try {
    const d  = await fetch('/api/google/status').then(r => r.json());
    const el = document.getElementById('nav-google-status');
    if (!el) return;
    if (d.connected) {
      el.className = 'nav-google-status connected';
      el.textContent = `● ${d.email || 'Google connected'}`;
      document.querySelectorAll('#gmail-connect-area, #cal-connect-area').forEach(area => {
        area.innerHTML = `<span style="font-size:11px;color:var(--green)">● ${d.email || 'Connected'}</span>
          <button class="icon-btn" onclick="disconnectGoogle()" title="Disconnect Google" style="margin-left:6px">✕</button>`;
      });
      const emailLbl = document.getElementById('email-account-label');
      const calLbl   = document.getElementById('cal-account-label');
      if (emailLbl) emailLbl.textContent = d.email || 'Gmail connected';
      if (calLbl)   calLbl.textContent   = d.email ? `${d.email} calendar` : 'Google Calendar connected';
      document.getElementById('email-connect-prompt')?.style.setProperty('display', 'none');
      document.getElementById('cal-connect-prompt')?.style.setProperty('display', 'none');
    } else {
      el.className  = 'nav-google-status';
      el.textContent = '';
    }
  } catch {}
}

window.disconnectGoogle = async function () {
  await fetch('/api/google/disconnect', { method: 'POST' });
  location.reload();
};

// ── OAuth return handler ──────────────────────────────────────────────────────
// Uses setTimeout so all module functions are defined before we try to call them
(function checkOAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('connected')) {
    history.replaceState({}, '', '/');
    checkGoogleStatus();
    setTimeout(() => { loadEmails(); loadCalendar(); }, 0);
  }
  if (params.has('error')) {
    const err = params.get('error');
    history.replaceState({}, '', '/');
    console.error('[CloneMe] OAuth error:', err);
    setTimeout(() => {
      const list = document.getElementById('email-list');
      if (list) list.innerHTML = `<div style="padding:20px;color:var(--red);font-size:13px">Google sign-in failed (${esc(err)}). Please try again.</div>`;
    }, 0);
  }
})();

// ── Startup ───────────────────────────────────────────────────────────────────
checkHealth();
checkGoogleStatus();
if (typeof refreshEmailProviderStatus === 'function') refreshEmailProviderStatus();
setInterval(checkHealth, 30000);
// Boot into Trends — call after all modules are ready
setTimeout(() => { if (typeof loadTrends === 'function') loadTrends(currentTrendSource); }, 0);
