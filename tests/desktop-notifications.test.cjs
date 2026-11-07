const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../desktop-notifications.js'), 'utf8');
function load(response = { success: true, permission: 'granted' }, permissions = ['nativeMessaging'], callbackOnly = false, transportError = '') {
  const messages = [];
  const context = vm.createContext({ URL, chrome: { runtime: {
    getURL: p => `safari-web-extension://test/${p}`,
    getManifest: () => ({ permissions }),
    sendNativeMessage: (app, value, callback) => {
      messages.push({ app, value });
      if (!callbackOnly) return Promise.resolve(response);
      queueMicrotask(() => {
        context.chrome.runtime.lastError = transportError ? { message: transportError } : undefined;
        callback(response);
        delete context.chrome.runtime.lastError;
      });
      return undefined;
    }
  } } });
  vm.runInContext(source, context);
  return { adapter: context.E3DesktopNotifications, messages };
}
test('Safari native transport supports permission and desktop delivery without browser notifications API', async () => {
  const { adapter, messages } = load();
  assert.equal(adapter.supported, true);
  assert.equal(await adapter.authorize(), 'granted');
  await adapter.create('test', { title: 'Reminder', message: 'Deadline' }, 'https://e3p.nycu.edu.tw/');
  assert.equal(messages[0].value.action, 'authorizeNotifications');
  assert.equal(messages[1].value.action, 'showNotification');
  assert.equal(messages[1].value.url, 'https://e3p.nycu.edu.tw/');
});
test('iPad without nativeMessaging disables desktop delivery despite the Safari API existing', async () => {
  const { adapter, messages } = load(undefined, ['storage', 'alarms']);
  assert.equal(adapter.supported, false);
  assert.equal(adapter.native, false);
  assert.equal(await adapter.authorize(), 'denied');
  assert.equal(messages.length, 0);
});
test('native errors are surfaced rather than marking delivery successful', async () => {
  const { adapter } = load({ success: false, error: 'permission denied' });
  await assert.rejects(adapter.create('test', { title: 'test', message: '' }), /permission denied/);
});

test('manual assignment placeholder links use E3 home in native notifications', async () => {
  const { adapter, messages } = load();
  for (const url of [undefined, '', '#']) {
    await adapter.create('manual', { title: 'Manual assignment', message: 'Due soon' }, url);
    assert.equal(messages.at(-1).value.url, 'https://e3p.nycu.edu.tw/');
  }
});
test('native notification transport rejects unsafe links before dispatch', async () => {
  const { adapter, messages } = load();
  for (const url of ['javascript:alert(1)', 'http://e3.nycu.edu.tw/', 'https://evil.test/', 'https://user@e3p.nycu.edu.tw/']) {
    await assert.rejects(adapter.create('manual', { title: 'Reminder', message: '' }, url), /Invalid notification URL/);
  }
  assert.equal(messages.length, 0);
});

test('callback-only Safari native messaging supports status, authorization and delivery', async () => {
  const { adapter, messages } = load(undefined, undefined, true);
  assert.equal(await adapter.getPermissionLevel(), 'granted');
  assert.equal(await adapter.authorize(), 'granted');
  await adapter.create('callback', { title: 'Reminder', message: 'Due' }, '#');
  assert.deepEqual(messages.map(item => item.value.action), ['notificationStatus', 'authorizeNotifications', 'showNotification']);
});
test('callback-only Safari messaging surfaces runtime.lastError', async () => {
  const { adapter } = load(undefined, undefined, true, 'Native host disconnected');
  await assert.rejects(adapter.authorize(), /Native host disconnected/);
});
