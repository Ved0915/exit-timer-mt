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
  if (remainSec <= 0) {
    chrome.action.setBadgeText({ text: 'DONE' });
    chrome.action.setBadgeBackgroundColor({ color: '#1b9954' });
  } else if (hasOpen) {
    const h = Math.floor(remainSec / 3600);
    const m = Math.floor((remainSec % 3600) / 60);
    const text = remainSec <= 60 ? `${Math.ceil(remainSec)}s` : h > 0 ? `${h}:${pad(m)}` : `${m}m`;
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: remainSec <= 60 ? '#c0392b' : '#2f5fc0' });
  } else {
    chrome.action.setBadgeText({ text: '⏸' });
    chrome.action.setBadgeBackgroundColor({ color: '#a8761a' });
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
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const { remainSec, hasOpen } = calcRemain(state.sessions, state.targetMin);
  paintBadge(remainSec, hasOpen);
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
    sendResponse({ ok: true });
  }
  // Popup ticks badge via message — avoids race with background's refreshBadge
  if (msg.type === 'BADGE_UPDATE') {
    paintBadge(msg.remainSec, msg.hasOpen);
  }
  // Session expired / logout — drop stored state so the badge stops ticking.
  if (msg.type === 'CLEAR_DATA') {
    chrome.storage.local.remove('bgState');
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
  }
  if (msg.type === 'KEEPALIVE') {
    refreshBadge();
  }
  return false;
});

// ── Startup ───────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
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
