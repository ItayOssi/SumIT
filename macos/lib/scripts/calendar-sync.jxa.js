// Runs inside macOS "osascript -l JavaScript" (JavaScript for Automation), not in Node: it talks to the Calendar app.
// calendar-sync.js sends one JSON request as the first argument and reads one JSON answer from the output.
//   { op: 'list' }                         -> { ok, calendars: [{ name, nth, writable }] }
//   { op: 'apply', ops: [...] }            -> { ok, results: [{ key, ok, uid, error }] }
//     an op: { key, op: 'put', calendar, nth, uid, title, notes, start, end, alarm }   (creates the event, or changes the one with this uid)
//            { key, op: 'delete', calendar, nth, uid }
// A calendar is named by its name and, when two calendars share a name, by which of them it is (nth, from 0):
// the Calendar app does not give its calendars' identifiers to scripts.
function run(argv) {
  var req = JSON.parse(argv[0] || '{}');
  var app = Application('Calendar');
  var names = app.calendars.name();
  if (req.op === 'list') {
    var writable = app.calendars.writable(), seen = {};
    return JSON.stringify({ ok: true, calendars: names.map(function (name, i) { var nth = seen[name] || 0; seen[name] = nth + 1; return { name: name, nth: nth, writable: !!writable[i] }; }) });
  }
  function calendarOf(o) {
    var left = o.nth || 0;
    for (var i = 0; i < names.length; i++) if (names[i] === o.calendar && left-- === 0) return app.calendars[i];
    throw new Error('no-calendar');
  }
  if (req.op !== 'apply') return JSON.stringify({ ok: false, error: 'unknown op' });
  var results = [];
  (req.ops || []).forEach(function (o) {
    try {
      var cal = calendarOf(o);
      var found = null;
      if (o.uid) { try { var x = cal.events.byId(o.uid); x.summary(); found = x; } catch (e) { found = null; } }
      if (o.op === 'delete') {
        if (found) app.delete(found);
        results.push({ key: o.key, ok: true });
        return;
      }
      var start = new Date(o.start), end = new Date(o.end);
      if (found) {
        // The end goes first when the event moves later, so that the start never passes the end on the way.
        if (start.getTime() >= found.endDate().getTime()) { found.endDate = end; found.startDate = start; } else { found.startDate = start; found.endDate = end; }
        found.summary = o.title; found.description = o.notes || '';
        results.push({ key: o.key, ok: true, uid: o.uid });
        return;
      }
      var ev = app.Event({ summary: o.title, startDate: start, endDate: end, description: o.notes || '' });
      cal.events.push(ev);
      if (o.alarm) { try { ev.displayAlarms.push(app.DisplayAlarm({ triggerInterval: -o.alarm })); } catch (e) { } }
      results.push({ key: o.key, ok: true, uid: ev.uid() });
    } catch (e) {
      results.push({ key: o.key, ok: false, error: String((e && e.message) || e) });
    }
  });
  return JSON.stringify({ ok: true, results: results });
}
