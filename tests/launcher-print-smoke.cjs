// Optional browser regression: install Playwright or set PLAYWRIGHT_PATH.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
  });
  try {
    // Some host sites apply global !important button rules.
    const hostileCSS = 'body > button { width: 100vw !important; min-width: 100vw !important; max-width: none !important; padding: 24px !important; display: block !important; position: static !important; margin: 18px !important; }';
    const prepare = async page => {
      await page.route('https://e3p.nycu.edu.tw/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><style>' + hostileCSS + '</style></head><body><main>Course page content</main></body></html>'
    }));
    await page.addInitScript(() => {
      const data = {
        interfaceLanguage: 'en',
        themePreference: 'light',
        assignments: [],
        courses: [],
        announcements: [],
        lastSyncTime: Date.now(),
        lastSeenVersion: '2.3.0'
      };
      const listeners = [];
      window.chrome = {
        i18n: { getUILanguage: () => 'en' },
        runtime: {
          id: 'fixture',
          getManifest: () => ({ version: '2.3.0' }),
          getURL: file => file,
          onMessage: { addListener() {} },
          sendMessage: (message, callback) => {
            const response = { success: true };
            callback?.(response);
            return Promise.resolve(response);
          }
        },
        storage: {
          onChanged: { addListener: listener => listeners.push(listener) },
          local: {
            get: async (keys, callback) => {
              callback?.(data);
              return data;
            },
            set: async update => {
              Object.assign(data, update);
              listeners.forEach(listener => listener(
                Object.fromEntries(Object.entries(update).map(([key, value]) => [key, { newValue: value }])),
                'local'
              ));
            }
          }
        }
      };
    });
    await page.goto('https://e3p.nycu.edu.tw/');
    const root = path.join(__dirname, '..');
    await page.addScriptTag({ path: path.join(root, 'i18n.js') });
    await page.addScriptTag({ path: path.join(root, 'exam-detection.js') });
    await page.addScriptTag({ path: path.join(root, 'content.js') });
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page);

    const launcher = page.locator('.e3-helper-sidebar-toggle');
    const getLauncher = () => launcher.evaluate(button => {
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return {
        position: style.position,
        display: style.display,
        width: rect.width,
        right: rect.right,
        background: style.backgroundColor,
        iconColor: getComputedStyle(button.querySelector('.e3-helper-toggle-icon')).color,
        textDisplay: getComputedStyle(button.querySelector('.e3-helper-toggle-text')).display
      };
    });

    const compact = await getLauncher();
    assert.equal(compact.position, 'fixed', 'host styles cannot unfix the launcher');
    assert.ok(['flex', 'inline-flex'].includes(compact.display), 'launcher must remain flex-based despite host styling');
    assert.ok(compact.width >= 40 && compact.width <= 50, 'launcher stays icon-sized');
    assert.equal(compact.right, 1280, 'launcher remains at the right edge');
    assert.equal(compact.background, 'rgb(179, 38, 30)', 'original red launcher');
    assert.equal(compact.iconColor, 'rgb(255, 255, 255)', 'white icon');
    assert.equal(compact.textDisplay, 'none', 'label is initially folded');

    await launcher.hover();
    // Hover starts a 300ms width transition; wait for its settled geometry.
    await page.waitForFunction(() => {
      const button = document.querySelector('.e3-helper-sidebar-toggle');
      const width = button?.getBoundingClientRect().width;
      return width >= 130 && width <= 140;
    });
    const hovered = await getLauncher();
    assert.ok(hovered.width >= 130 && hovered.width <= 140, 'hover expands only to label width');
    assert.notEqual(hovered.textDisplay, 'none', 'label appears on hover');

    await launcher.click();
    assert.ok(await page.locator('.e3-helper-sidebar').evaluate(el => el.classList.contains('expanded')));

    // The syllabus scan dialog uses inline display:flex and must also be absent from print.
    await page.evaluate(() => {
      const dialog = document.createElement('div');
      dialog.id = 'e3-helper-syllabus-modal';
      dialog.style.cssText = 'display:flex;position:fixed;inset:0';
      document.body.appendChild(dialog);
    });
    await page.emulateMedia({ media: 'print' });
    for (const selector of ['.e3-helper-sidebar', '.e3-helper-sidebar-toggle', '#e3-helper-syllabus-modal']) {
      assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).display), 'none', selector + ' hidden in print');
    }
    assert.notEqual(await page.locator('main').evaluate(el => getComputedStyle(el).display), 'none', 'host content still prints');
    await page.emulateMedia({ media: 'screen' });
    await page.locator('#e3-helper-syllabus-modal').evaluate(el => el.remove());

    await page.locator('#e3-helper-close-btn').click();
    assert.equal(await page.locator('.e3-helper-sidebar').evaluate(el => el.classList.contains('expanded')), false);
    await page.mouse.move(0, 0);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForFunction(() => document.querySelector('.e3-helper-sidebar-toggle')?.getBoundingClientRect().width <= 50);
    const narrowDesktop = await getLauncher();
    assert.ok(narrowDesktop.width <= 50 && narrowDesktop.right === 375, 'compact launcher remains visible in narrow viewport');
    await launcher.click();
    assert.ok(await page.locator('.e3-helper-sidebar').evaluate(el => el.classList.contains('expanded')), 'compact launcher reopens sidebar');

    // A real touch-capable viewport must not retain the hover-expanded width after tap.
    const touchPage = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
    const touchErrors = [];
    touchPage.on('pageerror', error => touchErrors.push(error.message));
    await prepare(touchPage);
    assert.equal(await touchPage.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), false, 'touch context should not match fine hover');
    const touchLauncher = touchPage.locator('.e3-helper-sidebar-toggle');
    await touchLauncher.tap();
    assert.ok(await touchPage.locator('.e3-helper-sidebar').evaluate(el => el.classList.contains('expanded')), 'touch opens sidebar');
    await touchPage.locator('#e3-helper-close-btn').tap();
    assert.equal(await touchPage.locator('.e3-helper-sidebar').evaluate(el => el.classList.contains('expanded')), false, 'touch closes sidebar');
    const touchWidth = await touchLauncher.evaluate(el => el.getBoundingClientRect().width);
    assert.ok(touchWidth >= 40 && touchWidth <= 50, 'touch leaves the launcher compact, even after tap');
    assert.equal(await touchLauncher.evaluate(el => getComputedStyle(el.querySelector('.e3-helper-toggle-text')).display), 'none', 'touch keeps label folded after programmatic focus');
    await touchLauncher.tap();
    assert.ok(await touchPage.locator('.e3-helper-sidebar').evaluate(el => el.classList.contains('expanded')), 'touch reopens sidebar');
    assert.deepEqual(touchErrors, []);
    await touchPage.close();

    assert.deepEqual(errors, []);
    console.log('Passed: host CSS, settled hover expansion, touch tap/reopen, syllabus print hiding, and desktop sidebar behavior.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
