/* ── Trends section ──────────────────────────────────────────────────────────
   Search bar with suggestions · hashtag/community topic pills · post cards.
   Mastodon + Reddit: click a topic pill → inline drill-down of posts.
   Clicking any post card → trend detail modal with Build + Analyse buttons.
   ──────────────────────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────────────
let _trendItems    = [];   // full list for modal index compat
let _trendAllTags  = [];   // all topic pills (mastodon #tags / reddit subreddits)
let _trendAllPosts = [];   // all post/story/repo/video cards
let _trendTags     = [];   // active display subset
let _trendPosts    = [];   // active display subset
let _visibleTags   = 15;
let _visiblePosts  = 15;
let _drilldown     = null;    // { title, source, loading, posts, visible }
let _isSearchMode  = false;   // true while showing API search results

// ── Cache ─────────────────────────────────────────────────────────────────────
const _trendsCache = {};      // keyed by source
const _CACHE_TTL   = 5 * 60 * 1000; // 5 minutes

// ── Source switching ──────────────────────────────────────────────────────────
window.switchTrendSource = function (btn) {
  document.querySelectorAll('.source-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  currentTrendSource = btn.dataset.src;
  _isSearchMode = false;
  const inp = document.getElementById('trend-search-input');
  if (inp) inp.value = '';
  document.getElementById('trend-search-clear').style.display = 'none';
  _hideDropdown();
  loadTrends(currentTrendSource);
};

// ── Main load ────────────────────────────────────────────────────────────────
window.loadTrends = async function (source) {
  const grid   = document.getElementById('trends-grid');
  const cached = _trendsCache[source];

  // Serve from cache instantly if fresh
  if (cached && Date.now() - cached.ts < _CACHE_TTL) {
    _applyTrendData(cached, source);
    // Silently refresh in background when cache is past half TTL
    if (Date.now() - cached.ts > _CACHE_TTL / 2) _fetchTrends(source, true);
    return;
  }

  // No cache — show spinner and fetch
  grid.innerHTML = `<div class="loading-state" style="grid-column:1/-1"><div class="spin"></div><span>Fetching ${source} trends…</span></div>`;
  await _fetchTrends(source, false);
};

async function _fetchTrends(source, background) {
  try {
    const data  = await fetch(`/api/trends?source=${source}`).then(r => r.json());
    let   items = data.items || (data.sources ? Object.values(data.sources).flat() : data);
    if (!Array.isArray(items)) items = [];
    items = items.filter(i => !i.error);

    items.forEach((item, i) => { item.__idx = i; });
    const [tags, posts] = _splitItems(items, source);

    const entry = { items, tags, posts, ts: Date.now() };
    _trendsCache[source] = entry;

    // Only update the view if we're still on this source and not in search mode
    if (source === currentTrendSource && !_isSearchMode) {
      _applyTrendData(entry, source);
    }
  } catch (e) {
    if (!background) {
      const grid = document.getElementById('trends-grid');
      if (grid) grid.innerHTML = `<div class="trends-empty" style="grid-column:1/-1;color:var(--red)">Error: ${esc(e.message)}</div>`;
    }
  }
}

function _applyTrendData(entry, source) {
  _trendItems    = entry.items;
  _trendAllTags  = entry.tags;
  _trendAllPosts = entry.posts;
  _trendTags     = entry.tags;
  _trendPosts    = entry.posts;
  _visibleTags   = 15;
  _visiblePosts  = 15;
  _drilldown     = null;
  _isSearchMode  = false;
  _updateSearchSuggestions(source, entry.tags, entry.posts);
  _renderTrends();
}

// ── Split items into tags vs posts ────────────────────────────────────────────
function _splitItems(items, source) {
  const tags  = [];
  const posts = [];

  if (source === 'mastodon') {
    items.forEach(item => {
      if (item.is_tag || item.title.startsWith('#')) tags.push(item);
      else posts.push(item);
    });
  } else if (source === 'reddit') {
    // Unique subreddits become topic pills; all items are also posts
    const seen = new Set();
    items.forEach(item => {
      const sub = item.subreddit || (item.tags || []).find(t => t.startsWith('r/')) || '';
      if (sub && !seen.has(sub)) {
        seen.add(sub);
        tags.push({ title: sub, source: 'reddit', is_subreddit: true, __sub: sub.replace('r/', '') });
      }
      posts.push(item);
    });
    // Sort subreddits by frequency in posts
    const freq = {};
    posts.forEach(p => { const s = p.subreddit || ''; freq[s] = (freq[s] || 0) + 1; });
    tags.sort((a, b) => (freq[b.title] || 0) - (freq[a.title] || 0));
  } else {
    posts.push(...items);
  }

  return [tags, posts];
}

// ── Autocomplete suggestions pool ─────────────────────────────────────────────
let _searchSuggestions = []; // top tag/topic titles from current source

function _updateSearchSuggestions(source, tags, posts) {
  // Build suggestion list from top tags, falling back to post title keywords
  const seen = new Set();
  _searchSuggestions = [];

  tags.slice(0, 20).forEach(t => {
    if (!seen.has(t.title)) { seen.add(t.title); _searchSuggestions.push(t.title); }
  });

  if (_searchSuggestions.length < 10) {
    posts.slice(0, 20).forEach(p => {
      const kw = p.title.split(/\s+/).slice(0, 3).join(' ');
      if (kw.length > 3 && !seen.has(kw)) { seen.add(kw); _searchSuggestions.push(kw); }
    });
  }
}

// ── Search input handlers ─────────────────────────────────────────────────────
window.onTrendSearchInput = function (val) {
  document.getElementById('trend-search-clear').style.display = val ? '' : 'none';
  _showDropdown(val);
  // If cleared, restore cached trends immediately
  if (!val.trim()) _restoreCachedTrends();
};

window.onTrendSearchFocus = function () {
  _showDropdown(document.getElementById('trend-search-input')?.value || '');
};

window.onTrendSearchBlur = function () {
  setTimeout(() => _hideDropdown(), 150);
};

window.onTrendSearchKey = function (e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = e.target.value.trim();
    _hideDropdown();
    if (val) performSearch(val);
    else _restoreCachedTrends();
  } else if (e.key === 'Escape') {
    clearTrendSearch();
  } else if (e.key === 'ArrowDown') {
    // Focus first suggestion
    e.preventDefault();
    document.querySelector('.search-suggestion')?.focus();
  }
};

function _showDropdown(query) {
  const dropdown = document.getElementById('trend-search-dropdown');
  const input    = document.getElementById('trend-search-input');
  if (!dropdown || !input) return;

  const lq      = (query || '').toLowerCase().trim();
  const matches = lq
    ? _searchSuggestions.filter(s => s.toLowerCase().includes(lq)).slice(0, 6)
    : _searchSuggestions.slice(0, 5);

  if (!matches.length) { _hideDropdown(); return; }

  dropdown.innerHTML = matches.map(s => {
    const safe = esc(s);
    const hi   = lq
      ? safe.replace(new RegExp(`(${lq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>')
      : safe;
    return `<div class="search-suggestion" tabindex="-1"
      onmousedown="pickSuggestion(${JSON.stringify(s)})"
      onkeydown="if(event.key==='Enter')pickSuggestion(${JSON.stringify(s)})">${hi}</div>`;
  }).join('');

  // Position fixed relative to the input element
  const rect = input.getBoundingClientRect();
  dropdown.style.top   = `${rect.bottom + 4}px`;
  dropdown.style.left  = `${rect.left}px`;
  dropdown.style.width = `${rect.width}px`;
  dropdown.style.display = '';
}

function _hideDropdown() {
  const d = document.getElementById('trend-search-dropdown');
  if (d) d.style.display = 'none';
}

window.pickSuggestion = function (s) {
  const inp = document.getElementById('trend-search-input');
  if (inp) { inp.value = s; document.getElementById('trend-search-clear').style.display = ''; }
  _hideDropdown();
  performSearch(s);
};

// ── Real platform search ──────────────────────────────────────────────────────
window.performSearch = async function (query) {
  if (!query?.trim()) return;
  _isSearchMode = true;
  _drilldown    = null;
  _visibleTags  = 15;
  _visiblePosts = 15;

  const grid = document.getElementById('trends-grid');
  grid.innerHTML = `<div class="loading-state" style="grid-column:1/-1"><div class="spin"></div><span>Searching ${currentTrendSource} for "${esc(query)}"…</span></div>`;

  try {
    const data  = await fetch(`/api/trends/search?source=${currentTrendSource}&q=${encodeURIComponent(query)}`).then(r => r.json());
    let   items = Array.isArray(data) ? data : (data.items || []);
    items = items.filter(i => !i.error);

    if (!items.length) {
      grid.innerHTML = `<div class="trends-empty" style="grid-column:1/-1">No results for <strong>"${esc(query)}"</strong> on ${esc(currentTrendSource)}</div>`;
      return;
    }

    items.forEach((item, i) => { item.__idx = i; });
    _trendItems = items;
    const [tags, posts] = _splitItems(items, currentTrendSource);
    _trendAllTags  = tags;
    _trendAllPosts = posts;
    _trendTags     = tags;
    _trendPosts    = posts;
    _renderTrends();
  } catch (e) {
    grid.innerHTML = `<div class="trends-empty" style="grid-column:1/-1;color:var(--red)">Search error: ${esc(e.message)}</div>`;
  }
};

function _restoreCachedTrends() {
  const cached = _trendsCache[currentTrendSource];
  if (cached) {
    _applyTrendData(cached, currentTrendSource);
  } else {
    loadTrends(currentTrendSource);
  }
}

window.clearTrendSearch = function () {
  const inp = document.getElementById('trend-search-input');
  if (inp) inp.value = '';
  document.getElementById('trend-search-clear').style.display = 'none';
  _hideDropdown();
  _restoreCachedTrends();
};

// ── Main render ───────────────────────────────────────────────────────────────
function _renderTrends() {
  const grid = document.getElementById('trends-grid');
  let html   = '';

  // ── Topics / Hashtags section ──────────────────────────────────────────────
  const tagsLabel = currentTrendSource === 'mastodon' ? 'Trending Hashtags'
                  : currentTrendSource === 'reddit'   ? 'Trending Communities'
                  : '';

  if (tagsLabel && _trendTags.length) {
    const slice   = _trendTags.slice(0, _visibleTags);
    const hasMore = _trendTags.length > _visibleTags;
    const pills   = slice.map(t => {
      const active = (_drilldown && _drilldown.title === t.title) ? ' active' : '';
      return `<button class="trend-pill${active}" onclick="openTagDrilldown(${JSON.stringify(t.title)}, '${currentTrendSource}')">${esc(t.title)}</button>`;
    }).join('');

    html += `<div class="trends-section" style="grid-column:1/-1">
      <div class="trends-section-header">
        <span class="trends-section-title">${tagsLabel}</span>
        <span class="trends-section-count">${_trendTags.length}</span>
      </div>
      <div class="trend-pills-row">${pills}</div>
      ${hasMore ? `<button class="load-more-btn" onclick="loadMoreTags()">Show ${Math.min(15, _trendTags.length - _visibleTags)} more topics</button>` : ''}
    </div>`;
  }

  // ── Drill-down panel ───────────────────────────────────────────────────────
  if (_drilldown) {
    html += `<div class="trends-drilldown" id="trends-drilldown" style="grid-column:1/-1">${_renderDrilldown()}</div>`;
  }

  // ── Posts section ──────────────────────────────────────────────────────────
  const postsLabel = { mastodon: 'Trending Posts', hackernews: 'HN Stories',
                       github: 'Trending Repos', youtube: 'Trending Videos',
                       reddit: 'Hot Posts' }[currentTrendSource] || 'Trending';

  const postSlice   = _trendPosts.slice(0, _visiblePosts);
  const postsHasMore = _trendPosts.length > _visiblePosts;

  if (postSlice.length) {
    html += `<div class="trends-section" style="grid-column:1/-1">
      <div class="trends-section-header">
        <span class="trends-section-title">${postsLabel}</span>
        <span class="trends-section-count">${_trendPosts.length}</span>
      </div>
    </div>`;
    postSlice.forEach(item => { html += _buildPostCard(item); });
    if (postsHasMore) {
      html += `<div style="grid-column:1/-1"><button class="load-more-btn" onclick="loadMorePosts()">Show ${Math.min(15, _trendPosts.length - _visiblePosts)} more ${postsLabel.toLowerCase()}</button></div>`;
    }
  } else if (!_trendTags.length && !_drilldown) {
    html += `<div class="trends-empty" style="grid-column:1/-1">No results match your search</div>`;
  }

  grid.innerHTML = html || `<div class="trends-empty" style="grid-column:1/-1">No trends available</div>`;
}

function _buildPostCard(item) {
  const idx  = item.__idx ?? 0;
  const tags = (item.tags || []).slice(0, 3)
    .map(t => `<span class="trend-tag">${esc(String(t))}</span>`).join('');
  return `
    <div class="trend-card" onclick="openTrendDetail(${idx})">
      <div class="trend-title">${esc(item.title)}</div>
      <div class="trend-desc">${esc((item.description || '').slice(0, 90))}</div>
      <div class="trend-footer">
        <div class="trend-tags">${tags}</div>
        <button class="trend-build-btn" data-idx="${idx}" onclick="event.stopPropagation();_trendBuildByIdx(this.dataset.idx)">Build →</button>
      </div>
    </div>`;
}

window._trendBuildByIdx = function (idxStr) {
  const item = _trendItems[parseInt(idxStr, 10)];
  if (item) buildFromTrend(item.prompt || item.title);
};

// ── Drill-down render ─────────────────────────────────────────────────────────
function _renderDrilldown() {
  const d       = _drilldown;
  const posts   = d.posts || [];
  const slice   = posts.slice(0, d.visible || 8);
  const hasMore = posts.length > (d.visible || 8);
  const label   = d.source === 'mastodon' ? `Posts tagged ${esc(d.title)}`
                                          : `Hot posts from ${esc(d.title)}`;

  let inner = '';
  if (d.loading) {
    inner = `<div class="loading-state" style="padding:20px"><div class="spin"></div><span>Loading posts…</span></div>`;
  } else if (!slice.length) {
    inner = `<div class="trends-empty" style="padding:16px">No posts found</div>`;
  } else {
    inner = slice.map((p, i) => _buildDrillPost(p, i)).join('');
    if (hasMore) {
      inner += `<button class="load-more-btn" style="margin:8px 16px" onclick="loadMoreDrilldown()">Show ${Math.min(8, posts.length - (d.visible || 8))} more posts</button>`;
    }
  }

  return `
    <div class="drilldown-header">
      <span class="drilldown-title">${label}</span>
      <button class="icon-btn" onclick="closeDrilldown()">✕</button>
    </div>
    <div class="drilldown-posts">${inner}</div>`;
}

function _buildDrillPost(p, i) {
  const author  = p.author || p.by || '';
  const content = p.content || p.title || '';
  const stats   = (p.boosts != null)
    ? `🔁 ${p.boosts}  ♥ ${p.likes || 0}`
    : (p.score != null)
    ? `⬆ ${p.score}  💬 ${p.n_comments || 0}`
    : '';
  // Store prompt on drilldown post for safe retrieval
  if (!p.__buildPrompt) {
    p.__buildPrompt = p.prompt || `Build a web app inspired by: ${content.slice(0, 120)}`;
  }
  return `
    <div class="drilldown-post" onclick="_drillBuild(${i})">
      ${author ? `<div class="drilldown-post-author">${esc(author)}</div>` : ''}
      <div class="drilldown-post-text">${esc(content.slice(0, 220))}</div>
      <div class="drilldown-post-footer">
        <span class="drilldown-post-stats">${stats}</span>
        <div style="display:flex;align-items:center;gap:8px">
          ${p.url ? `<a href="${esc(p.url)}" target="_blank" class="drilldown-post-link" onclick="event.stopPropagation()">↗</a>` : ''}
          <button class="trend-build-btn" onclick="event.stopPropagation();_drillBuild(${i})">Build →</button>
        </div>
      </div>
    </div>`;
}

window._drillBuild = function (i) {
  if (!_drilldown || !_drilldown.posts[i]) return;
  const p = _drilldown.posts[i];
  buildFromPost(p.__buildPrompt || p.prompt || `Build a web app inspired by: ${(p.content || p.title || '').slice(0, 120)}`);
};

// ── Load more ─────────────────────────────────────────────────────────────────
window.loadMoreTags = function ()  { _visibleTags  += 15; _renderTrends(); };
window.loadMorePosts = function () { _visiblePosts += 15; _renderTrends(); };
window.loadMoreDrilldown = function () {
  if (_drilldown) { _drilldown.visible = (_drilldown.visible || 8) + 8; _renderTrends(); }
};

// ── Tag / community drill-down ────────────────────────────────────────────────
window.openTagDrilldown = async function (tagTitle, source) {
  // Toggle off if clicking the same pill again
  if (_drilldown && _drilldown.title === tagTitle) {
    closeDrilldown(); return;
  }

  _drilldown = { title: tagTitle, source, loading: true, posts: [], visible: 8 };
  _renderTrends();
  // Scroll drill-down into view
  setTimeout(() => document.getElementById('trends-drilldown')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

  try {
    let posts = [];
    if (source === 'mastodon') {
      const tag  = tagTitle.startsWith('#') ? tagTitle.slice(1) : tagTitle;
      const data = await fetch(`/api/trends/detail?source=mastodon&tag=${encodeURIComponent(tag)}`).then(r => r.json());
      if (data.success && data.posts) posts = data.posts;
    } else if (source === 'reddit') {
      // First try filtering already-loaded posts by subreddit
      const sub = tagTitle; // "r/MachineLearning"
      posts = _trendAllPosts
        .filter(p => (p.subreddit || (p.tags || []).find(t => t.startsWith('r/'))) === sub)
        .map(p => ({ title: p.title, score: p.score || 0, url: p.source_url, prompt: p.prompt, n_comments: 0 }));

      // If fewer than 5 posts locally, hit the subreddit API for fresh results
      if (posts.length < 5) {
        const subName = tagTitle.replace('r/', '');
        const data    = await fetch(`/api/trends/subreddit?name=${encodeURIComponent(subName)}`).then(r => r.json());
        if (data.success && data.posts?.length) posts = data.posts;
      }
    }
    _drilldown = { title: tagTitle, source, loading: false, posts, visible: 8 };
  } catch (e) {
    _drilldown = { title: tagTitle, source, loading: false, posts: [], visible: 8 };
  }
  _renderTrends();
};

window.closeDrilldown = function () {
  _drilldown = null;
  _renderTrends();
};

// ── Build helpers ─────────────────────────────────────────────────────────────
window.buildFromPost = function (prompt) {
  switchSection('chat');
  promptInput.value = prompt;
  autoResize(promptInput);
  sendPromptAsBuild(prompt);
};

window.buildFromTrend = function (prompt) {
  switchSection('chat');
  promptInput.value = prompt;
  autoResize(promptInput);
  sendPromptAsBuild(prompt);
};

window.analyseAllTrends = function () {
  switchSection('chat');
  const prompt = `Fetch trends from Mastodon, HackerNews, and Reddit, then give me a brief analysis: what are the top 5 themes, which are most interesting, and what should I know about the tech world right now?`;
  promptInput.value = prompt;
  autoResize(promptInput);
  sendPromptAsTask(prompt);
};

// ── Trend detail modal (for post cards) ───────────────────────────────────────
window.openTrendDetail = function (idx) {
  const item = _trendItems[idx];
  if (!item) return;
  const modal = document.getElementById('trend-detail-modal');
  if (!modal) return;

  document.getElementById('tdm-source').textContent = (item.source || currentTrendSource).toUpperCase();
  document.getElementById('tdm-title').textContent  = item.title;

  const descEl = document.getElementById('tdm-desc');
  descEl.textContent   = item.description || '';
  descEl.style.display = item.description ? '' : 'none';

  const tagsEl = document.getElementById('tdm-tags');
  const tags   = (item.tags || []).map(t => `<span class="trend-tag">${esc(String(t))}</span>`).join('');
  tagsEl.innerHTML     = tags;
  tagsEl.style.display = tags ? '' : 'none';

  const linkEl = document.getElementById('tdm-link');
  if (item.source_url) {
    linkEl.href = item.source_url; linkEl.textContent = '↗ View original'; linkEl.style.display = '';
  } else { linkEl.style.display = 'none'; }

  document.getElementById('tdm-analyse-btn').onclick = () => {
    closeTrendDetail();
    sendPromptAsTask(item.prompt || `Analyse the trend: ${item.title}`);
    switchSection('chat');
  };
  document.getElementById('tdm-build-btn').onclick = () => {
    closeTrendDetail();
    promptInput.value = item.prompt || item.title;
    autoResize(promptInput);
    sendPromptAsBuild(item.prompt || item.title);
    switchSection('chat');
  };

  modal.classList.add('open');
  _loadTrendDetail(item);
};

async function _loadTrendDetail(item) {
  const el = document.getElementById('tdm-detail');
  if (!el) return;
  el.innerHTML = `<div class="loading-state" style="padding:20px 0"><div class="spin"></div><span>Loading details…</span></div>`;

  try {
    const source = item.source || currentTrendSource;
    const tag    = (source === 'mastodon' && item.title.startsWith('#')) ? item.title.slice(1) : '';
    const params = new URLSearchParams({ source });
    if (item.source_url) params.set('url', item.source_url);
    if (tag)             params.set('tag', tag);

    const data = await fetch(`/api/trends/detail?${params}`).then(r => r.json());
    if (!data.success) { el.innerHTML = ''; return; }
    el.innerHTML = _renderTrendDetail(data, item);
  } catch { el.innerHTML = ''; }
}

function _renderTrendDetail(d, item) {
  if (d.type === 'mastodon_posts') {
    if (!d.posts?.length) return '';
    const posts = d.posts.map(p => {
      const buildP = `Build an interactive web app inspired by this Mastodon post: ${p.content.slice(0, 120)}`;
      return `
        <div class="tdm-post tdm-post-clickable" onclick="closeTrendDetail();buildFromPost(${JSON.stringify(buildP)})">
          <div class="tdm-post-author">@${esc(p.author)}</div>
          <div class="tdm-post-text">${esc(p.content)}</div>
          <div class="tdm-post-meta">
            🔁 ${p.boosts}  ♥ ${p.likes}
            ${p.url ? `<a href="${esc(p.url)}" target="_blank" style="margin-left:8px;color:var(--cyan);font-size:10px" onclick="event.stopPropagation()">↗</a>` : ''}
            <button class="trend-build-btn" style="margin-left:auto;font-size:10px;padding:3px 8px"
              onclick="event.stopPropagation();closeTrendDetail();buildFromPost(${JSON.stringify(buildP)})">Build →</button>
          </div>
        </div>`;
    }).join('');
    return `<div class="tdm-section-label">Recent posts</div>${posts}`;
  }

  if (d.type === 'hn_story') {
    let html = `<div class="tdm-section-label">HackerNews · ${d.score} points · ${d.n_comments} comments · by ${esc(d.by)}</div>`;
    if (d.story_url) html += `<a href="${esc(d.story_url)}" target="_blank" class="tdm-ext-link">↗ Read article</a>`;
    if (d.comments?.length) {
      html += `<div class="tdm-section-label" style="margin-top:12px">Top comments</div>`;
      html += d.comments.map(c => `
        <div class="tdm-post">
          <div class="tdm-post-author">${esc(c.by)}</div>
          <div class="tdm-post-text">${esc(c.text)}</div>
        </div>`).join('');
    }
    return html;
  }

  if (d.type === 'github_repo') {
    const topics = (d.topics || []).map(t => `<span class="trend-tag">${esc(t)}</span>`).join('');
    let html = `
      <div class="tdm-section-label">Repository stats</div>
      <div class="tdm-stat-row">
        <span>⭐ ${Number(d.stars).toLocaleString()} stars</span>
        <span>🍴 ${Number(d.forks).toLocaleString()} forks</span>
        ${d.language ? `<span>🔵 ${esc(d.language)}</span>` : ''}
      </div>
      ${topics ? `<div class="trend-tags" style="flex-wrap:wrap;margin-top:8px">${topics}</div>` : ''}
      ${d.homepage ? `<a href="${esc(d.homepage)}" target="_blank" class="tdm-ext-link">↗ Homepage</a>` : ''}`;
    if (d.readme) html += `
      <div class="tdm-section-label" style="margin-top:12px">README</div>
      <div class="tdm-readme">${esc(d.readme)}</div>`;
    return html;
  }

  if (d.type === 'reddit_post') {
    let html = `<div class="tdm-section-label">${esc(d.subreddit)} · ⬆ ${d.score} · 💬 ${d.n_comments}</div>`;
    if (d.selftext) html += `<div class="tdm-post-text" style="padding:10px 0">${esc(d.selftext)}</div>`;
    if (d.comments?.length) {
      html += `<div class="tdm-section-label" style="margin-top:8px">Top comments</div>`;
      html += d.comments.map(c => `
        <div class="tdm-post">
          <div class="tdm-post-author">${esc(c.by)} · ⬆ ${c.score}</div>
          <div class="tdm-post-text">${esc(c.text)}</div>
        </div>`).join('');
    }
    return html;
  }

  if (d.type === 'youtube_video') {
    return `
      ${d.thumbnail ? `<img src="${esc(d.thumbnail)}" style="width:100%;border-radius:8px;margin-bottom:10px">` : ''}
      <div class="tdm-stat-row">
        <span>👁 ${Number(d.views).toLocaleString()}</span>
        <span>👍 ${Number(d.likes).toLocaleString()}</span>
        <span>💬 ${Number(d.comments).toLocaleString()}</span>
      </div>
      <div class="tdm-section-label" style="margin-top:10px">${esc(d.channel)}</div>
      ${d.description ? `<div class="tdm-post-text">${esc(d.description)}</div>` : ''}`;
  }
  return '';
}

window.closeTrendDetail = function () {
  document.getElementById('trend-detail-modal')?.classList.remove('open');
};
