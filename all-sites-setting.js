(() => {
  globalThis.E3AllSitesSetting = {
    async mount(container) {
      if (!container || !chrome.runtime.getManifest?.()?.optional_permissions?.includes('scripting')) return;
      const t = E3HelperI18n.text;
      // Chrome exposes permissions.request only to extension pages, not content scripts.
      if (!chrome.permissions?.request) {
        container.innerHTML = E3HelperI18n.template`<section class="card e3-helper-settings-section"><h3>在所有網站顯示浮動按鈕</h3><p>預設關閉。請在擴充功能設定頁開啟並允許網站存取權。</p><button type="button" class="e3-helper-log-btn">開啟網站顯示設定</button><p role="status" aria-live="polite"></p></section>`;
        container.querySelector('button').addEventListener('click', async () => {
          try {
            await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ action: 'openNotificationSettings' }, response => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else if (!response?.success) reject(new Error(t('無法開啟通知設定。')));
                else resolve();
              });
            });
          } catch (error) { container.querySelector('[role=status]').textContent = error.message; }
        });
        return;
      }
      container.innerHTML = E3HelperI18n.template`<section class="card e3-helper-settings-section"><label class="setting-row e3-helper-setting-label"><input type="checkbox" role="switch"><span><strong>在所有網站顯示浮動按鈕</strong><p>預設關閉。開啟後可在 Google 等一般網站查看已同步的作業；Chrome 內部頁面不支援。</p></span></label><p>${E3HelperI18n.text('此開關立即儲存。')}</p><p role="status" aria-live="polite"></p></section>`;
      const input = container.querySelector('input');
      const status = container.querySelector('[role=status]');
      input.checked = (await chrome.storage.local.get('showOnAllSites')).showOnAllSites === true;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.showOnAllSites) input.checked = changes.showOnAllSites.newValue === true;
      });
      input.addEventListener('change', async () => {
        const enabled = input.checked;
        input.disabled = true;
        try {
          // Invoke directly from the user's click, before awaiting any storage work.
          if (enabled && !await chrome.permissions.request({ permissions: ['scripting'], origins: ['http://*/*', 'https://*/*'] })) {
            throw new Error(t('未取得網站存取權，設定保持關閉。'));
          }
          await chrome.storage.local.set({ showOnAllSites: enabled });
          const response = await chrome.runtime.sendMessage({ action: 'applyAllSitesSetting' });
          if (!response?.success) throw new Error(response?.error || t('儲存失敗，請再試一次。'));
          status.textContent = t('設定已儲存！');
        } catch (error) {
          if (enabled) await chrome.storage.local.set({ showOnAllSites: false });
          input.checked = (await chrome.storage.local.get('showOnAllSites')).showOnAllSites === true;
          status.textContent = error.message;
        } finally { input.disabled = false; }
      });
    }
  };
})();
