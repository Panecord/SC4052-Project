/* ── Calendar section ────────────────────────────────────────────────────────
   Week-grid view of Google Calendar events.
   Navigation: prev / next week. Today highlighted. Real-time refresh.
   ──────────────────────────────────────────────────────────────────────────── */

let _calWeekOffset = 0;
let _calEventStore = [];   // flat list of all events currently displayed

// Returns the Monday (ISO week start) of the week at the given offset
function _weekMonday(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;   // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow + offset * 7);
  return d;
}

function _isoDate(d) {
  // Use local date parts to avoid UTC-shift issues in SGT (UTC+8)
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function _fmtTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function _fmtDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

window.calPrevWeek = function () { _calWeekOffset--; loadCalendar(); };
window.calNextWeek = function () { _calWeekOffset++; loadCalendar(); };
window.calToday    = function () { _calWeekOffset = 0; loadCalendar(); };

window.loadCalendar = async function () {
  const wrap = document.getElementById('cal-week-wrap');
  if (!wrap) return;

  const monday  = _weekMonday(_calWeekOffset);
  const sunday  = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const today   = _isoDate(new Date());
  const fromStr = _isoDate(monday);

  const label = document.getElementById('cal-week-label');
  if (label) {
    const opts = { month: 'short', day: 'numeric' };
    label.textContent =
      monday.toLocaleDateString([], opts) + ' – ' +
      sunday.toLocaleDateString([], { ...opts, year: 'numeric' });
  }

  _renderWeekGrid(wrap, monday, [], today);

  try {
    const data = await fetch(`/api/calendar/events?from=${fromStr}&days=7`).then(r => r.json());

    const msg = document.getElementById('cal-connect-msg');
    if (!data.success) {
      if (msg) msg.style.display = '';
      return;
    }
    if (msg) msg.style.display = 'none';

    _calEventStore = data.events || [];
    _renderWeekGrid(wrap, monday, _calEventStore, today);
  } catch (e) {
    wrap.innerHTML = `<div style="padding:20px;color:var(--red);font-size:13px">Error: ${esc(e.message)}</div>`;
  }
};

function _renderWeekGrid(wrap, monday, events, today) {
  _calEventStore = events;

  const byDay = {};
  events.forEach((ev, idx) => {
    const key = (ev.start || '').slice(0, 10);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push({ ev, idx });
  });

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    days.push(d);
  }

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  wrap.innerHTML = days.map((d, i) => {
    const key     = _isoDate(d);
    const isToday = key === today;
    const isWknd  = i >= 5;
    const entries = byDay[key] || [];

    const eventHtml = entries.map(({ ev, idx }) => {
      const allDay  = ev.all_day;
      const timeStr = allDay ? 'All day' : _fmtTime(ev.start);
      return `
        <div class="cal-week-event ${allDay ? 'all-day' : ''}"
             onclick="openCalEvent(${idx})" role="button" tabindex="0"
             title="${esc(ev.summary)}">
          <div class="cwe-time">${esc(timeStr)}</div>
          <div class="cwe-title">${esc(ev.summary)}</div>
          ${ev.location ? `<div class="cwe-loc">📍 ${esc(ev.location)}</div>` : ''}
        </div>`;
    }).join('') || `<div class="cwe-empty">—</div>`;

    return `
      <div class="cal-week-col ${isToday ? 'today' : ''} ${isWknd ? 'weekend' : ''}">
        <div class="cal-week-col-head">
          <div class="cwh-day">${DAY_NAMES[i]}</div>
          <div class="cwh-date ${isToday ? 'today-badge' : ''}">${d.getDate()}</div>
        </div>
        <div class="cal-week-col-body">${eventHtml}</div>
      </div>`;
  }).join('');
}

// ── Event detail popover ──────────────────────────────────────────────────────
window.openCalEvent = function (idx) {
  const ev = _calEventStore[idx];
  if (!ev) return;

  const modal = document.getElementById('cal-event-modal');
  if (!modal) return;

  document.getElementById('cem-title').textContent    = ev.summary || '(no title)';
  document.getElementById('cem-time').textContent     = ev.all_day
    ? 'All day · ' + new Date(ev.start + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : _fmtDateTime(ev.start) + (ev.end ? '  →  ' + _fmtTime(ev.end) : '');
  const locEl = document.getElementById('cem-location');
  locEl.querySelector('span').textContent = ev.location || '';
  locEl.style.display = ev.location ? 'flex' : 'none';
  document.getElementById('cem-desc').textContent      = ev.description || '';
  document.getElementById('cem-desc').style.display    = ev.description ? '' : 'none';

  modal.classList.add('open');
};

window.closeCalEvent = function () {
  document.getElementById('cal-event-modal')?.classList.remove('open');
};

// ── "New Event" form ──────────────────────────────────────────────────────────
window.toggleNewEventForm = function () {
  const form = document.getElementById('create-event-form');
  if (!form) return;
  const showing = form.style.display !== 'none';
  form.style.display = showing ? 'none' : 'flex';
  if (!showing) form.style.flexDirection = 'column';
};

window.createEvent = async function () {
  const summary = document.getElementById('ev-title')?.value.trim();
  const start   = document.getElementById('ev-start')?.value;
  const end     = document.getElementById('ev-end')?.value;
  const desc    = document.getElementById('ev-desc')?.value.trim();

  if (!summary || !start || !end) { alert('Title, start and end are required.'); return; }

  const btn = document.querySelector('.cal-create-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const data = await fetch('/api/calendar/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary, start, end, description: desc }),
    }).then(r => r.json());

    if (data.success) {
      document.getElementById('create-event-form').style.display = 'none';
      ['ev-title', 'ev-start', 'ev-end', 'ev-desc'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      loadCalendar();
    } else {
      alert('Failed to create event: ' + (data.error || 'unknown error'));
    }
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Event'; }
  }
};
