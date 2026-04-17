/* ── Chat section ────────────────────────────────────────────────────────────
   Tab management · feed rendering · SSE · Blueprint · send flow · results panel
   ──────────────────────────────────────────────────────────────────────────── */

// ── Tab system ────────────────────────────────────────────────────────────────
function newRunState() {
  return { repoUrl: null, repoName: null, previewUrl: null, files: [], fileContents: {}, mastodonText: null, mastodonUrl: null };
}

function newTabObj(name) {
  const feedEl    = document.createElement('div');
  feedEl.className = 'tab-feed';
  const resultsEl = document.createElement('div');
  resultsEl.className = 'tab-results-pane';
  resultsEl.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0';
  resultsEl.innerHTML = `<div class="results-empty">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <p>Built apps and outputs appear here.</p>
  </div>`;
  return {
    id: Date.now() + Math.random(), name: name || 'Chat',
    feedEl, resultsEl,
    _statusEl: null, _textEl: null, _cards: {},
    _infoToolIds: new Set(),
    state: newRunState(),
    history: [],   // [{role:'user'|'assistant', content:string}] — text only
  };
}

window.addTab = function (name) {
  const tab = newTabObj(name || 'Chat');
  tabs.push(tab);
  chatFeed.appendChild(tab.feedEl);
  document.getElementById('results-panel').appendChild(tab.resultsEl);

  if (tabs.length > 1) {
    tab.feedEl.innerHTML = `<div class="chat-welcome" style="padding-top:48px">
      <div class="welcome-avatar" style="width:40px;height:40px;font-size:18px">C</div>
      <h2 style="font-size:18px">New session</h2>
      <p>Ask anything in this tab.</p>
    </div>`;
  }

  switchToTab(tabs.length - 1);
  promptInput.focus();
  return tab;
};

window.switchToTab = function (idx) {
  activeTabIdx = idx;
  const panelOpen = document.getElementById('results-panel')?.style.display !== 'none';
  tabs.forEach((t, i) => {
    t.feedEl.style.display       = i === idx ? 'flex' : 'none';
    t.feedEl.style.flexDirection = 'column';
    t.resultsEl.style.display    = (i === idx && panelOpen) ? 'flex' : 'none';
    t.resultsEl.style.flexDirection = 'column';
  });
  renderTabBar();
};

window.closeTab = function (idx, e) {
  if (e) e.stopPropagation();
  if (tabs.length === 1) return;
  tabs[idx].feedEl.remove();
  tabs[idx].resultsEl.remove();
  tabs.splice(idx, 1);
  if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
  else if (activeTabIdx > idx)     activeTabIdx--;
  switchToTab(activeTabIdx);
};

function renderTabBar() {
  const bar = document.getElementById('chat-tabs');
  if (!bar) return;
  bar.innerHTML = tabs.map((t, i) => `
    <button class="ctab ${i === activeTabIdx ? 'active' : ''}" onclick="switchToTab(${i})">
      <span class="ctab-name">${esc(t.name)}</span>
      ${tabs.length > 1 ? `<button class="ctab-close" onclick="closeTab(${i},event)">×</button>` : ''}
    </button>`
  ).join('') + `<button class="ctab-new" onclick="addTab()" title="New tab">+</button>`;
}

// Init first tab — adopts existing DOM elements
(function initTabs() {
  const tab = newTabObj('Chat');
  tabs.push(tab);
  while (chatFeed.firstChild) tab.feedEl.appendChild(chatFeed.firstChild);
  chatFeed.appendChild(tab.feedEl);

  const panel = document.getElementById('results-panel');
  const existing = document.getElementById('results-content');
  if (existing) {
    while (existing.firstChild) tab.resultsEl.appendChild(existing.firstChild);
    panel.insertBefore(tab.resultsEl, existing);
    existing.remove();
  } else {
    panel.appendChild(tab.resultsEl);
  }

  tab.feedEl.style.display       = 'flex';
  tab.feedEl.style.flexDirection = 'column';
  tab.resultsEl.style.display    = 'none'; // panel starts hidden
  renderTabBar();
})();

// ── Results panel toggle ──────────────────────────────────────────────────────
window.toggleResultsPanel = function () {
  const panel = document.getElementById('results-panel');
  const btn   = document.getElementById('results-toggle-btn');
  const open  = panel.style.display === 'none' || panel.style.display === '';
  if (open) {
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    btn.classList.add('active');
    btn.title = 'Hide outputs panel';
    const tab = currentTab();
    if (tab) { tab.resultsEl.style.display = 'flex'; tab.resultsEl.style.flexDirection = 'column'; }
  } else {
    panel.style.display = 'none';
    btn.classList.remove('active');
    btn.title = 'Show outputs panel';
  }
};

