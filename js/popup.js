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
let showSessions     = false;
let notified5min     = false;
let notifiedDone     = false;

// ── DOM helpers ─────────────────────────────────────────────────────────────
function openSite() {
  chrome.tabs.create({ url: 'http://mtworks.manektech.com/inout-summary.aspx' });
}
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) { chrome.tabs.reload(tab.id); } else { openSite(); }
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
  if (silent && document.getElementById('liveWorked')) tick();
  else startTick();
  return true;
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

// ── Desktop notifications ───────────────────────────────────────────────────
function maybeNotify(remainSec) {
  if (!chrome.notifications) return;
  if (remainSec > 0 && remainSec <= 300 && !notified5min) {
    notified5min = true;
    chrome.notifications.create('exit5min', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Exit Timer',
      message: `You can leave in ${Math.ceil(remainSec / 60)} minutes!`
    });
  }
  if (remainSec <= 0 && !notifiedDone) {
    notifiedDone = true;
    chrome.notifications.create('exitDone', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Exit Timer',
      message: 'Target reached! You can leave now. 🎉'
    });
  }
}

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
    const d = new Date(exitMs);
    exitStr = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  updateBadge(remainSec, hasOpen);
  maybeNotify(remainSec);

  // Badge chip
  const badge = document.getElementById('badge');
  if (badge) {
    badge.style.display = 'inline-block';
    if (remainSec <= 0) { badge.textContent = 'Done';   badge.className = 'badge badge-done'; }
    else if (hasOpen)   { badge.textContent = 'Live';   badge.className = 'badge badge-live'; }
    else                { badge.textContent = 'Paused'; badge.className = 'badge badge-paused'; }
  }

  if (document.getElementById('liveWorked')) {
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
      const ringColor = remainSec <= 0 ? '#30d47e' : hasOpen ? '#5c9ef8' : '#f5a623';
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
    const hd = new Date(halfMs);
    halfExitStr = pad(hd.getHours()) + ':' + pad(hd.getMinutes());
  }

  const todayStr   = new Date().toISOString().slice(0, 10);
  const todayLeave = rawData.monthlySummary?.leaveMap?.[todayStr] || null;
  const isHalfDay  = todayLeave && todayLeave.startsWith('half');

  const policyLabel = targetMin === (8 * 60 + 15) ? '8h 15m shift' : '9h 15m shift';

  // Sessions HTML
  const sessHtml = sessions.map((s, i) => {
    const inD   = new Date(s.inMs);
    const outD  = s.outMs ? new Date(s.outMs) : null;
    const inStr = pad(inD.getHours()) + ':' + pad(inD.getMinutes());
    const outStr = outD ? pad(outD.getHours()) + ':' + pad(outD.getMinutes()) : null;
    const durMin = Math.round((s.outMs ? s.outMs - s.inMs : Date.now() - s.inMs) / 60000);
    const breakAfter = (i < sessions.length - 1 && s.outMs)
      ? Math.round((sessions[i + 1].inMs - s.outMs) / 60000) : null;
    const isOpen = !outStr;

    return `
      <div class="rl-row">
        <span class="rl-lbl">
          <span class="sess-dot ${isOpen ? 'active' : 'closed'}"></span>
          ${inStr} → ${isOpen ? `<span class="sess-now">now</span>` : outStr}
        </span>
        <span class="rl-val">${minToHHMM(durMin)}</span>
      </div>
      ${breakAfter !== null ? `<div class="rl-break">☕ ${minToHHMM(breakAfter)}</div>` : ''}`;
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
          <div class="stat-card"><div class="stat-val">${ms.workingDays}</div><div class="stat-lbl">Working Days</div></div>
          <div class="stat-card"><div class="stat-val green">${ms.presentDays}</div><div class="stat-lbl">Present Days</div></div>
          <div class="stat-card"><div class="stat-val blue">${ms.pct}%</div><div class="stat-lbl">Attendance</div></div>
          ${mv !== undefined ? `<div class="stat-card"><div class="stat-val ${mvClass}">${mv >= 0 ? '+' : '-'}${minToHHMM(Math.abs(mv))}</div><div class="stat-lbl">Monthly Extra</div></div>` : ''}
          ${ms.ot ? `<div class="stat-card"><div class="stat-val amber">${ms.ot}</div><div class="stat-lbl">OT Days</div></div>` : ''}
          ${ms.lateCount ? `<div class="stat-card"><div class="stat-val red">${ms.lateCount}</div><div class="stat-lbl">Late Days</div></div>` : ''}
        </div>
        ${leaveChips ? `<div class="chips">${leaveChips}</div>` : ''}`;
  }

  const now = new Date();
  const rR = 20, rC = +(2 * Math.PI * rR).toFixed(2);
  const rOff = +(rC - (pct / 100) * rC).toFixed(2);
  const rCol = remainSec <= 0 ? '#30d47e' : hasOpen ? '#5c9ef8' : '#f5a623';
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
        <div class="stat-val blue" id="liveWorked2">${minToHHMM(workedSec / 60)}</div>
        <div class="stat-lbl">Worked</div>
      </div>
      <div class="stat-card">
        <div class="stat-val muted" id="liveBreak">${minToHHMM(breakSec / 60)}</div>
        <div class="stat-lbl">Break</div>
      </div>
      <div class="stat-card">
        <div class="stat-val ${varClass}" id="liveVariation">${varSign}${secToHHMMSS(Math.abs(variSec))}</div>
        <div class="stat-lbl">+/− Today</div>
      </div>
      <div class="stat-card ${isHalfDay ? 'hl' : ''}">
        <div class="stat-val amber">${halfExitStr}</div>
        <div class="stat-lbl">Half Day Exit</div>
      </div>
    </div>
    ${monthHtml}

    <div class="row-list fade-in" id="sessionsBlock" style="display:${showSessions ? 'block' : 'none'}">
      <div class="month-header"><span class="month-title">Today's Sessions</span></div>
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

  // Sessions toggle button
  const sessBtn = document.getElementById('sessionsBtn');
  if (sessBtn) {
    sessBtn.style.color = showSessions ? 'var(--blue)' : '';
    sessBtn.title = showSessions ? 'Hide sessions' : 'Show sessions';
    sessBtn.onclick = () => {
      showSessions = !showSessions;
      const block = document.getElementById('sessionsBlock');
      if (block) block.style.display = showSessions ? 'block' : 'none';
      sessBtn.style.color = showSessions ? 'var(--blue)' : '';
      sessBtn.title = showSessions ? 'Hide sessions' : 'Show sessions';
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
        startTick();
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
    if (!silent) showErrorState(result.error, result.detail);
    return;
  }
  if (!result.sessions?.length) {
    if (serveCachedToday(silent)) return;
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

  try {
    chrome.runtime.sendMessage({
      type: 'STORE_DATA',
      data: { sessions: result.sessions, targetMin: result.targetMin, dayKey: result.dayKey }
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

// ── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('refreshBtn').addEventListener('click', () => loadData(false));
document.addEventListener('DOMContentLoaded', () => {
  loadData(false);
  startAutoRefresh();
});

window.addEventListener('unload', () => {
  stopTick();
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
});
