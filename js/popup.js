// ── Helpers ────────────────────────────────────────────────────────────────
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayKey(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function minToHHMM(m) {
  const a = Math.abs(Math.round(m));
  return pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}
function secToHHMMSS(s) {
  const a = Math.abs(Math.round(s));
  return pad(Math.floor(a / 3600)) + ':' + pad(Math.floor((a % 3600) / 60)) + ':' + pad(a % 60);
}
function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
// Time-of-day formatter — respects the saved 12h/24h preference (et_timeFmt).
function getTimeFmt() {
  try { return localStorage.getItem('et_timeFmt') === '12' ? '12' : '24'; } catch (_) { return '24'; }
}
function fmtTime(d) {
  const h = d.getHours(), m = d.getMinutes();
  if (getTimeFmt() === '12') {
    const ap = h < 12 ? 'AM' : 'PM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + pad(m) + ' ' + ap;
  }
  return pad(h) + ':' + pad(m);
}
function timeAgo(ms) {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60)  return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  return Math.floor(sec / 3600) + 'h ago';
}

// ── State ───────────────────────────────────────────────────────────────────
let tickTimer        = null;
let autoRefreshTimer = null;
let rawData          = null;
let showSessions     = (() => { try { return localStorage.getItem('et_showSessions') === '1'; } catch (_) { return false; } })();
let notified5min     = false;
let notifiedDone     = false;

// ── DOM helpers ─────────────────────────────────────────────────────────────
// Open a fresh ManekTech attendance tab.
function createSiteTab() {
  chrome.tabs.create({ url: 'http://mtworks.manektech.com/inout-summary.aspx' });
}

// Find an existing ManekTech tab in ANY window. If found, switch to it (focus
// its window + activate it), optionally reload it. If none exists, open a fresh
// one. Used everywhere instead of blindly creating a new tab or reloading the
// current (random) active tab — e.g. the "session expired" login button.
async function focusOrOpenMTWorks(reload = false) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: '*://mtworks.manektech.com/*' }); } catch (_) {}
  const tab = tabs && tabs[0];
  if (tab) {
    try {
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
      if (reload) await chrome.tabs.reload(tab.id);
    } catch (_) { createSiteTab(); }
    return tab;
  }
  createSiteTab();
  return null;
}

// Back-compat name used by the "Open Attendance Page" buttons: jump to an
// existing tab (no forced reload) or open a new one.
function openSite() { focusOrOpenMTWorks(false); }
function setContent(html) {
  document.getElementById('content').innerHTML = html;
}