function showResultsPanel() {
  const panel = document.getElementById('results-panel');
  if (!panel || panel.style.display !== 'none') return;
  const btn = document.getElementById('results-toggle-btn');
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  if (btn) { btn.classList.add('active'); btn.title = 'Hide outputs panel'; }
  const tab = currentTab();
  if (tab) { tab.resultsEl.style.display = 'flex'; tab.resultsEl.style.flexDirection = 'column'; }
}

// ── Ideas panel ───────────────────────────────────────────────────────────────
window.toggleIdeas = function () {
  const panel   = document.getElementById('ideas-panel');
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'flex';
  if (!visible) loadIdeas(_ideasSource);
};

window.switchSource = function (btn) {
  document.querySelectorAll('#ideas-panel .src-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  _ideasSource = btn.dataset.source;
  loadIdeas(_ideasSource);
};

async function loadIdeas(source) {
  const list = document.getElementById('ideas-list');
  list.innerHTML = `<div class="loading-state"><div class="spin"></div><span>Loading…</span></div>`;
  try {
    const items = await fetch(`/api/inspirations?source=${source}`).then(r => r.json());
    if (!items.length || items[0]?.error) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">No ideas available.</div>`;
      return;
    }
    list.innerHTML = items.map((item, i) => `
      <div class="idea-row" onclick="useIdea(${i})">
        <span class="idea-dot"></span>
        <div class="idea-content">
          <div class="idea-title">${esc(item.title)}</div>
          <div class="idea-desc">${esc(item.description || '')}</div>
        </div>
        <span class="idea-arrow">→</span>
      </div>`).join('');
    list._items = items;
  } catch {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">Failed to load ideas.</div>`;
  }
}

window.useIdea = function (i) {
  const list = document.getElementById('ideas-list');
  const item = list._items?.[i];
  if (!item) return;
  promptInput.value = item.prompt;
  autoResize(promptInput);
  promptInput.focus();
  document.getElementById('ideas-panel').style.display = 'none';
};

// ── Feed helpers ──────────────────────────────────────────────────────────────
function scrollFeedDown() {
  const el = currentTab().feedEl;
  el.scrollTop = el.scrollHeight;
}

function appendUserMsg(text) {
  const tab = currentTab();

  // Remove welcome on first message, show quick strip instead
  const welcome = tab.feedEl.querySelector('.chat-welcome');
  if (welcome) {
    welcome.style.transition = 'opacity 0.2s';
    welcome.style.opacity = '0';
    setTimeout(() => welcome.remove(), 200);
    const strip = document.getElementById('quick-strip');
    if (strip) strip.style.display = '';
  }

  const d = document.createElement('div');
  d.className = 'msg-user';
  d.innerHTML = `<div class="msg-user-label">You</div><div class="msg-user-text">${esc(text)}</div>`;
  tab.feedEl.appendChild(d);
  scrollFeedDown();
}

function showStatus(msg) {
  const tab = currentTab();
  if (!tab._statusEl) {
    tab._statusEl = document.createElement('div');
    tab._statusEl.className = 'msg-status';
    tab.feedEl.appendChild(tab._statusEl);
  }
  const text = msg.replace(/[…\.]+$/, '');
  tab._statusEl.innerHTML =
    `<div class="mini-spin"></div><span>${esc(text)}</span>` +
    `<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>`;
  scrollFeedDown();
}

function clearStatus() {
  const tab = currentTab();
  tab._statusEl?.remove();
  tab._statusEl = null;
}

function appendText(chunk) {
  const tab = currentTab();
  if (!tab._textEl) {
    tab._textEl = document.createElement('div');
    tab._textEl.className = 'msg-text';
    tab.feedEl.appendChild(tab._textEl);
  }
  tab._textEl._raw = (tab._textEl._raw || '') + chunk;

  // Render immediately on the first token so the user sees activity right away.
  // After that, throttle re-renders to every 50 ms so partial markdown doesn't
  // flash blank on every individual token during rapid streaming.
  const el  = tab._textEl;
  const now = Date.now();
  if (!el._lastRender) {
    // First token — render immediately
    _renderMd(el);
    el._lastRender = now;
  } else {
    clearTimeout(el._rt);
    el._rt = setTimeout(() => { _renderMd(el); el._lastRender = Date.now(); }, 50);
  }
  scrollFeedDown();
}

function _renderMd(el) {
  if (!el) return;
  try {
    el.innerHTML = marked.parse(el._raw || '');
    el.querySelectorAll('pre code:not(.hljs)').forEach(e => hljs.highlightElement(e));
  } catch (e) { /* keep previous render on parse error */ }
}

function finaliseText() {
  const tab = currentTab();
  if (tab._textEl) {
    clearTimeout(tab._textEl._rt);
    _renderMd(tab._textEl);   // force final render with complete markdown
    tab._textEl = null;
  }
}

