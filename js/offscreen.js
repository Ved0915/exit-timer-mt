// Offscreen document — keeps the service worker alive by pinging it every 25s.
// Chrome terminates service workers after ~30s of inactivity.
// This document lives as long as Chrome is running and prevents that.

setInterval(() => {
  chrome.runtime.sendMessage({ type: 'KEEPALIVE' }).catch(() => {});
}, 25000);
