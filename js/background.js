// ── Background service worker ─────────────────────────────────────────────────
// Data fetched ONLY when popup opens (popup sends STORE_DATA).
// Badge ticks every second via offscreen keep-alive + alarms as backup.
// Offscreen document pings every 25s to prevent service worker termination.

const ALARM_TICK = 'bgTick';

// ── Storage ───────────────────────────────────────────────────────────────────
function saveState(s) {
  chrome.storage.local.set({ bgState: s });
}
async function loadState() {
  return new Promise(resolve => {
    chrome.storage.local.get('bgState', r => resolve(r.bgState || null));
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function calcRemain(sessions, targetMin) {
  const nowMs  = Date.now();
  const TARGET = targetMin * 60;
  let workedSec = 0, hasOpen = false;
  (sessions || []).forEach(s => {
    if (!s.inMs) return;
    const isOpen = !s.outMs;
    workedSec += Math.max(0, (isOpen ? nowMs : s.outMs) - s.inMs) / 1000;
    if (isOpen) hasOpen = true;
  });
  return { remainSec: TARGET - workedSec, hasOpen };
}

// ── Badge ─────────────────────────────────────────────────────────────────────
// Single source of truth for badge text/color — used by both the alarm refresh
// and the popup's live BADGE_UPDATE messages.
function paintBadge(remainSec, hasOpen) {
  // White badge text on all states (Chrome's badge API has no border option).
  try { chrome.action.setBadgeTextColor({ color: '#ffffff' }); } catch (_) {}
  if (remainSec <= 0) {
    chrome.action.setBadgeText({ text: 'DONE' });
    chrome.action.setBadgeBackgroundColor({ color: '#0f9d58' });   // green
  } else if (hasOpen) {
    const h = Math.floor(remainSec / 3600);
    const m = Math.floor((remainSec % 3600) / 60);
    const text = remainSec <= 60 ? `${Math.ceil(remainSec)}s` : h > 0 ? `${h}:${pad(m)}` : `${m}m`;
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: remainSec <= 60 ? '#c8861a' : '#008899' }); // teal, gold when <=60s
  } else {
    chrome.action.setBadgeText({ text: '⏸' });
    chrome.action.setBadgeBackgroundColor({ color: '#a8761a' });   // gold
  }
}

async function refreshBadge() {
  const state = await loadState();
  if (!state) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  // Stale data → wipe and show nothing until today's sessions are fetched.
  // Covers a different day AND legacy state with no dayKey, so a leftover
  // "DONE" can't survive an extension reload or cross midnight.
  if (!state.dayKey || state.dayKey !== todayKey()) {
    chrome.storage.local.remove('bgState');
    chrome.storage.local.remove('notifyState');
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const { remainSec, hasOpen } = calcRemain(state.sessions, state.targetMin);
  paintBadge(remainSec, hasOpen);
  checkNotifications(remainSec, hasOpen);
}

// ── Auto notifications ─────────────────────────────────────────────────────
// Fire desktop alerts at 5 / 2 / 1 min left and at target — once each, from the
// worker so they arrive even with the popup closed. Only while a session is
// open (the exit time is actually counting down).
function saveNotify(n) { chrome.storage.local.set({ notifyState: n }); }
function loadNotify() {
  return new Promise(resolve => {
    chrome.storage.local.get('notifyState', r => resolve(r.notifyState || null));
  });
}
async function checkNotifications(remainSec, hasOpen) {
  if (!chrome.notifications || !hasOpen) return;

  const today = todayKey();
  let n = await loadNotify();
  if (!n || n.dayKey !== today) n = { dayKey: today };

  // Fire only the most-urgent newly-crossed threshold this tick.
  let message = null, nid = null;
  if      (remainSec <= 0   && !n.done) { n.done = true; nid = 'et_done'; message = 'Target reached — you can leave now! 🎉'; }
  else if (remainSec <= 60  && !n.min1) { n.min1 = true; nid = 'et_min1'; message = 'About 1 minute left until you can leave.'; }
  else if (remainSec <= 120 && !n.min2) { n.min2 = true; nid = 'et_min2'; message = 'About 2 minutes left until you can leave.'; }
  else if (remainSec <= 300 && !n.min5) { n.min5 = true; nid = 'et_min5'; message = 'About 5 minutes left until you can leave.'; }

  // Mark already-passed thresholds as fired so they don't pop late.
  if (remainSec <= 300) n.min5 = true;
  if (remainSec <= 120) n.min2 = true;
  if (remainSec <= 60)  n.min1 = true;
  if (remainSec <= 0)   n.done = true;

  saveNotify(n);
  if (message) {
    chrome.notifications.create(nid, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'), // absolute URL — relative can silently fail in MV3
      title: 'Exit Timer',
      message,
      priority: 2,
      requireInteraction: remainSec <= 0
    });
  }
}

// ── Offscreen document (keeps service worker alive) ───────────────────────────
async function ensureOffscreen() {
  try {
    const existing = await chrome.offscreen.hasDocument();
    if (!existing) {
      await chrome.offscreen.createDocument({
        url:    'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Keep service worker alive to maintain badge updates'
      });
    }
  } catch (e) {
    // offscreen API may not be available in all Chrome versions — ignore
  }
}

// ── Alarm (backup ticker every 1 min, covers cases offscreen doc is gone) ─────
async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_TICK);
  if (!existing) {
    chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
  }
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === ALARM_TICK) {
    await refreshBadge();
    await ensureOffscreen(); // recreate if it was closed
  }
});

// ── Messages ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'STORE_DATA') {
    const state = { ...msg.data, fetchedAt: Date.now() };
    saveState(state);
    // Keep the ticker alive + repaint immediately so the badge reflects new
    // (incl. manual) sessions even after the popup closes.
    ensureAlarm();
    ensureOffscreen();
    refreshBadge();
    sendResponse({ ok: true });
  }
  // Popup ticks badge via message — avoids race with background's refreshBadge.
  // Also drive notifications here so they fire instantly while the popup is open.
  if (msg.type === 'BADGE_UPDATE') {
    paintBadge(msg.remainSec, msg.hasOpen);
    checkNotifications(msg.remainSec, msg.hasOpen);
  }
  // Session expired / logout — drop stored state so the badge stops ticking.
  if (msg.type === 'CLEAR_DATA') {
    chrome.storage.local.remove('bgState');
    chrome.storage.local.remove('notifyState');
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
  }
  if (msg.type === 'KEEPALIVE') {
    ensureOffscreen(); // recreate if Chrome closed it
    refreshBadge();
  }
  return false;
});

// ── Startup ───────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.remove('notifyState'); // re-arm thresholds on reload/update
  await ensureAlarm();
  await ensureOffscreen();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await ensureOffscreen();
  await refreshBadge();
});

// Runs every time the worker wakes for any reason
(async () => {
  await ensureAlarm();
  await ensureOffscreen();
  await refreshBadge();
})();