// ── Tool cards ────────────────────────────────────────────────────────────────
function createToolCard(id, name) {
  const tab  = currentTab();
  const wrap = document.createElement('div');
  wrap.className = 'tool-card';
  wrap.innerHTML = `
    <div class="tool-header" onclick="toggleToolCard('${id}')">
      <span class="tool-status-dot running" id="tdot-${id}"></span>
      <span class="tool-name-label">${esc(toolLabel(name))}</span>
      <span class="tool-pill running" id="tpill-${id}">running</span>
      <span class="tool-chevron open" id="tchev-${id}">▶</span>
    </div>
    <div class="tool-body open" id="tbody-${id}">
      <div class="tool-label">Input</div>
      <pre class="tool-json" id="tin-${id}"></pre>
      <div class="tool-label" id="trl-${id}" style="display:none">Result</div>
      <pre class="tool-json" id="tres-${id}" style="display:none"></pre>
    </div>`;
  tab.feedEl.appendChild(wrap);
  tab._cards[id] = {
    dot:      wrap.querySelector(`#tdot-${id}`),
    pill:     wrap.querySelector(`#tpill-${id}`),
    body:     wrap.querySelector(`#tbody-${id}`),
    chevron:  wrap.querySelector(`#tchev-${id}`),
    inputEl:  wrap.querySelector(`#tin-${id}`),
    rlabel:   wrap.querySelector(`#trl-${id}`),
    resultEl: wrap.querySelector(`#tres-${id}`),
  };
  scrollFeedDown();
}

window.toggleToolCard = function (id) {
  for (const tab of tabs) {
    const c = tab._cards[id];
    if (c) {
      const open = c.body.classList.toggle('open');
      c.chevron.classList.toggle('open', open);
      return;
    }
  }
};

function setCardInput(id, input) {
  const c = currentTab()._cards[id];
  if (!c) return;
  const compact = { ...input };
  if (compact.files) compact.files = compact.files.map(f => ({ path: f.path, bytes: f.content?.length || 0 }));
  c.inputEl.textContent = JSON.stringify(compact, null, 2);
}

function setCardResult(id, result) {
  const c = currentTab()._cards[id];
  if (!c) return;
  const ok = result.success !== false && !result.error;
  c.pill.textContent = ok ? 'done' : 'error';
  c.pill.className   = `tool-pill ${ok ? 'ok' : 'err'}`;
  c.dot.className    = `tool-status-dot ${ok ? 'ok' : 'err'}`;
  c.rlabel.style.display   = '';
  c.resultEl.style.display = '';
  const compact = { ...result }; delete compact.results;
  c.resultEl.textContent = JSON.stringify(compact, null, 2);
}

// ── Results panel content ─────────────────────────────────────────────────────
window.clearResults = function () {
  const tab = currentTab();
  tab.state = newRunState();
  tab.resultsEl.innerHTML = `<div class="results-empty">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2">
      <circle cx="12" cy="12" r="10"/>
    </svg>
    <p>Built apps and outputs appear here.</p>
  </div>`;
};

function renderResults() {
  const { state, resultsEl } = currentTab();
  resultsEl.innerHTML = '';

  if (state.repoUrl || state.previewUrl) {
    const card = document.createElement('div');
    card.className = 'rcard';
    card.innerHTML = `<div class="rcard-header">🔗 Your App</div><div class="rcard-body"><div class="link-cards" id="lc-main"></div></div>`;
    resultsEl.appendChild(card);
    const lc = card.querySelector('#lc-main');
    if (state.previewUrl) lc.appendChild(_linkCard({ href: state.previewUrl, icon: '⚡', label: 'Live Preview', url: state.previewUrl, note: 'Local preview', ct: state.previewUrl }));
    if (state.repoUrl)    lc.appendChild(_linkCard({ href: state.repoUrl,    icon: '🔒', label: 'GitHub (Private)', url: state.repoUrl, note: 'Source code', ct: state.repoUrl }));
  }

  if (state.files.length > 0) {
    const card = document.createElement('div');
    card.className = 'rcard';
    const rows = state.files.map(f => {
      const icon = f.success ? `<span class="file-ok">✓</span>` : `<span class="file-fail">✗</span>`;
      const link = f.url ? `<a href="${esc(f.url)}" target="_blank">${esc(f.path)}</a>` : `<span>${esc(f.path)}</span>`;
      return `<div class="file-row">${icon} ${link}</div>`;
    }).join('');
    card.innerHTML = `<div class="rcard-header">📄 Files</div><div class="rcard-body"><div class="file-list">${rows}</div></div>`;
    resultsEl.appendChild(card);
  }

  const codeFiles = Object.entries(state.fileContents);
  if (codeFiles.length > 0) {
    const tab     = currentTab();
    const card    = document.createElement('div');
    card.className = 'rcard';
    const tabBtns = codeFiles.map(([p], i) =>
      `<button class="code-tab ${i === 0 ? 'active' : ''}" onclick="switchCodeTab(event,'${esc(p)}',${tab.id})">${esc(p)}</button>`
    ).join('');
    const [fp, fc] = codeFiles[0];
    card.innerHTML = `
      <div class="rcard-header">🖊 Source</div>
      <div class="code-tabs">${tabBtns}</div>
      <div class="code-view" id="cv-${tab.id}">
        <pre><code class="language-${langFrom(fp)}">${esc(fc)}</code></pre>
      </div>`;
    resultsEl.appendChild(card);
    card.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }

  if (state.mastodonText) {
    const card = document.createElement('div');
    card.className = 'rcard';
    const viewLink = state.mastodonUrl
      ? `<a class="mastodon-link" href="${esc(state.mastodonUrl)}" target="_blank">🐘 View post →</a>` : '';
    card.innerHTML = `
      <div class="rcard-header">🐘 Mastodon</div>
      <div class="rcard-body">
        <div class="mastodon-post">${esc(state.mastodonText)}</div>
        ${viewLink}
      </div>`;
    resultsEl.appendChild(card);
  }

  if (!state.repoUrl && !state.previewUrl && state.files.length === 0) {
    clearResults();
  } else {
    showResultsPanel();
  }
}

