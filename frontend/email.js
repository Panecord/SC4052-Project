/* ── Email section ───────────────────────────────────────────────────────────
   Multi-provider inbox: Gmail (OAuth) + Outlook/Yahoo (IMAP).
   30 emails per load, "Load more" pagination.
   ──────────────────────────────────────────────────────────────────────────── */

// ── Provider state ────────────────────────────────────────────────────────────
let _emailProvider   = 'gmail';   // 'gmail' | 'outlook' | 'yahoo'
let _emailPageToken  = '';        // Gmail next-page token
let _emailOffset     = 0;         // IMAP offset
let _emailHasMore    = false;
const PAGE_SIZE      = 30;

// ── Provider tabs ─────────────────────────────────────────────────────────────
window.switchEmailProvider = function (btn) {
  const provider = btn.dataset.provider;

  // If IMAP provider and not yet connected, open connect modal
  if (provider !== 'gmail') {
    const hints = document.getElementById(`${provider}-connect-hint`);
    if (hints && hints.style.display !== 'none') {
      openImapModal(provider);
      return;
    }
  }

  document.querySelectorAll('.email-provider-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  _emailProvider = provider;
  _emailPageToken = '';
  _emailOffset    = 0;
  emailFilter     = '';
  // Reset filter buttons
  document.querySelectorAll('.filter-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  loadEmails();
};

// Called from app.js after Google status check — update IMAP connect hints
window.refreshEmailProviderStatus = async function () {
  try {
    const status = await fetch('/api/email/status').then(r => r.json());
    for (const provider of ['outlook', 'yahoo']) {
      const hint = document.getElementById(`${provider}-connect-hint`);
      if (!hint) continue;
      if (status[provider]?.connected) {
        hint.style.display = 'none';
        const tab = document.querySelector(`.email-provider-tab[data-provider="${provider}"]`);
        if (tab) tab.title = status[provider].email || '';
      } else {
        hint.style.display = '';
      }
    }
  } catch {}
};

// ── Filter ────────────────────────────────────────────────────────────────────
window.setEmailFilter = function (btn, filter) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  emailFilter = filter;
  _emailPageToken = '';
  _emailOffset    = 0;
  loadEmails();
};

// ── Load inbox ────────────────────────────────────────────────────────────────
window.loadEmails = async function () {
  const list  = document.getElementById('email-list');
  const query = (document.getElementById('email-search')?.value || '').trim();
  const q     = [emailFilter, query].filter(Boolean).join(' ');
  const moreRow = document.getElementById('email-load-more-row');

  list.innerHTML = `<div class="loading-state"><div class="spin"></div><span>Loading inbox…</span></div>`;
  if (moreRow) moreRow.style.display = 'none';
  _emailPageToken = '';
  _emailOffset    = 0;

  const data = await _fetchEmails(q, 0, '');
  if (!data) return;

  _renderEmailList(list, data, false);
  _updateLoadMore(data);
};

// ── Load more ─────────────────────────────────────────────────────────────────
window.loadMoreEmails = async function () {
  const list  = document.getElementById('email-list');
  const query = (document.getElementById('email-search')?.value || '').trim();
  const q     = [emailFilter, query].filter(Boolean).join(' ');
  const btn   = document.querySelector('.email-load-more-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  const data = await _fetchEmails(q, _emailOffset, _emailPageToken);
  if (!data) {
    if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
    return;
  }

  _renderEmailList(list, data, true);
  _updateLoadMore(data);
  if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
};

async function _fetchEmails(q, offset, pageToken) {
  const list = document.getElementById('email-list');
  try {
    let url, data;
    if (_emailProvider === 'gmail') {
      url = `/api/gmail/inbox?limit=${PAGE_SIZE}`;
      if (q)         url += `&q=${encodeURIComponent(q)}`;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      data = await fetch(url).then(r => r.json());

      if (!data.success) {
        const notConn = data.error?.toLowerCase().includes('not connected')
                     || data.error?.toLowerCase().includes('gmail not connected');
        list.innerHTML = notConn
          ? `<div class="connect-prompt" id="email-connect-prompt">
               <div class="connect-prompt-icon">✉</div>
               <h3>Connect Gmail</h3>
               <p>Click "Connect Google" above to read and analyse your emails with AI.</p>
             </div>`
          : `<div style="padding:20px;color:var(--red);font-size:13px"><strong>Error:</strong><br>${esc(data.error || 'Unknown error')}</div>`;
        return null;
      }
    } else {
      url = `/api/email/inbox?provider=${_emailProvider}&limit=${PAGE_SIZE}&offset=${offset}`;
      data = await fetch(url).then(r => r.json());

      if (!data.success) {
        const notConn = data.error?.toLowerCase().includes('not connected');
        list.innerHTML = notConn
          ? `<div class="connect-prompt">
               <div class="connect-prompt-icon">✉</div>
               <h3>Connect ${_emailProvider.charAt(0).toUpperCase() + _emailProvider.slice(1)}</h3>
               <p>Click the provider tab to connect your account.</p>
             </div>`
          : `<div style="padding:20px;color:var(--red);font-size:13px"><strong>Error:</strong><br>${esc(data.error || 'Unknown error')}</div>`;
        return null;
      }
    }
    return data;
  } catch (e) {
    list.innerHTML = `<div style="padding:20px;color:var(--red);font-size:13px">Error: ${esc(e.message)}</div>`;
    return null;
  }
}

function _renderEmailList(list, data, append) {
  const emails = data.emails || [];

  // Update badge (only on fresh load)
  if (!append) {
    const unread = emails.filter(e => e.unread).length;
    const badge  = document.getElementById('email-badge');
    if (badge) { badge.textContent = unread; badge.style.display = unread ? '' : 'none'; }
  }

  if (!append && !emails.length) {
    list.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-3);font-size:13px">No emails found.</div>`;
    return;
  }

  const html = emails.map(email => {
    const name   = email.from.replace(/<[^>]+>/, '').trim() || email.from;
    const letter = (name[0] || '?').toUpperCase();
    const colour = avatarColour(email.from);
    const prov   = email.provider || _emailProvider;
    return `
      <div class="email-card ${email.unread ? 'unread' : ''}"
           onclick="openEmail('${esc(email.id)}','${esc(prov)}')" >
        <div class="email-avatar" style="background:${colour}">${esc(letter)}</div>
        <div class="email-body">
          <div class="email-from">${esc(name)}</div>
          <div class="email-subject">${esc(email.subject)}</div>
          <div class="email-snippet">${esc(email.snippet || '')}</div>
        </div>
        <div class="email-meta">
          <div class="email-date">${esc(formatEmailDate(email.date))}</div>
          ${email.unread ? '<div class="email-unread-dot"></div>' : ''}
        </div>
      </div>`;
  }).join('');

  if (append) {
    list.insertAdjacentHTML('beforeend', html);
  } else {
    list.innerHTML = html;
  }

  // Advance pagination cursors
  if (_emailProvider === 'gmail') {
    _emailPageToken = data.next_page_token || '';
    _emailHasMore   = !!_emailPageToken;
  } else {
    _emailOffset += emails.length;
    _emailHasMore = (_emailOffset < (data.total || 0));
  }
}

function _updateLoadMore(data) {
  const moreRow = document.getElementById('email-load-more-row');
  if (!moreRow) return;
  moreRow.style.display = _emailHasMore ? '' : 'none';
}

// ── Open email ────────────────────────────────────────────────────────────────
window.openEmail = async function (id, provider) {
  provider = provider || _emailProvider;
  currentEmailId = id;
  const reader = document.getElementById('email-reader');
  reader.style.display       = 'flex';
  reader.style.flexDirection = 'column';

  document.getElementById('reader-subject').textContent = 'Loading…';
  document.getElementById('reader-meta').textContent    = '';
  document.getElementById('reader-body').textContent    = '';
  document.getElementById('reader-ai-output').style.display = 'none';

  try {
    const url  = provider === 'gmail'
      ? `/api/gmail/message/${id}`
      : `/api/email/message/${provider}/${id}`;
    const data = await fetch(url).then(r => r.json());
    if (!data.success) {
      document.getElementById('reader-subject').textContent = 'Failed to load';
      return;
    }
    document.getElementById('reader-subject').textContent = data.subject;
    document.getElementById('reader-meta').innerHTML =
      `<strong>From:</strong> ${esc(data.from)}<br><strong>Date:</strong> ${esc(data.date)}`;
    document.getElementById('reader-body').textContent = data.body || '(No body)';
  } catch {
    document.getElementById('reader-subject').textContent = 'Error loading email';
  }
};

window.closeEmailReader = function () {
  document.getElementById('email-reader').style.display = 'none';
  currentEmailId = null;
};

window.summariseEmail = function () {
  const body   = document.getElementById('reader-body').textContent;
  const output = document.getElementById('reader-ai-output');
  output.style.display = 'block';
  output.textContent   = 'Summarising…';
  _emailAIStream(`Summarise this email in 3 bullet points and list any action items:\n\n${body.slice(0, 4000)}`);
};

window.draftReply = function () {
  const subject = document.getElementById('reader-subject').textContent;
  const body    = document.getElementById('reader-body').textContent;
  const output  = document.getElementById('reader-ai-output');
  output.style.display = 'block';
  output.textContent   = 'Drafting reply…';
  _emailAIStream(`Draft a polite, professional reply to this email.\nSubject: ${subject}\n\n${body.slice(0, 3000)}`);
};

// Stream a prompt to /api/chat and display the result in the reader AI output pane
async function _emailAIStream(prompt) {
  const output = document.getElementById('reader-ai-output');
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: 'claude-haiku-4-5-20251001' }),
    });
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   result  = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'text') { result += d.content; output.textContent = result; }
        } catch {}
      }
    }
  } catch (e) {
    output.textContent = `Error: ${e.message}`;
  }
}

