// Injected into a ManekTech page on Export click (never on a timer).
// Fetches every day of the current month (1..today) from InOutSelectByDateAsc
// using the page's session cookies + member ID, reads the calendar on the page
// for leave / weekend / holiday context, and returns structured data the popup
// turns into a multi-sheet .xlsx workbook.
(async () => {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // ── Member ID (same resolution as page-fetcher) ──
  const MEM_KEY = 'et_memberID';
  let memberID = null;
  if (typeof MemberID !== 'undefined' && MemberID) memberID = MemberID;
  if (!memberID) { const s = document.getElementById('content_ddlMember'); if (s && s.value) memberID = s.value; }
  if (!memberID) { const m = location.search.match(/memberid=(\d+)/i); if (m) memberID = m[1]; }
  if (memberID) { try { localStorage.setItem(MEM_KEY, String(memberID)); } catch (_) {} }
  if (!memberID) {
    const onLoginPage =
      /default\.aspx/i.test(location.pathname) ||
      /mode=logout/i.test(location.search) ||
      !!document.querySelector('input[type="password"]') ||
      !!document.getElementById('txtPassword');
    if (onLoginPage) return { error: 'session_expired' };
    try { memberID = localStorage.getItem(MEM_KEY) || null; } catch (_) {}
    if (!memberID) return { error: 'first_run' };
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const wdays  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const now = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const lastDay = now.getDate();
  const monthKey  = year + '-' + pad(month + 1);
  const monthName = months[month] + ' ' + year;

  // ── Calendar context from the page (leave / weekend / holiday) ──
  // Only present when the export runs from the inout-summary page; otherwise
  // empty maps and we fall back to weekday math for weekends.
  const leaveMap = {};   // 'YYYY-MM-DD' -> leave type label
  const weekendSet = new Set();
  const holidaySet = new Set();
  const lateMap = {};      // date -> late minutes
  const variNoteMap = {};  // date -> variation minutes parsed off calendar (fallback)

  try {
    document.querySelectorAll('.fc-day-content').forEach(el => {
      const td = el.closest('td[data-date]');
      const date = td?.getAttribute('data-date');
      if (!date) return;
      const approved = el.classList.contains('leave-approved');
      const txt = el.textContent || '';
      if (el.classList.contains('fullleave'))        leaveMap[date] = approved ? 'Full Leave (Approved)' : 'Full Leave (Pending)';
      else if (txt.includes('Half Leave'))           leaveMap[date] = approved ? 'Half Leave (Approved)' : 'Half Leave (Pending)';
      else if (txt.includes('Un-Informed'))          leaveMap[date] = 'Uninformed';
      else if (txt.includes('WFH'))                  leaveMap[date] = 'Work From Home';
      else if (txt.includes('PL'))                   leaveMap[date] = approved ? 'Privilege Leave (Approved)' : 'Privilege Leave (Pending)';
      else if (txt.includes('SL'))                   leaveMap[date] = approved ? 'Sick Leave (Approved)' : 'Sick Leave (Pending)';
      else if (txt.includes('OT'))                   leaveMap[date] = 'OT';
      if (/holiday/i.test(el.className) || /holiday/i.test(txt)) holidaySet.add(date);
    });
    document.querySelectorAll('td.sat-sun[data-date]').forEach(td => {
      weekendSet.add(td.getAttribute('data-date'));
    });
    document.querySelectorAll('td.holiday[data-date], td.fc-holiday[data-date]').forEach(td => {
      holidaySet.add(td.getAttribute('data-date'));
    });
    document.querySelectorAll('a.fc-event').forEach(ev => {
      const td = ev.closest('td[data-date]');
      const date = td?.getAttribute('data-date');
      const html = ev.querySelector('.fc-event-title')?.innerHTML || ev.innerHTML;
      if (!date) return;
      const lm = html.match(/Late Time\s*:\s*(\d+):(\d+)/i);
      if (lm) lateMap[date] = parseInt(lm[1],10)*60 + parseInt(lm[2],10);
      const vm = html.match(/Variation\s*:\s*([+-])(\d+):(\d+)/i);
      if (vm) variNoteMap[date] = (vm[1]==='+'?1:-1)*(parseInt(vm[2],10)*60 + parseInt(vm[3],10));
    });
  } catch (_) {}

  // ── Daily fetch ──
  let targetMin = 9 * 60 + 15; // refined as PolicyShift seen
  async function fetchDay(d) {
    const inDateTime = months[month] + ' ' + d + ' ' + year;
    const resp = await fetch('/DataService.asmx/InOutSelectByDateAsc', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ memberID, inDateTime })
    });
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok || !ct.includes('json')) throw new Error('session');
    const json = await resp.json();
    return JSON.parse(json.d) || [];
  }

  const days = [];      // per-day summary rows
  const sessionRows = []; // flat per-session rows

  for (let d = 1; d <= lastDay; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = year + '-' + pad(month + 1) + '-' + pad(d);
    const weekday = wdays[dateObj.getDay()];
    const isWeekendCal = weekendSet.has(dateStr);
    const isWeekend = isWeekendCal || dateObj.getDay() === 0 || dateObj.getDay() === 6;
    const isHoliday = holidaySet.has(dateStr);
    const leave = leaveMap[dateStr] || null;

    let list;
    try { list = await fetchDay(d); }
    catch (e) {
      if (e.message === 'session') return { error: 'session_expired' };
      list = [];
    }

    const sessions = [];
    list.forEach(row => {
      if (!row.InTime) return;
      const inMs  = new Date(row.InTime).getTime();
      const outMs = row.OutTime ? new Date(row.OutTime).getTime() : null;
      if (isNaN(inMs)) return;
      if (outMs != null && (isNaN(outMs) || outMs < inMs)) return;
      sessions.push({ inMs, outMs });
      if (row.PolicyShift == 1) targetMin = 8 * 60 + 15;
      else if (row.PolicyShift != null) targetMin = 9 * 60 + 15;
    });

    let workedMin = 0, breakMin = 0;
    sessions.forEach((s, i) => {
      const out = s.outMs || s.inMs;
      workedMin += Math.max(0, out - s.inMs) / 60000;
      if (i < sessions.length - 1 && s.outMs) breakMin += Math.max(0, sessions[i + 1].inMs - s.outMs) / 60000;
    });
    workedMin = Math.round(workedMin);
    breakMin  = Math.round(breakMin);

    // Status precedence: punched-in beats everything; else leave/weekend/holiday/absent.
    let status;
    if (sessions.length) status = 'Present';
    else if (leave)      status = leave;
    else if (isHoliday)  status = 'Holiday';
    else if (isWeekend)  status = 'Weekend';
    else                 status = 'Absent';

    // Variation only meaningful on a work day with punches. Off-days = null
    // (no -target penalty → no misleading negatives, no #VALUE!).
    const isWorkExpected = !isWeekend && !isHoliday && !(leave && /Full Leave/.test(leave));
    const variationMin = sessions.length ? (workedMin - targetMin)
                        : (isWorkExpected ? -targetMin : null);

    // Per-session rows
    sessions.forEach((s, i) => {
      sessionRows.push({
        date: dateStr, weekday, idx: i + 1,
        inMs: s.inMs, outMs: s.outMs,
        durMin: Math.round(Math.max(0, (s.outMs || s.inMs) - s.inMs) / 60000),
        open: !s.outMs
      });
    });

    days.push({
      date: dateStr, weekday, status,
      firstIn: sessions[0]?.inMs ?? null,
      lastOut: sessions.length ? (sessions[sessions.length - 1].outMs ?? null) : null,
      sessionCount: sessions.length,
      workedMin, breakMin, variationMin,
      lateMin: lateMap[dateStr] ?? null,
      leave: leave || '',
      isWeekend, isHoliday
    });
  }

  // ── Aggregates for the Summary sheet ──
  const presentDays = days.filter(x => x.status === 'Present').length;
  const absentDays  = days.filter(x => x.status === 'Absent').length;
  const weekendDays = days.filter(x => x.isWeekend).length;
  const holidayDays = days.filter(x => x.isHoliday && !x.isWeekend).length;
  const workExpected = days.filter(x => !x.isWeekend && !x.isHoliday && !/Full Leave/.test(x.leave)).length;
  const totalWorkedMin = days.reduce((a, x) => a + x.workedMin, 0);
  const totalBreakMin  = days.reduce((a, x) => a + x.breakMin, 0);
  const totalVariationMin = days.reduce((a, x) => a + (x.variationMin || 0), 0);
  const lateDays = days.filter(x => (x.lateMin || 0) > 0).length;
  const avgWorkedMin = presentDays ? Math.round(totalWorkedMin / presentDays) : 0;
  const attendancePct = workExpected ? Math.round((presentDays / workExpected) * 100) : 0;

  // Leave tally
  const leaveTally = {};
  days.forEach(x => { if (x.leave) leaveTally[x.leave] = (leaveTally[x.leave] || 0) + 1; });

  return {
    monthKey, monthName, targetMin,
    days, sessionRows,
    summary: {
      monthName, targetMin,
      daysCovered: days.length,
      workExpected, presentDays, absentDays, weekendDays, holidayDays,
      totalWorkedMin, avgWorkedMin, totalBreakMin, totalVariationMin,
      lateDays, attendancePct
    },
    leaveTally
  };
})();