function _linkCard({ href, icon, label, url, note, ct }) {
  const a = document.createElement('a');
  a.className = 'link-card';
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.innerHTML = `
    <span class="link-card-icon">${icon}</span>
    <div class="link-card-text">
      <div class="link-card-label">${esc(label)}</div>
      <div class="link-card-url">${esc(url)}</div>
      <div class="link-card-note">${esc(note)}</div>
    </div>
    <button class="link-card-copy" onclick="event.preventDefault();copyText('${esc(ct)}',this)">Copy</button>`;
  return a;
}

window.switchCodeTab = function (e, path, tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  e.target.closest('.rcard')?.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  const view = document.getElementById(`cv-${tabId}`);
  if (view) {
    view.innerHTML = `<pre><code class="language-${langFrom(path)}">${esc(tab.state.fileContents[path] || '')}</code></pre>`;
    view.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }
};

// ── Info-tool status labels (no JSON card, just spinner message) ──────────────
const INFO_TOOL_STATUS = {
  get_email_inbox:       'Reading emails…',
  get_calendar_events:   'Fetching calendar…',
  create_calendar_event: 'Creating calendar event…',
  fetch_trends:          'Fetching trends…',
  web_search:            'Searching the web…',
  read_webpage:          'Reading page…',
  star_github_repo:      'Starring repo…',
};

// ── SSE watchdog ──────────────────────────────────────────────────────────────
let _watchdog = null;
function resetWatchdog() {
  clearTimeout(_watchdog);
  _watchdog = setTimeout(() => {
    // Abort the stalled fetch so runAgent() exits its reader loop and
    // calls setIdle() via its own finally block — otherwise setBusy()
    // in the next sendPrompt call re-locks the input immediately.
    if (_agentAbort) _agentAbort.abort();
    clearStatus();
    appendText('**Connection stalled** — no response for 5 min. Check the server terminal and try again.');
    setIdle();
  }, 300000);
}
function clearWatchdog() { clearTimeout(_watchdog); _watchdog = null; }

