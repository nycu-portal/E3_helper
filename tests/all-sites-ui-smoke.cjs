const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const data = {}, listeners = [];
      window.grantAccess = false;
      window.chrome = {
        runtime: { getManifest: () => ({ optional_permissions: ['scripting'] }), sendMessage: async () => ({ success: true }) },
        permissions: { request: async () => window.grantAccess },
        storage: { onChanged: { addListener: fn => listeners.push(fn) }, local: {
          get: async () => data,
          set: async update => { Object.assign(data, update); listeners.forEach(fn => fn(Object.fromEntries(Object.entries(update).map(([k, v]) => [k, { newValue: v }])), 'local')); }
        } }
      };
    });
    await page.goto('about:blank');
    for (const file of ['i18n.js', 'all-sites-setting.js']) await page.addScriptTag({ path: path.join(__dirname, '..', file) });
    await page.evaluate(async () => { const container = document.createElement('div'); container.id = 'settings'; document.body.append(container); await E3AllSitesSetting.mount(container); });
    const input = page.locator('#settings input');
    assert.equal(await input.isChecked(), false);
    await input.click();
    await page.waitForFunction(() => !document.querySelector('#settings input').disabled);
    assert.equal(await input.isChecked(), false);
    assert.match(await page.locator('[role=status]').textContent(), /未取得網站存取權|Website access was not granted/);
    await page.evaluate(() => { window.grantAccess = true; });
    await input.check(); await page.waitForFunction(() => !document.querySelector('#settings input').disabled);
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get()).showOnAllSites), true);
    await input.uncheck(); await page.waitForFunction(() => !document.querySelector('#settings input').disabled);
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get()).showOnAllSites), false);
    console.log('PASS: default off, denied grant stays off, explicit enable and disable');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
