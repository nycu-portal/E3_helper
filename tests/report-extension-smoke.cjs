// Real MV3, isolated profile, offline sources and fake provider output only.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const root = process.env.EXTENSION_PATH || path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-report-regression-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    const tomorrow = new Date(Date.now() + 86400000), next = new Date(Date.now() + 2 * 86400000);
    const day = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const due = day(tomorrow), later = day(next);
    await context.route('https://**/*', async route => {
      const url = route.request().url();
      let body = '<!doctype html><html><body>Offline report fixture</body></html>', contentType = 'text/html';
      if (url.includes('/post/1')) body = `<div class="posting">Final report ${due} presentation; ${later} submission due</div>`;
      if (url.includes('/courseextension/index.php')) body = '<div id="region-main"><a href="https://e3p.nycu.edu.tw/pluginfile.php/1/syllabus.pdf">Syllabus.pdf</a><a href="https://e3p.nycu.edu.tw/pluginfile.php/2/syllabus.docx">Syllabus.docx</a></div>';
      if (url.includes('/pluginfile.php/1')) { body = '%PDF-1.4\nOffline syllabus fixture'; contentType = 'application/pdf'; }
      if (url.includes('/pluginfile.php/2')) {
        const zip = new (require('../jszip.min.js'))();
        zip.file('word/document.xml', `<w:document><w:p>Local report due ${due}</w:p></w:document>`);
        const buffer = await zip.generateAsync({ type: 'nodebuffer' });
        return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: buffer });
      }
      await route.fulfill({ contentType, body });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async ({ due }) => {
      const deadline = new Date(`${due}T23:59`).getTime();
      await chrome.storage.local.set({ interfaceLanguage: 'en', lastSeenVersion: chrome.runtime.getManifest().version, lastSyncTime: Date.now(),
        courses: [{ id: '1', fullname: '1151.123456.Course' }], notificationSettings: { desktop: false, reminders: [] },
        announcements: [{ id: '1', title: 'Final report', courseId: '1', courseName: '1151.123456.Course', timestamp: Date.now(), url: 'https://e3p.nycu.edu.tw/post/1' }], messages: [],
        assignments: [{ eventId: '42', name: 'Final report', courseId: '1', course: '1151.123456.Course', deadline, url: 'https://e3p.nycu.edu.tw/mod/assign/view.php?id=42', manualStatus: 'pending' }],
        syllabusExamCache: { 'https://e3p.nycu.edu.tw/pluginfile.php/2/syllabus.docx': { at: Date.now(), count: 1 } },
        examExtractionCache: { 'announcement:1': { at: Date.now(), mode: 'regex', candidates: [] } } });
      globalThis.fetchTimetableJson = async route => route === 'getCrsOutlineBase' ? { cos_time: 'M12' } : [{ week_id: 1, class_date: due, class_data: 'Quiz 1' }];
    }, { due });
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    const errors = []; pages.forEach(p => p.on('pageerror', e => errors.push(e.message)));
    for (const p of pages) { await p.goto('https://e3p.nycu.edu.tw/'); await p.locator('.e3-helper-sidebar-toggle').click(); }
    const page = pages[0], coursework = '.e3-helper-content[data-content="assignments"]';
    await page.locator(`${coursework} [data-exam-action="scan"]`).click();
    await page.locator(`${coursework} [data-exam-suggestion^="report:"]`).first().waitFor();
    assert.equal(await page.locator(`${coursework} [data-exam-suggestion^="report:"]`).count(), 2);
    assert.equal(await page.locator(`${coursework} [data-exam-suggestion^="exam:"]`).count(), 1);
    const suggestions = await worker.evaluate(() => chrome.storage.local.get('reportSuggestions'));
    const presentation = suggestions.reportSuggestions.find(s => s.reportType === 'presentation');
    const submission = suggestions.reportSuggestions.find(s => s.reportType === 'submission');
    const card = (p, s, panel=coursework) => p.locator(`${panel} [data-exam-suggestion]`).filter({ has: p.locator(`[data-exam-action="accept"]`) }).filter({ hasText: s.reportType === 'submission' ? 'Submission' : 'Presentation' });
    // Accept on both tabs while a separate coursework patch is being saved.
    await Promise.all([card(page, presentation).getByRole('button', { name: 'Convert to report', exact: true }).click(),
      card(pages[1], submission).getByRole('button', { name: 'Add report', exact: true }).click(),
      worker.evaluate(() => saveAssignmentChanges({ deleted: [], upserts: [{ eventId: 'sync-new', create: true, fields: { name: 'Concurrent synced task', deadline: Date.now()+86400000 } }] }))]);
    const waitStorage = async predicate => {
      for (let i=0; i<100; i++) { const data = await worker.evaluate(() => chrome.storage.local.get(['assignments','reportSuggestions','assignmentStatuses'])); if (predicate(data)) return data; await page.waitForTimeout(50); }
      throw new Error('Report storage did not converge: ' + JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(['assignments','reportSuggestions']))));
    };
    const accepted = await waitStorage(s => s.assignments.filter(a => a.kind === 'report').length === 2);
    assert.equal(accepted.assignments.length, 3);
    assert.equal(accepted.assignments.find(a => a.eventId === '42').kind, 'report');
    assert.match(accepted.assignments.find(a => a.eventId === '42').url, /mod\/assign/);
    for (const p of pages) await p.locator(`${coursework} [data-exam-suggestion^="report:"]`).waitFor({ state: 'detached' });
    await page.locator('[data-kind-filter="report"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.e3-helper-assignment-item').length === 2);
    // Rename a date-only report without changing its timing metadata.
    const report = accepted.assignments.find(a => a.reportType === 'submission');
    await page.locator(`.e3-helper-edit-assignment[data-event-id="${report.eventId}"]`).click();
    await page.locator('#e3-helper-assignment-name').fill('Renamed report');
    await page.locator('#e3-helper-add-assignment-form button[type="submit"]').click();
    const renamed = await waitStorage(s => s.assignments.some(a => a.name === 'Renamed report'));
    assert.equal(renamed.assignments.find(a => a.eventId === report.eventId).timeKnown, 'date-only');
    await page.locator(`.e3-helper-status-toggle[data-event-id="${report.eventId}"]`).click();
    await waitStorage(s => s.assignments.find(a => a.eventId === report.eventId).manualStatus === 'submitted');
    // Read Word locally without AI; old exam-only syllabus caches must not pre-uncheck it.
    await page.locator(`${coursework} [data-exam-action="syllabus"]`).click();
    await page.locator('[data-syllabus-read]').click();
    await waitStorage(s => s.reportSuggestions.some(s => s.name === 'Local report'));
    // Fake provider verifies PDF consent/upload and the shared extraction prompt.
    await worker.evaluate(({ due }) => {
      globalThis.callAIWithFile = async request => {
        if (!request.content.includes('"reports"') || !request.content.includes('untrusted source content')) throw new Error('Missing report extraction rules');
        return JSON.stringify({ exams: [], reports: [{ source: 1, name: 'PDF report', reportType: 'submission', date: due, time: null }] });
      };
      return chrome.storage.local.set({ aiSettings: { enabled: true, summaryProvider: 'openai', openaiSummaryApiKey: 'fixture', openaiSummaryModel: 'fixture' } });
    }, { due });
    await page.locator(`${coursework} [data-exam-action="syllabus"]`).click();
    const pdf = page.locator('#e3-helper-syllabus-body label').filter({ hasText: 'Syllabus.pdf' });
    await pdf.locator('input').check();
    await page.locator('#e3-helper-syllabus-body label').filter({ hasText: 'Syllabus.docx' }).locator('input').uncheck();
    await page.locator('[data-syllabus-read]').click();
    await waitStorage(s => s.reportSuggestions.some(s => s.name === 'PDF report'));
    // Manual reports participate in today's digest without an AI overview.
    await page.locator('#e3-helper-add-assignment-btn').click();
    await page.locator('#e3-helper-assignment-kind').selectOption('report');
    await page.locator('#e3-helper-report-type').selectOption('submission');
    await page.locator('#e3-helper-assignment-name').fill('Today manual report');
    await page.locator('#e3-helper-assignment-course-select').selectOption('__custom__');
    await page.locator('#e3-helper-assignment-course-custom').fill('Manual course');
    await page.locator('#e3-helper-assignment-date').fill(day(new Date()));
    await page.locator('#e3-helper-assignment-time').fill('23:59');
    await page.locator('#e3-helper-add-assignment-form button[type="submit"]').click();
    const manual = (await waitStorage(s => s.assignments.some(a => a.name === 'Today manual report'))).assignments.find(a => a.name === 'Today manual report');
    await page.locator('[data-tab="announcements"]').click();
    await page.locator('#e3-helper-digest-exams').getByText('Today manual report', { exact: false }).waitFor();
    await page.locator('[data-tab="assignments"]').click();
    await page.locator(`.e3-helper-status-toggle[data-event-id="${manual.eventId}"]`).click();
    await waitStorage(s => s.assignments.find(a => a.eventId === manual.eventId)?.manualStatus === 'submitted');
    await page.locator('[data-tab="announcements"]').click();
    await page.locator('#e3-helper-digest-exams').getByText('Today manual report', { exact: false }).waitFor({ state: 'detached' });
    await page.locator('[data-tab="assignments"]').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator(`.e3-helper-delete-assignment[data-event-id="${manual.eventId}"]`).click();
    await waitStorage(s => !s.assignments.some(a => a.eventId === manual.eventId));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(os.tmpdir(), 'e3-report-coursework.png'), fullPage: true });
    console.log('Passed: real MV3 combined scan, two-tab acceptance, E3 conversion, concurrent coursework save, report filter, rename, completion, local Word and PDF AI consent.');
  } finally { await context?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
