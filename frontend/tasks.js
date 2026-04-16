/* ── Tasks section + Apps modal ──────────────────────────────────────────────
   Background task list with live badge polling, and built-apps modal.
   ──────────────────────────────────────────────────────────────────────────── */

window.loadTasks = async function () {
  const list = document.getElementById('tasks-list');
  try {
    const tasks = await fetch('/api/tasks').then(r => r.json());

    // Update full tasks section if visible
    if (list) {
      if (!tasks.length) {
        list.innerHTML = `<div class="connect-prompt">
          <div class="connect-prompt-icon">⚙</div>
          <h3>No tasks yet</h3>
          <p>When CloneMe runs tasks for you — building apps, reading email, analysing trends — they appear here.</p>
        </div>`;
      } else {
        list.innerHTML = tasks.map(task => {
          const icons   = { running: '↻', done: '✓', error: '✗' };
          const classes = { running: 'running', done: 'done', error: 'error' };
          const cls     = classes[task.status] || 'done';
          return `
            <div class="task-card">
              <div class="task-icon ${cls}">${icons[task.status] || '?'}</div>
              <div class="task-body">
                <div class="task-name">${esc(task.name)}</div>
                <div class="task-desc">${esc(task.description)}</div>
                <div class="task-time">${esc(relativeTime(task.created_at))}${task.completed_at ? ` → ${esc(relativeTime(task.completed_at))}` : ''}</div>
              </div>
              <span class="task-status-badge ${cls}">${esc(task.status)}</span>
            </div>`;
        }).join('');
      }
    }

    _updateFloatingWidget(tasks);
  } catch {}
};

function _updateFloatingWidget(tasks) {
  const badge  = document.getElementById('tasks-float-badge');
  const label  = document.getElementById('tasks-float-label');
  const btn    = document.getElementById('tasks-float-btn');
  const body   = document.getElementById('tasks-float-body');
  if (!badge || !label || !btn || !body) return;

  const running = tasks.filter(t => t.status === 'running');
  const recent  = tasks.slice(0, 5); // show latest 5

  // Update button state
  if (running.length) {
    badge.textContent   = running.length;
    badge.style.display = '';
    label.textContent   = running.length === 1 ? '1 task running' : `${running.length} tasks running`;
    btn.classList.add('running');
  } else if (tasks.length) {
    badge.style.display = 'none';
    label.textContent   = `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;
    btn.classList.remove('running');
  } else {
    badge.style.display = 'none';
    label.textContent   = 'No tasks yet';
    btn.classList.remove('running');
  }

  // Update panel body
  if (!tasks.length) {
    body.innerHTML = `<div class="tasks-float-empty">No tasks yet — try asking CloneMe to do something!</div>`;
    return;
  }

  const icons = { running: '↻', done: '✓', error: '✗' };
  body.innerHTML = recent.map(t => {
    const cls = { running: 'running', done: 'done', error: 'error' }[t.status] || 'done';
    return `<div class="tasks-float-item">
      <div class="tasks-float-item-icon ${cls}">${icons[t.status] || '?'}</div>
      <div class="tasks-float-item-name" title="${esc(t.name)}">${esc(t.name)}</div>
      <div class="tasks-float-item-status">${esc(t.status)}</div>
    </div>`;
  }).join('');
}

window.toggleTasksFloat = function () {
  const panel = document.getElementById('tasks-float-panel');
  if (!panel) return;
  panel.classList.toggle('open');
};

// Poll every 5 s to keep the floating widget live
setInterval(() => loadTasks(), 5000);

// ── Build History modal ───────────────────────────────────────────────────────
window.openAppsModal = async function () {
  document.getElementById('apps-modal').classList.add('open');
  _refreshBuilds();
};

async function _refreshBuilds() {
  const body = document.getElementById('apps-modal-body');
  body.innerHTML = `<div class="loading-state"><div class="spin"></div><span>Loading…</span></div>`;
  try {
    const builds = await fetch('/api/builds').then(r => r.json());
    if (!builds.length) {
      body.innerHTML = `<div class="modal-empty">No builds yet — ask me to build an app!</div>`;
      return;
    }
    body.innerHTML = builds.map(b => _buildCard(b)).join('');
  } catch (e) {
    body.innerHTML = `<div class="modal-empty">Failed to load builds: ${esc(e.message)}</div>`;
  }
}

function _buildCard(b) {
  const date = b.created_at
    ? new Date(b.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const statusClass = { ready: 'done', creating: 'running', error: 'error' }[b.status] || 'done';
  const statusLabel = { ready: 'ready', creating: 'building…', error: 'error' }[b.status] || b.status;
  const filesLabel  = b.files_count ? `${b.files_count} file${b.files_count !== 1 ? 's' : ''}` : '';

  const previewBtn = b.has_preview
    ? `<button class="app-action-btn" onclick="window.open('${esc(b.preview_url)}', '_blank')" title="Open local preview">Preview</button>`
    : '';
  const githubBtn = b.repo_url
    ? `<button class="app-action-btn" onclick="window.open('${esc(b.repo_url)}', '_blank')" title="View on GitHub">GitHub ↗</button>`
    : '';

  return `
    <div class="build-card" id="build-card-${esc(b.repo_name)}">
      <div class="build-card-top">
        <div class="build-card-info">
          <div class="build-card-name">${esc(b.repo_name)}</div>
          ${b.description ? `<div class="build-card-desc">${esc(b.description)}</div>` : ''}
        </div>
        <span class="task-status-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="build-card-meta">
        ${date ? `<span>${date}</span>` : ''}
        ${filesLabel ? `<span>${filesLabel}</span>` : ''}
        ${b.legacy ? `<span style="color:var(--text-3);font-style:italic">legacy</span>` : ''}
      </div>
      <div class="build-card-actions">
        ${previewBtn}
        ${githubBtn}
        <button class="app-action-btn danger" onclick="deleteBuild('${esc(b.repo_name)}')" title="Delete repo + local files">Delete</button>
      </div>
    </div>`;
}

window.deleteBuild = async function (repoName) {
  const msg = `Delete "${repoName}"?\n\nThis will:\n• Delete the GitHub repo permanently\n• Remove the local preview files`;
  if (!confirm(msg)) return;

  const card = document.getElementById(`build-card-${repoName}`);
  if (card) card.style.opacity = '0.4';

  try {
    const data = await fetch(`/api/builds/${encodeURIComponent(repoName)}`, { method: 'DELETE' }).then(r => r.json());
    if (data.success) {
      _refreshBuilds();
    } else {
      if (card) card.style.opacity = '';
      alert(`Delete failed: ${data.github_error || data.error || 'unknown error'}`);
    }
  } catch (e) {
    if (card) card.style.opacity = '';
    alert(`Error: ${e.message}`);
  }
};

window.closeAppsModal = function () {
  document.getElementById('apps-modal').classList.remove('open');
};
