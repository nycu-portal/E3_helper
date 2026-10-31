// Only this extension-owned page may initialize the cached coursework UI off campus.
globalThis.E3HelperAllSitesFrame = true;
document.addEventListener('click', event => {
  if (event.target.closest?.('#e3-helper-close-btn')) parent.postMessage({ type: 'e3-helper-close' }, '*');
}, true);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.showOnAllSites && changes.showOnAllSites.newValue !== true) document.body.replaceChildren();
});
