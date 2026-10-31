// Optional Chrome-wide sidebar. No broad site access is requested at installation.
(() => {
  if (!chrome.runtime.getManifest().optional_permissions?.includes('scripting')) return;
  const id = 'e3-helper-all-sites';
  const origins = ['http://*/*', 'https://*/*'];
  const excludeMatches = ['https://e3.nycu.edu.tw/*', 'https://e3p.nycu.edu.tw/*',
    'https://timetable.nycu.edu.tw/*', 'https://portal.nycu.edu.tw/*'];
  const files = ['all-sites-bootstrap.js'];
  let queue = Promise.resolve();
  function reconcile() {
    const work = queue.catch(() => {}).then(async () => {
      const { showOnAllSites } = await chrome.storage.local.get('showOnAllSites');
      const enabled = showOnAllSites === true && await chrome.permissions.contains({ permissions: ['scripting'], origins });
      if (!enabled) {
        if (showOnAllSites === true) await chrome.storage.local.set({ showOnAllSites: false });
        if (chrome.scripting?.getRegisteredContentScripts) {
          const old = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
          if (old.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
        }
        const granted = await chrome.permissions.getAll();
        const broad = (granted.origins || []).filter(origin => origins.includes(origin) || origin === '*://*/*' || origin === '<all_urls>');
        if (broad.length && chrome.scripting?.executeScript) {
          const tabs = await chrome.tabs.query({ url: origins });
          await Promise.allSettled(tabs.filter(tab => tab.id && !excludeMatches.some(pattern => tab.url?.startsWith(pattern.slice(0, -1)))).map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files })));
        }
        if ((await chrome.storage.local.get('showOnAllSites')).showOnAllSites === true) return;
        if (broad.length && !await chrome.permissions.remove({ origins: broad })) throw new Error('Unable to revoke all-websites access. Check extension site access in your browser.');
        return;
      }
      if (!chrome.scripting?.registerContentScripts) throw new Error('This setting requires Chrome 96 or later.');
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
      // Replace the older registration that injected private DOM into host pages.
      if (registered.length && JSON.stringify(registered[0].js) !== JSON.stringify(files)) {
        await chrome.scripting.unregisterContentScripts({ ids: [id] });
        registered.length = 0;
      }
      if (registered.length) return;
      await chrome.scripting.registerContentScripts([{
        id, matches: origins, excludeMatches, js: files, runAt: 'document_idle', persistAcrossSessions: true
      }]);
      // Also make the button available in already-open ordinary pages.
      const tabs = await chrome.tabs.query({ url: origins });
      await Promise.allSettled(tabs.filter(tab => tab.id && !excludeMatches.some(pattern =>
        tab.url?.startsWith(pattern.slice(0, -1)))).map(tab => chrome.scripting.executeScript({
        target: { tabId: tab.id }, files
      })));
    });
    queue = work;
    return work;
  }
  const schedule = () => { reconcile().catch(error => console.warn('E3 Helper: all-sites setting', error)); };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.showOnAllSites) schedule();
  });
  chrome.permissions.onRemoved.addListener(schedule);
  chrome.runtime.onInstalled.addListener(schedule);
  chrome.runtime.onStartup.addListener(schedule);
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'applyAllSitesSetting' || sender.id !== chrome.runtime.id) return;
    reconcile().then(() => sendResponse({ success: true }), error => sendResponse({ success: false, error: error.message }));
    return true;
  });
  schedule();
})();