// ── SSE handler ───────────────────────────────────────────────────────────────
function handleSSE(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  resetWatchdog();
  const tab = currentTab();

  switch (data.type) {
    case 'status': showStatus(data.message); break;

    case 'tool_generating':
      showStatus(`Writing ${toolLabel(data.name)}…`);
      break;

    case 'text':
      clearStatus();
      appendText(data.content);
      break;

    case 'tool_call':
      clearStatus();
      finaliseText();
      // Advance pipeline step based on which tool is running
      if (data.name === 'fetch_trends')                                    setPipelineStep(0);
      if (['web_search','read_webpage'].includes(data.name))               setPipelineStep(1);
      if (['create_github_repo','push_files_to_repo'].includes(data.name)) setPipelineStep(2);
      if (INFO_TOOL_STATUS[data.name]) {
        // Show animated spinner message instead of JSON card
        showStatus(INFO_TOOL_STATUS[data.name]);
        tab._infoToolIds.add(data.id);
      } else {
        createToolCard(data.id, data.name);
        setCardInput(data.id, data.input);
        if (data.name === 'push_files_to_repo' && data.input?.files)
          data.input.files.forEach(f => { tab.state.fileContents[f.path] = f.content; });
        if (data.name === 'post_to_mastodon' && data.input?.status)
          tab.state.mastodonText = data.input.status;
      }
      break;

    case 'tool_result': {
      if (tab._infoToolIds.has(data.id)) {
        // Info tool finished — clear spinner
        clearStatus();
        tab._infoToolIds.delete(data.id);
        // Refresh calendar view when AI creates an event
        if (data.name === 'create_calendar_event' && data.result?.success) {
          setTimeout(() => { if (typeof loadCalendar === 'function') loadCalendar(); }, 400);
        }
      } else {
        setCardResult(data.id, data.result);
        const ok = data.result.success !== false && !data.result.error;
        if (data.name === 'create_github_repo' && ok) {
          tab.state.repoUrl  = data.result.repo_url;
          tab.state.repoName = data.result.full_name;
        }
        if (data.name === 'push_files_to_repo' && ok) {
          if (data.result.repo_url)    tab.state.repoUrl    = data.result.repo_url;
          if (data.result.preview_url) tab.state.previewUrl = data.result.preview_url;
          if (data.result.results)     tab.state.files      = data.result.results;
        }
        if (data.name === 'post_to_mastodon' && ok && data.result.post_url)
          tab.state.mastodonUrl = data.result.post_url;
      }
      break;
    }

    case 'truncated': {
      clearWatchdog();
      clearStatus();
      const truncTab = currentTab();
      const truncText = truncTab._textEl?._raw || '';
      try { finaliseText(); } catch(e) { console.error('finaliseText', e); }
      if (truncText) {
        truncTab.history.push({ role: 'assistant', content: truncText });
        if (truncTab.history.length > 20) truncTab.history = truncTab.history.slice(-20);
      }
      hidePipelineBar();
      const tab = truncTab;
      const notice = document.createElement('div');
      notice.className = 'msg-truncated';
      notice.dataset.sessionId = data.session_id;
      notice.innerHTML =
        `<span class="trunc-icon">⚠</span>` +
        `<span class="trunc-text">Response cut off — max tokens reached</span>` +
        `<button class="trunc-btn" onclick="continueFromTruncation('${data.session_id}')">Continue →</button>`;
      tab.feedEl.appendChild(notice);
      scrollFeedDown();
      setIdle();
      loadTasks();
      break;
    }

    case 'done': {
      clearWatchdog();
      clearStatus();
      // Capture AI text before finaliseText nulls _textEl
      const doneTab = currentTab();
      const aiText  = doneTab._textEl?._raw || '';
      try { finaliseText(); }   catch(e) { console.error('finaliseText', e); }
      try { renderResults(); }  catch(e) { console.error('renderResults', e); }
      hidePipelineBar();
      setIdle();
      loadTasks();
      // Save assistant response to per-tab history
      if (aiText) {
        doneTab.history.push({ role: 'assistant', content: aiText });
        if (doneTab.history.length > 20) doneTab.history = doneTab.history.slice(-20);
      }
      try { _checkBuildComplete(); } catch(e) { console.error('checkBuildComplete', e); }
      break;
    }
  }
}

// ── Build-complete milestone trigger ──────────────────────────────────────────
// Scan the last AI message for BUILD_COMPLETE: metadata emitted by the system prompt.
// Instead of auto-opening a modal (which blocks the input), inject a clickable card.
function _checkBuildComplete() {
  const tab = currentTab();
  if (!tab.state.repoUrl) return;   // not a build session
  const feedText = tab.feedEl.innerText || '';
  const match = feedText.match(/BUILD_COMPLETE:\s*repo=([^\s|]+)\s*\|\s*title=([^|]+)\|\s*features=([^\n]+)/i);
  if (!match) return;
  const repoName  = match[1].trim();
  const title     = match[2].trim();
  const features  = match[3].split(',').map(f => f.trim()).filter(Boolean);
  const repoUrl   = tab.state.repoUrl;

  // Remove BUILD_COMPLETE metadata line from every rendered message element
  tab.feedEl.querySelectorAll('.msg-text, p').forEach(el => {
    if (el.innerText && el.innerText.includes('BUILD_COMPLETE')) {
      el.innerHTML = el.innerHTML.replace(/BUILD_COMPLETE:[^\n<]*/gi, '').trim();
      if (!el.innerHTML.trim()) el.remove();
    }
  });

  // Show a non-blocking inline card instead of a modal
  if (tab.feedEl.querySelector('.build-complete-card')) return; // don't add twice
  const card = document.createElement('div');
  card.className = 'build-complete-card';
  card.innerHTML = `
    <div class="bcc-icon">🚀</div>
    <div class="bcc-body">
      <div class="bcc-title">${esc(title)} — built!</div>
      <div class="bcc-sub">Set milestones &amp; schedule feature deadlines on your calendar.</div>
    </div>
    <button class="bcc-btn" onclick="openMilestoneModal({repoName:'${esc(repoName)}',title:'${esc(title)}',features:${JSON.stringify(features)},repoUrl:'${esc(repoUrl)}'});this.closest('.build-complete-card').remove()">
      Set milestones →
    </button>`;
  tab.feedEl.appendChild(card);
  scrollFeedDown();
}

