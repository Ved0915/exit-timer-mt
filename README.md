# ManekTech Exit Timer

A Chrome (Manifest V3) extension that shows your **live exit time**, worked/break
hours, today's sessions, and a monthly leave summary — read straight from the
ManekTech attendance portal. The toolbar badge ticks down the time left until you
hit your daily target.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue) ![Chrome](https://img.shields.io/badge/Chrome-Extension-brightgreen)

---

## Features

- ⏱ **Live exit time** — "Leave By HH:MM" that updates every second.
- 🟢 **Toolbar badge** — minutes left, `DONE`, or `⏸` (paused) without opening the popup.
- 📊 **Today at a glance** — worked time, break time, +/− vs. target, half-day exit.
- 🗓 **Monthly summary** — working/present days, attendance %, OT, late days, leave tally.
- 🧾 **Per-session breakdown** — every punch in/out with break gaps.
- 🌗 **Dark / light theme** — follows system, remembers your choice.
- 📴 **Offline cache** — shows the last successful fetch when you're off the portal tab.
- 🔒 **Logout-aware** — detects an expired session and prompts you to log back in
  instead of silently ticking on stale data.

---

## Install (load unpacked)

1. Clone this repo:
   ```bash
   git clone git@github.com:Ved0915/exit-timer-mt.git
   ```
2. Open `chrome://extensions` in Chrome/Edge.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked** and select the project folder.
5. Pin the extension, open the ManekTech attendance page, then click the icon.

> After pulling new changes, hit the ↻ **reload** button on the extension card —
> `manifest.json` and service-worker changes don't hot-reload.

---

## Usage

1. Log in to **http://mtworks.manektech.com/inout-summary.aspx**.
2. Click the Exit Timer icon. It reads your sessions from the page and starts ticking.
3. The badge keeps counting down even after you close the popup.
4. Click the exit time to **copy** it. Toggle the list icon to show per-session detail.

If you see **🔒 Session expired**, your portal login timed out — click
**Refresh & Login**, sign in again, then reopen the popup.

---

## Project structure

```
exit-timer-mt/
├── manifest.json        # MV3 manifest (entry points + permissions)
├── popup.html           # Popup UI shell
├── offscreen.html       # Offscreen doc (keeps service worker alive)
├── css/
│   └── popup.css         # Popup styles + theme variables
├── js/
│   ├── popup.js          # Popup logic, live tick engine, render
│   ├── background.js     # Service worker: badge + storage + alarms
│   ├── offscreen.js      # 25s keep-alive ping
│   └── page-fetcher.js   # Injected into the portal tab to scrape data
└── icons/               # 16 / 48 / 128 px icons
```

### How it works

- **`page-fetcher.js`** is injected into the active ManekTech tab. It resolves the
  member ID, calls `DataService.asmx/InOutSelectByDateAsc`, and returns raw session
  timestamps plus a scraped monthly summary. If no member ID is found **and** the page
  looks like the login/logout screen, it returns `session_expired`.
- **`popup.js`** runs a 1s tick that computes worked time, remaining time, and the
  exit time, then drives the UI, badge, and desktop notifications. It auto-refreshes
  silently every 60s and caches the last good result in `localStorage`.
- **`background.js`** is the service worker. It stores the latest state, paints the
  toolbar badge, and uses an **alarm + offscreen document** to survive MV3 worker
  termination so the badge keeps updating. On `CLEAR_DATA` (logout) it wipes the badge.

### Session / logout handling

| Where | Behavior |
|-------|----------|
| `page-fetcher.js` | Login/logout page (no member ID) → returns `session_expired`. Non-JSON API response (redirect to login) → also `session_expired`. |
| `popup.js` | Handles `session_expired` even during a **silent** refresh — stops the tick, halts auto-refresh, clears state, shows the login screen. |
| `background.js` | `CLEAR_DATA` removes stored state and clears the badge so it can't tick on a dead session. |

---

## Permissions

| Permission | Why |
|------------|-----|
| `scripting` | Inject `page-fetcher.js` into the portal tab |
| `tabs` | Find the active ManekTech tab |
| `storage` | Persist badge state across worker restarts |
| `alarms` | Backup ticker for the badge |
| `offscreen` | Keep the service worker alive |
| `notifications` | "5 minutes left" / "target reached" alerts |
| `host_permissions` | `mtworks.manektech.com` only |

The extension talks **only** to `mtworks.manektech.com` and stores everything locally —
no external servers, no analytics.

---

## Development

Plain JS/HTML/CSS — no build step. Edit a file, then reload the extension card in
`chrome://extensions`.

- Popup-only changes (`js/popup.js`, `css/popup.css`): close and reopen the popup.
- Service worker / manifest changes: click **reload** on the extension card.

---

## License

Internal tool for ManekTech attendance. Use within your organization.
