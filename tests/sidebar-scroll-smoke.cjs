// Optional browser smoke test: install Playwright or set PLAYWRIGHT_PATH.
// Set CHROME_PATH to use an existing Chrome executable.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://e3p.nycu.edu.tw/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }));
    await page.addInitScript(() => {
      const changes = [];
      const seed = { interfaceLanguage: 'en', assignments: [{ eventId: 'manual-1', name: '作業中文原文', course: '課程中文原文', deadline: Date.now() + 86400000, manualStatus: 'pending', isManual: true }], courses: [], announcements: [], lastSyncTime: Date.now(), lastSeenVersion: '2.2.0' };
      const read = () => JSON.parse(localStorage.getItem('fixture') || JSON.stringify(seed));
      window.chrome = {
        i18n: { getUILanguage: () => 'zh-TW' },
        runtime: { id: 'test', getManifest: () => ({ version: '2.2.0' }), getURL: p => p, onMessage: { addListener() {} }, sendMessage: (message, callback) => { const result = { success: true }; callback?.(result); return Promise.resolve(result); } },
        storage: {
          onChanged: { addListener: listener => changes.push(listener) },
          local: {
            get: async (keys, callback) => { const data = read(); callback?.(data); return data; },
            set: async update => {
              const data = read();
              localStorage.setItem('fixture', JSON.stringify({ ...data, ...update }));
              const change = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
              changes.forEach(listener => listener(change, 'local'));
            }
          }
        }
      };
    });
    await page.goto('https://e3p.nycu.edu.tw/');
    const inject = async () => {
      await page.addScriptTag({ path: path.join(__dirname, '../i18n.js') });
      await page.addScriptTag({ path: path.join(__dirname, '../exam-detection.js') });
      await page.addScriptTag({ path: path.join(__dirname, '../report-detection.js') });
      await page.addScriptTag({ path: path.join(__dirname, '../content.js') });
      await page.waitForSelector('.e3-helper-sidebar-toggle');
      await page.locator('.e3-helper-sidebar-toggle').click();
    };
    await inject();
    // Long lists must not scroll the only close control out of the viewport.
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 667 }]) {
      await page.setViewportSize(viewport);
      for (const tab of ['assignments', 'announcements', 'notifications']) {
        await page.locator(`[data-tab="${tab}"]`).click();
        await page.locator(`[data-content="${tab}"]`).evaluate(panel => {
          const filler = document.createElement('div');
          filler.id = 'scroll-regression-filler';
          filler.style.height = '2500px';
          panel.appendChild(filler);
          panel.closest('.e3-helper-sidebar').scrollTop = 100000;
        });
        const closeReachable = await page.locator('#e3-helper-close-btn').evaluate(button => {
          const rect = button.getBoundingClientRect();
          const sidebar = button.closest('.e3-helper-sidebar');
          return sidebar.scrollTop > 0 && rect.top >= 0 && rect.bottom <= innerHeight &&
            button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        });
        assert.ok(closeReachable, `${tab}: close button must remain visible and reachable after scrolling at ${viewport.width}px`);
        await page.locator('#e3-helper-close-btn').click();
        assert.equal(await page.locator('.e3-helper-sidebar').evaluate(el => el.classList.contains('expanded')), false);
        await page.locator('.e3-helper-sidebar-toggle').click();
        await page.locator('.e3-helper-sidebar').evaluate(sidebar => {
          sidebar.querySelector('#scroll-regression-filler').remove();
          sidebar.scrollTop = 0;
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('[data-tab="assignments"]').click();
    assert.deepEqual(errors, []);
    console.log('Passed: close button remains visible and clickable after scrolling assignments, announcements and notifications at desktop and mobile sizes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