// ── Blueprint (intent card) ───────────────────────────────────────────────────
function renderIntentCard(prompt, intent) {
  const tab  = currentTab();
  const card = document.createElement('div');
  card.className = 'intent-card';

  const features = (intent.features || []).map(f => `<span class="intent-chip chip-feature">${esc(f)}</span>`).join('');
  const apis     = (intent.apis     || []).map(a => `
    <div class="intent-api-row">
      <span class="api-name">${esc(a.name)}</span>
      <span class="api-usage">${esc(a.usage)}</span>
      <span class="api-auth ${esc(a.auth || 'none')}">${esc(a.auth || 'none')}</span>
    </div>`).join('');
  const stack  = (intent.tech_stack || []).map(t => `<span class="intent-chip chip-tech">${esc(t)}</span>`).join('');
  const dotCls = { simple: 'simple', moderate: 'moderate', complex: 'complex' }[intent.complexity] || 'moderate';

  card.innerHTML = `
    <div class="intent-header">
      <span class="intent-header-icon">🧠</span>
      <div>
        <div class="intent-header-label">Blueprint — Haiku Analysis</div>
        <div class="intent-title">${esc(intent.title || 'Your App')}</div>
      </div>
    </div>
    <div class="intent-body">
      <div class="intent-desc">${esc(intent.description || '')}</div>
      ${features ? `<div><div class="intent-section-label">Features</div><div class="intent-chips">${features}</div></div>` : ''}
      ${apis     ? `<div><div class="intent-section-label">APIs</div>${apis}</div>` : ''}
      ${stack    ? `<div><div class="intent-section-label">Stack</div><div class="intent-chips">${stack}</div></div>` : ''}
      <div class="intent-meta">
        <span class="complexity-dot ${dotCls}"></span>
        <span>${esc(intent.complexity || 'moderate')} complexity</span>
        ${intent.style ? `<span>· ${esc(intent.style)}</span>` : ''}
      </div>
    </div>
    <div class="intent-actions">
      <button class="btn-build" id="ib-build">⚡ Build it</button>
      <button class="btn-edit"  id="ib-edit">✎ Edit</button>
    </div>`;

  tab.feedEl.appendChild(card);
  scrollFeedDown();

  card.querySelector('#ib-build').addEventListener('click', () => {
    card.querySelector('.intent-actions').remove();
    tab.name = (intent.title || 'App').slice(0, 22);
    renderTabBar();
    showResultsPanel();
    runAgent(prompt, intent);
  });
  card.querySelector('#ib-edit').addEventListener('click', () => {
    card.remove();
    hidePipelineBar();
    promptInput.value = prompt;
    autoResize(promptInput);
    setIdle();
    promptInput.focus();
  });
}

// ── Intent classification ─────────────────────────────────────────────────────
// Returns true ONLY for explicit app-building requests.
// Everything else (email, calendar, trends, analysis, questions) goes straight
// to the agent — no Blueprint card shown.
function isBuildRequest(prompt) {
  const p = prompt.toLowerCase();
  return [
    /\bbuild\b.{0,50}\b(app|tool|site|website|dashboard|widget|game|extension|plugin|page)\b/,
    /\bcreate\b.{0,30}\b(app|tool|site|website|dashboard|widget)\b/,
    /\bmake\b.{0,30}\b(app|tool|site|website|dashboard|widget|game)\b/,
    /\bdevelop\b.{0,30}\b(app|tool|site|website|application)\b/,
    /\bweb\s*app\b/,
    /\bsingle.page\s+(app|application)\b/,
    /\bgenerate\b.{0,20}\b(html|css|js|javascript)\b/,
  ].some(r => r.test(p));
}

// ── Quick action wrappers ─────────────────────────────────────────────────────
// quickAction  → skip Blueprint, go straight to agent (tasks, email, calendar, trends)
// quickBuild   → always show Blueprint (explicit build request)
window.quickAction = function (prompt) {
  promptInput.value = prompt;
  autoResize(promptInput);
  sendPromptAsTask(prompt);
};

window.quickBuild = function (prompt) {
  promptInput.value = prompt;
  autoResize(promptInput);
  sendPromptAsBuild(prompt);
};

// ── Send flow ─────────────────────────────────────────────────────────────────
async function sendPrompt() {
  const prompt = promptInput.value.trim();
  if (!prompt || sendBtn.disabled) return;
  isBuildRequest(prompt) ? sendPromptAsBuild(prompt) : sendPromptAsTask(prompt);
}

// Direct to agent — no Blueprint
async function sendPromptAsTask(prompt) {
  prompt = prompt || promptInput.value.trim();
  if (!prompt) return;

  const tab = currentTab();
  // Only reset state on the very first message — preserve repo context on follow-ups
  if (tab.history.length === 0) tab.state = newRunState();
  tab.name  = prompt.slice(0, 22) + (prompt.length > 22 ? '…' : '');
  renderTabBar();
  promptInput.value = '';
  autoResize(promptInput);
  appendUserMsg(prompt);
  runAgent(prompt, null);
}