// ── Inline SVG icons (consistent stroke style, tinted via CSS) ───────────────
const SVG = {
  alert:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  building: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2"/></svg>`,
  sunrise:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/></svg>`,
  lock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  clock:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 13.5"/></svg>`,
  wifi:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`
};
function stateIcon(name, color) {
  return `<div class="state-icon ${color}">${SVG[name]}</div>`;
}

// Small per-card category icons (muted, top-right)
const CICON = {
  clock:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`,
  coffee:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a3 3 0 0 1 0 6h-1"/><path d="M2 8h16v6a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>`,
  trend:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="21 12 21 7 16 7"/></svg>`,
  exit:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  check:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  percent:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`,
  zap:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  alert:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
};
function cardIco(name) { return `<div class="stat-ico">${CICON[name]}</div>`; }
function showLoading() {
  stopTick();
  document.getElementById('badge').style.display = 'none';
  setContent(`<div class="loading"><div class="spinner"></div><span>Fetching attendance data…</span></div>`);
}
function showNotOnSite() {
  stopTick();
  document.getElementById('badge').style.display = 'none';
  setContent(`
    <div class="not-on-site">
      ${stateIcon('building', 'blue')}
      <h3>Not on ManekTech</h3>
      <p>Open the attendance page first,<br>then click this icon again.</p>
      <button class="btn" id="ob">Open Attendance Page</button>
      <div class="site-url">mtworks.manektech.com/inout-summary.aspx</div>
    </div>`);
  document.getElementById('ob').onclick = openSite;
}
function showError(msg, canRetry = false) {
  stopTick();
  document.getElementById('badge').style.display = 'none';
  setContent(`
    <div class="error-box">
      ${stateIcon('alert', 'amber')}
      <div class="error-msg">${msg}</div>
      ${canRetry ? `<button class="btn btn-secondary" id="retryBtn" style="margin-bottom:8px">Retry</button>` : ''}
      <button class="btn" id="ob">Open Attendance Page</button>
    </div>`);
  document.getElementById('ob').onclick = openSite;
  if (canRetry) document.getElementById('retryBtn').onclick = () => loadData(false);
}
function showSessionExpired() {
  stopTick();
  document.getElementById('badge').style.display = 'none';
  setContent(`
    <div class="error-box">
      ${stateIcon('lock', 'red')}
      <div class="error-msg">Session expired. Please log in again.</div>
      <button class="btn" id="ob">Refresh &amp; Login</button>
    </div>`);
  document.getElementById('ob').onclick = async () => {
    // Switch to an existing ManekTech tab (any window) and reload it; only
    // open a new one if none is open. Never reloads the current random tab.
    await focusOrOpenMTWorks(true);
    startAutoRefresh(); // resume polling so we pick up data once re-logged in
  };
}

// Session expired is terminal: stop the live timer + badge so nothing keeps
// ticking on dead data, reset notify flags, then show the login screen.
function handleSessionExpired() {
  stopTick();
  stopAutoRefresh();
  rawData      = null;
  notified5min = false;
  notifiedDone = false;
  try { chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }); } catch (_) {}
  showSessionExpired();
}

// New-day empty state — shown when the only data we have is from a previous day.
function showNewDay() {
  stopTick();
  document.getElementById('badge').style.display = 'none';
  setContent(`
    <div class="not-on-site">
      ${stateIcon('sunrise', 'amber')}
      <h3>New day</h3>
      <p>Yesterday's timer was cleared.<br>Open the attendance page to start today.</p>
      <button class="btn" id="ob">Open Attendance Page</button>
      <div class="site-url">mtworks.manektech.com/inout-summary.aspx</div>
    </div>`);
  document.getElementById('ob').onclick = openSite;
}

// Local day changed while data was live → drop stale data, clear badge, refetch.
function handleDayRollover() {
  stopTick();
  rawData      = null;
  notified5min = false;
  notifiedDone = false;
  try { chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }); } catch (_) {}
  loadData(false); // on-site → today's data; off-site → new-day state
}

// First run — member ID never captured yet (never visited attendance page).
function showFirstRun() {
  stopTick();
  document.getElementById('badge').style.display = 'none';
  setContent(`
    <div class="not-on-site">
      ${stateIcon('building', 'blue')}
      <h3>Quick setup</h3>
      <p>Open the attendance page once so the timer can find your member ID.<br>After that it works on every ManekTech page.</p>
      <button class="btn" id="ob">Open Attendance Page</button>
      <div class="site-url">mtworks.manektech.com/inout-summary.aspx</div>
    </div>`);
  document.getElementById('ob').onclick = openSite;
}

// No punches recorded for today yet.
function showNoSessions() {
  stopTick();
  document.getElementById('badge').style.display = 'none';
  setContent(`
    <div class="not-on-site">
      ${stateIcon('clock', 'amber')}
      <h3>No punches yet</h3>
      <p>You haven't punched in today.<br>Punch in and the timer starts automatically.</p>
      <button class="btn btn-secondary" id="retryBtn" style="margin-bottom:8px">Retry</button>
      <button class="btn" id="ob">Open Attendance Page</button>
    </div>`);
  document.getElementById('ob').onclick = openSite;
  document.getElementById('retryBtn').onclick = () => loadData(false);
}

// Map a page-fetcher / popup error code to a friendly, on-brand screen.
function showErrorState(code, detail) {
  switch (code) {
    case 'first_run':   return showFirstRun();
    case 'no_sessions': return showNoSessions();
    case 'api_error':
      return showError("Couldn't reach ManekTech. Check your connection, then retry.", true);
    case 'load_failed':
      return showError('No data came back. Open the attendance page and retry.', true);
    case 'exec_failed':
      return showError("Couldn't read this page. Open the attendance page and retry.", true);
    default:
      return showError('Something went wrong. Please retry.', true);
  }
}

// ── Offline cache ──────────────────────────────────────────────────────────
function saveCachedData(data) {
  try { localStorage.setItem('et_cache', JSON.stringify(data)); } catch (_) {}
}
function loadCachedData() {
  try { return JSON.parse(localStorage.getItem('et_cache') || 'null'); } catch (_) { return null; }
}
// Render today's cached sessions when a fresh fetch couldn't get them.
// Returns true if cached data was shown.
function serveCachedToday(silent) {
  const cached = loadCachedData();
  if (!(cached?.sessions?.length && cached.dayKey === todayKey())) return false;
  rawData = { ...cached, _offline: true };
  applyManualToRaw();
  if (silent && document.getElementById('liveWorked')) tick();
  else startTick();
  return true;
}

// ── Manual sessions (split-shift / work-from-home entries) ───────────────────
// Per-day history kept under et_manualSessions so old days can be reviewed and
// pulled into the Excel export later (e.g. for regularisation requests).
// Shape: { "YYYY-MM-DD": [{ inMs, outMs|null, manual:true, note }] }
function loadAllManual() {
  try { return JSON.parse(localStorage.getItem('et_manualSessions') || '{}') || {}; }
  catch (_) { return {}; }
}
function saveAllManual(obj) {
  try { localStorage.setItem('et_manualSessions', JSON.stringify(obj)); } catch (_) {}
}
function getManualFor(dayKey) {
  const all = loadAllManual();
  return Array.isArray(all[dayKey]) ? all[dayKey] : [];
}
function addManualSession(dayKey, inMs, outMs, note) {
  const all = loadAllManual();
  (all[dayKey] = all[dayKey] || []).push({ inMs, outMs: outMs ?? null, manual: true, note: note || '' });
  all[dayKey].sort((a, b) => a.inMs - b.inMs);
  saveAllManual(all);
}
function deleteManualSession(dayKey, inMs) {
  const all = loadAllManual();
  if (!all[dayKey]) return;
  all[dayKey] = all[dayKey].filter(s => s.inMs !== inMs);
  if (!all[dayKey].length) delete all[dayKey];
  saveAllManual(all);
}

// When there's no office data at all today (no tab, not punched) but manual
// sessions exist, build a minimal rawData from manual alone so the timer still
// works for a fully-remote / split day. Returns true if it rendered.
function serveManualOnly() {
  const dayKey = todayKey();
  const manual = getManualFor(dayKey);
  if (!manual.length) return false;
  // Reuse last known target if cached, else default 9h15m.
  const cached = loadCachedData();
  const targetMin = (cached?.dayKey === dayKey ? cached.targetMin : null) || (9 * 60 + 15);
  rawData = {
    sessions: [], _officeSessions: [],
    targetMin, dayKey,
    monthlySummary: cached?.monthlySummary || null,
    fetchedAt: Date.now(), _manualOnly: true
  };
  applyManualToRaw();
  startTick();
  return true;
}

// Merge today's manual sessions into the office tracker sessions on rawData,
// sorted by start time, so worked / break / exit-time calc treats them as one
// timeline. Called after every fetch and after any manual edit.
function applyManualToRaw() {
  if (!rawData) return;
  const dayKey = rawData.dayKey || todayKey();
  const manual = getManualFor(dayKey);
  // Office sessions are the non-manual ones; rebuild from them + manual each time
  // so re-applying is idempotent.
  const office = (rawData._officeSessions || rawData.sessions || []).filter(s => !s.manual);
  rawData._officeSessions = office;
  const merged = office.concat(manual.map(m => ({ inMs: m.inMs, outMs: m.outMs, manual: true, note: m.note })))
    .sort((a, b) => a.inMs - b.inMs);
  rawData.sessions = merged;
}

// ── Copy exit time to clipboard ─────────────────────────────────────────────
function copyExitTime(exitStr) {
  if (!exitStr || exitStr === '--:--' || exitStr === '✓ Done') return;
  navigator.clipboard.writeText(exitStr).then(() => {
    const el = document.getElementById('liveExitTime');
    if (!el) return;
    const old = el.querySelector('.copy-toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.className = 'copy-toast';
    toast.textContent = 'Copied!';
    el.appendChild(toast);
    setTimeout(() => toast.remove(), 1600);
  }).catch(() => {});
}

// Notifications are owned by the background worker (background.js) so they
// fire at 5/2/1 min + done even with the popup closed — no popup-side notify.

// ── Extension badge (send to background, no direct write) ───────────────────
function updateBadge(remainSec, hasOpen) {
  try {
    chrome.runtime.sendMessage({ type: 'BADGE_UPDATE', remainSec, hasOpen });
  } catch (_) {}
}

// ── Animated value update helper ─────────────────────────────────────────────
function updateVal(id, newText, className) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.textContent !== newText) {
    el.textContent = newText;
    el.classList.remove('value-changed');
    void el.offsetWidth;
    el.classList.add('value-changed');
  }
  if (className !== undefined) el.className = className;
}

// ── Tick engine ──────────────────────────────────────────────────────────────
function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  const footer = document.getElementById('mainFooter');
  if (footer) footer.style.display = 'none';
}

function startTick() {
  stopTick();
  tick();
  tickTimer = setInterval(tick, 1000);
}

function tick() {
  if (!rawData) return;
  // Midnight passed while popup/data was alive → stale, reset for the new day.
  if (rawData.dayKey && rawData.dayKey !== todayKey()) { handleDayRollover(); return; }
  const { sessions, targetMin } = rawData;

  const nowMs  = Date.now();
  const TARGET = targetMin * 60;

  let workedSec = 0;
  let breakSec  = 0;
  let hasOpen   = false;

  sessions.forEach((s, i) => {
    const out  = s.outMs || nowMs;
    const dur  = Math.max(0, out - s.inMs) / 1000;
    workedSec += dur;
    if (!s.outMs) hasOpen = true;

    if (i < sessions.length - 1 && s.outMs) {
      const gap = Math.max(0, sessions[i + 1].inMs - s.outMs) / 1000;
      breakSec += gap;
    }
  });

  const remainSec = TARGET - workedSec;
  const variSec   = workedSec - TARGET;
  const pct       = Math.min(100, Math.round((workedSec / TARGET) * 100));

  let exitStr = null;
  if (hasOpen && remainSec > 0) {
    const exitMs = nowMs + remainSec * 1000;
    exitStr = fmtTime(new Date(exitMs));
  }

  updateBadge(remainSec, hasOpen);

  // Badge chip
  const badge = document.getElementById('badge');
  if (badge) {
    badge.style.display = 'inline-block';
    if (remainSec <= 0) { badge.textContent = 'Done';   badge.className = 'badge badge-done'; }
    else if (hasOpen)   { badge.textContent = 'Live';   badge.className = 'badge badge-live'; }
    else                { badge.textContent = 'Paused'; badge.className = 'badge badge-paused'; }
  }

  if (document.getElementById('liveWorked')) {
    // stopTick() hides the footer; re-show it whenever the live view is active
    // (e.g. after blur→focus restarts the tick without a full re-render).
    const footerEl = document.getElementById('mainFooter');
    if (footerEl && footerEl.style.display === 'none') footerEl.style.display = 'flex';

    updateVal('liveWorked',  minToHHMM(workedSec / 60));
    updateVal('liveWorked2', minToHHMM(workedSec / 60));
    updateVal('liveBreak',   minToHHMM(breakSec / 60));
    const varSign = variSec >= 0 ? '+' : '-';
    updateVal('liveVariation',
      varSign + secToHHMMSS(Math.abs(variSec)),
      'stat-val ' + (variSec >= 0 ? 'green' : 'red')
    );
    document.getElementById('liveTime').textContent = new Date().toLocaleTimeString();

    // Update dot tooltip with last-updated time
    const dot = document.getElementById('footDot');
    if (dot && rawData.fetchedAt) {
      const base = dot.title.split(' · ')[0];
      dot.title = base + ' · Updated ' + timeAgo(rawData.fetchedAt);
    }

    const pb = document.getElementById('liveProgress');
    if (pb) pb.style.width = pct + '%';
    const pl = document.getElementById('livePct');
    if (pl) pl.textContent = minToHHMM(workedSec / 60) + ' · ' + pct + '%';

    const ringFill = document.getElementById('ringFill');
    if (ringFill) {
      const r = 20, circ = 2 * Math.PI * r;
      const ringColor = remainSec <= 0 ? 'var(--green)' : hasOpen ? 'var(--amber)' : 'var(--blue)';
      ringFill.style.strokeDasharray  = circ;
      ringFill.style.strokeDashoffset = circ - (pct / 100) * circ;
      ringFill.style.stroke = ringColor;
    }
    const ringPct = document.getElementById('ringPct');
    if (ringPct) ringPct.textContent = pct + '%';

    const hero = document.getElementById('exitHero');
    if (hero) hero.className = 'exit-hero ' + (remainSec <= 0 ? 'green-glow' : hasOpen ? 'blue-glow' : 'amber-glow');

    const exitEl    = document.getElementById('liveExitTime');
    const exitNote  = document.getElementById('liveExitNote');
    const exitLabel = document.getElementById('liveExitLabel');
    if (exitEl) {
      if (remainSec <= 0) {
        exitEl.textContent    = 'Done';
        exitEl.className      = 'exit-time done-gradient';
        exitLabel.textContent = 'Target Reached 🎉';
        exitNote.innerHTML    = `<span>+${secToHHMMSS(Math.abs(variSec))} extra</span>`;
      } else if (hasOpen) {
        exitEl.textContent    = exitStr || '--:--';
        exitEl.className      = 'exit-time blue';
        exitLabel.textContent = 'Leave By';
        exitNote.innerHTML    = `<span>⏱ ${secToHHMMSS(remainSec)} left</span>`;
      } else {
        exitEl.textContent    = exitStr || '--:--';
        exitEl.className      = 'exit-time amber';
        exitLabel.textContent = 'Paused — Leave By';
        exitNote.innerHTML    = `<span>⏸ ${secToHHMMSS(Math.abs(remainSec))} left</span>`;
      }
    }
  } else {
    renderFull(sessions, workedSec, breakSec, remainSec, variSec, hasOpen, exitStr, pct, targetMin);
  }
}

// ── Full initial render ──────────────────────────────────────────────────────
function renderFull(sessions, workedSec, breakSec, remainSec, variSec, hasOpen, exitStr, pct, targetMin) {
  const varSign   = variSec >= 0 ? '+' : '-';
  const varClass  = variSec >= 0 ? 'green' : 'red';
  const timeClass = remainSec <= 0 ? 'done-gradient' : hasOpen ? 'blue' : 'amber';
  const heroGlow  = remainSec <= 0 ? 'green-glow' : hasOpen ? 'blue-glow' : 'amber-glow';
  const exitLabel = remainSec <= 0 ? 'Target Reached 🎉' : hasOpen ? 'Leave By' : 'Paused — Leave By';
  const exitDisplay = remainSec <= 0 ? '✓ Done' : exitStr || '--:--';
  const exitNoteHtml = remainSec <= 0
    ? `<span>+${secToHHMMSS(Math.abs(variSec))} extra</span>`
    : `<span>⏱ ${secToHHMMSS(Math.abs(remainSec))} left</span>`;

  const firstInMs = sessions[0]?.inMs;
  let halfExitStr = '--:--';
  if (firstInMs) {
    const halfMs = firstInMs + (4 * 60 + 15) * 60 * 1000;
    halfExitStr = fmtTime(new Date(halfMs));
  }

  const todayStr   = new Date().toISOString().slice(0, 10);
  const todayLeave = rawData.monthlySummary?.leaveMap?.[todayStr] || null;
  const isHalfDay  = todayLeave && todayLeave.startsWith('half');

  const policyLabel = targetMin === (8 * 60 + 15) ? '8h 15m shift' : '9h 15m shift';

  // Sessions HTML
  const sessHtml = sessions.map((s, i) => {
    const inD   = new Date(s.inMs);
    const outD  = s.outMs ? new Date(s.outMs) : null;
    const inStr = fmtTime(inD);
    const outStr = outD ? fmtTime(outD) : null;
    const durMin = Math.round((s.outMs ? s.outMs - s.inMs : Date.now() - s.inMs) / 60000);
    const breakAfter = (i < sessions.length - 1 && s.outMs)
      ? Math.round((sessions[i + 1].inMs - s.outMs) / 60000) : null;
    const isOpen = !outStr;

    const manualTag = s.manual ? `<span class="sess-manual" title="Manual entry">manual</span>` : '';

    return `
      <div class="sess-card">
        <span class="sess-time">
          <span class="sess-dot ${isOpen ? 'active' : 'closed'}"></span>
          ${inStr} <span class="sess-arrow">→</span> ${isOpen ? `<span class="sess-now">now</span>` : outStr}${manualTag}
        </span>
        <span class="sess-dur">${minToHHMM(durMin)}</span>
      </div>
      ${breakAfter !== null ? `<div class="sess-break">☕ ${minToHHMM(breakAfter)} break</div>` : ''}`;
  }).join('');

  // Monthly summary
  const ms = rawData.monthlySummary;
  let monthHtml = '';
  if (ms) {
    const leaveLabels = {
      'half-approved':   'Half Leave (Approved)',
      'half-unapproved': 'Half Leave (Pending)',
      'full-approved':   'Full Leave (Approved)',
      'full-unapproved': 'Full Leave (Pending)',
      'PL-approved':     'Privilege Leave (Approved)',
      'PL-unapproved':   'Privilege Leave (Pending)',
      'SL-approved':     'Sick Leave (Approved)',
      'SL-unapproved':   'Sick Leave (Pending)',
      uninformed: 'Uninformed', WFH: 'Work From Home', OT: 'OT'
    };
    const leaveChips = ms.leaveTally
      ? Object.entries(ms.leaveTally).map(([k, v]) =>
          `<span class="chip">${leaveLabels[k] || k}<b>${v}</b></span>`
        ).join('') : '';

    const mv = ms.monthlyVariationMin;
    const mvClass = mv >= 0 ? 'green' : 'red';

    monthHtml = `
        <div class="rl-divider">${ms.monthName || 'This Month'}</div>
        <div class="stat-grid">
          <div class="stat-card">${cardIco('calendar')}<div class="stat-val">${ms.workingDays}</div><div class="stat-lbl">Working Days</div></div>
          <div class="stat-card">${cardIco('check')}<div class="stat-val green">${ms.presentDays}</div><div class="stat-lbl">Present Days</div></div>
          <div class="stat-card">${cardIco('percent')}<div class="stat-val blue">${ms.pct}%</div><div class="stat-lbl">Attendance</div></div>
          ${mv !== undefined ? `<div class="stat-card">${cardIco('trend')}<div class="stat-val ${mvClass}">${mv >= 0 ? '+' : '-'}${minToHHMM(Math.abs(mv))}</div><div class="stat-lbl">Monthly Extra</div></div>` : ''}
          ${ms.ot ? `<div class="stat-card">${cardIco('zap')}<div class="stat-val amber">${ms.ot}</div><div class="stat-lbl">OT Days</div></div>` : ''}
          ${ms.lateCount ? `<div class="stat-card">${cardIco('alert')}<div class="stat-val red">${ms.lateCount}</div><div class="stat-lbl">Late Days</div></div>` : ''}
        </div>
        ${leaveChips ? `<div class="chips">${leaveChips}</div>` : ''}`;
  }

  const now = new Date();
  const rR = 20, rC = +(2 * Math.PI * rR).toFixed(2);
  const rOff = +(rC - (pct / 100) * rC).toFixed(2);
  const rCol = remainSec <= 0 ? 'var(--green)' : hasOpen ? 'var(--amber)' : 'var(--blue)';
  const rSz  = 52, cx = rSz / 2;

  const offlineBadge = rawData._offline
    ? `<span class="offline-badge">Offline</span>` : '';

  setContent(`
    <div class="exit-hero ${heroGlow} fade-in" id="exitHero">
      <div class="hero-row">
        <div class="hero-left">
          <div class="exit-label" id="liveExitLabel">${exitLabel}${offlineBadge}</div>
          <div class="exit-time ${timeClass}" id="liveExitTime" title="Click to copy">${exitDisplay}</div>
          <div class="exit-note" id="liveExitNote">${exitNoteHtml}</div>
        </div>
        <div class="hero-right">
          <div class="ring-wrap">
            <svg class="ring-svg" width="${rSz}" height="${rSz}" viewBox="0 0 ${rSz} ${rSz}">
              <circle class="ring-track" cx="${cx}" cy="${cx}" r="${rR}"/>
              <circle class="ring-fill" id="ringFill" cx="${cx}" cy="${cx}" r="${rR}"
                style="stroke:${rCol};stroke-dasharray:${rC};stroke-dashoffset:${rOff}"/>
              <text id="ringPct" x="${cx}" y="${cx}" text-anchor="middle" dominant-baseline="middle"
                style="font-size:9px;font-weight:800;fill:var(--text2);font-family:Inter,sans-serif">${pct}%</text>
            </svg>
            <div class="ring-label">${policyLabel}</div>
          </div>
        </div>
      </div>
      <div class="prog-wrap">
        <div class="prog-bg">
          <div class="prog-fill ${timeClass}" id="liveProgress" style="width:${pct}%"></div>
        </div>
        <div class="prog-labels">
          <span id="liveWorked">${minToHHMM(workedSec / 60)}</span>
          <span id="livePct">${minToHHMM(workedSec / 60)} · ${pct}%</span>
        </div>
      </div>
    </div>

    <div class="stat-grid fade-in">
      <div class="stat-card">
        ${cardIco('clock')}
        <div class="stat-val blue" id="liveWorked2">${minToHHMM(workedSec / 60)}</div>
        <div class="stat-lbl">Worked</div>
      </div>
      <div class="stat-card">
        ${cardIco('coffee')}
        <div class="stat-val muted" id="liveBreak">${minToHHMM(breakSec / 60)}</div>
        <div class="stat-lbl">Break</div>
      </div>
      <div class="stat-card">
        ${cardIco('trend')}
        <div class="stat-val ${varClass}" id="liveVariation">${varSign}${secToHHMMSS(Math.abs(variSec))}</div>
        <div class="stat-lbl">+/− Today</div>
      </div>
      <div class="stat-card ${isHalfDay ? 'hl' : ''}">
        ${cardIco('exit')}
        <div class="stat-val amber">${halfExitStr}</div>
        <div class="stat-lbl">Half Day Exit</div>
      </div>
    </div>
    ${monthHtml}

    <div class="sess-block fade-in" id="sessionsBlock" style="display:${showSessions ? 'block' : 'none'}">
      <div class="rl-divider">Today's Sessions</div>
      ${sessHtml}
    </div>`);

  // Wire interactions
  document.getElementById('liveExitTime')
    ?.addEventListener('click', () => copyExitTime(document.getElementById('liveExitTime').textContent.trim()));

  // Footer
  const footer = document.getElementById('mainFooter');
  if (footer) {
    footer.style.display = 'flex';
    const dot = document.getElementById('footDot');
    const date = document.getElementById('footDate');
    const statusText = hasOpen ? 'Session in progress' : 'All sessions closed';
    const updatedText = rawData.fetchedAt ? ' · Updated ' + timeAgo(rawData.fetchedAt) : '';
    if (dot) { dot.className = 'foot-dot ' + (hasOpen ? 'active' : 'idle'); dot.title = statusText + updatedText; }
    if (date) date.textContent = fmtDate(now);
  }

  // Sessions toggle (menu item)
  const sessBtn = document.getElementById('sessionsBtn');
  const sessLbl = document.getElementById('sessionsLabel');
  if (sessBtn) {
    const sync = () => {
      sessBtn.classList.toggle('active', showSessions);
      if (sessLbl) sessLbl.textContent = showSessions ? 'Hide sessions' : 'Show sessions';
    };
    sync();
    sessBtn.onclick = () => {
      showSessions = !showSessions;
      try { localStorage.setItem('et_showSessions', showSessions ? '1' : '0'); } catch (_) {}
      const block = document.getElementById('sessionsBlock');
      if (block) block.style.display = showSessions ? 'block' : 'none';
      sync();
    };
  }
}

// ── Load data from page (network call) ──────────────────────────────────────
async function loadData(silent = false) {
  if (!silent) showLoading();

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.classList.add('spinning');

  // Prefer the active tab if it's on ManekTech; otherwise reuse ANY open
  // ManekTech tab (even a background one). The stored member ID lets the fetch
  // run from any page, so the timer keeps working — and picks up new punches —
  // no matter which page you're looking at.
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = (active && active.url && active.url.includes('mtworks.manektech.com')) ? active : null;
  if (!tab) {
    try {
      const mt = await chrome.tabs.query({ url: '*://mtworks.manektech.com/*' });
      tab = mt[0] || null;
    } catch (_) {}
  }

  if (!tab) {
    // No ManekTech tab open anywhere → show today's cached data if we have it.
    if (refreshBtn) refreshBtn.classList.remove('spinning');
    if (!silent) {
      const cached = loadCachedData();
      if (cached && cached.dayKey === todayKey()) {
        rawData = { ...cached, _offline: true };
        applyManualToRaw();
        startTick();
      } else if (serveManualOnly()) {
        // No office data today, but manual sessions exist → run on those alone.
      } else if (cached) {
        showNewDay();
      } else {
        showNotOnSite();
      }
    }
    return;
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['js/page-fetcher.js']
    });
  } catch (e) {
    if (refreshBtn) refreshBtn.classList.remove('spinning');
    if (!silent) showErrorState('exec_failed');
    return;
  }

  if (refreshBtn) refreshBtn.classList.remove('spinning');

  const result = results?.[0]?.result;

  // Terminal — handle even during silent auto-refresh so the timer/badge
  // stop ticking on stale data the moment the session dies.
  if (result?.error === 'session_expired') { handleSessionExpired(); return; }

  if (!result) {
    if (!serveCachedToday(silent)) { if (!silent) showErrorState('load_failed'); }
    return;
  }
  if (result.error) {
    // Transient miss (e.g. read off a non-summary page) — keep today's cached
    // data on screen instead of flashing an error.
    if (serveCachedToday(silent)) return;
    if (!silent && serveManualOnly()) return;
    if (!silent) showErrorState(result.error, result.detail);
    return;
  }
  if (!result.sessions?.length) {
    if (serveCachedToday(silent)) return;
    if (!silent && serveManualOnly()) return;
    if (!silent) showErrorState('no_sessions');
    return;
  }

  // Keep the monthly summary visible even when this fetch (off the summary
  // page) didn't include it.
  if (!result.monthlySummary) {
    const cached = loadCachedData();
    if (cached?.monthlySummary) result.monthlySummary = cached.monthlySummary;
  }

  rawData = result;
  saveCachedData(result);
  applyManualToRaw();

  try {
    chrome.runtime.sendMessage({
      type: 'STORE_DATA',
      data: { sessions: rawData.sessions, targetMin: result.targetMin, dayKey: result.dayKey }
    });
  } catch (_) {}

  if (silent && document.getElementById('liveWorked')) {
    tick();
    return;
  }

  startTick();
}

// ── Auto refresh (every 60s, silent) ─────────────────────────────────────────
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => loadData(true), 60 * 1000);
}
function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

// ── Pause tick when popup not visible ────────────────────────────────────────
window.addEventListener('blur', () => {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = -1; }
});
window.addEventListener('focus', () => {
  if (tickTimer === -1) {
    tickTimer = null;
    if (rawData) startTick();
  }
});

// ── Theme toggle (with sun/moon icon) ────────────────────────────────────────
(function initTheme() {
  const MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  const SUN  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    const btn = document.getElementById('themeBtn');
    if (btn) btn.innerHTML = t === 'dark' ? SUN : MOON;
  }

  const saved = localStorage.getItem('et_theme');
  const sys   = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(saved || sys);

  document.getElementById('themeBtn').addEventListener('click', () => {
    const cur  = document.documentElement.getAttribute('data-theme') || sys;
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('et_theme', next);
    applyTheme(next);
  });
})();

// ── Export current month as a styled multi-sheet .xlsx workbook ──────────────
// Runs only on button click. month-fetcher.js loops day 1..today + reads the
// calendar, returning structured data. We build a modern Excel workbook with
// ExcelJS: colored headers, banded rows, status colors, autofilter, frozen
// panes, number formats, totals, plus a Dashboard sheet with canvas-rendered
// charts embedded as images.
async function exportMonthXLSX() {
  if (typeof ExcelJS === 'undefined') { showExportToast('Export library failed to load.', true); return; }

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = (active && active.url && active.url.includes('mtworks.manektech.com')) ? active : null;
  if (!tab) {
    try { const mt = await chrome.tabs.query({ url: '*://mtworks.manektech.com/*' }); tab = mt[0] || null; } catch (_) {}
  }
  if (!tab) { showExportToast('Open a ManekTech tab first to export.', true); return; }

  const btn = document.getElementById('exportBtn');
  if (btn) btn.classList.add('spinning');
  showExportOverlay();

  let result;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['js/month-fetcher.js']
    });
    result = results?.[0]?.result;
  } catch (e) {
    hideExportOverlay();
    if (btn) btn.classList.remove('spinning');
    showExportToast("Couldn't read the page. Open the attendance page and retry.", true);
    return;
  }

  if (!result || result.error) {
    hideExportOverlay();
    if (btn) btn.classList.remove('spinning');
    showExportToast(result?.error === 'session_expired'
      ? 'Session expired — log in and retry.'
      : "Export failed. Open the attendance page and retry.", true);
    return;
  }
  if (!result.days || !result.days.length) {
    hideExportOverlay();
    if (btn) btn.classList.remove('spinning');
    showExportToast('No data found for this month.', true);
    return;
  }

  // Fold this month's manual sessions into the export so worked totals, the
  // Sessions sheet, and a dedicated Manual sheet all include them.
  mergeManualIntoExport(result);

  try {
    const buf = await buildWorkbook(result);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ManekTech-Attendance-' + result.monthKey + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showExportToast('Exported ' + result.days.length + ' days ✓', false);
  } catch (e) {
    showExportToast('Could not build the file: ' + (e.message || e), true);
  } finally {
    hideExportOverlay();
    if (btn) btn.classList.remove('spinning');
  }
}

// Fold stored manual sessions (per-day history) into the export result so all
// sheets reflect them. Adds R.manualRows (flat list) for the Manual sheet and
// recomputes worked/sessions/variation for any day that has manual entries.
function mergeManualIntoExport(R) {
  const all = loadAllManual();
  const manualRows = [];
  const wdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Only manual entries within the exported month.
  Object.keys(all).forEach(dateStr => {
    if (!dateStr.startsWith(R.monthKey)) return;
    const list = all[dateStr] || [];
    const dObj = new Date(dateStr + 'T00:00:00');
    list.forEach(m => {
      manualRows.push({
        date: dateStr, weekday: wdays[dObj.getDay()],
        inMs: m.inMs, outMs: m.outMs,
        durMin: m.outMs ? Math.round((m.outMs - m.inMs) / 60000) : null,
        open: !m.outMs, note: m.note || ''
      });
    });

    // Reflect into the matching day row (if the month-fetcher produced one).
    const day = R.days.find(d => d.date === dateStr);
    if (!day) return;
    let addWorked = 0;
    list.forEach(m => { if (m.outMs) addWorked += (m.outMs - m.inMs) / 60000; });
    addWorked = Math.round(addWorked);
    if (addWorked > 0) {
      day.workedMin += addWorked;
      day.sessionCount += list.length;
      if (day.status !== 'Present') day.status = 'Present';
      day.variationMin = day.workedMin - R.summary.targetMin;
      if (!day.firstIn || (list[0] && list[0].inMs < day.firstIn)) day.firstIn = Math.min(day.firstIn || Infinity, list[0].inMs);
      const lastClosed = list.filter(m => m.outMs).slice(-1)[0];
      if (lastClosed && (!day.lastOut || lastClosed.outMs > day.lastOut)) day.lastOut = lastClosed.outMs;
    }
    // Add to Sessions sheet rows too.
    list.forEach((m, i) => {
      R.sessionRows.push({
        date: dateStr, weekday: wdays[dObj.getDay()], idx: 900 + i,
        inMs: m.inMs, outMs: m.outMs, durMin: m.outMs ? Math.round((m.outMs - m.inMs) / 60000) : 0,
        open: !m.outMs, manual: true
      });
    });
  });

  // Recompute month aggregates affected by manual time.
  const s = R.summary;
  s.totalWorkedMin = R.days.reduce((a, x) => a + x.workedMin, 0);
  s.presentDays = R.days.filter(x => x.status === 'Present').length;
  s.avgWorkedMin = s.presentDays ? Math.round(s.totalWorkedMin / s.presentDays) : 0;
  s.totalVariationMin = R.days.reduce((a, x) => a + (x.variationMin || 0), 0);

  manualRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.inMs - b.inMs));
  R.manualRows = manualRows;
}

// ── Workbook builder (ExcelJS) ───────────────────────────────────────────────
// Durations/clock times are real Excel time numbers (fraction of a day) so they
// sum and never throw #VALUE!. Columns are widened so values never show as ###.
function xlDur(min) { return (min == null) ? null : min / 1440; }
function xlTimeOfDay(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
}
const FMT_DUR    = '[h]:mm';
const FMT_TIME24 = 'hh:mm';
const FMT_TIME12 = 'h:mm\\ AM/PM';
// Variation as SIGNED decimal hours. Excel's [h]:mm cannot render negative
// durations (shows ####), so variation uses signed hours with a colored format:
// positive green, negative red, zero gray. Sums correctly, sorts correctly.
const FMT_VAR    = '[Green]+0.00" h";[Red]\\-0.00" h";[Color16]0.00" h"';
function xlHours(min) { return (min == null) ? null : min / 60; }

// Palette
const C = {
  brand:   'FF1F4E79', brand2: 'FF2E75B6',
  headBg:  'FF1F4E79', headTx: 'FFFFFFFF',
  band:    'FFF2F6FC',
  green:   'FF548235', greenBg: 'FFE2EFDA',
  red:     'FFC00000', redBg:   'FFFCE4E4',
  amber:   'FFBF8F00', amberBg: 'FFFFF2CC',
  grayBg:  'FFF2F2F2', grayTx: 'FF808080',
  border:  'FFD9D9D9'
};

function styleHeader(row) {
  row.font = { bold: true, color: { argb: C.headTx }, size: 11 };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 22;
  row.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headBg } };
    c.border = thin();
  });
}
function thin() {
  return { top: { style: 'thin', color: { argb: C.border } }, bottom: { style: 'thin', color: { argb: C.border } },
           left: { style: 'thin', color: { argb: C.border } }, right: { style: 'thin', color: { argb: C.border } } };
}
function statusColors(status) {
  if (status === 'Present') return [C.green, C.greenBg];
  if (status === 'Absent')  return [C.red, C.redBg];
  if (status === 'Weekend' || status === 'Holiday') return [C.grayTx, C.grayBg];
  return [C.amber, C.amberBg]; // leave types
}

async function buildWorkbook(R) {
  const isFmt12 = getTimeFmt() === '12';
  const FMT_TIME = isFmt12 ? FMT_TIME12 : FMT_TIME24;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ManekTech Exit Timer';
  wb.created = new Date();

  // ── Dashboard (summary + charts) ──
  const dash = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
  dash.columns = [{ width: 28 }, { width: 16 }, { width: 4 }, { width: 22 }, { width: 22 }];
  dash.mergeCells('A1:E1');
  const t = dash.getCell('A1');
  t.value = 'ManekTech Attendance — ' + R.summary.monthName;
  t.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } };
  dash.getRow(1).height = 30;

  const s = R.summary;
  const kv = [
    ['Shift target / day', xlDur(s.targetMin), FMT_DUR],
    ['Days covered', s.daysCovered],
    ['Work-expected days', s.workExpected],
    ['Present days', s.presentDays],
    ['Absent days', s.absentDays],
    ['Weekend days', s.weekendDays],
    ['Holiday days', s.holidayDays],
    ['Attendance %', s.attendancePct / 100, '0%'],
    ['Total worked', xlDur(s.totalWorkedMin), FMT_DUR],
    ['Avg worked / present day', xlDur(s.avgWorkedMin), FMT_DUR],
    ['Total break', xlDur(s.totalBreakMin), FMT_DUR],
    ['Total variation', xlHours(s.totalVariationMin), FMT_VAR],
    ['Late days', s.lateDays],
  ];
  let rr = 3;
  kv.forEach(([label, val, fmt]) => {
    const rowObj = dash.getRow(rr);
    const lc = rowObj.getCell(1), vc = rowObj.getCell(2);
    lc.value = label; lc.font = { bold: true, color: { argb: 'FF404040' } };
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
    lc.border = thin();
    vc.value = val; if (fmt) vc.numFmt = fmt;
    vc.alignment = { horizontal: 'right' }; vc.border = thin();
    rr++;
  });

  // Charts → canvas PNG → embedded images (free, offline)
  try {
    const barPng = renderBarChart(R.days);
    if (barPng) {
      const id = wb.addImage({ base64: barPng, extension: 'png' });
      dash.addImage(id, { tl: { col: 3, row: 2 }, ext: { width: 360, height: 200 } });
    }
    const donutPng = renderDonut(s);
    if (donutPng) {
      const id2 = wb.addImage({ base64: donutPng, extension: 'png' });
      dash.addImage(id2, { tl: { col: 3, row: 13 }, ext: { width: 360, height: 200 } });
    }
  } catch (_) {}

  // ── Daily ──
  const daily = wb.addWorksheet('Daily', { views: [{ state: 'frozen', ySplit: 1 }] });
  daily.columns = [
    { header: 'Date', width: 12 }, { header: 'Day', width: 7 }, { header: 'Status', width: 22 },
    { header: 'First In', width: 12 }, { header: 'Last Out', width: 12 }, { header: 'Sessions', width: 10 },
    { header: 'Worked', width: 11 }, { header: 'Break', width: 11 }, { header: 'Variation', width: 12 },
    { header: 'Late', width: 10 }, { header: 'Leave', width: 24 },
  ];
  styleHeader(daily.getRow(1));
  R.days.forEach((d, i) => {
    const row = daily.addRow([
      d.date, d.weekday, d.status,
      xlTimeOfDay(d.firstIn), xlTimeOfDay(d.lastOut),
      d.sessionCount,
      xlDur(d.workedMin), xlDur(d.breakMin),
      d.variationMin == null ? null : xlHours(d.variationMin),
      d.lateMin ? xlDur(d.lateMin) : null,
      d.leave || ''
    ]);
    row.getCell(4).numFmt = FMT_TIME; row.getCell(5).numFmt = FMT_TIME;
    row.getCell(7).numFmt = FMT_DUR;  row.getCell(8).numFmt = FMT_DUR;
    row.getCell(9).numFmt = FMT_VAR;  row.getCell(10).numFmt = FMT_DUR;
    // banded
    if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } }; });
    row.eachCell(c => { c.border = thin(); });
    // status pill colors
    const [tx, bg] = statusColors(d.status);
    const sc = row.getCell(3);
    sc.font = { bold: true, color: { argb: tx } };
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    sc.alignment = { horizontal: 'center' };
    row.getCell(1).alignment = { horizontal: 'left' };
  });
  // Totals row
  const last = daily.rowCount;
  const totals = daily.addRow(['', '', 'TOTAL', null, null,
    { formula: `SUM(F2:F${last})` }, { formula: `SUM(G2:G${last})` },
    { formula: `SUM(H2:H${last})` }, { formula: `SUM(I2:I${last})` },
    { formula: `SUM(J2:J${last})` }, '']);
  totals.font = { bold: true };
  totals.getCell(7).numFmt = FMT_DUR; totals.getCell(8).numFmt = FMT_DUR;
  totals.getCell(9).numFmt = FMT_VAR; totals.getCell(10).numFmt = FMT_DUR;
  totals.eachCell(c => { c.border = thin(); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }; });
  daily.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };

  // ── Sessions ──
  const sess = wb.addWorksheet('Sessions', { views: [{ state: 'frozen', ySplit: 1 }] });
  sess.columns = [
    { header: 'Date', width: 12 }, { header: 'Day', width: 7 }, { header: '#', width: 5 },
    { header: 'In', width: 12 }, { header: 'Out', width: 12 }, { header: 'Duration', width: 11 }, { header: 'Open?', width: 8 },
  ];
  styleHeader(sess.getRow(1));
  R.sessionRows.forEach((sx, i) => {
    const row = sess.addRow([ sx.date, sx.weekday, sx.idx,
      xlTimeOfDay(sx.inMs), sx.open ? null : xlTimeOfDay(sx.outMs), xlDur(sx.durMin), sx.open ? 'Yes' : '' ]);
    row.getCell(4).numFmt = FMT_TIME; row.getCell(5).numFmt = FMT_TIME; row.getCell(6).numFmt = FMT_DUR;
    if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } }; });
    row.eachCell(c => { c.border = thin(); });
    if (sx.open) row.getCell(7).font = { bold: true, color: { argb: C.amber } };
  });
  sess.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };

  // ── Leave (only real leave + holidays + genuine absences; plain weekends
  //    are NOT listed unless leave was actually marked on them) ──
  const leave = wb.addWorksheet('Leave', { views: [{ state: 'frozen', ySplit: 1 }] });
  leave.columns = [{ header: 'Date', width: 12 }, { header: 'Day', width: 7 }, { header: 'Type', width: 26 }];
  styleHeader(leave.getRow(1));
  const leaveDays = R.days.filter(d => d.leave || (d.isHoliday && !d.isWeekend) || d.status === 'Absent');
  if (!leaveDays.length) {
    const row = leave.addRow(['—', '—', 'No leave / absences this month']);
    row.eachCell(c => { c.border = thin(); });
  } else {
    leaveDays.forEach((d, i) => {
      const type = d.leave || (d.isHoliday ? 'Holiday' : 'Absent');
      const row = leave.addRow([d.date, d.weekday, type]);
      if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } }; });
      row.eachCell(c => { c.border = thin(); });
      const [tx, bg] = statusColors(d.status);
      const tc = row.getCell(3); tc.font = { bold: true, color: { argb: tx } };
      tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    });
  }
  leave.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } };

  // ── Weekly Summary ──────────────────────────────────────────────────────────
  // Group days into ISO-ish weeks (by date, Mon-start) and total per week.
  const wk = wb.addWorksheet('Weekly', { views: [{ state: 'frozen', ySplit: 1 }] });
  wk.columns = [
    { header: 'Week', width: 10 }, { header: 'Range', width: 22 },
    { header: 'Present', width: 10 }, { header: 'Absent', width: 9 },
    { header: 'Worked', width: 11 }, { header: 'Break', width: 11 }, { header: 'Variation', width: 12 },
  ];
  styleHeader(wk.getRow(1));
  const weeks = {};
  R.days.forEach(d => {
    const dt = new Date(d.date + 'T00:00:00');
    // Week number within the month: 1 + floor((dayOfMonth + firstWeekdayOffset)/7)
    const dayNum = dt.getDate();
    const firstDow = new Date(dt.getFullYear(), dt.getMonth(), 1).getDay(); // 0=Sun
    const offset = (firstDow + 6) % 7; // make Monday=0
    const wnum = Math.floor((dayNum - 1 + offset) / 7) + 1;
    (weeks[wnum] = weeks[wnum] || { days: [], min: d.date, max: d.date }).days.push(d);
    if (d.date < weeks[wnum].min) weeks[wnum].min = d.date;
    if (d.date > weeks[wnum].max) weeks[wnum].max = d.date;
  });
  Object.keys(weeks).map(Number).sort((a, b) => a - b).forEach((wn, i) => {
    const w = weeks[wn];
    const present = w.days.filter(x => x.status === 'Present').length;
    const absent  = w.days.filter(x => x.status === 'Absent').length;
    const worked  = w.days.reduce((a, x) => a + x.workedMin, 0);
    const brk     = w.days.reduce((a, x) => a + x.breakMin, 0);
    const vari     = w.days.reduce((a, x) => a + (x.variationMin || 0), 0);
    const row = wk.addRow(['W' + wn, w.min.slice(5) + ' → ' + w.max.slice(5), present, absent,
      xlDur(worked), xlDur(brk), xlHours(vari)]);
    row.getCell(5).numFmt = FMT_DUR; row.getCell(6).numFmt = FMT_DUR; row.getCell(7).numFmt = FMT_VAR;
    if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } }; });
    row.eachCell(c => { c.border = thin(); });
  });
  addTotals(wk, [5, 6], { 3: 'sum', 4: 'sum' }, 'TOTAL', [7]);
  wk.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };

  // ── Late Days ───────────────────────────────────────────────────────────────
  const lateSheet = wb.addWorksheet('Late Days', { views: [{ state: 'frozen', ySplit: 1 }] });
  lateSheet.columns = [
    { header: 'Date', width: 12 }, { header: 'Day', width: 7 },
    { header: 'Late By', width: 11 }, { header: 'First In', width: 12 }, { header: 'Status', width: 14 },
  ];
  styleHeader(lateSheet.getRow(1));
  const lateDays = R.days.filter(d => (d.lateMin || 0) > 0).sort((a, b) => b.lateMin - a.lateMin);
  if (!lateDays.length) {
    const row = lateSheet.addRow(['—', '—', null, null, 'No late days 🎉']);
    row.eachCell(c => { c.border = thin(); });
  } else {
    lateDays.forEach((d, i) => {
      const row = lateSheet.addRow([d.date, d.weekday, xlDur(d.lateMin), xlTimeOfDay(d.firstIn), d.status]);
      row.getCell(3).numFmt = FMT_DUR; row.getCell(4).numFmt = FMT_TIME;
      row.getCell(3).font = { bold: true, color: { argb: C.red } };
      if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } }; });
      row.eachCell(c => { c.border = thin(); });
    });
    addTotals(lateSheet, [3], { 2: 'count' });
  }
  lateSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };

  // ── Leave Breakdown (pivot: type × count) ────────────────────────────────────
  const lb = wb.addWorksheet('Leave Breakdown', { views: [{ state: 'frozen', ySplit: 1 }] });
  lb.columns = [{ header: 'Leave Type', width: 30 }, { header: 'Count', width: 10 }, { header: 'Dates', width: 50 }];
  styleHeader(lb.getRow(1));
  const byType = {};
  R.days.forEach(d => { if (d.leave) (byType[d.leave] = byType[d.leave] || []).push(d.date.slice(5)); });
  const typeEntries = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
  if (!typeEntries.length) {
    const row = lb.addRow(['No leave this month', 0, '—']);
    row.eachCell(c => { c.border = thin(); });
  } else {
    typeEntries.forEach(([type, dates], i) => {
      const row = lb.addRow([type, dates.length, dates.join(', ')]);
      row.getCell(1).font = { bold: true, color: { argb: C.amber } };
      if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } }; });
      row.eachCell(c => { c.border = thin(); });
    });
    addTotals(lb, [], { 2: 'sum' }, 'TOTAL');
  }
  lb.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } };

  // ── Present Days only ────────────────────────────────────────────────────────
  const pres = wb.addWorksheet('Present Days', { views: [{ state: 'frozen', ySplit: 1 }] });
  pres.columns = [
    { header: 'Date', width: 12 }, { header: 'Day', width: 7 },
    { header: 'First In', width: 12 }, { header: 'Last Out', width: 12 }, { header: 'Sessions', width: 10 },
    { header: 'Worked', width: 11 }, { header: 'Break', width: 11 }, { header: 'Variation', width: 12 }, { header: 'Met Target?', width: 12 },
  ];
  styleHeader(pres.getRow(1));
  const presentDays = R.days.filter(d => d.status === 'Present');
  presentDays.forEach((d, i) => {
    const met = (d.variationMin || 0) >= 0;
    const row = pres.addRow([d.date, d.weekday, xlTimeOfDay(d.firstIn), xlTimeOfDay(d.lastOut),
      d.sessionCount, xlDur(d.workedMin), xlDur(d.breakMin), xlHours(d.variationMin),
      met ? 'Yes' : 'No']);
    row.getCell(3).numFmt = FMT_TIME; row.getCell(4).numFmt = FMT_TIME;
    row.getCell(6).numFmt = FMT_DUR;  row.getCell(7).numFmt = FMT_DUR; row.getCell(8).numFmt = FMT_VAR;
    const mc = row.getCell(9);
    mc.font = { bold: true, color: { argb: met ? C.green : C.red } };
    mc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: met ? C.greenBg : C.redBg } };
    mc.alignment = { horizontal: 'center' };
    if (i % 2 === 1) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
    row.eachCell(c => { c.border = thin(); });
  });
  if (!presentDays.length) pres.addRow(['—', '—', null, null, 0, null, null, null, '—']);
  addTotals(pres, [6, 7], { 5: 'sum' }, 'TOTAL', [8]);
  pres.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

  // ── Manual Entries (split-shift / WFH) — for regularisation reference ────────
  const man = wb.addWorksheet('Manual Entries', { views: [{ state: 'frozen', ySplit: 1 }] });
  man.columns = [
    { header: 'Date', width: 12 }, { header: 'Day', width: 7 },
    { header: 'Start', width: 12 }, { header: 'End', width: 12 },
    { header: 'Duration', width: 11 }, { header: 'Open?', width: 8 }, { header: 'Note', width: 32 },
  ];
  styleHeader(man.getRow(1));
  const mrows = R.manualRows || [];
  if (!mrows.length) {
    const row = man.addRow(['—', '—', null, null, null, '', 'No manual entries this month']);
    row.eachCell(c => { c.border = thin(); });
  } else {
    mrows.forEach((m, i) => {
      const row = man.addRow([ m.date, m.weekday, xlTimeOfDay(m.inMs),
        m.open ? null : xlTimeOfDay(m.outMs), m.durMin == null ? null : xlDur(m.durMin),
        m.open ? 'Yes' : '', m.note ]);
      row.getCell(3).numFmt = FMT_TIME; row.getCell(4).numFmt = FMT_TIME; row.getCell(5).numFmt = FMT_DUR;
      if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } }; });
      row.eachCell(c => { c.border = thin(); });
      if (m.open) row.getCell(6).font = { bold: true, color: { argb: C.amber } };
    });
    addTotals(man, [5], {}, 'TOTAL');
  }
  man.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };

  return await wb.xlsx.writeBuffer();
}

// Append a bold totals row. durCols = column indices to SUM as durations;
// countCfg = { colIdx: 'count'|'sum' } for plain numeric columns; labelText
// goes in column 1 (default 'TOTAL').
function addTotals(ws, durCols, countCfg, labelText, varCols) {
  const dataLast = ws.rowCount;            // last data row (header is row 1)
  if (dataLast < 2) return;
  const row = ws.addRow([]);
  row.getCell(1).value = labelText || 'TOTAL';
  const sumCell = (ci, fmt) => {
    const L = colLetter(ci);
    row.getCell(ci).value = { formula: `SUM(${L}2:${L}${dataLast})` };
    row.getCell(ci).numFmt = fmt;
  };
  durCols.forEach(ci => sumCell(ci, FMT_DUR));
  (varCols || []).forEach(ci => sumCell(ci, FMT_VAR));
  Object.entries(countCfg || {}).forEach(([ci, kind]) => {
    ci = +ci;
    const L = colLetter(ci);
    row.getCell(ci).value = { formula: `${kind === 'sum' ? 'SUM' : 'COUNT'}(${L}2:${L}${dataLast})` };
  });
  row.font = { bold: true };
  row.eachCell(c => { c.border = thin(); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }; });
}
function colLetter(n) { // 1->A
  let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

// ── Canvas charts → base64 PNG (no external chart lib) ───────────────────────
function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function renderBarChart(days) {
  const present = days.filter(d => d.sessionCount > 0);
  if (!present.length) return null;
  const W = 720, H = 400, pad = 50;
  const c = newCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#1F4E79'; x.font = 'bold 20px Arial';
  x.fillText('Worked hours per day', pad, 30);

  const maxMin = Math.max(...present.map(d => d.workedMin), 60);
  const plotH = H - pad - 60, plotW = W - pad - 20, base = H - 50;
  // axis
  x.strokeStyle = '#cccccc'; x.beginPath(); x.moveTo(pad, base); x.lineTo(W - 20, base); x.stroke();
  const bw = plotW / present.length;
  present.forEach((d, i) => {
    const bh = (d.workedMin / maxMin) * plotH;
    const bx = pad + i * bw + bw * 0.15, by = base - bh, bwid = bw * 0.7;
    x.fillStyle = d.variationMin >= 0 ? '#548235' : '#C00000';
    x.fillRect(bx, by, bwid, bh);
    if (present.length <= 31) {
      x.save(); x.translate(bx + bwid / 2, base + 6); x.rotate(-Math.PI / 4);
      x.fillStyle = '#666'; x.font = '10px Arial'; x.textAlign = 'right';
      x.fillText(d.date.slice(8), 0, 0); x.restore();
    }
  });
  return c.toDataURL('image/png').split(',')[1];
}
function renderDonut(s) {
  const W = 720, H = 400;
  const c = newCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#1F4E79'; x.font = 'bold 20px Arial';
  x.fillText('Day breakdown', 50, 30);

  const segs = [
    ['Present', s.presentDays, '#548235'],
    ['Absent',  s.absentDays,  '#C00000'],
    ['Weekend', s.weekendDays, '#A6A6A6'],
    ['Holiday', s.holidayDays, '#2E75B6'],
  ].filter(seg => seg[1] > 0);
  const total = segs.reduce((a, s2) => a + s2[1], 0) || 1;
  const cx = 200, cy = 230, rO = 130, rI = 70;
  let ang = -Math.PI / 2;
  segs.forEach(([, v, col]) => {
    const a2 = ang + (v / total) * Math.PI * 2;
    x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, rO, ang, a2); x.closePath();
    x.fillStyle = col; x.fill(); ang = a2;
  });
  // donut hole
  x.beginPath(); x.arc(cx, cy, rI, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
  x.fillStyle = '#1F4E79'; x.font = 'bold 28px Arial'; x.textAlign = 'center';
  x.fillText(s.attendancePct + '%', cx, cy - 4);
  x.font = '13px Arial'; x.fillStyle = '#666'; x.fillText('attendance', cx, cy + 18);
  // legend
  x.textAlign = 'left'; let ly = 120;
  segs.forEach(([label, v, col]) => {
    x.fillStyle = col; x.fillRect(400, ly, 16, 16);
    x.fillStyle = '#333'; x.font = '14px Arial'; x.fillText(`${label}: ${v}`, 424, ly + 13);
    ly += 28;
  });
  return c.toDataURL('image/png').split(',')[1];
}

function showExportOverlay() {
  let ov = document.getElementById('exportOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'exportOverlay';
    ov.className = 'export-overlay';
    ov.innerHTML = `<div class="export-box"><div class="spinner"></div><span>Exporting this month…</span></div>`;
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
}
function hideExportOverlay() {
  const ov = document.getElementById('exportOverlay');
  if (ov) ov.style.display = 'none';
}
function showExportToast(msg, isError) {
  let t = document.getElementById('exportToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'exportToast';
    t.className = 'export-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'export-toast' + (isError ? ' error' : ' ok') + ' show';
  setTimeout(() => { t.className = t.className.replace(' show', ''); }, 2600);
}

// ── Time format toggle (12h AM/PM ↔ 24h), persisted in et_timeFmt ────────────
(function initTimeFmt() {
  function applyFmt(f) {
    const btn = document.getElementById('fmtBtn');
    if (btn) {
      btn.textContent = f === '12' ? '12h' : '24h';
      btn.title = f === '12' ? 'Switch to 24-hour' : 'Switch to 12-hour (AM/PM)';
    }
  }
  applyFmt(getTimeFmt());
  const btn = document.getElementById('fmtBtn');
  if (btn) btn.addEventListener('click', () => {
    const next = getTimeFmt() === '12' ? '24' : '12';
    try { localStorage.setItem('et_timeFmt', next); } catch (_) {}
    applyFmt(next);
    if (rawData) { stopTick(); startTick(); } // re-render with new format
  });
})();

// ── Header kebab menu (open/close, click-outside, Esc) ───────────────────────
// ── Manual time entry (split-shift / work-from-home) ─────────────────────────
// "HH:MM" on today's date → epoch ms.
function timeStrToMs(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((str || '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  const d = new Date(); d.setHours(h, mi, 0, 0);
  return d.getTime();
}
function msToInputStr(ms) {
  const d = new Date(ms);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

const DEFAULT_NOTE = 'Managing client shift CWS - Martin';
function openManualModal() {
  const dayKey = (rawData && rawData.dayKey) || todayKey();

  let ov = document.getElementById('manualModal');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'manualModal';
  ov.className = 'export-overlay';
  ov.style.display = 'flex';
  ov.innerHTML = `
    <div class="manual-box" id="manualBox">
      <div class="manual-title">Manual time — ${dayKey}</div>
      <div class="manual-sub">For work without the office tracker (2nd shift, WFH). End optional — leave blank for a running session.</div>
      <div class="manual-form">
        <label>Start<input type="text" id="mStart" class="fp-input" placeholder="--:--" readonly></label>
        <label>End<input type="text" id="mEnd" class="fp-input" placeholder="optional" readonly></label>
      </div>
      <input type="text" id="mNote" class="manual-note" placeholder="Note (optional)" value="${escapeHtml(DEFAULT_NOTE)}">
      <div id="mErr" class="manual-err"></div>
      <button class="btn" id="mAdd">Add session</button>
      <div class="manual-list" id="mList"></div>
      <button class="btn btn-secondary" id="mClose">Close</button>
    </div>`;
  document.body.appendChild(ov);

  // flatpickr time-only pickers. Internal value stays "H:i" (24h) so
  // timeStrToMs() parses regardless of the 12/24h display preference.
  const use12 = getTimeFmt() === '12';
  const fpCommon = {
    enableTime: true, noCalendar: true, dateFormat: 'H:i',
    time_24hr: !use12, minuteIncrement: 5,
    disableMobile: true,
    // Display value in the user's 12/24h preference while storing H:i.
    altInput: true, altFormat: use12 ? 'h:i K' : 'H:i',
  };
  let fpStart = null, fpEnd = null;
  if (typeof flatpickr !== 'undefined') {
    fpStart = flatpickr('#mStart', { ...fpCommon, defaultDate: msToInputStr(Date.now()) });
    fpEnd   = flatpickr('#mEnd',   { ...fpCommon });
  } else {
    // Fallback to native if lib missing.
    const sEl = document.getElementById('mStart'); sEl.removeAttribute('readonly'); sEl.type = 'time';
    const eEl = document.getElementById('mEnd');   eEl.removeAttribute('readonly'); eEl.type = 'time';
    sEl.value = msToInputStr(Date.now());
  }

  const errEl = document.getElementById('mErr');
  function renderList() {
    const list = getManualFor(dayKey);
    const wrap = document.getElementById('mList');
    if (!list.length) { wrap.innerHTML = `<div class="manual-empty">No manual sessions yet.</div>`; return; }
    wrap.innerHTML = list.map(s => {
      const inStr  = fmtTime(new Date(s.inMs));
      const outStr = s.outMs ? fmtTime(new Date(s.outMs)) : '<span class="manual-open">running</span>';
      const note   = s.note ? ` · ${escapeHtml(s.note)}` : '';
      return `<div class="manual-row">
        <span class="manual-row-time">${inStr} → ${outStr}${note}</span>
        <button class="manual-del" data-in="${s.inMs}" title="Delete">✕</button>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.manual-del').forEach(b => {
      b.onclick = () => { deleteManualSession(dayKey, +b.dataset.in); reapplyManual(); renderList(); };
    });
  }

  function reapplyManual() {
    // Recompute the merged timeline + re-render live, building rawData from
    // manual alone if there's no office data yet.
    if (rawData) { applyManualToRaw(); stopTick(); startTick(); }
    else if (!serveManualOnly()) { /* nothing to show */ }
  }

  document.getElementById('mAdd').onclick = () => {
    errEl.textContent = '';
    const inMs  = timeStrToMs(document.getElementById('mStart').value);
    const endVal = document.getElementById('mEnd').value;
    const outMs = endVal ? timeStrToMs(endVal) : null;
    const note  = document.getElementById('mNote').value.trim();
    if (!inMs) { errEl.textContent = 'Enter a valid start time.'; return; }
    if (endVal && !outMs) { errEl.textContent = 'Enter a valid end time.'; return; }
    if (outMs && outMs < inMs) { errEl.textContent = 'End must be after start.'; return; }
    addManualSession(dayKey, inMs, outMs, note);
    if (fpEnd) fpEnd.clear(); else document.getElementById('mEnd').value = '';
    document.getElementById('mNote').value = DEFAULT_NOTE;
    reapplyManual();
    renderList();
  };

  function closeModal() {
    try { fpStart && fpStart.destroy(); fpEnd && fpEnd.destroy(); } catch (_) {}
    ov.remove();
  }
  document.getElementById('mClose').onclick = closeModal;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
  });

  renderList();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

(function initMenu() {
  const btn = document.getElementById('menuBtn');
  const pop = document.getElementById('menuPop');
  if (!btn || !pop) return;
  function close() { pop.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  function open()  { pop.classList.add('open');    btn.setAttribute('aria-expanded', 'true'); }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.contains('open') ? close() : open();
  });
  document.addEventListener('click', (e) => {
    if (pop.classList.contains('open') && !pop.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // Close after picking a one-shot action (refresh/export/manual). Toggles stay open.
  document.getElementById('refreshBtn').addEventListener('click', close);
  document.getElementById('exportBtn').addEventListener('click', close);
  document.getElementById('manualBtn').addEventListener('click', close);
})();

// ── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('refreshBtn').addEventListener('click', () => loadData(false));
document.getElementById('exportBtn').addEventListener('click', exportMonthXLSX);
document.getElementById('manualBtn').addEventListener('click', openManualModal);
document.addEventListener('DOMContentLoaded', () => {
  loadData(false);
  startAutoRefresh();
});

window.addEventListener('unload', () => {
  stopTick();
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
});
