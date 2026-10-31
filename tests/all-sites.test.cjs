const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function fixture(enabled = false, granted = false, canRevoke = true) {
  const data = { showOnAllSites: enabled }, registrations = [], injections = [], removals = [];
  const events = {};
  const event = name => ({ addListener(fn) { (events[name] ||= []).push(fn); } });
  const chrome = {
    runtime: { id: 'test', getManifest: () => ({ optional_permissions: ['scripting'], content_scripts: [{ js: ['jszip.min.js', 'i18n.js', 'exam-detection.js', 'all-sites-setting.js', 'content.js'] }] }),
      onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    storage: { local: { get: async () => data, set: async value => Object.assign(data, value) }, onChanged: event('storage') },
    permissions: { contains: async () => granted, getAll: async () => ({ origins: granted ? ['http://*/*', 'https://*/*'] : [] }), remove: async request => { removals.push(request); if (!canRevoke) return false; granted = false; return true; }, onRemoved: event('removed') },
    scripting: {
      getRegisteredContentScripts: async () => registrations,
      registerContentScripts: async scripts => registrations.push(...scripts),
      unregisterContentScripts: async () => { registrations.length = 0; },
      executeScript: async details => { injections.push(details); if (details.target.tabId === 3) throw Error('Restricted page'); }
    },
    tabs: { query: async () => [{ id: 1, url: 'https://www.google.com/' }, { id: 2, url: 'https://e3p.nycu.edu.tw/' }, { id: 3, url: 'https://chromewebstore.google.com/' }] }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'all-sites.js'), 'utf8'), { chrome, console });
  const apply = () => new Promise(resolve => events.message[0]({ action: 'applyAllSitesSetting' }, { id: 'test' }, resolve));
  return { data, registrations, injections, removals, apply, grant(value) { granted = value; } };
}
test('default does not register scripts or touch ordinary tabs', async () => {
  const app = fixture(); assert.equal((await app.apply()).success, true);
  assert.equal(app.registrations.length, 0); assert.equal(app.injections.length, 0);
});
test('all-sites requires opt-in AND granted permissions; revocation restores default', async () => {
  const denied = fixture(true, false); await denied.apply();
  assert.equal(denied.registrations.length, 0); assert.equal(denied.data.showOnAllSites, false);
  const app = fixture(true, true); await app.apply();
  assert.equal(app.registrations.length, 1);
  assert.deepEqual(Array.from(app.registrations[0].js), ['all-sites-bootstrap.js']);
  assert.equal(app.registrations[0].allFrames, undefined);
  assert.equal(app.injections.length, 2); // E3 is excluded; restricted-page errors are tolerated.
  await app.apply(); assert.equal(app.injections.length, 2); // Idempotent.
  app.grant(false); await app.apply();
  assert.equal(app.registrations.length, 0); assert.equal(app.data.showOnAllSites, false);
});
test('switching off unregisters future injection without changing default hosts', async () => {
  const app = fixture(true, true); await app.apply();
  app.data.showOnAllSites = false; await app.apply(); assert.equal(app.registrations.length, 0);
  assert.ok(app.removals.some(request => request.origins.includes('https://*/*')), 'Disabling must revoke broad website permission');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.ok(!manifest.host_permissions.includes('https://*/*'));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(!manifest.permissions.includes('scripting'));
});

test('failed permission removal is reported while leaving injection disabled', async () => {
  const app = fixture(true, true, false); await app.apply();
  app.data.showOnAllSites = false;
  const result = await app.apply();
  assert.equal(result.success, false);
  assert.match(result.error, /Unable to revoke/);
  assert.equal(app.registrations.length, 0);
  assert.equal(app.data.showOnAllSites, false);
});
test('upgrades replace old full-content registration with the private-data-free launcher', async () => {
  const app = fixture(true, true);
  app.registrations.push({ id: 'e3-helper-all-sites', js: ['content.js'] });
  await app.apply();
  assert.deepEqual(Array.from(app.registrations[0].js), ['all-sites-bootstrap.js']);
});

test('ordinary websites cannot initialize private content even with forged marker names', () => {
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  for (const url of ['https://www.google.com/', 'https://e3p.nycu.edu.tw.evil.test/']) {
    vm.runInNewContext(source, { location: new URL(url), E3HelperAllSites: true, E3HelperAllSitesFrame: true });
  }
});
test('only the extension panel entry is web accessible and all of its local dependencies exist', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ['all-sites-panel.html']);
  assert.equal(manifest.web_accessible_resources[0].use_dynamic_url, true);
  const html = fs.readFileSync(path.join(root, 'all-sites-panel.html'), 'utf8');
  for (const [, resource] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, resource)), resource);
});
