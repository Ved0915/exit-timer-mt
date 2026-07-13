# ManekTech Exit Timer

A Chrome (Manifest V3) extension that shows your **live exit time**, worked/break
hours, today's sessions, and a monthly leave summary — read straight from the
ManekTech attendance portal. The toolbar badge ticks down the time left until you
hit your daily target.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue) ![Chrome](https://img.shields.io/badge/Chrome-Extension-brightgreen)

---

## Features

- ⏱ **Live exit time** — "Leave By HH:MM" that updates every second (8h 15m net-work target).
- 🟢 **Toolbar badge** — minutes left, `DONE`, or `⏸` (paused) without opening the popup.
- 📊 **Today at a glance** — worked time, break time, +/− vs. target, half-day exit.
- 🗓 **Monthly summary** — working/present days, attendance %, OT, late days, leave tally.
- 🧾 **Per-session breakdown** — every punch in/out with break gaps.
- 🏠 **Manual time entry** — log work done off the portal (WFH / 2nd shift). Stored per
  day, merged into the same timeline as your portal punches.
- 📗 **Excel export** — styled multi-sheet workbook (Dashboard with charts, Daily,
  Sessions, Weekly, Late Days, Leave Breakdown, Present Days, Manual Entries) with
  autofilters, frozen headers, and totals.
- 🕐 **12h / 24h toggle** — remembered.
- 🌗 **Dark / light theme** — follows system, remembers your choice.
- 📴 **Offline cache** — shows the last successful fetch when you're off the portal tab.
- 🔒 **Logout-aware** — detects an expired session and switches you to an existing
  ManekTech tab (or opens one) to log back in, instead of ticking on stale data.

---

## Install

> **Full step-by-step: [INSTALL.txt](INSTALL.txt)**

Chrome disables an unpacked extension if its folder is deleted or moved. So don't
run it from the repo — `deploy.bat` copies the runtime files into a permanent
folder (`%LOCALAPPDATA%\ExitTimer`) and Chrome loads it from there. The repo can
then be deleted or re-cloned freely.

1. Clone this repo:
   ```bash
   git clone git@github.com:Ved0915/exit-timer-mt.git
   ```
2. **Double-click `deploy.bat`.** On first run it also opens an Explorer window on
   the install folder and copies that path to your clipboard.
3. Open `chrome://extensions`. If an Exit Timer card is already loaded **from the
   repo folder**, click **Remove** on it.
4. Turn on **Developer mode**, then either **drag the `ExitTimer` folder** from the
   open Explorer window onto the page, or click **Load unpacked** and press
   `Ctrl+V`, `Enter`.
5. Pin the extension, open the ManekTech attendance page, then click the icon.

> **Updating:** double-click `deploy.bat` (it sees the extension is already loaded
> and just refreshes the files), then hit the ↻ **reload** button on the extension
> card. Your settings and manual entries are preserved.
>
> **Why isn't the install automatic?** Chrome deliberately blocks scripts from
> installing extensions. The enterprise-policy route was tried and doesn't help:
> Chrome only accepts **http/https** update URLs, so it would need a web server
> running on every machine. The only other fully automatic route is the Chrome Web
> Store (paid). For an in-house tool, one click — once — is the better trade.

---

## Usage

1. Log in to **http://mtworks.manektech.com/inout-summary.aspx**.
2. Click the Exit Timer icon. It reads your sessions from the page and starts ticking.
3. The badge keeps counting down even after you close the popup.
4. Click the exit time to **copy** it.

**Header:** ☀/🌙 theme · `12h`/`24h` time format · `⋯` menu.

**Menu (`⋯`):**

| Item | What it does |
| ---- | ------------ |
| Refresh | Re-read the portal |
| Show / Hide sessions | Per-punch breakdown (remembered) |
| Add manual time | Log work done off the portal — see below |
| Export month (Excel) | Full styled workbook + charts |

### Manual time (WFH / 2nd shift)

Working without the portal tracker? **Menu → Add manual time**. Pick a start (end is
optional — leave it blank for a session that's still running). Entries are kept
**per day, forever**, and merge with any portal punches into one timeline, so an
office half-day plus an evening WFH shift add up to a single exit time. They also
appear on the **Manual Entries** sheet of the Excel export (all months) — handy when
raising a regularisation request.

If you see **🔒 Session expired**, your portal login timed out — click
**Refresh & Login**. It switches to your open ManekTech tab (or opens one) so you can
sign back in.

---

## Project structure

```
exit-timer-mt/
├── manifest.json        # MV3 manifest (entry points + permissions)
├── popup.html           # Popup UI shell
├── offscreen.html       # Offscreen doc (keeps service worker alive)
├── deploy.bat           # Double-click: deploy to %LOCALAPPDATA%\ExitTimer
├── deploy.ps1           # The deploy script itself (path-independent)
├── INSTALL.txt          # Step-by-step install / update / FAQ
├── css/
│   ├── popup.css         # Popup styles + theme variables
│   └── flatpickr.min.css # Time-picker styles (vendored)
├── js/
│   ├── popup.js          # Popup logic, live tick engine, render, manual time, export
│   ├── background.js     # Service worker: badge + storage + alarms
│   ├── offscreen.js      # 25s keep-alive ping
│   ├── page-fetcher.js   # Injected into the portal tab to scrape today's data
│   ├── month-fetcher.js  # Injected on export to pull the whole month, day by day
│   ├── exceljs.min.js    # Excel writer (vendored)
│   └── flatpickr.min.js  # Time picker (vendored)
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
- **`month-fetcher.js`** is injected only when you hit **Export**. It walks day 1 →
  today, calling the same endpoint per day, and scrapes the calendar for leave /
  weekend / holiday / late context. `popup.js` turns the result into the workbook.

### Time model

The target is a fixed **8h 15m of *worked* time** — breaks are excluded. Breaks only
push the wall-clock exit later; the amount you must work stays the same.

**Manual entries** live in `localStorage` (`et_manualSessions`), keyed by date, and are
**merged with** portal punches rather than replacing them. A day with no portal punch
at all runs on manual alone, and the merged timeline is pushed to the service worker so
the badge keeps ticking on fully-remote days too.

### Session / logout handling

| Where | Behavior |
|-------|----------|
| `page-fetcher.js` | Login/logout page (no member ID) → returns `session_expired`. Non-JSON API response (redirect to login) → also `session_expired`. |
| `popup.js` | Handles `session_expired` even during a **silent** refresh — stops the tick, halts auto-refresh, clears state, shows the login screen. **Unless today has manual entries**, in which case it keeps running on those instead. |
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

Plain JS/HTML/CSS — no build step, no npm. ExcelJS and flatpickr are vendored into
`js/` and `css/`, so nothing is fetched at runtime.

Because Chrome runs the **deployed** copy (`%LOCALAPPDATA%\ExitTimer`), not the repo,
the loop is:

1. Edit files in the repo.
2. Double-click **`deploy.bat`** to copy them across.
3. Reload:
   - Popup-only changes (`js/popup.js`, `css/popup.css`): close and reopen the popup.
   - Service worker / manifest changes: click **reload** on the extension card.

If you'd rather iterate without deploying every time, you can **Load unpacked** the
repo folder itself while developing — just remember Chrome will disable it if the
folder ever moves, so switch back to the deployed copy for daily use.

---

## License

Internal tool for ManekTech attendance. Use within your organization.