// Show Blueprint card first (explicit build requests only)
async function sendPromptAsBuild(prompt) {
  prompt = prompt || promptInput.value.trim();
  if (!prompt) return;

  const tab = currentTab();
  // Only reset state on the very first message — preserve repo context on follow-ups
  if (tab.history.length === 0) tab.state = newRunState();
  tab.name  = prompt.slice(0, 22) + (prompt.length > 22 ? '…' : '');
  renderTabBar();
  promptInput.value = '';
  autoResize(promptInput);
  appendUserMsg(prompt);
  showResultsPanel();
  setBusy();
  setPipelineStep(0);   // show pipeline bar at Discover step
  showStatus('Analysing…');

  let intent = null;
  try {
    const r = await fetch('/api/clarify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const d = await r.json();
    if (d.success && d.intent) intent = d.intent;
  } catch {}

  clearStatus();

  if (intent && (intent.apis?.length || intent.features?.length > 1)) {
    renderIntentCard(prompt, intent);
    setIdle();
  } else {
    runAgent(prompt, null);
  }
}

async function runAgent(prompt, intent) {
  setBusy();
  _agentAbort = new AbortController();
  const model = modelSelect.value;
  const label = modelSelect.options[modelSelect.selectedIndex].text.split('—')[0].trim();
  showStatus(`My clone is working — ${label}`);
  resetWatchdog();

  // Snapshot history before appending current user message
  const tab = currentTab();
  const history = [...tab.history];
  tab.history.push({ role: 'user', content: prompt });

  // Include existing repo context so the agent knows what to update
  const repoContext = (tab.state.repoName && history.length > 0)
    ? { repoName: tab.state.repoName, repoUrl: tab.state.repoUrl }
    : null;

  let resp;
  try {
    resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, intent, model, history, repoContext }),
      signal: _agentAbort.signal,
    });
  } catch (e) {
    clearWatchdog(); clearStatus();
    if (e.name === 'AbortError') {
      appendText(`\n*Stopped.*`);
    } else {
      appendText(`**Connection error**: ${e.message}`);
    }
    setIdle(); return;
  }

  if (!resp.ok) {
    clearWatchdog(); clearStatus();
    appendText(`**Server error ${resp.status}** — check .env and restart.`);
    setIdle(); return;
  }

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines)
        if (line.startsWith('data: ')) handleSSE(line.slice(6));
    }
    if (buffer.startsWith('data: ')) handleSSE(buffer.slice(6));
  } catch (e) {
    clearStatus();
    if (e.name === 'AbortError') {
      finaliseText();
      appendText(`\n*Stopped.*`);
    } else {
      appendText(`\n\n**Stream error**: ${e.message}`);
    }
  } finally {
    _agentAbort = null;
    clearWatchdog();
    setIdle();
    // Safety net: re-enable input after a short delay in case any synchronous
    // code running after this finally block re-locks it unexpectedly.
    setTimeout(setIdle, 200);
  }
}

window.stopAgent = function () {
  if (_agentAbort) {
    _agentAbort.abort();
  }
};

window.continueFromTruncation = async function (sessionId) {
  // Remove all truncation notices for this session
  document.querySelectorAll('.msg-truncated').forEach(el => el.remove());
  await runAgentContinue(sessionId);
};

async function runAgentContinue(sessionId) {
  setBusy();
  _agentAbort = new AbortController();
  showStatus('Continuing from where I left off…');
  resetWatchdog();
  // Record the continuation trigger in history so follow-ups have full context
  currentTab().history.push({ role: 'user', content: '(continued from previous response)' });

  let resp;
  try {
    resp = await fetch('/api/chat/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
      signal: _agentAbort.signal,
    });
  } catch (e) {
    clearWatchdog(); clearStatus();
    if (e.name === 'AbortError') {
      appendText(`\n*Stopped.*`);
    } else {
      appendText(`**Connection error**: ${e.message}`);
    }
    setIdle(); return;
  }

  if (!resp.ok) {
    clearWatchdog(); clearStatus();
    const err = await resp.json().catch(() => ({}));
    appendText(`**Could not continue** — ${err.error || resp.status}. The session may have expired; try resending your request.`);
    setIdle(); return;
  }

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines)
        if (line.startsWith('data: ')) handleSSE(line.slice(6));
    }
    if (buffer.startsWith('data: ')) handleSSE(buffer.slice(6));
  } catch (e) {
    clearStatus();
    if (e.name === 'AbortError') {
      finaliseText();
      appendText(`\n*Stopped.*`);
    } else {
      appendText(`\n\n**Stream error**: ${e.message}`);
    }
  } finally {
    _agentAbort = null;
    clearWatchdog();
    setIdle();
  }
}

