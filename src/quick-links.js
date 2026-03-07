import { ICONS } from './icons.js';
import { settingsManager } from './settings.js';

document.addEventListener('DOMContentLoaded', function () {
  const quickLinksContainer = document.getElementById('quick-links');
  // 添加快捷链接专用的状态变量
  let quickLinkToDelete = null;
  const MAX_FIXED_SHORTCUTS = 10;


  function faviconURL(u) {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", u);
    url.searchParams.set("size", "32");
    url.searchParams.set("cache", "1");
    return url.toString();
  }

  function getSiteName(title, url) {
    const MAX_WIDTH_EN = 16; // 英文最大宽度
    const MAX_WIDTH_CN = 14; // 中文最大宽度（允许7个中文字符）
    const MAX_WIDTH_MIXED = 15; // 混合语言最大宽度

    function getVisualWidth(str) {
        return str.split('').reduce((width, char) => {
            return width + (/[\u4e00-\u9fa5]/.test(char) ? 2 : 1);
        }, 0);
    }

    function cleanTitle(title) {
        if (!title || typeof title !== 'string') return '';
        
        // 移除常见的无用后缀
        title = title.replace(/\s*[-|·:]\s*.*$/, '');
        
        // 移除常见的网站后缀保留有效的标题部分
        title = title.replace(/\s*(官方网站|首页|网|网站|官网)$/, '');
        
        // 如果标题太长，尝试提取品牌名
        if (title.length > 20) {
            const parts = title.split(/\s+/);
            title = parts.length > 1 ? parts.slice(0, 2).join(' ') : title.substring(0, 20);
        }
        
        // 如果清理后仍为空，返回原始标题的某种变体
        const cleanedTitle = title.trim();
        if (cleanedTitle === '') {
            return title;
        }
        
        return cleanedTitle;
    }

    title = cleanTitle(title);

    // 处理标题
    if (title && title.trim() !== '') {
        const visualWidth = getVisualWidth(title);
        const chineseCharCount = (title.match(/[\u4e00-\u9fa5]/g) || []).length;
        const chineseRatio = chineseCharCount / title.length;

        let maxWidth;
        if (chineseRatio === 0) {
            maxWidth = MAX_WIDTH_EN;
        } else if (chineseRatio === 1) {
            maxWidth = MAX_WIDTH_CN;
        } else {
            maxWidth = Math.round(MAX_WIDTH_MIXED * (1 - chineseRatio) + MAX_WIDTH_CN * chineseRatio / 2);
        }

        if (visualWidth > maxWidth) {
            let truncated = '';
            let currentWidth = 0;
            for (let char of title) {
                const charWidth = /[\u4e00-\u9fa5]/.test(char) ? 2 : 1;
                if (currentWidth + charWidth > maxWidth) break;
                truncated += char;
                currentWidth += charWidth;
            }
            return truncated; // 返回截断后的标题
        }
        return title; // 返回清理后的标题
    } else {
        // 处理 URL
        try {
            const hostname = new URL(url).hostname;
            let name = hostname.replace(/^www\./, '').split('.')[0];
            name = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ');
            return getVisualWidth(name) > MAX_WIDTH_EN ? name.substring(0, MAX_WIDTH_EN) : name;
        } catch (error) {
            return 'Unknown Site';
        }
    }
  }

  function t(key, fallback) {
    return chrome.i18n.getMessage(key) || fallback;
  }

  function normalizeShortcutUrl(url) {
    const trimmedUrl = (url || '').trim();
    if (!trimmedUrl) return '';
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmedUrl)) {
      return trimmedUrl;
    }
    return `https://${trimmedUrl}`;
  }

  function isQuickLinksLimitReached(shortcuts) {
    return shortcuts.length >= MAX_FIXED_SHORTCUTS;
  }

  function showQuickLinksLimitToast() {
    showToast(t('quickLinksLimitReached', `最多添加 ${MAX_FIXED_SHORTCUTS} 个快捷标签，请先删除一个再继续`));
  }

  function normalizeFixedShortcut(shortcut, index = 0) {
    if (!shortcut) return null;

    const url = normalizeShortcutUrl(shortcut.url);
    const name = (shortcut.name || shortcut.title || '').trim();
    if (!url || !name) {
      return null;
    }

    return {
      name,
      url,
      favicon: faviconURL(url),
      fixed: true,
      order: Number.isFinite(shortcut.order) ? shortcut.order : index
    };
  }

  async function saveFixedShortcuts(shortcuts) {
    const normalizedShortcuts = shortcuts
      .map((shortcut, index) => normalizeFixedShortcut(shortcut, index))
      .filter(Boolean)
      .map((shortcut, index) => ({ ...shortcut, order: index }));

    await new Promise((resolve) => {
      chrome.storage.sync.set({ fixedShortcuts: normalizedShortcuts }, resolve);
    });

    return normalizedShortcuts;
  }

  // 获取固定的快捷方式
  function getFixedShortcuts() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('fixedShortcuts', (result) => {
        const fixedShortcuts = (result.fixedShortcuts || [])
          .map((shortcut, index) => normalizeFixedShortcut(shortcut, index))
          .filter(Boolean)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        resolve(fixedShortcuts);
      });
    });
  }

  async function addFixedShortcut(site) {
    const fixedShortcuts = await getFixedShortcuts();
    const normalizedSite = normalizeFixedShortcut(site, fixedShortcuts.length);
    if (!normalizedSite) return false;

    const existingIndex = fixedShortcuts.findIndex(shortcut => shortcut.url === normalizedSite.url);
    if (existingIndex === -1 && isQuickLinksLimitReached(fixedShortcuts)) {
      showQuickLinksLimitToast();
      return false;
    }
    if (existingIndex !== -1) {
      fixedShortcuts[existingIndex] = normalizedSite;
    } else {
      fixedShortcuts.push(normalizedSite);
    }

    await saveFixedShortcuts(fixedShortcuts);
    await generateQuickLinks();
    return true;
  }

  // 更新固定的快捷方式
  async function updateFixedShortcut(updatedSite, oldUrl) {
    const fixedShortcuts = await getFixedShortcuts();
    const normalizedSite = normalizeFixedShortcut(updatedSite);
    if (!normalizedSite) return;

    const index = fixedShortcuts.findIndex(shortcut => shortcut.url === oldUrl);
    if (index !== -1) {
      fixedShortcuts[index] = normalizedSite;
    } else {
      fixedShortcuts.push(normalizedSite);
    }

    await saveFixedShortcuts(fixedShortcuts);
    refreshQuickLink(normalizedSite, oldUrl);
    await generateQuickLinks();
  }

  async function removeFixedShortcut(url) {
    const fixedShortcuts = await getFixedShortcuts();
    const updatedShortcuts = fixedShortcuts.filter(shortcut => shortcut.url !== url);
    await saveFixedShortcuts(updatedShortcuts);
    await generateQuickLinks();
  }

  async function generateQuickLinks() {
    const fixedShortcuts = await getFixedShortcuts();
    renderQuickLinks(fixedShortcuts);
    renderQuickLinksManager(fixedShortcuts);
  }


  let quickLinksManagerList = null;
  let quickLinksManagerEmpty = null;
  let quickLinksManagerSortable = null;
  let homepageQuickLinksSortable = null;

  function ensureHomepageQuickLinksSortable() {
    const isHomepage = window.location.pathname.endsWith('index.html');
    if (!isHomepage || typeof Sortable === 'undefined' || !quickLinksContainer || homepageQuickLinksSortable) {
      return;
    }

    homepageQuickLinksSortable = new Sortable(quickLinksContainer, {
      animation: 150,
      draggable: '.quick-link-item-container:not(.quick-link-add-entry)',
      onEnd: async () => {
        const orderedUrls = Array.from(
          quickLinksContainer.querySelectorAll('.quick-link-item-container:not(.quick-link-add-entry)')
        )
          .map(item => item.dataset.url)
          .filter(Boolean);

        const currentShortcuts = await getFixedShortcuts();
        const shortcutMap = new Map(currentShortcuts.map(shortcut => [shortcut.url, shortcut]));
        const reorderedShortcuts = orderedUrls
          .map(url => shortcutMap.get(url))
          .filter(Boolean);

        if (reorderedShortcuts.length !== currentShortcuts.length) {
          return;
        }

        await saveFixedShortcuts(reorderedShortcuts);
        await generateQuickLinks();
      }
    });
  }


  function openQuickLinkDialog(site = null) {
    const editDialog = document.getElementById('edit-dialog');
    const editNameInput = document.getElementById('edit-name');
    const editUrlInput = document.getElementById('edit-url');
    const editDialogTitle = editDialog.querySelector('h2');
    const isEditMode = Boolean(site);

    editDialogTitle.textContent = isEditMode
      ? t('editDialogTitle', '编辑快捷标签')
      : t('addQuickLinkButton', '添加快捷标签');

    editNameInput.value = site?.name || '';
    editUrlInput.value = site?.url || '';
    editDialog.style.display = 'block';

    document.getElementById('edit-form').onsubmit = async function(event) {
      event.preventDefault();
      const newName = editNameInput.value.trim();
      const newUrl = normalizeShortcutUrl(editUrlInput.value.trim());

      if (newName && newUrl) {
        const updatedSite = {
          name: newName,
          url: newUrl,
          favicon: faviconURL(newUrl),
          fixed: true
        };

        if (isEditMode) {
          await updateFixedShortcut(updatedSite, site.url);
        } else {
          const added = await addFixedShortcut(updatedSite);
          if (!added) {
            return;
          }
        }

        editDialog.style.display = 'none';
      }
    };

    document.querySelector('.cancel-button').onclick = function() {
      editDialog.style.display = 'none';
    };

    document.querySelector('.close-button').onclick = function() {
      editDialog.style.display = 'none';
    };
  }

  function ensureQuickLinksManager() {
    const quickLinksSettings = document.getElementById('quick-links-settings');
    if (!quickLinksSettings || document.getElementById('quick-links-manager')) {
      return;
    }

    const manager = document.createElement('div');
    manager.id = 'quick-links-manager';
    manager.className = 'quick-links-manager';
    manager.innerHTML = `
      <div class="quick-links-manager-header">
        <div>
          <h4 class="quick-links-manager-title">${t('manageQuickLinksTitle', '固定快捷标签')}</h4>
          <p class="quick-links-manager-hint">${t('quickLinksManagerHint', '这里的标签完全由你自己管理，不会再根据访问频率自动变化。')}</p>
        </div>
        <button type="button" class="quick-links-add-button">${t('addQuickLinkButton', '添加快捷标签')}</button>
      </div>
      <div class="quick-links-manager-empty"></div>
      <div id="quick-links-manager-list" class="quick-links-manager-list"></div>
    `;

    quickLinksSettings.appendChild(manager);
    quickLinksManagerList = manager.querySelector('#quick-links-manager-list');
    quickLinksManagerEmpty = manager.querySelector('.quick-links-manager-empty');
    manager.querySelector('.quick-links-add-button').addEventListener('click', async () => {
      const shortcuts = await getFixedShortcuts();
      if (isQuickLinksLimitReached(shortcuts)) {
        showQuickLinksLimitToast();
        return;
      }
      openQuickLinkDialog();
    });

    if (typeof Sortable !== 'undefined' && quickLinksManagerList && !quickLinksManagerSortable) {
      quickLinksManagerSortable = new Sortable(quickLinksManagerList, {
        animation: 150,
        handle: '.quick-links-manager-drag',
        onEnd: async () => {
          const currentShortcuts = await getFixedShortcuts();
          const shortcutMap = new Map(currentShortcuts.map(shortcut => [shortcut.url, shortcut]));
          const reorderedShortcuts = Array.from(quickLinksManagerList.children)
            .map(item => shortcutMap.get(item.dataset.url))
            .filter(Boolean);
          await saveFixedShortcuts(reorderedShortcuts);
          await generateQuickLinks();
        }
      });
    }
  }

  function renderQuickLinksManager(shortcuts) {
    ensureQuickLinksManager();
    if (!quickLinksManagerList || !quickLinksManagerEmpty) {
      return;
    }

    quickLinksManagerList.innerHTML = '';
    quickLinksManagerEmpty.textContent = '';

    const addButton = document.querySelector('#quick-links-manager .quick-links-add-button');
    if (addButton) {
      addButton.classList.toggle('disabled', isQuickLinksLimitReached(shortcuts));
      addButton.title = isQuickLinksLimitReached(shortcuts)
        ? t('quickLinksLimitReached', `最多添加 ${MAX_FIXED_SHORTCUTS} 个快捷标签，请先删除一个再继续`)
        : '';
    }

    if (shortcuts.length === 0) {
      quickLinksManagerEmpty.textContent = t('quickLinksEmptyState', '暂未添加快捷标签');
      quickLinksManagerEmpty.style.display = 'block';
      return;
    }

    quickLinksManagerEmpty.style.display = 'none';
    const fragment = document.createDocumentFragment();

    shortcuts.forEach(shortcut => {
      const item = document.createElement('div');
      item.className = 'quick-links-manager-item';
      item.dataset.url = shortcut.url;

      const dragButton = document.createElement('button');
      dragButton.type = 'button';
      dragButton.className = 'quick-links-manager-drag';
      dragButton.setAttribute('aria-label', 'drag');
      dragButton.textContent = '⋮⋮';

      const meta = document.createElement('div');
      meta.className = 'quick-links-manager-meta';

      const name = document.createElement('div');
      name.className = 'quick-links-manager-name';
      name.textContent = shortcut.name;

      const url = document.createElement('div');
      url.className = 'quick-links-manager-url';
      url.textContent = shortcut.url;

      meta.appendChild(name);
      meta.appendChild(url);

      const actions = document.createElement('div');
      actions.className = 'quick-links-manager-actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'quick-links-manager-button edit';
      editButton.textContent = t('editQuickLink', '编辑');
      editButton.addEventListener('click', () => openQuickLinkDialog(shortcut));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'quick-links-manager-button delete';
      deleteButton.textContent = t('deleteQuickLink', '删除');
      deleteButton.addEventListener('click', () => confirmDeleteQuickLink(shortcut));

      actions.appendChild(editButton);
      actions.appendChild(deleteButton);

      item.appendChild(dragButton);
      item.appendChild(meta);
      item.appendChild(actions);
      fragment.appendChild(item);
    });

    quickLinksManagerList.appendChild(fragment);
  }

  function createQuickLinksEmptyState() {
    const emptyState = document.createElement('div');
    emptyState.className = 'quick-links-empty-state';
    emptyState.innerHTML = `
      <div class="quick-links-empty-title">${t('quickLinksEmptyState', '暂未添加快捷标签')}</div>
      <button type="button" class="quick-links-empty-button">${t('addQuickLinkButton', '添加快捷标签')}</button>
    `;
    emptyState.querySelector('.quick-links-empty-button').addEventListener('click', () => openQuickLinkDialog());
    return emptyState;
  }

  // 3. 优化渲染函数，使用 DocumentFragment 减少重排
  function renderQuickLinks(shortcuts) {
    const quickLinksContainer = document.getElementById('quick-links');
    const fragment = document.createDocumentFragment();
    
    quickLinksContainer.innerHTML = '';

    if (!shortcuts || shortcuts.length === 0) {
      quickLinksContainer.appendChild(createQuickLinksEmptyState());
      ensureHomepageQuickLinksSortable();
      return;
    }

    shortcuts.forEach((site) => {
      const linkItem = document.createElement('div');
      linkItem.className = 'quick-link-item-container';
      linkItem.dataset.url = site.url;

      const link = document.createElement('a');
      link.href = site.url;
      link.className = 'quick-link-item';
      
      link.addEventListener('click', async function(event) {
        event.preventDefault();
        
        try {
          const isSidePanel = window.location.pathname.endsWith('sidepanel.html');

          if (isSidePanel) {
            chrome.storage.sync.get(['sidepanelOpenInNewTab', 'sidepanelOpenInSidepanel'], (result) => {
              const openInNewTab = result.sidepanelOpenInNewTab !== false;
              const openInSidepanel = result.sidepanelOpenInSidepanel === true;
              
              if (openInSidepanel) {
                try {
                  if (typeof SidePanelManager === 'undefined') {
                    const sidePanelContent = document.getElementById('side-panel-content');
                    const sidePanelIframe = document.getElementById('side-panel-iframe');
                    
                    if (sidePanelContent && sidePanelIframe) {
                      sidePanelContent.style.display = 'block';
                      sidePanelIframe.src = site.url;
                      
                      let backButton = document.querySelector('.back-to-links');
                      if (!backButton) {
                        backButton = document.createElement('div');
                        backButton.className = 'back-to-links';
                        backButton.innerHTML = '<span class="material-icons">arrow_back</span>';
                        document.body.appendChild(backButton);
                        backButton.addEventListener('click', () => {
                          sidePanelContent.style.display = 'none';
                          backButton.style.display = 'none';
                        });
                      }
                      
                      backButton.style.display = 'flex';
                    } else {
                      chrome.tabs.create({ url: site.url, active: true });
                    }
                  } else if (window.sidePanelManager) {
                    window.sidePanelManager.loadUrl(site.url);
                  } else {
                    window.sidePanelManager = new SidePanelManager();
                    window.sidePanelManager.loadUrl(site.url);
                  }
                } catch (error) {
                  chrome.tabs.create({ url: site.url, active: true });
                }
              } else if (openInNewTab) {
                chrome.tabs.create({ url: site.url, active: true });
              }
            });
          } else {
            chrome.storage.sync.get(['openInNewTab'], (result) => {
              if (result.openInNewTab !== false) {
                window.open(site.url, '_blank');
              } else {
                window.location.href = site.url;
              }
            });
          }
        } catch (error) {
          console.error('[Quick Link Click] Error:', error);
        }
      });

      const img = document.createElement('img');
      img.src = site.favicon || faviconURL(site.url);
      img.alt = `${site.name} Favicon`;
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        this.src = '../images/placeholder-icon.svg';
      });

      link.appendChild(img);

      const span = document.createElement('span');
      span.textContent = site.name;

      linkItem.appendChild(link);
      linkItem.appendChild(span);

      linkItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, site);
      });

      fragment.appendChild(linkItem);
    });

    const addEntry = document.createElement('div');
    addEntry.className = 'quick-link-item-container quick-link-add-entry';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'quick-link-item quick-link-add-tile';
    addButton.innerHTML = `<span class="quick-link-add-icon">${ICONS.add_circle}</span>`;

    const limitReached = isQuickLinksLimitReached(shortcuts);
    addButton.classList.toggle('disabled', limitReached);
    addButton.title = limitReached
      ? t('quickLinksLimitReached', `最多添加 ${MAX_FIXED_SHORTCUTS} 个快捷标签，请先删除一个再继续`)
      : '';
    addButton.addEventListener('click', () => {
      if (limitReached) {
        showQuickLinksLimitToast();
        return;
      }
      openQuickLinkDialog();
    });

    const addLabel = document.createElement('span');
    addLabel.className = 'quick-link-add-text';
    addLabel.textContent = t('addQuickLinkShort', '添加');

    addEntry.appendChild(addButton);
    addEntry.appendChild(addLabel);
    fragment.appendChild(addEntry);

    quickLinksContainer.appendChild(fragment);
    ensureHomepageQuickLinksSortable();
  }


  // 显示上下文菜单
  function showContextMenu(e, site) {
    console.log('=== Quick Link Context Menu ===');
    console.log('Event:', e.type);
    console.log('Site:', site);
    
    e.preventDefault();
    // 移除任何已存在的上下文菜单
    const existingMenu = document.querySelector('.custom-context-menu');
    if (existingMenu) {
      console.log('Removing existing context menu');
      existingMenu.remove();
    }

    const contextMenu = document.createElement('div');
    contextMenu.className = 'custom-context-menu';

    contextMenu.style.display = 'block';
    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.top = `${e.clientY}px`;

    // 定义菜单项
    const menuItems = [
      { text: chrome.i18n.getMessage("openInNewTab"), icon: 'open_in_new', action: () => window.open(site.url, '_blank') },
      { text: chrome.i18n.getMessage("openInNewWindow"), icon: 'launch', action: () => window.open(site.url, '_blank', 'noopener,noreferrer') },
      { text: chrome.i18n.getMessage("openInIncognito"), icon: 'visibility_off', action: () => openInIncognito(site.url) },
      { text: chrome.i18n.getMessage("editQuickLink"), icon: 'edit', action: () => editQuickLink(site) },
      { text: chrome.i18n.getMessage("deleteQuickLink"), icon: 'delete', action: () => confirmDeleteQuickLink(site) },
      { text: chrome.i18n.getMessage("copyLink"), icon: 'content_copy', action: () => copyToClipboard(site.url) },
      { text: chrome.i18n.getMessage("createQRCode"), icon: 'qr_code', action: () => createQRCode(site.url, site.name) }
    ];

    menuItems.forEach((item, index) => {
      const menuItem = document.createElement('div');
      menuItem.className = 'custom-context-menu-item';
      
      const icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.innerHTML = ICONS[item.icon];
      
      const text = document.createElement('span');
      text.textContent = item.text;

      menuItem.appendChild(icon);
      menuItem.appendChild(text);

      menuItem.addEventListener('click', () => {
        item.action();
        contextMenu.remove();
      });

      if (index === 3 || index === 5) {
        const divider = document.createElement('div');
        divider.className = 'custom-context-menu-divider';
        contextMenu.appendChild(divider);
      }

      contextMenu.appendChild(menuItem);
    });

    document.body.appendChild(contextMenu);

    // 确保菜单不会超出视窗
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuRect = contextMenu.getBoundingClientRect();

    if (e.clientX + menuRect.width > viewportWidth) {
      contextMenu.style.left = `${viewportWidth - menuRect.width}px`;
    }

    if (e.clientY + menuRect.height > viewportHeight) {
      contextMenu.style.top = `${viewportHeight - menuRect.height}px`;
    }

    // 点击其他地方闭菜单
    function closeMenu(e) {
      if (!contextMenu.contains(e.target)) {
        contextMenu.remove();
        document.removeEventListener('click', closeMenu);
      }
    }

    // 使用 setTimeout 来确保这个监听器不会立即触发
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  // 编辑快捷链接
  function editQuickLink(site) {
    openQuickLinkDialog(site);
  }

  // 刷新单个快捷链接
  function refreshQuickLink(site, oldUrl) {
    const linkItem = document.querySelector(`.quick-link-item-container[data-url="${oldUrl}"]`);
    if (linkItem) {
      const link = linkItem.querySelector('a');
      const img = link.querySelector('img');
      const span = linkItem.querySelector('span');

      link.href = site.url;
      
      // 更新 favicon
      const newFaviconUrl = faviconURL(site.url);
      img.src = newFaviconUrl;
      img.alt = `${site.name} Favicon`;
      
      // 添加错误处理，如果新的 favicon 加载失败，使用默认图标
      img.onerror = function() {
        this.src = '../images/placeholder-icon.svg';
      };

      span.textContent = site.name;

      // 更新 data-url 属性
      linkItem.dataset.url = site.url;
    } else {
      console.error('Quick link element not found for:', oldUrl);
      generateQuickLinks();
    }
  }

  // 确认删除快捷标签
  function confirmDeleteQuickLink(site) {
    console.log('=== Quick Link Delete Confirmation ===');
    console.log('Quick link to delete:', site);
    
    const confirmDialog = document.getElementById('confirm-dialog');
    const confirmMessage = document.getElementById('confirm-dialog-message');
    const confirmDeleteQuickLinkMessage = document.getElementById('confirm-delete-quick-link-message');
    
    // 保存要删除的快捷链接
    quickLinkToDelete = site;
    console.log('Set quickLinkToDelete:', quickLinkToDelete);
    
    // 确保两个消息元素都正确显示
    if (confirmMessage) {
      confirmMessage.style.display = 'none'; // 隐藏默认的确认消息
    }
    
    if (confirmDeleteQuickLinkMessage) {
      confirmDeleteQuickLinkMessage.style.display = 'block'; // 显示快捷链接的确认消息
      confirmDeleteQuickLinkMessage.innerHTML = chrome.i18n.getMessage(
        "confirmDeleteQuickLinkMessage", 
        `<strong>${site.name}</strong>`
      );
      console.log('Setting quick link delete message:', confirmDeleteQuickLinkMessage.innerHTML);
    } else {
      console.error('Quick link delete message element not found');
    }
    
    confirmDialog.style.display = 'block';
    
    // 修改确认按钮处理程序
    document.getElementById('confirm-delete-button').onclick = function() {
      console.log('=== Quick Link Delete Confirmed ===');
      console.log('Current quickLinkToDelete:', quickLinkToDelete);
      
      if (quickLinkToDelete) {
        removeFixedShortcut(quickLinkToDelete.url).then(() => {
          showToast(chrome.i18n.getMessage('deleteSuccess'));
          confirmDialog.style.display = 'none';
          if (confirmMessage) confirmMessage.style.display = 'block';
          if (confirmDeleteQuickLinkMessage) confirmDeleteQuickLinkMessage.style.display = 'none';
          quickLinkToDelete = null;
        });
      } else {
        console.error('No quick link selected for deletion');
      }
    };
    
    // 修改取消按钮处理程序
    document.getElementById('cancel-delete-button').onclick = function() {
      console.log('=== Quick Link Delete Cancelled ===');
      console.log('Clearing quickLinkToDelete:', quickLinkToDelete);
      confirmDialog.style.display = 'none';
      // 重置消息显示状态
      if (confirmMessage) confirmMessage.style.display = 'block';
      if (confirmDeleteQuickLinkMessage) confirmDeleteQuickLinkMessage.style.display = 'none';
      quickLinkToDelete = null;
    };
  }

  // 在无痕窗口中打开链接
  function openInIncognito(url) {
    chrome.windows.create({ url: url, incognito: true });
  }

  // 复制链接到剪贴板
  function copyToClipboard(url) {
    try {
      navigator.clipboard.writeText(url).then(() => {
        // 使用本地化消息
        showToast(chrome.i18n.getMessage("linkCopied"));
      }).catch(() => {
        // 使用本地化消息
        showToast(chrome.i18n.getMessage("copyLinkFailed"));
      });
    } catch (err) {
      console.error('Copy failed:', err);
      // 使用本地化消息
      showToast(chrome.i18n.getMessage("copyLinkFailed"));
    }
  }
  // 显示 toast 提示
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000); // 显示3秒钟
  }

  // 创建二维码的函数
  function createQRCode(url, bookmarkName) {
    // 创建一个模态来显示二维码
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.zIndex = '1000';

    const qrContainer = document.createElement('div');
    qrContainer.style.backgroundColor = 'white';
    qrContainer.style.padding = '1.5rem 3rem';
    qrContainer.style.width = '320px';
    qrContainer.style.borderRadius = '10px';
    qrContainer.style.display = 'flex';
    qrContainer.style.flexDirection = 'column';
    qrContainer.style.alignItems = 'center';
    qrContainer.style.position = 'relative';

    // 添加关闭按钮
    const closeButton = document.createElement('span');
    closeButton.textContent = '×';
    closeButton.style.position = 'absolute';
    closeButton.style.right = '10px';
    closeButton.style.top = '10px';
    closeButton.style.fontSize = '20px';
    closeButton.style.cursor = 'pointer';
    closeButton.onclick = () => document.body.removeChild(modal);
    qrContainer.appendChild(closeButton);

    // 添加标题
    const title = document.createElement('h2');
    title.textContent = getLocalizedMessage('scanQRCode');
    title.style.marginBottom = '20px';
    title.style.fontWeight = '600';
    title.style.fontSize = '0.875rem';
    qrContainer.appendChild(title);

    // 创建 QR 码容器
    const qrCodeElement = document.createElement('div');
    qrContainer.appendChild(qrCodeElement);

    // 添加 URL 显示
    const urlDisplay = document.createElement('div');
    urlDisplay.textContent = url;
    urlDisplay.style.marginTop = '20px';
    urlDisplay.style.wordBreak = 'break-all';
    urlDisplay.style.maxWidth = '300px';
    urlDisplay.style.textAlign = 'center';
    qrContainer.appendChild(urlDisplay);

    // 添加按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'space-between';
    buttonContainer.style.width = '100%';
    buttonContainer.style.marginTop = '20px';

    // 添加复制按钮
    const copyButton = document.createElement('button');
    copyButton.textContent = getLocalizedMessage('copyLink');
    copyButton.onclick = () => {
      navigator.clipboard.writeText(url).then(() => {
        copyButton.textContent = getLocalizedMessage('copied');
        setTimeout(() => copyButton.textContent = getLocalizedMessage('copyLink'), 2000);
      });
    };

    // 添加下载按钮
    const downloadButton = document.createElement('button');
    downloadButton.textContent = getLocalizedMessage('download');
    downloadButton.onclick = () => {
      setTimeout(() => {
        const canvas = qrCodeElement.querySelector('canvas');
        if (canvas) {
          const link = document.createElement('a');
          // 使用书签名称作为文件名，添加 .png 扩展名
          const fileName = `${bookmarkName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_qrcode.png`;
          link.download = fileName;
          link.href = canvas.toDataURL('image/png');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }, 100);
    };

    // 设置按钮样式和hover效果
    [copyButton, downloadButton].forEach(button => {
      button.style.padding = '5px 10px';
      button.style.border = 'none';
      button.style.borderRadius = '5px';
      button.style.cursor = 'pointer';
      button.style.backgroundColor = '#f0f0f0';
      button.style.color = '#333';
      button.style.transition = 'all 0.3s ease';

      // 添加hover效果
      button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = '#e0e0e0';
        button.style.color = '#111827';
      });
      button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = '#f0f0f0';
        button.style.color = '#717882';
      });
    });

    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(downloadButton);
    qrContainer.appendChild(buttonContainer);

    modal.appendChild(qrContainer);
    document.body.appendChild(modal);

    // 使用 qrcode.js 库生成二维码
    new QRCode(qrCodeElement, {
      text: url,
      width: 200,
      height: 200
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', function (event) {
      if (event.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  // 初始化
  ensureQuickLinksManager();
  generateQuickLinks();

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && (changes.fixedShortcuts || changes.enableQuickLinks)) {
      generateQuickLinks();
    }
  });


});