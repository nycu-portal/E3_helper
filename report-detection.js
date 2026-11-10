// Report-specific classification; source documents are data, never instructions.
(function (root) {
  'use strict';
  const exams = root.E3ExamDetection || (typeof require === 'function' ? require('./exam-detection.js') : null);
  const TYPES = ['presentation', 'submission'];
  const VERSION = 2;
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  function hasReportKeyword(text) {
    return /\b(?:reports?|presentations?|projects?)\b|報告|發表|專題/i.test(String(text || '')) && !/事故報告|天氣報告|bug report|weather report/i.test(text);
  }
  function reportType(text) {
    return /繳交|提交|截止|書面|交件|\b(?:submit|submission|due|deadline|written)\b/i.test(text) ? 'submission' : 'presentation';
  }
  function nameOf(text) {
    const base = String(text || '').replace(/<[^>]*>/g, ' ')
      .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\d{1,2}[\/月]\d{1,2}日?/g, ' ')
      .replace(/(?:上午|下午|中午|晚上)?\s*\d{1,2}[:：]\d{2}\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)?/ig, ' ')
      .replace(/\([一二三四五六日天]\)|（[一二三四五六日天]）/g, ' ')
      .replace(/第?\s*\d+\s*組|\bgroup\s*[\w-]+/ig, ' ')
      .replace(/繳交|提交|截止|\b(?:due|submit|deadline)\b/ig, ' ')
      .replace(/[|；;：:]/g, ' ').replace(/\s+/g, ' ').trim();
    // Keep a literal title such as “Final presentation”; remove action labels only
    // when a report/project title remains, so its two milestones share a name.
    return (/報告|專題|\b(?:reports?|projects?)\b/i.test(base)
      ? base.replace(/口頭|書面|發表日?|\b(?:presentation|submission|written)\b/ig, ' ').replace(/\s+/g, ' ').trim()
      : base).slice(0, 120);
  }
  function makeCandidate(fields) {
    if (!TYPES.includes(fields.reportType) || !String(fields.name || '').trim() || !Number.isFinite(fields.deadline)) return null;
    return { ...fields, kind: 'report', name: String(fields.name).trim().slice(0, 120), group: String(fields.group || '').slice(0, 60),
      courseId: String(fields.courseId || ''), course: String(fields.course || ''), url: fields.url || '', timeKnown: fields.timeKnown || 'date-only' };
  }
  function withTime(date, type, course, clock) {
    const slot = type === 'presentation' && exams.parseClassTime(course.classTime).find(s => s.day === date.getDay());
    const time = clock || slot?.start || '23:59';
    const stamp = value => { const [h, m] = value.split(':').map(Number); return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).getTime(); };
    return { deadline: stamp(time), timeKnown: clock ? 'exact' : slot ? 'class-slot' : 'date-only', endTime: !clock && slot ? stamp(slot.end) : null };
  }
  function detectText(text, course, source = {}) {
    const out = [];
    // Keep each dated clause separate, so submission and presentation dates cannot leak into one another.
    let title = hasReportKeyword(source.label) ? nameOf(source.label) : '';
    let currentGroup = String(source.label || '').match(/(?:第?\s*\d+\s*組|\bgroup\s*[\w-]+)/i)?.[0] || '';
    for (const line of String(text || '').replace(/<[^>]*>/g, ' ').split(/\n|[；;，]|,(?=\s*\d)|\band\s+(?=group\s|\d)/i)) {
      const explicitGroup = line.match(/(?:第?\s*\d+\s*組|\bgroup\s*[\w-]+)/i)?.[0] || '';
      if (hasReportKeyword(line)) {
        const name = nameOf(line);
        if (normalize(name) !== normalize(title)) currentGroup = '';
        title = name;
      }
      if (explicitGroup) currentGroup = explicitGroup;
      if (!hasReportKeyword(line) && !(title && /繳交|提交|發表|presentation|due|submit|第?\s*\d+\s*組|\bgroup\s/i.test(line))) continue;
      const type = reportType(line);
      const fullDates = [...line.matchAll(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g)];
      let dates;
      if (fullDates.length) dates = fullDates.flatMap((match, index) => {
        const date = new Date(+match[1], +match[2] - 1, +match[3]);
        if (date.getFullYear() !== +match[1] || date.getMonth() !== +match[2] - 1 || date.getDate() !== +match[3]) return [];
        const segment = fullDates.length === 1 ? line : line.slice(match.index, fullDates[index + 1]?.index);
        const timing = exams.extractDatesFromText(segment.replace(match[0], `${match[2]}/${match[3]}`), date.getTime())[0];
        const clock = timing?.timeKnown === 'exact' ? `${new Date(timing.deadline).getHours()}:${String(new Date(timing.deadline).getMinutes()).padStart(2, '0')}` : null;
        return [{ deadline: date.getTime(), timeKnown: 'date-only', clock }];
      });
      else dates = exams.extractDatesFromText(line, source.seenAt || Date.now());
      for (const found of dates) {
        const exact = found.clock || (found.timeKnown === 'exact' ? `${new Date(found.deadline).getHours()}:${String(new Date(found.deadline).getMinutes()).padStart(2, '0')}` : null);
        const group = currentGroup;
        const c = makeCandidate({ ...course, ...source, name: hasReportKeyword(line) ? nameOf(line) : nameOf(title), group, reportType: type,
          ...withTime(new Date(found.deadline), type, course, exact), excerpt: line.trim().slice(0, 160), confidence: 'low' });
        if (c) out.push(c);
      }
    }
    return out;
  }
  function detectTimetableReports(rows, course) {
    return (rows || []).flatMap(row => detectText(`${row.class_date} | ${row.class_data}`, course, { source: 'timetable', url: course.url, label: `W${row.week_id}` }));
  }
  function detectAnnouncementReports(items, courses) {
    return (items || []).flatMap(item => detectText(`${item.title || ''}\n${item.text || ''}`, exams.resolveCourse(item, courses || []), {
      source: item.type === 'message' ? 'message' : 'announcement', url: item.url, label: item.title, seenAt: item.timestamp }));
  }
  function buildExtractionPrompt(records, options) {
    return exams.buildExtractionPrompt(records, options).replace('You extract exam dates', 'You extract exam and report milestone dates').replace('Only report exams', 'Extract exams').replace('Use {"exams":[]} if nothing qualifies.', 'Use {"exams":[],"reports":[]} if nothing qualifies.').replace('Ignore homework, projects and presentations.', 'Also extract dated reports, presentations and project deliverables into reports; ignore ordinary homework.') + `\nAlso return "reports":[{"source":1,"name":"literal report title/number, consistent across its dates","group":"explicit group or empty string","reportType":"presentation|submission","date":"YYYY-MM-DD","time":null,"location":null}]. Keep presentation and submission dates separate. Preserve all explicitly named groups; never guess the student's group. Use classWeekDates only when provided. No inferred deadlines or undated reports. Return both exams and reports arrays, even when empty.`;
  }
  function parseReportExtraction(text, sources, { now = Date.now() } = {}) {
    const data = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (!data || !Array.isArray(data.reports)) throw new Error('Invalid report extraction format');
    return data.reports.slice(0, 80).flatMap(entry => {
      if (!entry || !Number.isInteger(entry.source) || !sources[entry.source - 1] || !TYPES.includes(entry.reportType) || typeof entry.name !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return [];
      const [y, m, d] = entry.date.split('-').map(Number), date = new Date(y, m - 1, d);
      if (date.getMonth() !== m - 1 || date.getDate() !== d || date.getTime() < now - 30 * 86400000 || date.getTime() > now + 240 * 86400000) return [];
      const source = sources[entry.source - 1];
      const clock = typeof entry.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(entry.time) ? entry.time : null;
      const c = makeCandidate({ ...source, source: source.type, name: entry.name, group: typeof entry.group === 'string' ? entry.group : '', reportType: entry.reportType,
        location: typeof entry.location === 'string' ? entry.location.slice(0, 60) : '', ...withTime(date, entry.reportType, source, clock), confidence: 'high' });
      return c ? [c] : [];
    });
  }
  function suggestionId(c) { return `report:${encodeURIComponent(JSON.stringify([String(c.courseId), normalize(c.name), normalize(c.group), c.reportType]))}`; }
  function matchingAssignment(assignments, suggestion, chosen) {
    return assignments.find(a => a.reportKey === suggestion.id) || assignments.find(a => !a.reportKey && normalize(a.group) === normalize(suggestion.group) && (String(a.courseId) === String(suggestion.courseId) || (!a.courseId && a.course === suggestion.course)) &&
      normalize(a.name) === normalize(suggestion.name) && exams.dayKey(a.deadline) === exams.dayKey(chosen.deadline) && (!a.reportType || a.reportType === suggestion.reportType));
  }
  function mergeSuggestions(existing, candidates, assignments = [], now = Date.now(), replace = () => false) {
    const map = new Map((existing || []).map(s => [s.id, { ...s, candidates: s.candidates.filter(c => !replace(c)) }]));
    const refreshed = new Set();
    for (const raw of candidates) {
      const c = makeCandidate(raw); if (!c) continue;
      const id = suggestionId(c), s = map.get(id) || { id, kind: 'report', courseId: c.courseId, course: c.course, name: c.name, group: c.group, reportType: c.reportType, candidates: [], state: 'new' };
      const key = JSON.stringify([id, c.source, c.url]);
      if (!refreshed.has(key)) { s.candidates = s.candidates.filter(old => old.source !== c.source || old.url !== c.url); refreshed.add(key); }
      if (!s.candidates.some(old => old.source === c.source && old.url === c.url && old.deadline === c.deadline)) s.candidates.push(c);
      map.set(id, s);
    }
    return [...map.values()].filter(s => s.candidates.length).map(s => {
      const best = exams.preferredCandidate(s.candidates), confirmed = assignments.find(a => a.reportKey === s.id), fingerprint = exams.fingerprint(s.candidates);
      if (confirmed) s.state = (best.deadline !== confirmed.deadline && (exams.dayKey(best.deadline) !== exams.dayKey(confirmed.deadline) || best.timeKnown !== 'date-only')) && fingerprint !== s.resolvedFingerprint ? 'update' : 'accepted';
      else if (s.state === 'accepted' || s.state === 'update' || s.state === 'dismissed') s.state = fingerprint === s.resolvedFingerprint ? 'dismissed' : 'new';
      return s;
    }).filter(s => s.state === 'accepted' || Math.max(...s.candidates.map(c => c.deadline)) >= now - 86400000);
  }
  function toReportAssignment(s, chosen, previous) {
    return { ...(previous || {}), eventId: previous?.eventId || `report-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      kind: 'report', reportType: s.reportType, reportKey: s.id, name: previous?.name || s.name, group: s.group,
      courseId: s.courseId, course: s.course, deadline: chosen.deadline, endTime: chosen.endTime, timeKnown: chosen.timeKnown,
      url: previous?.url || chosen.url || '#', location: chosen.location || '', sources: s.candidates.map(c => ({ type: c.source, url: c.url, label: c.label, deadline: c.deadline })),
      manualStatus: previous?.manualStatus || 'pending', isManual: previous ? previous.isManual : true,
      ...(previous && !previous.isManual ? { manuallyEdited: true } : {}) };
  }
  root.E3ReportDetection = { TYPES, VERSION, hasReportKeyword, reportType, nameOf, detectText, detectTimetableReports, detectAnnouncementReports,
    buildExtractionPrompt, parseReportExtraction, suggestionId, mergeSuggestions, matchingAssignment, toReportAssignment };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.E3ReportDetection;
})(globalThis);