function setBusy() {
  promptInput.disabled = true;
  sendBtn.disabled = false;
  sendBtn.title = 'Stop';
  sendBtn.onclick = stopAgent;
  sendBtn.classList.add('stop-mode');
  sendBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
}
function setIdle() {
  promptInput.disabled = false;
  sendBtn.disabled = false;
  sendBtn.title = 'Send';
  sendBtn.onclick = sendPrompt;
  sendBtn.classList.remove('stop-mode');
  sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  promptInput.focus();
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILD PIPELINE
// ══════════════════════════════════════════════════════════════════════════════
// Steps: 0=Discover, 1=Research, 2=Build, 3=Schedule
window.setPipelineStep = function (step) {
  const bar = document.getElementById('pipeline-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`pipe-step-${i}`);
    if (!el) continue;
    el.className = 'pipe-step ' + (i < step ? 'done' : i === step ? 'active' : 'pending');
  }
  // Mark connecting lines done
  bar.querySelectorAll('.pipe-line').forEach((l, i) => {
    l.classList.toggle('done', i < step);
  });
};

window.hidePipelineBar = function () {
  const bar = document.getElementById('pipeline-bar');
  if (bar) bar.style.display = 'none';
};

// ══════════════════════════════════════════════════════════════════════════════
// MILESTONE MODAL
// ══════════════════════════════════════════════════════════════════════════════
let _msData = null;

window.openMilestoneModal = function ({ repoName, title, features, repoUrl }) {
  _msData = { repoName, title, repoUrl };
  document.getElementById('ms-repo-label').textContent = repoName;

  // Default deadline = 2 weeks from today
  const dl = new Date();
  dl.setDate(dl.getDate() + 14);
  const dlInput = document.getElementById('ms-deadline');
  dlInput.value    = dl.toISOString().slice(0, 10);
  dlInput.disabled = false;
  document.getElementById('ms-no-deadline').checked = false;

  // Populate features evenly spaced between today and deadline
  const featEl = document.getElementById('ms-features');
  featEl.innerHTML = '';
  features.forEach((feat, i) => {
    const d = new Date();
    d.setDate(d.getDate() + Math.round((i + 1) * 14 / (features.length + 1)));
    _addFeatureRow(feat, d.toISOString().slice(0, 10));
  });

  setPipelineStep(3);   // highlight Schedule step
  document.getElementById('milestone-modal').classList.add('open');
};

window.closeMilestoneModal = function () {
  document.getElementById('milestone-modal')?.classList.remove('open');
  hidePipelineBar();
};

window.toggleMsDeadline = function (cb) {
  document.getElementById('ms-deadline').disabled = cb.checked;
};

window.addMilestoneFeature = function () { _addFeatureRow('', ''); };

function _addFeatureRow(name, date) {
  const container = document.getElementById('ms-features');
  const row = document.createElement('div');
  row.className = 'ms-feature-row';
  row.innerHTML =
    `<input type="text"  class="form-input ms-feat-name" value="${esc(name)}" placeholder="Feature name…" />` +
    `<input type="date"  class="form-input ms-feat-date" value="${date}" />` +
    `<button class="icon-btn" onclick="this.closest('.ms-feature-row').remove()" title="Remove">✕</button>`;
  container.appendChild(row);
}

window.saveMilestones = async function () {
  const btn = document.getElementById('ms-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const title     = _msData?.title    || _msData?.repoName || 'Project';
  const repoName  = _msData?.repoName || '';
  const repoUrl   = _msData?.repoUrl  || '';
  const deadline  = document.getElementById('ms-deadline').value;
  const noDeadline = document.getElementById('ms-no-deadline').checked;

  const features = Array.from(document.querySelectorAll('.ms-feature-row')).map(r => ({
    name: r.querySelector('.ms-feat-name').value.trim(),
    date: r.querySelector('.ms-feat-date').value,
  })).filter(f => f.name && f.date);

  const today = new Date().toISOString().slice(0, 10);
  const events = [];

  // Kick-off event
  events.push({
    summary:     `🚀 ${title} — Project Started`,
    start:       `${today}T09:00:00`,
    end:         `${today}T09:30:00`,
    description: `Repository: ${repoUrl}\nInitial build complete by CloneMe.`,
  });

  // Feature milestones
  features.forEach(f => {
    events.push({
      summary:     `📋 ${title} — ${f.name}`,
      start:       `${f.date}T09:00:00`,
      end:         `${f.date}T09:30:00`,
      description: `Feature milestone for project: ${title}`,
    });
  });

  // Deadline
  if (!noDeadline && deadline) {
    events.push({
      summary:     `🏁 ${title} — Project Deadline`,
      start:       `${deadline}T09:00:00`,
      end:         `${deadline}T17:00:00`,
      description: `Final deadline for ${title}.\nRepository: ${repoUrl}`,
    });
  }

  let created = 0;
  for (const ev of events) {
    try {
      const r = await fetch('/api/calendar/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ev),
      }).then(r => r.json());
      if (r.success) created++;
    } catch {}
  }

  btn.disabled = false;
  closeMilestoneModal();

  if (created > 0) {
    setTimeout(() => {
      if (typeof switchSection === 'function') switchSection('calendar');
      if (typeof loadCalendar  === 'function') loadCalendar();
    }, 350);
  }
};

// Expose for cross-module use
window.sendPrompt        = sendPrompt;
window.sendPromptAsTask  = sendPromptAsTask;
window.sendPromptAsBuild = sendPromptAsBuild;
