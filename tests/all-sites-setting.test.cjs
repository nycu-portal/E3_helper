const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../all-sites-setting.js'), 'utf8');
function load(error) {
  const data = {}, handlers = {}, input = {}, status = {}, actions = [];
  const runtime = {
    getManifest: () => ({ optional_permissions: ['scripting'] }),
    sendMessage(message, callback) {
      actions.push(message.action);
      if (typeof callback === 'function') queueMicrotask(() => {
        runtime.lastError = error ? { message: error } : undefined;
        callback({ success: true });
        delete runtime.lastError;
      });
      return undefined;
    }
  };
  input.addEventListener = (name, handler) => { handlers[name] = handler; };
  const container = { querySelector: selector => selector === 'input' ? input : status };
  const context = vm.createContext({ chrome: { runtime, permissions: { request: async () => true }, storage: {
    local: { get: async () => data, set: async update => Object.assign(data, update) }, onChanged: { addListener() {} }
  } }, E3HelperI18n: { text: value => value, template: (parts, ...values) => String.raw({ raw: parts }, ...values) } });
  vm.runInContext(source, context);
  return { mount: () => context.E3AllSitesSetting.mount(container), input, status, data, actions, change: enabled => { input.checked = enabled; return handlers.change(); } };
}
test('callback-only runtime messaging enables and disables all-sites settings', async () => {
  const fixture = load();
  await fixture.mount();
  for (const enabled of [true, false]) {
    await fixture.change(enabled);
    assert.equal(fixture.data.showOnAllSites, enabled);
    assert.equal(fixture.status.textContent, '設定已儲存！');
    assert.equal(fixture.input.disabled, false);
  }
  assert.deepEqual(fixture.actions, ['applyAllSitesSetting', 'applyAllSitesSetting']);
});
test('runtime.lastError is surfaced and failed enable rolls back', async () => {
  const fixture = load('Message port closed');
  await fixture.mount();
  await fixture.change(true);
  assert.equal(fixture.data.showOnAllSites, false);
  assert.equal(fixture.status.textContent, 'Message port closed');
  assert.equal(fixture.input.checked, false);
  assert.equal(fixture.input.disabled, false);
});
