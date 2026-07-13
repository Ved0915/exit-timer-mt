(async () => {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // Member ID is fixed per user. Discover it once, persist to the site's
  // localStorage (shared across every ManekTech page), then reuse it everywhere
  // so the timer works on any page — not just the attendance page.
  const MEM_KEY = 'et_memberID';
  let memberID = null;
  if (typeof MemberID !== 'undefined' && MemberID) memberID = MemberID;
  if (!memberID) { const s = document.getElementById('content_ddlMember'); if (s && s.value) memberID = s.value; }
  if (!memberID) { const m = location.search.match(/memberid=(\d+)/i); if (m) memberID = m[1]; }

  if (memberID) {
    // Found on this page → remember for future visits to other pages.
    try { localStorage.setItem(MEM_KEY, String(memberID)); } catch (_) {}
  } else {
    // Logged out? Don't reuse a stale ID to render data on a login screen.
    const onLoginPage =
      /default\.aspx/i.test(location.pathname) ||
      /mode=logout/i.test(location.search) ||
      !!document.querySelector('input[type="password"]') ||
      !!document.getElementById('txtPassword');
    if (onLoginPage) return { error: 'session_expired' };

    // Fall back to the ID saved from a previous attendance-page visit.
    try { memberID = localStorage.getItem(MEM_KEY) || null; } catch (_) {}

    // Truly first run — never visited the attendance page yet.
    if (!memberID) return { error: 'first_run' };
  }

  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const inDateTime = months[now.getMonth()] + ' ' + now.getDate() + ' ' + now.getFullYear();
  // Date this data belongs to — consumers drop it once the local day rolls over.
  const dayKey = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

  let list;
  try {
    const resp = await fetch('/DataService.asmx/InOutSelectByDateAsc', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ memberID, inDateTime })
    });

    // Session expired — server may return HTML redirect or 500
    const contentType = resp.headers.get('content-type') || '';
    if (!resp.ok || !contentType.includes('json')) {
      return { error: 'session_expired' };
    }

    const json = await resp.json();
    list = JSON.parse(json.d);
  } catch (e) {
    return { error: 'api_error', detail: e.message };
  }

  if (!list || !list.length) return { error: 'no_sessions' };

  // Return raw sessions with epoch timestamps so popup.js can tick live
  const sessions = [];
  list.forEach(row => {
    if (!row.InTime) return;
    const inMs  = new Date(row.InTime).getTime();
    const outMs = row.OutTime ? new Date(row.OutTime).getTime() : null;
    if (isNaN(inMs)) return;
    if (outMs && (isNaN(outMs) || outMs < inMs)) return;
    sessions.push({ inMs, outMs });
  });

  // Fixed target: must WORK 8h15m net (breaks excluded). Exit = when worked
  // time reaches 8h15m; breaks just push the exit clock-time later.
  const targetMin = 8 * 60 + 15;

  // Monthly summary from calendar if on summary page
  let monthlySummary = null;
  try {
    const lblDetail = document.getElementById('lblCurrentMonthDetail');
    if (lblDetail) {
      const txt = lblDetail.textContent;
      const wd  = txt.match(/Working Days\s*=\s*(\d+)/)?.[1];
      const pd  = txt.match(/Present Days\s*=\s*([\d.]+)/)?.[1];
      const pct = txt.match(/\[(\d+)%\]/)?.[1];
      const ot  = txt.match(/OT\s*=\s*([\d.]+)/)?.[1];
      if (wd) monthlySummary = { workingDays: +wd, presentDays: +pd, pct: +pct, ot: +ot };
    }

    // Collect leave data from calendar day cells
    const leaveMap = {};
    document.querySelectorAll('.fc-day-content').forEach(el => {
      const td = el.closest('td[data-date]');
      const date = td?.getAttribute('data-date');
      if (!date) return;
      const isApproved = el.classList.contains('leave-approved');
      const txt = el.textContent || '';
      if (el.classList.contains('fullleave')) {
        leaveMap[date] = isApproved ? 'full-approved' : 'full-unapproved';
      } else if (txt.includes('Half Leave')) {
        leaveMap[date] = isApproved ? 'half-approved' : 'half-unapproved';
      } else if (txt.includes('Un-Informed')) {
        leaveMap[date] = 'uninformed';
      } else if (txt.includes('WFH')) {
        leaveMap[date] = 'WFH';
      } else if (txt.includes('PL')) {
        leaveMap[date] = isApproved ? 'PL-approved' : 'PL-unapproved';
      } else if (txt.includes('SL')) {
        leaveMap[date] = isApproved ? 'SL-approved' : 'SL-unapproved';
      } else if (txt.includes('OT')) {
        leaveMap[date] = 'OT';
      }
    });

    // Count sat/sun & holidays
    let satSunCount = 0, holidayCount = 0;
    document.querySelectorAll('td.sat-sun').forEach(td => {
      const d = td.getAttribute('data-date') || '';
      if (d.startsWith(now.getFullYear() + '-' + pad(now.getMonth()+1))) satSunCount++;
    });

    // Tally leaves
    const leaveTally = {};
    Object.values(leaveMap).forEach(type => { leaveTally[type] = (leaveTally[type] || 0) + 1; });

    // Count late days and sum monthly variation from calendar events
    let lateCount = 0;
    let monthlyVariationMin = 0;
    document.querySelectorAll('a.fc-event .fc-event-title').forEach(el => {
      const html = el.innerHTML;
      // Late days
      const lm = html.match(/Late Time\s*:\s*(\d+):(\d+)/i);
      if (lm) {
        const mins = parseInt(lm[1], 10) * 60 + parseInt(lm[2], 10);
        if (mins > 0) lateCount++;
      }
      // Variation: +HH:MM or -HH:MM
      const vm = html.match(/Variation\s*:\s*([+-])(\d+):(\d+)/i);
      if (vm) {
        const sign = vm[1] === '+' ? 1 : -1;
        const mins = parseInt(vm[2], 10) * 60 + parseInt(vm[3], 10);
        monthlyVariationMin += sign * mins;
      }
    });

    // Read selected month name from picker
    const monthPicker = document.getElementById('monthPicker');
    const monthName = monthPicker
      ? monthPicker.options[monthPicker.selectedIndex]?.text
      : null;

    if (monthlySummary) {
      monthlySummary.leaveTally = leaveTally;
      monthlySummary.leaveMap = leaveMap;
      monthlySummary.satSunCount = satSunCount;
      monthlySummary.lateCount = lateCount;
      monthlySummary.monthlyVariationMin = monthlyVariationMin;
      monthlySummary.monthName = monthName;
    }
  } catch(_) {}

  return { sessions, targetMin, monthlySummary, fetchedAt: Date.now(), dayKey };
})();