// ── IMAP connect modal ────────────────────────────────────────────────────────
let _imapModalProvider = '';

window.openImapModal = function (provider) {
  _imapModalProvider = provider;
  const title = document.getElementById('imap-modal-title');
  const hint  = document.getElementById('imap-modal-hint');
  if (title) title.textContent = `Connect ${provider.charAt(0).toUpperCase() + provider.slice(1)}`;
  if (hint) {
    hint.innerHTML = provider === 'yahoo'
      ? 'Use your Yahoo email and an <strong>App Password</strong> (not your main password). Generate one at <em>Yahoo Account Security → App passwords</em>.'
      : '⚠ <strong>Personal @outlook.com / @hotmail.com accounts only.</strong> School/work accounts (e.g. NTU @e.ntu.edu.sg) block basic auth — they require OAuth which isn\'t supported here.<br><br>For personal accounts: enable IMAP and generate an <strong>App Password</strong> at <em>account.microsoft.com → Security → Advanced security options</em>.';
  }
  const err = document.getElementById('imap-error');
  if (err) err.style.display = 'none';
  document.getElementById('imap-email').value    = '';
  document.getElementById('imap-password').value = '';
  document.getElementById('imap-modal').classList.add('open');
};

window.closeImapModal = function () {
  document.getElementById('imap-modal').classList.remove('open');
};

window.saveImapAccount = async function () {
  const em  = document.getElementById('imap-email').value.trim();
  const pw  = document.getElementById('imap-password').value;
  const err = document.getElementById('imap-error');
  const btn = document.getElementById('imap-save-btn');
  if (!em || !pw) { err.textContent = 'Email and password are required.'; err.style.display = ''; return; }

  btn.disabled = true; btn.textContent = 'Connecting…';
  err.style.display = 'none';

  try {
    const data = await fetch('/api/email/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: _imapModalProvider, email: em, password: pw }),
    }).then(r => r.json());

    if (data.success) {
      closeImapModal();
      // Hide "+ Connect" hint and switch to the tab
      const hint = document.getElementById(`${_imapModalProvider}-connect-hint`);
      if (hint) hint.style.display = 'none';
      const tab = document.querySelector(`.email-provider-tab[data-provider="${_imapModalProvider}"]`);
      if (tab) switchEmailProvider(tab);
    } else {
      err.textContent = data.error || 'Connection failed';
      err.style.display = '';
    }
  } catch (e) {
    err.textContent = `Error: ${e.message}`;
    err.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Connect';
  }
};
