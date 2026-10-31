// Third-party pages receive no coursework, settings, localization or API keys.
// Private UI is created only after a click, in an extension-origin document.
(() => {
  if (!['http:', 'https:'].includes(location.protocol) || globalThis.E3AllSitesLauncher) return;
  let host, frame, disposed = false, launcherTop = 100;
  const clampTop = top => Math.max(10, Math.min(Math.max(10, window.innerHeight - 60), top));
  const positionLauncher = () => {
    launcherTop = clampTop(launcherTop);
    if (host && !frame) host.style.setProperty('top', `${launcherTop}px`, 'important');
  };
  // Extension updates reset the isolated world but can leave its closed-shadow host in open tabs.
  const clearLegacyUI = () => document.querySelectorAll('#e3-helper-all-sites-host, .e3-helper-sidebar, .e3-helper-sidebar-toggle, .e3-helper-log-modal, .e3-helper-toast, #e3-helper-add-assignment-modal, #e3-helper-changelog-modal').forEach(node => node.remove());
  const cleanup = () => {
    disposed = true;
    host?.remove();
    clearLegacyUI();
    chrome.storage.onChanged.removeListener(changed);
    window.removeEventListener('message', message);
    window.removeEventListener('resize', positionLauncher);
    delete globalThis.E3AllSitesLauncher;
  };
  const changed = (changes, area) => {
    if (area === 'local' && changes.showOnAllSites?.newValue !== true && changes.showOnAllSites) cleanup();
  };
  const close = () => {
    frame?.remove(); frame = null;
    host.style.setProperty('width', '46px', 'important');
    host.style.setProperty('height', '46px', 'important');
    positionLauncher();
    button.hidden = false;
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  };
  const message = event => {
    if (frame && event.source === frame.contentWindow && event.origin === new URL(chrome.runtime.getURL('128.png')).origin && event.data?.type === 'e3-helper-close') close();
  };
  globalThis.E3AllSitesLauncher = { cleanup };
  chrome.storage.onChanged.addListener(changed);
  window.addEventListener('message', message);
  let button;
  chrome.storage.local.get(['showOnAllSites', 'allSitesLauncherTop']).then(data => {
    if (disposed || data.showOnAllSites !== true) { cleanup(); return; }
    clearLegacyUI();
    if (Number.isFinite(data.allSitesLauncherTop)) launcherTop = data.allSitesLauncherTop;
    host = document.createElement('div');
    host.id = 'e3-helper-all-sites-host';
    for (const [key, value] of Object.entries({ all: 'initial', position: 'fixed', right: '0', left: 'auto', top: '100px', bottom: 'auto', width: '46px', height: '46px', margin: '0', padding: '0', border: '0', display: 'block', 'z-index': '2147483647', 'color-scheme': 'light', transform: 'none' })) host.style.setProperty(key, value, 'important');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { contain: layout style; }
      @media print { :host { display: none !important; } }
      button { box-sizing:border-box; position:absolute; right:0; top:0; width:132px; height:46px; min-width:132px; min-height:46px; margin:0; padding:0 13px; display:flex; align-items:center; justify-content:flex-start; gap:8px; border:1px solid #d7d3cb; border-right:0; border-radius:12px 0 0 12px; background:#b3261e; color:#ffffff; cursor:pointer; touch-action:none; user-select:none; font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; transform:translateX(86px); transition:transform 180ms cubic-bezier(.2,.8,.2,1); }
      button[hidden] { display:none; }
      button:hover, button:focus-visible { transform:translateX(0); }
      button span { opacity:0; transform:translateX(4px); transition:opacity 120ms ease, transform 160ms ease; pointer-events:none; white-space:nowrap; }
      button:hover span, button:focus-visible span { opacity:1; transform:translateX(0); }
      @media (prefers-reduced-motion: reduce) { button, button span { transition:none; } }
      svg { width:20px; height:20px; flex:none; color:#ffffff; }
      iframe { width:100%; height:100%; display:block; border:0; background:white; color-scheme:normal; }
    </style><button type="button" title="E3 Helper" aria-label="E3 Helper" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 5h6a2 2 0 0 1 2 2v14a3 3 0 0 0-3-3H4zM20 5h-6a2 2 0 0 0-2 2v14a3 3 0 0 1 3-3h5z"/></svg><span>E3 Helper</span></button>`;
    button = root.querySelector('button');
    let drag = null, suppressClick = false;
    button.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || frame) return;
      suppressClick = false;
      drag = { id: event.pointerId, y: event.clientY, top: launcherTop, moved: false };
      button.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    button.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const delta = event.clientY - drag.y;
      if (Math.abs(delta) > 3) drag.moved = true;
      if (!drag.moved) return;
      launcherTop = clampTop(drag.top + delta);
      positionLauncher();
      event.preventDefault();
    });
    button.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.id) return;
      suppressClick = drag.moved;
      if (drag.moved) chrome.storage.local.set({ allSitesLauncherTop: launcherTop }).catch(() => {});
      drag = null;
    });
    const cancelDrag = () => { drag = null; };
    button.addEventListener('pointercancel', cancelDrag);
    button.addEventListener('lostpointercapture', cancelDrag);
    button.addEventListener('click', event => {
      if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
      if (frame) return;
      host.style.setProperty('width', 'min(400px, 100vw)', 'important');
      host.style.setProperty('height', CSS.supports('height', '100dvh') ? '100dvh' : '100vh', 'important');
      host.style.setProperty('top', '0', 'important');
      button.setAttribute('aria-expanded', 'true');
      button.hidden = true;
      frame = document.createElement('iframe');
      frame.title = 'E3 Helper';
      frame.src = chrome.runtime.getURL('all-sites-panel.html');
      root.append(frame);
    });
    positionLauncher();
    window.addEventListener('resize', positionLauncher);
    (document.body || document.documentElement).append(host);
  }).catch(cleanup);
})();
