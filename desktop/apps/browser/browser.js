// hyadeOS Browser (window popup2 in desktop/com.hyadeos.desktop.html, which keeps its markup).
// Loaded by the desktop between its own scripts, sharing their scope: the pages are <webview>s that must live
// in the desktop page to keep their saved logins and extensions. Saved favorites/spaces/tabs: desktop/assets/browser-sidebar-state.js.
// Spec: docs/superpowers/specs/2026-11-23-sidebar-browser-design.md
// --- Browser (popup2) ---
const BROWSER_HOME = `${location.origin}/desktop/browser-home.html`;
const BROWSER_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' }
};
const BROWSER_ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function getBrowserEngineId() {
  try { const id = localStorage.getItem('browserSearchEngine'); if (BROWSER_ENGINES[id]) return id; } catch (e) {}
  return 'google';
}

function normalizeBrowserUrl(value) {
  const input = value.trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    return url.href;
  }
  // localhost, IPv4 and host.tld, each with optional port and path
  const hostMatch = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d{1,5})?(?:[/?#]\S*)?$/i.exec(input);
  if (hostMatch) {
    const local = /^(localhost|\d)/i.test(hostMatch[1]);
    return new URL(`${local ? 'http' : 'https'}://${input}`).href;
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) throw new Error(hyadeOSI18n.t("desktop.browser.only-http", "Only HTTP and HTTPS websites can be opened."));
  return BROWSER_ENGINES[getBrowserEngineId()].url + encodeURIComponent(input);
}

let browserTabs = [];
let activeBrowserTabId = null;
let nextBrowserTabId = 1;
let browserProgressTimer = null;

const browserEl = id => document.getElementById(id);
function getActiveBrowserTab() {
  return browserTabs.find(tab => tab.id === activeBrowserTabId) || null;
}
function browserDisplayUrl(url) {
  return !url || url === BROWSER_HOME || url === 'about:blank' ? '' : url;
}
// The address pill shows just the site until it is clicked, like the sidebar browsers do.
function browserShortUrl(url) {
  const shown = browserDisplayUrl(url);
  try { return shown ? new URL(shown).hostname.replace(/^www./, '') : ''; } catch (e) { return shown; }
}

function updateBrowserToolbar() {
  const tab = getActiveBrowserTab();
  browserEl('browserBack').disabled = !tab || !tab.ready || !tab.view.canGoBack();
  browserEl('browserForward').disabled = !tab || !tab.ready || !tab.view.canGoForward();

  const reload = browserEl('browserReload');
  const loading = !!tab?.loading;
  reload.querySelector('.material-symbols-outlined').textContent = loading ? 'close' : 'refresh';
  reload.setAttribute('aria-label', loading ? hyadeOSI18n.t("desktop.browser.stop", "Stop") : hyadeOSI18n.t("desktop.browser.reload", "Reload"));
  reload.title = loading ? hyadeOSI18n.t("desktop.browser.stop-shortcut", "Stop (Esc)") : hyadeOSI18n.t("desktop.browser.reload-shortcut", "Reload (F5)");

  const input = browserEl('browserUrl');
  if (document.activeElement !== input) input.value = browserShortUrl(tab?.url);
  const icon = browserEl('browserUrlIcon');
  const shown = browserDisplayUrl(tab?.url);
  icon.textContent = !shown ? 'search' : shown.startsWith('https:') ? 'lock' : 'info';
  icon.classList.toggle('secure', shown.startsWith('https:'));
  icon.title = !shown ? '' : shown.startsWith('https:') ? hyadeOSI18n.t("desktop.browser.secure", "Secure connection") : hyadeOSI18n.t("desktop.browser.not-secure", "Connection is not secure");

  updateBrowserExtAdd(tab);

  const zoom = browserEl('browserZoom');
  const factor = tab?.zoom || 1;
  zoom.hidden = factor === 1;
  zoom.textContent = `${Math.round(factor * 100)}%`;

  const progress = browserEl('browserProgress');
  clearTimeout(browserProgressTimer);
  if (loading) {
    progress.classList.add('active');
    progress.style.width = `${tab.progress || 15}%`;
  } else if (progress.classList.contains('active')) {
    progress.style.width = '100%';
    browserProgressTimer = setTimeout(() => { progress.classList.remove('active'); progress.style.width = '0'; }, 300);
  }
}

// --- Sidebar: favorites, spaces, pinned and today's tabs, saved per account. ---
// The saved data lives in browser-sidebar-state.js; a live tab points at its saved item (tab.itemId).
// Saved items stay rows until clicked: a page loads only when its row is opened.
const BS = window.BrowserSidebarState;
const BROWSER_STATE_KEY = (window.hyadeOSUserKey || (k => k))('browserSidebar');
const readBrowserStorage = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
let browserState = BS.load(readBrowserStorage(BROWSER_STATE_KEY), readBrowserStorage('browserTheme'));
let browserSaveTimer = null, browserRenderQueued = false, browserDragId = null, browserSuppressNewTab = false;
const browserLastActive = new Map(); // spaceId -> itemId, reopened when switching back

function saveBrowserState(now = false) {
  clearTimeout(browserSaveTimer);
  const write = () => { try { localStorage.setItem(BROWSER_STATE_KEY, BS.serialize(browserState)); } catch (e) {} };
  if (now) write(); else browserSaveTimer = setTimeout(write, 500);
}
const browserTabForItem = itemId => browserTabs.find(tab => tab.itemId === itemId) || null;
const browserItemUrl = url => (!url || url === BROWSER_HOME || url === 'about:blank') ? BS.NEW_TAB : url;
const browserPageUrl = url => url === BS.NEW_TAB ? BROWSER_HOME : url;
const browserEsc = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
const browserSpaceItemIds = space => [...space.pinned, ...space.today].map(item => item.id);

function browserItemTitle(item) {
  if (item.title) return item.title;
  if (item.url === BS.NEW_TAB) return hyadeOSI18n.t("desktop.browser.new-tab-title", "New Tab");
  try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch (e) { return item.url; }
}

function browserFaviconEl(src, size) {
  const globe = () => { const g = document.createElement('span'); g.className = 'material-symbols-outlined'; g.style.fontSize = size + 'px'; g.textContent = 'public'; return g; };
  if (!src) return globe();
  const img = document.createElement('img');
  img.alt = '';
  img.src = src;
  img.onerror = () => img.replaceWith(globe());
  return img;
}

function browserRowEl(item, section, activeItemId) {
  const live = browserTabForItem(item.id);
  const row = document.createElement('div');
  row.className = 'bsb-row' + (item.id === activeItemId ? ' active' : '');
  row.setAttribute('role', 'listitem');
  row.tabIndex = 0;
  row.draggable = true;
  row.dataset.itemId = item.id;
  row.dataset.section = section;
  const title = browserItemTitle(item);
  row.title = title;
  const icon = document.createElement('span');
  icon.className = 'bsb-row-icon' + (live?.loading ? ' loading' : '');
  icon.append(browserFaviconEl(item.favicon, 16));
  const label = document.createElement('span');
  label.className = 'bsb-row-title';
  label.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bsb-row-close material-symbols-outlined';
  close.textContent = 'close';
  close.setAttribute('aria-label', hyadeOSI18n.t("desktop.browser.close-tab", "Close {title}", { title }));
  close.addEventListener('click', event => { event.stopPropagation(); closeBrowserItem(item.id); });
  row.append(icon, label, close);
  wireBrowserItemEl(row, item.id);
  return row;
}

function browserFavEl(item, index, activeItemId) {
  const live = browserTabForItem(item.id);
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'bsb-fav' + (item.id === activeItemId ? ' active' : '') + (live?.loading ? ' loading' : '');
  tile.setAttribute('role', 'listitem');
  tile.draggable = true;
  tile.dataset.itemId = item.id;
  tile.dataset.section = 'favorites';
  const title = browserItemTitle(item);
  tile.title = index < 9 ? `${title} (Ctrl+${index + 1})` : title;
  tile.setAttribute('aria-label', title);
  tile.append(browserFaviconEl(item.favicon, 20));
  wireBrowserItemEl(tile, item.id);
  return tile;
}

function wireBrowserItemEl(el, itemId) {
  el.addEventListener('click', () => openBrowserItem(itemId));
  el.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); closeBrowserItem(itemId); } });
  el.addEventListener('keydown', event => {
    if (event.target !== el) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBrowserItem(itemId); }
    if (event.key === 'Delete') { event.preventDefault(); closeBrowserItem(itemId); }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const r = el.getBoundingClientRect(); showBrowserRowMenu(itemId, r.left + 20, r.bottom); }
  });
  el.addEventListener('contextmenu', event => { event.preventDefault(); showBrowserRowMenu(itemId, event.clientX, event.clientY); });
  el.addEventListener('dragstart', event => {
    browserDragId = itemId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', itemId);
    el.classList.add('dragging');
    document.getElementById('popup2').classList.add('bsb-dragging');
  });
  el.addEventListener('dragend', () => {
    browserDragId = null;
    document.getElementById('popup2').classList.remove('bsb-dragging');
    clearBrowserDropMarks();
    renderBrowserSidebar();
  });
}

function scheduleBrowserRender() {
  if (browserRenderQueued) return;
  browserRenderQueued = true;
  requestAnimationFrame(() => { browserRenderQueued = false; renderBrowserSidebar(); });
}

function renderBrowserSidebar() {
  if (browserDragId) return; // replaced rows would end the drag; dragend renders
  const popup = document.getElementById('popup2');
  const space = BS.currentSpace(browserState);
  popup.style.setProperty('--bs-tint', space.color);
  popup.style.setProperty('--bs-w', browserState.sidebarWidth + 'px');
  browserEl('browserSpaceName').textContent = space.name;
  tintBrowserHomes();
  const activeItemId = getActiveBrowserTab()?.itemId;
  browserEl('browserFavs').replaceChildren(...browserState.favorites.map((item, i) => browserFavEl(item, i, activeItemId)));
  browserEl('browserPinned').replaceChildren(...space.pinned.map(item => browserRowEl(item, 'pinned', activeItemId)));
  browserEl('browserToday').replaceChildren(...space.today.map(item => browserRowEl(item, 'today', activeItemId)));
  browserEl('browserClearToday').parentElement.classList.toggle('empty', !space.today.length);
  popup.querySelector(`[data-item-id="${CSS.escape(activeItemId || '')}"]`)?.scrollIntoView({ block: 'nearest' });
}

function applyBrowserLayout() {
  const popup = document.getElementById('popup2');
  popup.classList.toggle('bsb-collapsed', browserState.collapsed);
  if (!browserState.collapsed) popup.classList.remove('bsb-peek');
  renderBrowserSidebar();
}

// The new-tab page glows in the current space's color. It runs in the browser's own session,
// so it can't read the desktop's settings: the color is set on it once it has loaded.
function tintBrowserHome(tab) {
  if (!tab.ready || tab.url !== BROWSER_HOME) return;
  const color = BS.currentSpace(browserState).color; // always #rrggbb (checked by the state module)
  tab.view.executeJavaScript(`document.documentElement.style.setProperty('--tint', '${color}')`).catch(() => {});
}
const tintBrowserHomes = () => browserTabs.forEach(tintBrowserHome);

function toggleBrowserSidebar(force) {
  browserState.collapsed = typeof force === 'boolean' ? force : !browserState.collapsed;
  saveBrowserState();
  applyBrowserLayout();
}

function showBrowserEmpty() {
  activeBrowserTabId = null;
  browserTabs.forEach(tab => { tab.view.hidden = true; tab.errorEl.hidden = true; });
  browserEl('browserEmpty').hidden = false;
  closeBrowserFind();
  browserEndUrlEditing();
  updateBrowserToolbar();
  renderBrowserSidebar();
}

function openBrowserItem(itemId) {
  const live = browserTabForItem(itemId);
  if (live) { selectBrowserTab(live.id); return; }
  const found = BS.findItem(browserState, itemId);
  if (found) createBrowserTab(browserPageUrl(found.item.url), itemId);
}

// Closing a today tab removes it; closing a pinned tab or a favorite only unloads its page.
function closeBrowserItem(itemId) {
  const live = browserTabForItem(itemId);
  if (live) { closeBrowserTab(live.id); return; }
  const found = BS.findItem(browserState, itemId);
  if (found?.section === 'today') { BS.removeItem(browserState, itemId); saveBrowserState(); renderBrowserSidebar(); }
}

function switchBrowserSpace(spaceId) {
  if (!BS.getSpace(browserState, spaceId)) return;
  browserState.currentSpace = spaceId;
  saveBrowserState();
  const ids = browserSpaceItemIds(BS.currentSpace(browserState));
  const last = browserLastActive.get(spaceId);
  const target = (last && ids.includes(last)) ? last : ids.find(id => browserTabForItem(id)) || null;
  if (target) openBrowserItem(target);
  else showBrowserEmpty();
}

function cycleBrowserTab(step) {
  const ids = browserSpaceItemIds(BS.currentSpace(browserState));
  if (!ids.length) return;
  const index = ids.indexOf(getActiveBrowserTab()?.itemId);
  openBrowserItem(ids[(index + step + ids.length) % ids.length]);
}

// --- Right-click menu on a tab or favorite ---
function hideBrowserPopovers() {
  browserEl('browserRowMenu').hidden = true;
  browserEl('browserSpaceMenu').hidden = true;
}

function placeBrowserPopover(menu, clientX, clientY) {
  const popup = document.getElementById('popup2').getBoundingClientRect();
  menu.hidden = false;
  const width = menu.offsetWidth, height = menu.offsetHeight;
  menu.style.left = Math.max(6, Math.min(clientX - popup.left, popup.width - width - 6)) + 'px';
  menu.style.top = Math.max(6, Math.min(clientY - popup.top, popup.height - height - 6)) + 'px';
}

function browserMenuButton(icon, label, act) {
  return `<button type="button" role="menuitem" data-act="${act}"><span class="material-symbols-outlined check" style="color:inherit">${icon}</span>${browserEsc(label)}</button>`;
}

function showBrowserRowMenu(itemId, clientX, clientY) {
  const found = BS.findItem(browserState, itemId);
  if (!found) return;
  const live = browserTabForItem(itemId);
  const menu = browserEl('browserRowMenu');
  const items = [];
  if (found.section === 'favorites') {
    items.push(browserMenuButton('star', hyadeOSI18n.t("desktop.browser.remove-favorite", 'Remove from Favorites'), 'unfavorite'));
    if (found.item.savedUrl && found.item.savedUrl !== found.item.url) items.push(browserMenuButton('history', hyadeOSI18n.t("desktop.browser.back-to-saved", 'Go back to saved page'), 'reset'));
  } else {
    items.push(browserMenuButton('star', hyadeOSI18n.t("desktop.browser.add-favorite", 'Add to Favorites'), 'favorite'));
    items.push(found.section === 'pinned'
      ? browserMenuButton('keep_off', hyadeOSI18n.t("desktop.browser.unpin", 'Unpin'), 'unpin')
      : browserMenuButton('keep', hyadeOSI18n.t("desktop.browser.pin", 'Pin'), 'pin'));
  }
  if (found.item.url !== BS.NEW_TAB) items.push(browserMenuButton('link', hyadeOSI18n.t("desktop.browser.copy-link", 'Copy link'), 'copy'));
  items.push('<hr>');
  if (live && found.section !== 'today') items.push(browserMenuButton('close', hyadeOSI18n.t("desktop.browser.unload", 'Close page'), 'unload'));
  items.push(found.section === 'today'
    ? browserMenuButton('close', hyadeOSI18n.t("desktop.browser.close-tab-short", 'Close tab'), 'remove')
    : browserMenuButton('delete', hyadeOSI18n.t("desktop.browser.remove", 'Remove'), 'remove'));
  menu.innerHTML = items.join('');
  menu.onclick = event => {
    const act = event.target.closest('button')?.dataset.act;
    if (!act) return;
    hideBrowserPopovers();
    const spaceId = found.space?.id || browserState.currentSpace;
    if (act === 'favorite') BS.moveItem(browserState, itemId, { section: 'favorites' });
    if (act === 'unfavorite') BS.moveItem(browserState, itemId, { section: 'today', spaceId: browserState.currentSpace, index: 0 });
    if (act === 'pin') BS.moveItem(browserState, itemId, { section: 'pinned', spaceId });
    if (act === 'unpin') BS.moveItem(browserState, itemId, { section: 'today', spaceId, index: 0 });
    if (act === 'reset') {
      const saved = found.item.savedUrl;
      const tab = browserTabForItem(itemId);
      if (tab) { selectBrowserTab(tab.id); navigateBrowser(saved); } else { BS.updateItem(browserState, itemId, { url: saved }); openBrowserItem(itemId); }
    }
    if (act === 'copy') navigator.clipboard?.writeText(found.item.url).catch(() => {});
    if (act === 'unload') { const tab = browserTabForItem(itemId); if (tab) closeBrowserTab(tab.id); }
    if (act === 'remove') {
      const tab = browserTabForItem(itemId);
      BS.removeItem(browserState, itemId);
      if (tab) closeBrowserTab(tab.id);
    }
    saveBrowserState();
    renderBrowserSidebar();
  };
  placeBrowserPopover(menu, clientX, clientY);
  menu.querySelector('button')?.focus();
}

// --- Spaces menu (the colored pill at the top) ---
function showBrowserSpaceMenu() {
  const menu = browserEl('browserSpaceMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  const current = BS.currentSpace(browserState);
  const swatches = BROWSER_THEMES.filter(([id]) => id.startsWith('#')).map(([id]) =>
    `<button type="button" class="browser-theme${id === current.color ? ' on' : ''}" data-color="${id}" style="--sw:${id}" title="${id}"></button>`).join('') +
    `<button type="button" class="browser-theme browser-theme-custom${BROWSER_THEMES.some(([id]) => id === current.color) ? '' : ' on'}" style="--sw:conic-gradient(#ff6b6b, #fcc419, #51cf66, #339af0, #cc5de8, #ff6b6b)" title="${browserEsc(hyadeOSI18n.t("desktop.browser.custom-color", 'Custom color'))}"><span class="material-symbols-outlined">colorize</span><input type="color" value="${current.color}" aria-label="${browserEsc(hyadeOSI18n.t("desktop.browser.custom-color", 'Custom color'))}"></button>`;
  menu.innerHTML = `
    <div class="menu-label">${browserEsc(hyadeOSI18n.t("desktop.browser.spaces", 'Spaces'))}</div>
    ${browserState.spaces.map(space => `<button type="button" role="menuitemradio" aria-checked="${space.id === current.id}" data-space="${space.id}"><span class="bsb-space-swatch" style="--sw:${space.color}"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${browserEsc(space.name)}</span><span class="material-symbols-outlined check">${space.id === current.id ? 'check' : ''}</span></button>`).join('')}
    ${browserMenuButton('add', hyadeOSI18n.t("desktop.browser.new-space", 'New space'), 'new')}
    <hr><div class="menu-label">${browserEsc(hyadeOSI18n.t("desktop.browser.space-name", 'Space name'))}</div>
    <input class="bsb-rename" type="text" maxlength="40" value="${browserEsc(current.name)}" aria-label="${browserEsc(hyadeOSI18n.t("desktop.browser.space-name", 'Space name'))}">
    <div class="browser-themes">${swatches}</div>
    ${browserState.spaces.length > 1 ? browserMenuButton('delete', hyadeOSI18n.t("desktop.browser.delete-space", 'Delete space'), 'delete') : ''}`;
  menu.onclick = async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.space) { hideBrowserPopovers(); switchBrowserSpace(button.dataset.space); return; }
    if (button.dataset.color) { BS.updateSpace(browserState, current.id, { color: button.dataset.color }); saveBrowserState(); renderBrowserSidebar(); menu.hidden = true; showBrowserSpaceMenu(); return; }
    const act = button.dataset.act;
    if (act === 'new') {
      const space = BS.addSpace(browserState, hyadeOSI18n.t("desktop.browser.new-space-name", 'Space {n}', { n: browserState.spaces.length + 1 }), BROWSER_THEMES[2 + (browserState.spaces.length % 6)][0]);
      switchBrowserSpace(space.id);
      menu.hidden = true;
      showBrowserSpaceMenu();
      const rename = menu.querySelector('.bsb-rename');
      rename?.focus();
      rename?.select();
    }
    if (act === 'delete') {
      hideBrowserPopovers();
      const space = BS.currentSpace(browserState);
      const count = space.pinned.length + space.today.length;
      const ok = await mDialog.confirm(hyadeOSI18n.t("desktop.browser.delete-space-confirm", 'Delete "{name}"? Its {count} tabs will be closed.', { name: space.name, count }));
      if (!ok) return;
      browserSpaceItemIds(space).forEach(id => { const tab = browserTabForItem(id); if (tab) { browserTabs.splice(browserTabs.indexOf(tab), 1); destroyBrowserTab(tab); } });
      BS.removeSpace(browserState, space.id);
      switchBrowserSpace(browserState.currentSpace);
    }
  };
  const rename = menu.querySelector('.bsb-rename');
  const commit = () => { BS.updateSpace(browserState, current.id, { name: rename.value }); saveBrowserState(); renderBrowserSidebar(); };
  rename.addEventListener('change', commit);
  rename.addEventListener('keydown', event => { if (event.key === 'Enter') { commit(); hideBrowserPopovers(); } if (event.key === 'Escape') hideBrowserPopovers(); });
  const custom = menu.querySelector('.browser-theme-custom input');
  custom.addEventListener('input', () => { BS.updateSpace(browserState, current.id, { color: custom.value }); saveBrowserState(); renderBrowserSidebar(); });
  const pill = browserEl('browserSpaceBtn').getBoundingClientRect();
  placeBrowserPopover(menu, pill.left, pill.bottom + 6);
}

// --- Drag and drop: reorder, pin/unpin, and drop on the grid to make a favorite. ---
function clearBrowserDropMarks() {
  document.querySelectorAll('#popup2 .drop-before, #popup2 .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
}

function browserDropTarget(event) {
  const zone = event.target.closest('#browserFavs, #browserPinned, #browserToday, .bsb-divider, #browserNewTab');
  if (!zone) return null;
  const spaceId = browserState.currentSpace;
  if (zone.id === 'browserFavs') {
    const tiles = [...zone.children];
    const hit = event.target.closest('.bsb-fav');
    let index = tiles.length;
    if (hit) { const r = hit.getBoundingClientRect(); index = tiles.indexOf(hit) + (event.clientX > r.left + r.width / 2 ? 1 : 0); }
    return { section: 'favorites', index, el: tiles[index] || null, mark: 'drop-before' };
  }
  if (zone.classList.contains('bsb-divider')) return { section: 'today', spaceId, index: 0, el: browserEl('browserToday').firstElementChild, mark: 'drop-before' };
  if (zone.id === 'browserNewTab') return { section: 'today', spaceId, index: Infinity, el: browserEl('browserToday').lastElementChild, mark: 'drop-after' };
  const rows = [...zone.children];
  const hit = event.target.closest('.bsb-row');
  let index = rows.length;
  if (hit) { const r = hit.getBoundingClientRect(); index = rows.indexOf(hit) + (event.clientY > r.top + r.height / 2 ? 1 : 0); }
  const el = rows[index] || rows[rows.length - 1] || null;
  return { section: zone.id === 'browserPinned' ? 'pinned' : 'today', spaceId, index, el, mark: rows[index] ? 'drop-before' : 'drop-after' };
}

(function setupBrowserDragDrop() {
  const sidebar = browserEl('browserSidebar');
  sidebar.addEventListener('dragover', event => {
    if (!browserDragId) return;
    const target = browserDropTarget(event);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearBrowserDropMarks();
    target.el?.classList.add(target.mark);
  });
  sidebar.addEventListener('drop', event => {
    if (!browserDragId) return;
    const target = browserDropTarget(event);
    if (!target) return;
    event.preventDefault();
    BS.moveItem(browserState, browserDragId, { section: target.section, spaceId: target.spaceId, index: target.index, adjust: true });
    saveBrowserState();
    // dragend renders once the drag is over
  });
})();

function updateBrowserTab(tab) {
  if (tab.itemId) {
    const changes = { url: browserItemUrl(tab.url), favicon: tab.favicon };
    if (!tab.loading || !BS.findItem(browserState, tab.itemId)?.item.title) changes.title = tab.title || '';
    BS.updateItem(browserState, tab.itemId, changes);
    saveBrowserState();
  }
  tab.errorEl.hidden = tab.id !== activeBrowserTabId || !tab.error;
  if (tab.error) {
    tab.errorEl.querySelector('p').textContent = `${tab.error.url}\n${tab.error.description}`;
  }
  scheduleBrowserRender();
  if (tab.id === activeBrowserTabId) updateBrowserToolbar();
}

function selectBrowserTab(tabId) {
  const selected = browserTabs.find(tab => tab.id === tabId);
  if (!selected) return;
  const found = BS.findItem(browserState, selected.itemId);
  // A tab in another space (e.g. opened from the dynamic island) brings its space along.
  if (found?.space && found.space.id !== browserState.currentSpace) { browserState.currentSpace = found.space.id; saveBrowserState(); }
  browserLastActive.set(browserState.currentSpace, selected.itemId);
  activeBrowserTabId = tabId;
  browserTabs.forEach(tab => {
    const active = tab.id === tabId;
    tab.view.hidden = !active;
    tab.errorEl.hidden = !active || !tab.error;
  });
  browserEl('browserEmpty').hidden = true;
  closeBrowserFind();
  browserEndUrlEditing();
  updateBrowserToolbar();
  renderBrowserSidebar();
}

// Switching tab or space ends any address editing, so the field shows the new tab's address.
function browserEndUrlEditing() {
  const input = browserEl('browserUrl');
  if (document.activeElement === input) input.blur();
}

function attachBrowserTabEvents(tab) {
  const view = tab.view;
  const refresh = () => updateBrowserTab(tab);
  view.addEventListener('media-started-playing', () => refreshTabMedia(tab));
  view.addEventListener('media-paused', () => refreshTabMedia(tab));
  view.addEventListener('dom-ready', () => {
    view.executeJavaScript(WEBVIEW_MEDIA_HOOK).catch(() => {});
    tab.ready = true;
    tintBrowserHome(tab);
    if (tab.zoom && tab.zoom !== 1) view.setZoomFactor(tab.zoom);
    tab.progress = 70;
    refresh();
  });
  view.addEventListener('did-start-loading', () => {
    tab.loading = true;
    tab.progress = 15;
    tab.error = null;
    refresh();
  });
  view.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    refresh();
  });
  view.addEventListener('did-navigate', event => {
    removeMediaSession(`tab:${tab.id}`);
    recordBrowserVisit(event.url);
    tab.url = event.url;
    tab.favicon = null;
    tab.progress = 45;
    refresh();
  });
  view.addEventListener('did-navigate-in-page', event => {
    if (!event.isMainFrame) return;
    tab.url = event.url;
    refresh();
  });
  view.addEventListener('page-title-updated', event => {
    tab.title = event.title || hyadeOSI18n.t("desktop.browser.new-tab-title", "New Tab");
    recordBrowserTitle(tab.url, event.title);
    if (mediaSessions.has(`tab:${tab.id}`)) refreshTabMedia(tab);
    refresh();
  });
  view.addEventListener('page-favicon-updated', event => {
    tab.favicon = (event.favicons || []).find(src => /^(https?|data):/i.test(src)) || null;
    refresh();
  });
  view.addEventListener('did-fail-load', event => {
    // -3 is an aborted load (user stop / new navigation), not a real failure.
    if (!event.isMainFrame || event.errorCode === -3) return;
    tab.error = { url: event.validatedURL || tab.url, description: event.errorDescription || hyadeOSI18n.t("desktop.browser.load-failed", "The page could not be loaded.") };
    tab.title = hyadeOSI18n.t("desktop.browser.cant-reach", "Can't reach this page");
    refresh();
  });
  view.addEventListener('found-in-page', event => {
    const result = event.result || {};
    if (result.finalUpdate) browserEl('browserFindCount').textContent = result.matches ? `${result.activeMatchOrdinal}/${result.matches}` : '0/0';
  });
  view.addEventListener('will-navigate', event => {
    if (!/^https?:\/\//i.test(event.url)) event.preventDefault();
  });
}

// Opens a page in a new webview. Without itemId it is a new tab at the top of today's list;
// with one, it loads that saved row (pinned tab, favorite, restored tab).
function createBrowserTab(url = BROWSER_HOME, itemId = null) {
  if (typeof url !== 'string') url = BROWSER_HOME; // onclick="createBrowserTab()" from a button
  const view = document.createElement('webview');
  view.className = 'browser-view';
  view.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes');
  view.setAttribute('allowpopups', '');
  // Its own session: extensions load there and nowhere near the desktop (lib/browser-extensions.js).
  view.setAttribute('partition', BROWSER_PARTITION);
  view.src = url || BROWSER_HOME;

  const errorEl = document.createElement('div');
  errorEl.className = 'browser-error';
  errorEl.hidden = true;
  errorEl.innerHTML = `<span class="material-symbols-outlined">cloud_off</span><h2>${hyadeOSI18n.t("desktop.browser.cant-reach", "Can't reach this page")}</h2>
    <p style="white-space:pre-line"></p><button type="button">${hyadeOSI18n.t("common.retry", "Try again")}</button>`;

  const saved = itemId ? BS.findItem(browserState, itemId)?.item : null;
  if (!saved) itemId = BS.addToday(browserState, browserState.currentSpace, { url: browserItemUrl(url), title: '', favicon: null }).id;
  const tab = { id: nextBrowserTabId++, itemId, title: saved?.title || hyadeOSI18n.t("desktop.browser.new-tab-title", "New Tab"), url: url || BROWSER_HOME, view, errorEl,
    loading: false, ready: false, favicon: saved?.favicon || null, error: null, zoom: 1, progress: 0 };
  errorEl.querySelector('button').addEventListener('click', () => {
    tab.error = null;
    tab.view.src = tab.url;
    updateBrowserTab(tab);
  });
  attachBrowserTabEvents(tab);
  browserEl('browserTabContent').append(view, errorEl);
  browserTabs.push(tab);
  saveBrowserState();
  selectBrowserTab(tab.id);
  if (!url || url === BROWSER_HOME) setTimeout(() => browserEl('browserUrl').focus(), 0);
  return tab;
}

// When the window opens: show the saved rows and reopen the tab that was last in front.
function ensureBrowserTabs() {
  applyBrowserLayout();
  requestAnimationFrame(() => document.getElementById('popup2').classList.add('bsb-ready'));
  if (browserTabs.length > 0) return;
  if (browserSuppressNewTab) return; // a link is about to open in its own new tab
  const space = BS.currentSpace(browserState);
  const ids = browserSpaceItemIds(space);
  const last = browserLastActive.get(space.id);
  const target = (last && ids.includes(last)) ? last : space.today[0]?.id || space.pinned[0]?.id;
  if (target) openBrowserItem(target);
  else if (!browserSuppressNewTab) createBrowserTab();
  else showBrowserEmpty();
}

// Links with target=_blank / window.open from any web page arrive here (see launcher.js).
function openUrlInBrowserTab(url) {
  browserSuppressNewTab = true;
  try { if (!document.getElementById('popup2').classList.contains('active')) openPopup('popup2'); } finally { browserSuppressNewTab = false; }
  createBrowserTab(url);
  focusPopup(document.getElementById('popup2'));
}

function destroyBrowserTab(tab) {
  removeMediaSession(`tab:${tab.id}`);
  // Removing the webview ends its page; pointing it at about:blank first raced its teardown.
  tab.view.remove();
  tab.errorEl.remove();
}

// Closing a today tab removes its row; a pinned tab or a favorite keeps its row and only unloads.
// The tab in front moves to the nearest open tab of the space, or to the empty page.
function closeBrowserTab(tabId) {
  const index = browserTabs.findIndex(tab => tab.id === tabId);
  if (index < 0) return;
  const [tab] = browserTabs.splice(index, 1);
  const found = BS.findItem(browserState, tab.itemId);
  const order = browserSpaceItemIds(BS.currentSpace(browserState));
  const position = order.indexOf(tab.itemId);
  if (found?.section === 'today') BS.removeItem(browserState, tab.itemId);
  destroyBrowserTab(tab);
  saveBrowserState();
  if (activeBrowserTabId !== tabId) { renderBrowserSidebar(); return; }
  activeBrowserTabId = null;
  const open = order.filter(id => id !== tab.itemId && browserTabForItem(id));
  const after = open.find(id => order.indexOf(id) > position);
  const next = after || open[open.length - 1];
  if (next) openBrowserItem(next);
  else showBrowserEmpty();
}

// The window was closed: pages unload, the rows stay saved for next time.
function closeBrowserTabs() {
  browserTabs.forEach(destroyBrowserTab);
  browserTabs = [];
  activeBrowserTabId = null;
  closeBrowserFind();
  browserEl('browserMenu').hidden = true;
  hideBrowserPopovers();
  document.getElementById('popup2').classList.remove('bsb-ready', 'bsb-peek');
  saveBrowserState(true);
}

function navigateBrowser(value = browserEl('browserUrl').value) {
  try {
    const url = normalizeBrowserUrl(value);
    if (!url) return;
    const tab = getActiveBrowserTab();
    if (!tab) { createBrowserTab(url); return; }
    tab.url = url;
    tab.error = null;
    tab.title = hyadeOSI18n.t("desktop.browser.loading", "Loading…");
    browserEl('browserUrl').blur();
    tab.view.src = url;
    updateBrowserTab(tab);
  } catch (error) {
    showNotification(hyadeOSI18n.t("desktop.browser.open-failed", "Unable to open website"), error.message, '⚠️');
  }
}

function performSpotlightWebSearch(query) {
  if (!query.trim()) return;
  closeSpotlight();
  try { const url = normalizeBrowserUrl(query); if (url) openUrlInBrowserTab(url); }
  catch (error) { showNotification(hyadeOSI18n.t("desktop.browser.open-failed", "Unable to open website"), error.message, '⚠️'); }
}

function browserNav(action) {
  const tab = getActiveBrowserTab();
  if (!tab) return;
  if (action === 'home') { navigateBrowser(BROWSER_HOME); return; }
  if (action === 'reload' && tab.error) { tab.error = null; tab.view.src = tab.url; updateBrowserTab(tab); return; }
  if (!tab.ready) return;
  if (action === 'back' && tab.view.canGoBack()) tab.view.goBack();
  if (action === 'fwd' && tab.view.canGoForward()) tab.view.goForward();
  if (action === 'reload') tab.loading ? tab.view.stop() : tab.view.reload();
  if (action === 'stop') tab.view.stop();
}

function browserZoom(direction) {
  const tab = getActiveBrowserTab();
  if (!tab || !tab.ready) return;
  let index = BROWSER_ZOOM_STEPS.indexOf(tab.zoom);
  if (index < 0) index = BROWSER_ZOOM_STEPS.indexOf(1);
  if (direction === 0) index = BROWSER_ZOOM_STEPS.indexOf(1);
  else index = Math.max(0, Math.min(BROWSER_ZOOM_STEPS.length - 1, index + direction));
  tab.zoom = BROWSER_ZOOM_STEPS[index];
  tab.view.setZoomFactor(tab.zoom);
  updateBrowserToolbar();
}

function openBrowserFind() {
  const bar = browserEl('browserFindbar');
  bar.hidden = false;
  const input = browserEl('browserFindInput');
  input.focus();
  input.select();
}
function browserFind(forward = true, findNext = true) {
  const tab = getActiveBrowserTab();
  const text = browserEl('browserFindInput').value;
  if (!tab || !tab.ready) return;
  if (!text) { tab.view.stopFindInPage('clearSelection'); browserEl('browserFindCount').textContent = ''; return; }
  tab.view.findInPage(text, { forward, findNext });
}
function closeBrowserFind() {
  const bar = browserEl('browserFindbar');
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  browserEl('browserFindCount').textContent = '';
  const tab = getActiveBrowserTab();
  if (tab?.ready) tab.view.stopFindInPage('clearSelection');
}

function toggleBrowserMenu(force) {
  const menu = browserEl('browserMenu');
  const show = typeof force === 'boolean' ? force : menu.hidden;
  if (!show) { menu.hidden = true; return; }
  const engine = getBrowserEngineId();
  const zoom = Math.round((getActiveBrowserTab()?.zoom || 1) * 100);
  menu.innerHTML = `
    <button data-act="new-tab"><span class="material-symbols-outlined check" style="color:inherit">add</span>${hyadeOSI18n.t("desktop.browser.new-tab", "New tab")}<span style="margin-left:auto;opacity:.5">Ctrl+T</span></button>
    <button data-act="find"><span class="material-symbols-outlined check" style="color:inherit">search</span>${hyadeOSI18n.t("desktop.browser.find", "Find in page")}<span style="margin-left:auto;opacity:.5">Ctrl+F</span></button>
    <div style="display:flex;align-items:center;gap:4px;padding:2px 4px 2px 10px">
      <span style="flex:1">${hyadeOSI18n.t("desktop.browser.zoom", "Zoom")}</span>
      <button data-act="zoom-out" style="width:auto;padding:4px 10px">−</button>
      <span style="min-width:42px;text-align:center">${zoom}%</span>
      <button data-act="zoom-in" style="width:auto;padding:4px 10px">+</button>
    </div>
    <button data-act="extensions"><span class="material-symbols-outlined check" style="color:inherit">extension</span>${hyadeOSI18n.t("desktop.browser.extensions", "Extensions")}</button>
    <hr><div class="menu-label">${hyadeOSI18n.t("desktop.browser.search-engine", "Search engine")}</div>
    ${Object.entries(BROWSER_ENGINES).map(([id, e]) =>
      `<button data-engine="${id}"><span class="material-symbols-outlined check">${id === engine ? 'check' : ''}</span>${e.name}</button>`).join('')}
    <hr>
    <button data-act="clear-data"><span class="material-symbols-outlined check" style="color:inherit">delete</span>${hyadeOSI18n.t("desktop.browser.clear-data", "Clear browsing data")}</button>`;
  menu.onclick = async event => {
    const item = event.target.closest('button');
    if (!item) return;
    if (item.dataset.engine) {
      try { localStorage.setItem('browserSearchEngine', item.dataset.engine); } catch (e) {}
      toggleBrowserMenu(true);
      return;
    }
    const act = item.dataset.act;
    if (act === 'zoom-in' || act === 'zoom-out') { browserZoom(act === 'zoom-in' ? 1 : -1); toggleBrowserMenu(true); return; }
    menu.hidden = true;
    if (act === 'new-tab') createBrowserTab();
    if (act === 'find') openBrowserFind();
    if (act === 'extensions') openBrowserExtPanel();
    if (act === 'clear-data') {
      if (!window.hyadeOSElectron?.clearBrowserData) { showNotification(hyadeOSI18n.t("desktop.app.browser", "Browser"), hyadeOSI18n.t("desktop.browser.not-available", "Not available in this mode."), '⚠️'); return; }
      try { await window.hyadeOSElectron.clearBrowserData(); showNotification(hyadeOSI18n.t("desktop.app.browser", "Browser"), hyadeOSI18n.t("desktop.browser.data-cleared", "Cookies, cache and site data cleared."), '🧹'); }
      catch (error) { showNotification(hyadeOSI18n.t("desktop.app.browser", "Browser"), error.message || hyadeOSI18n.t("desktop.browser.clear-failed", "Could not clear browsing data."), '⚠️'); }
    }
  };
  menu.hidden = false;
}

// --- Address bar autofill: what you visit is remembered here and completed as you type. ---
const BROWSER_HISTORY_KEY = (window.hyadeOSUserKey || (k => k))('browserHistory');
const BROWSER_SEED_SITES = ['google.com', 'youtube.com', 'github.com', 'wikipedia.org', 'reddit.com', 'x.com', 'instagram.com', 'facebook.com',
  'amazon.com', 'netflix.com', 'twitch.tv', 'spotify.com', 'discord.com', 'stackoverflow.com', 'claude.ai', 'chatgpt.com', 'duckduckgo.com',
  'bing.com', 'linkedin.com', 'outlook.com', 'mail.google.com', 'maps.google.com', 'translate.google.com', 'drive.google.com', 'whatsapp.com',
  'tiktok.com', 'pinterest.com', 'ebay.com', 'paypal.com', 'apple.com', 'microsoft.com', 'openai.com', 'chromewebstore.google.com'];
let browserTyped = '', browserSuggestItems = [], browserSuggestIndex = -1;

function readBrowserHistory() {
  try { const history = JSON.parse(localStorage.getItem(BROWSER_HISTORY_KEY) || '{}'); return history && typeof history === 'object' && !Array.isArray(history) ? history : {}; } catch (e) { return {}; }
}
function writeBrowserHistory(history) {
  const entries = Object.entries(history);
  if (entries.length > 400) history = Object.fromEntries(entries.sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 400));
  try { localStorage.setItem(BROWSER_HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
}
function recordBrowserVisit(url) {
  if (!/^https?:\/\//i.test(url || '') || url.startsWith(BROWSER_HOME)) return;
  const history = readBrowserHistory();
  const entry = history[url] || { v: 0 };
  entry.v = (entry.v || 0) + 1; entry.t = Date.now();
  history[url] = entry;
  writeBrowserHistory(history);
}
function recordBrowserTitle(url, title) {
  const history = readBrowserHistory();
  if (!history[url] || !title) return;
  history[url].title = String(title).slice(0, 200);
  writeBrowserHistory(history);
}

const bareBrowserUrl = url => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
// Sites score by visits, newer visits counting more; a site you never visited still completes.
function browserCandidates(typed) {
  const query = typed.toLowerCase();
  if (!query || /\s/.test(query)) return [];
  const now = Date.now(), sites = new Map(), pages = [];
  Object.entries(readBrowserHistory()).forEach(([url, entry]) => {
    let parsed; try { parsed = new URL(url); } catch (e) { return; }
    const score = (entry.v || 1) * (1 + 6 / (1 + (now - (entry.t || 0)) / 86400000));
    const host = parsed.hostname.replace(/^www\./i, '');
    const site = sites.get(host) || { text: host, url: parsed.origin + '/', title: '', score: 0, visited: true };
    site.score += score;
    if (parsed.pathname === '/' && entry.title) site.title = entry.title;
    sites.set(host, site);
    pages.push({ text: bareBrowserUrl(url), url, title: entry.title || '', score, visited: true });
  });
  BROWSER_SEED_SITES.forEach((host, i) => { if (!sites.has(host)) sites.set(host, { text: host, url: `https://${host}/`, title: '', score: 0.5 - i / 1000, visited: false }); });
  const starts = [...sites.values(), ...(query.includes('/') ? pages : [])].filter(item => item.text.toLowerCase().startsWith(query));
  const byTitle = pages.filter(item => item.title.toLowerCase().includes(query) && !starts.some(s => s.url === item.url));
  const seen = new Set();
  return [...starts.sort((a, b) => b.score - a.score), ...byTitle.sort((a, b) => b.score - a.score)]
    .filter(item => !seen.has(item.url) && seen.add(item.url)).slice(0, 5);
}

function updateBrowserSuggestions(complete) {
  const input = browserEl('browserUrl');
  // Typing replaces the selected completion, so the value is exactly what was typed.
  browserTyped = input.value;
  const items = browserCandidates(browserTyped.trim());
  // Inline: the best site that starts with what was typed fills the rest, selected, so typing on replaces it.
  const best = items.find(item => item.text.toLowerCase().startsWith(browserTyped.toLowerCase()));
  if (complete && best && browserTyped) {
    const rest = best.text.replace(/\/$/, '').slice(browserTyped.length);
    if (rest) { input.value = browserTyped + rest; input.setSelectionRange(browserTyped.length, input.value.length, 'backward'); }
  }
  const engine = BROWSER_ENGINES[getBrowserEngineId()];
  browserSuggestItems = browserTyped.trim()
    ? [...items, { search: true, text: browserTyped.trim(), url: null, title: hyadeOSI18n.t("desktop.browser.search-with", "Search with {engine}", { engine: engine.name }) }]
    : [];
  browserSuggestIndex = -1;
  renderBrowserSuggestions();
}

function renderBrowserSuggestions() {
  const box = browserEl('browserSuggest');
  if (!browserSuggestItems.length) { box.hidden = true; return; }
  const typed = browserTyped.trim().toLowerCase();
  // Hangs right under the address field, as wide as it.
  const bar = box.parentElement.getBoundingClientRect(), wrap = box.parentElement.querySelector('.browser-url-wrap').getBoundingClientRect();
  box.style.left = (wrap.left - bar.left) + 'px'; box.style.right = (bar.right - wrap.right) + 'px';
  box.replaceChildren(...browserSuggestItems.map((item, i) => {
    const row = document.createElement('div');
    row.className = 'browser-suggest-row' + (i === browserSuggestIndex ? ' selected' : '');
    const icon = document.createElement('span'); icon.className = 'material-symbols-outlined';
    icon.textContent = item.search ? 'search' : item.visited ? 'history' : 'public';
    const main = document.createElement('span'); main.className = 'browser-suggest-main';
    const label = item.search ? item.text : item.text.replace(/\/$/, '');
    // What was typed stays plain, the completion is bold, like the address bar fills it.
    if (!item.search && label.toLowerCase().startsWith(typed)) { main.append(document.createTextNode(label.slice(0, typed.length))); const b = document.createElement('b'); b.textContent = label.slice(typed.length); main.append(b); }
    else main.textContent = label;
    const sub = document.createElement('span'); sub.className = 'browser-suggest-sub'; sub.textContent = item.search ? item.title : item.title || '';
    row.append(icon, main, sub);
    row.addEventListener('mousedown', event => { event.preventDefault(); hideBrowserSuggestions(); navigateBrowser(item.search ? item.text : item.url); });
    return row;
  }));
  box.hidden = false;
}

function hideBrowserSuggestions() { browserSuggestItems = []; browserSuggestIndex = -1; browserEl('browserSuggest').hidden = true; }
function browserSuggestPick() {
  const item = browserSuggestItems[browserSuggestIndex];
  return item ? (item.search ? item.text : item.url) : null;
}
function handleBrowserSuggestKeys(event) {
  if (!browserSuggestItems.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return false;
  event.preventDefault();
  const n = browserSuggestItems.length;
  browserSuggestIndex = event.key === 'ArrowDown' ? (browserSuggestIndex + 1) % n : (browserSuggestIndex - 1 + n) % n;
  const item = browserSuggestItems[browserSuggestIndex];
  browserEl('browserUrl').value = item.search ? item.text : item.text.replace(/\/$/, '');
  renderBrowserSuggestions();
  return true;
}

// --- Themes: one colour tints the frame, the toolbar and the accents. ---
const BROWSER_THEMES = [
  ['default', '#2a2d33'], ['accent', 'var(--m3-accent-active)'], ['#4263eb', '#4263eb'], ['#2f9e44', '#2f9e44'],
  ['#9c36b5', '#9c36b5'], ['#e64980', '#e64980'], ['#1098ad', '#1098ad'], ['#f08c00', '#f08c00']
];
// --- Extensions: Chrome Web Store or unpacked, run only inside the browser's session. ---
const BROWSER_PARTITION = 'persist:hyadeos-browser';
const browserExtApi = () => window.hyadeOSElectron?.browserExtensions;
let browserExtensionList = [];
const browserStoreId = url => { const match = /^https:\/\/chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?([a-p]{32})/.exec(url || ''); return match ? match[1] : null; };

async function refreshBrowserExtensions() {
  if (!browserExtApi()) return;
  try { browserExtensionList = await browserExtApi().list(); } catch (e) { browserExtensionList = []; }
  renderBrowserExtActions();
  updateBrowserExtAdd(getActiveBrowserTab());
  if (!browserEl('browserExtPanel').hidden) renderBrowserExtPanel();
}

function renderBrowserExtActions() {
  browserEl('browserExtActions').replaceChildren(...browserExtensionList.filter(ext => ext.enabled && ext.id).map(ext => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'browser-nav-btn browser-ext-btn'; button.title = ext.name;
    if (ext.icon) { const img = document.createElement('img'); img.alt = ''; img.src = ext.icon; button.append(img); }
    else { const glyph = document.createElement('span'); glyph.className = 'material-symbols-outlined'; glyph.textContent = 'extension'; button.append(glyph); }
    button.addEventListener('click', () => openBrowserExtPopup(ext, button));
    return button;
  }));
}

function updateBrowserExtAdd(tab) {
  const chip = browserEl('browserExtAdd'), id = browserStoreId(tab?.url);
  chip.hidden = !id || !browserExtApi();
  if (!id) return;
  const installed = browserExtensionList.some(ext => ext.id === id);
  chip.disabled = installed;
  browserEl('browserExtAddLabel').textContent = installed ? hyadeOSI18n.t("desktop.browser.ext-installed", "Installed") : hyadeOSI18n.t("desktop.browser.ext-add", "Add to hyadeOS");
}

// An extension's popup is its own page, shown in a small view of the same session.
function openBrowserExtPopup(ext, anchor) {
  const pop = browserEl('browserExtPopup');
  if (!pop.hidden && pop.dataset.id === ext.id) { closeBrowserExtPopup(); return; }
  if (!ext.popup) { showNotification(ext.name, hyadeOSI18n.t("desktop.browser.ext-no-popup", "This extension works on its own and has no window."), '🧩'); return; }
  const view = document.createElement('webview');
  view.setAttribute('partition', BROWSER_PARTITION);
  view.style.width = '300px'; view.style.height = '150px';
  view.src = `chrome-extension://${ext.id}/${ext.popup}`;
  view.addEventListener('close', closeBrowserExtPopup);
  // Like Chrome, the popup takes its page's natural size; pages often fill in after loading.
  const fit = () => view.isConnected && view.executeJavaScript(`(() => { const html = document.documentElement, body = document.body; html.style.width = 'max-content'; const style = body && getComputedStyle(body); return [Math.ceil(html.getBoundingClientRect().width), Math.ceil(body ? body.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom) : html.scrollHeight)]; })()`)
    .then(([w, h]) => { view.style.width = Math.min(480, Math.max(200, w)) + 'px'; view.style.height = Math.min(560, Math.max(60, h)) + 'px'; }).catch(() => {});
  view.addEventListener('dom-ready', () => [0, 150, 500, 1200].forEach(ms => setTimeout(fit, ms)));
  pop.replaceChildren(view);
  pop.dataset.id = ext.id;
  const content = browserEl('browserTabContent').getBoundingClientRect(), at = anchor.getBoundingClientRect();
  pop.style.right = Math.max(8, content.right - at.right) + 'px';
  pop.hidden = false;
}
function closeBrowserExtPopup() {
  const pop = browserEl('browserExtPopup');
  pop.hidden = true; pop.replaceChildren(); delete pop.dataset.id;
}

function openBrowserExtPanel() {
  const panel = browserEl('browserExtPanel');
  if (!browserExtApi()) { showNotification(hyadeOSI18n.t("desktop.app.browser", "Browser"), hyadeOSI18n.t("desktop.browser.not-available", "Not available in this mode."), '⚠️'); return; }
  panel.innerHTML = `
    <div class="bx-head"><span>${hyadeOSI18n.t("desktop.browser.extensions", "Extensions")}</span><button class="browser-nav-btn" type="button" data-bx="close"><span class="material-symbols-outlined" style="font-size:18px;">close</span></button></div>
    <div class="bx-install"><input id="bxInput" type="text" spellcheck="false" placeholder="${hyadeOSI18n.t("desktop.browser.ext-input", "Chrome Web Store link or extension ID")}"><button class="bx-btn primary" type="button" data-bx="install">${hyadeOSI18n.t("desktop.browser.ext-install", "Install")}</button></div>
    <div class="bx-row">
      <button class="bx-btn" type="button" data-bx="store"><span class="material-symbols-outlined">storefront</span>${hyadeOSI18n.t("desktop.browser.ext-store", "Chrome Web Store")}</button>
      <button class="bx-btn" type="button" data-bx="unpacked"><span class="material-symbols-outlined">folder_open</span>${hyadeOSI18n.t("desktop.browser.ext-unpacked", "Load unpacked")}</button>
    </div>
    <div class="bx-status" id="bxStatus"></div>
    <div class="bx-list" id="bxList"></div>
    <div class="bx-note">${hyadeOSI18n.t("desktop.browser.ext-note", "Extensions only run in the browser. Some Chrome features they rely on may be missing.")}</div>`;
  panel.onclick = async event => {
    const button = event.target.closest('[data-bx]');
    if (!button) return;
    const act = button.dataset.bx;
    if (act === 'close') { panel.hidden = true; return; }
    if (act === 'store') { panel.hidden = true; createBrowserTab('https://chromewebstore.google.com/category/extensions'); return; }
    if (act === 'install') { installBrowserExtension(browserEl('bxInput').value); return; }
    if (act === 'unpacked') {
      try { const ext = await browserExtApi().loadUnpacked(); if (ext) setBrowserExtStatus(hyadeOSI18n.t("desktop.browser.ext-added", "{name} added", { name: ext.name })); }
      catch (error) { setBrowserExtStatus(browserExtError(error), true); }
      refreshBrowserExtensions(); return;
    }
    const id = button.closest('[data-ext]')?.dataset.ext;
    if (act === 'toggle' && id) { button.classList.toggle('on'); try { await browserExtApi().setEnabled(id, button.classList.contains('on')); } catch (error) { setBrowserExtStatus(browserExtError(error), true); } refreshBrowserExtensions(); }
    if (act === 'remove' && id) { try { await browserExtApi().remove(id); } catch (error) { setBrowserExtStatus(browserExtError(error), true); } refreshBrowserExtensions(); }
  };
  browserEl('bxInput').addEventListener('keydown', event => { if (event.key === 'Enter') installBrowserExtension(event.target.value); });
  panel.hidden = false;
  renderBrowserExtPanel();
  refreshBrowserExtensions();
}

// Errors from the main process arrive as "Error invoking remote method ...: Error: <message>".
const browserExtError = error => String(error?.message || error).replace(/^.*?Error:\s*/s, '');
function setBrowserExtStatus(text, isError) {
  const status = browserEl('bxStatus'); if (!status) return;
  status.textContent = text || ''; status.classList.toggle('error', !!isError);
}

function renderBrowserExtPanel() {
  const list = browserEl('bxList'); if (!list) return;
  if (!browserExtensionList.length) { list.innerHTML = `<div class="bx-empty">${hyadeOSI18n.t("desktop.browser.ext-empty", "No extensions yet")}</div>`; return; }
  list.replaceChildren(...browserExtensionList.map(ext => {
    const row = document.createElement('div'); row.className = 'bx-item'; row.dataset.ext = ext.id || '';
    const icon = ext.icon ? Object.assign(document.createElement('img'), { src: ext.icon, alt: '' }) : Object.assign(document.createElement('span'), { className: 'bx-noicon material-symbols-outlined', textContent: 'extension' });
    const text = document.createElement('div'); text.className = 'bx-text';
    const name = document.createElement('div'); name.className = 'bx-name'; name.textContent = ext.name + (ext.version ? '  ' + ext.version : '');
    const desc = document.createElement('div'); desc.className = 'bx-desc'; desc.textContent = ext.description || (ext.source === 'unpacked' ? hyadeOSI18n.t("desktop.browser.ext-unpacked", "Load unpacked") : '');
    desc.title = ext.description || '';
    text.append(name, desc);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'bx-switch' + (ext.enabled ? ' on' : ''); toggle.dataset.bx = 'toggle';
    toggle.title = ext.enabled ? hyadeOSI18n.t("desktop.browser.ext-disable", "Turn off") : hyadeOSI18n.t("desktop.browser.ext-enable", "Turn on");
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'browser-nav-btn'; remove.dataset.bx = 'remove';
    remove.title = hyadeOSI18n.t("common.remove", "Remove");
    remove.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">delete</span>';
    row.append(icon, text, toggle, remove);
    return row;
  }));
}

async function installBrowserExtension(input) {
  if (!browserExtApi() || !String(input || '').trim()) return;
  const chip = browserEl('browserExtAdd');
  chip.disabled = true; browserEl('browserExtAddLabel').textContent = hyadeOSI18n.t("desktop.browser.ext-installing", "Installing…");
  setBrowserExtStatus(hyadeOSI18n.t("desktop.browser.ext-installing", "Installing…"));
  try {
    const ext = await browserExtApi().install(String(input).trim());
    setBrowserExtStatus(hyadeOSI18n.t("desktop.browser.ext-added", "{name} added", { name: ext.name }));
    showNotification(hyadeOSI18n.t("desktop.browser.extensions", "Extensions"), hyadeOSI18n.t("desktop.browser.ext-added", "{name} added", { name: ext.name }), '🧩');
    if (browserEl('bxInput')) browserEl('bxInput').value = '';
  } catch (error) {
    setBrowserExtStatus(browserExtError(error), true);
    showNotification(hyadeOSI18n.t("desktop.browser.extensions", "Extensions"), browserExtError(error), '⚠️');
  }
  refreshBrowserExtensions();
}

function runBrowserShortcut(name) {
  const tab = getActiveBrowserTab();
  switch (name) {
    case 'new-tab': createBrowserTab(); break;
    case 'close-tab': if (tab) closeBrowserTab(tab.id); break;
    case 'focus-url': if (browserState.collapsed) document.getElementById('popup2').classList.add('bsb-peek'); browserEl('browserUrl').focus(); browserEl('browserUrl').select(); break;
    case 'reload': browserNav('reload'); break;
    case 'back': browserNav('back'); break;
    case 'forward': browserNav('fwd'); break;
    case 'find': openBrowserFind(); break;
    case 'zoom-in': browserZoom(1); break;
    case 'zoom-out': browserZoom(-1); break;
    case 'zoom-reset': browserZoom(0); break;
    case 'next-tab': cycleBrowserTab(1); break;
    case 'prev-tab': cycleBrowserTab(-1); break;
    case 'toggle-sidebar': toggleBrowserSidebar(); break;
    default: {
      const fav = /^favorite-([1-9])$/.exec(name);
      if (fav && browserState.favorites[fav[1] - 1]) openBrowserItem(browserState.favorites[fav[1] - 1].id);
    }
  }
}

(function setupBrowserControls() {
  const urlInput = browserEl('browserUrl');
  urlInput.addEventListener('focus', () => { urlInput.value = browserDisplayUrl(getActiveBrowserTab()?.url); setTimeout(() => urlInput.select(), 0); });
  urlInput.addEventListener('input', event => updateBrowserSuggestions(!/^delete/.test(event.inputType || '')));
  urlInput.addEventListener('keydown', event => {
    if (handleBrowserSuggestKeys(event)) return;
    if (event.key === 'Enter') { const pick = browserSuggestPick(); hideBrowserSuggestions(); navigateBrowser(pick || urlInput.value); }
    if (event.key === 'Escape') { hideBrowserSuggestions(); urlInput.value = browserDisplayUrl(getActiveBrowserTab()?.url); urlInput.blur(); }
  });
  urlInput.addEventListener('blur', () => { hideBrowserSuggestions(); updateBrowserToolbar(); });
  browserEl('browserExtAdd').addEventListener('click', () => installBrowserExtension(getActiveBrowserTab()?.url));
  document.addEventListener('mousedown', event => {
    const pop = browserEl('browserExtPopup');
    if (!pop.hidden && !pop.contains(event.target) && !event.target.closest('.browser-ext-btn')) closeBrowserExtPopup();
  });
  // Sidebar: spaces pill, peek when collapsed, resizing, closing popovers.
  browserEl('browserSpaceBtn').addEventListener('click', event => { event.stopPropagation(); browserEl('browserRowMenu').hidden = true; showBrowserSpaceMenu(); });
  browserEl('browserClearToday').addEventListener('click', () => {
    const removed = BS.clearToday(browserState, browserState.currentSpace);
    removed.forEach(item => { const tab = browserTabForItem(item.id); if (tab) { browserTabs.splice(browserTabs.indexOf(tab), 1); destroyBrowserTab(tab); } });
    saveBrowserState();
    if (!getActiveBrowserTab()) switchBrowserSpace(browserState.currentSpace);
    else renderBrowserSidebar();
  });
  const browserPopup = document.getElementById('popup2');
  const sidebarEl = browserEl('browserSidebar');
  const keepPeek = () => browserEl('browserUrl') === document.activeElement || !browserEl('browserSpaceMenu').hidden || !browserEl('browserRowMenu').hidden;
  browserEl('browserPeek').addEventListener('mouseenter', () => { if (browserState.collapsed) browserPopup.classList.add('bsb-peek'); });
  sidebarEl.addEventListener('mouseleave', () => { if (!keepPeek()) browserPopup.classList.remove('bsb-peek'); });
  urlInput.addEventListener('blur', () => setTimeout(() => { if (!sidebarEl.matches(':hover') && !keepPeek()) browserPopup.classList.remove('bsb-peek'); }, 0));
  browserEl('browserResize').addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const left = browserPopup.getBoundingClientRect().left;
    browserPopup.classList.remove('bsb-ready'); // the card follows the pointer without easing
    const move = e => {
      browserState.sidebarWidth = Math.round(Math.min(BS.WIDTH.max, Math.max(BS.WIDTH.min, e.clientX - left)));
      browserPopup.style.setProperty('--bs-w', browserState.sidebarWidth + 'px');
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      browserPopup.classList.add('bsb-ready');
      saveBrowserState();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  document.addEventListener('mousedown', event => {
    if (event.target.closest('#browserSpaceMenu, #browserRowMenu, #browserSpaceBtn')) return;
    hideBrowserPopovers();
  });
  browserPopup.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (!browserEl('browserSpaceMenu').hidden || !browserEl('browserRowMenu').hidden)) { event.stopPropagation(); hideBrowserPopovers(); }
  });
  applyBrowserLayout();
  refreshBrowserExtensions();
  const findInput = browserEl('browserFindInput');
  findInput.addEventListener('input', () => browserFind(true, false));
  findInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') browserFind(!event.shiftKey);
    if (event.key === 'Escape') closeBrowserFind();
  });
  document.addEventListener('mousedown', event => {
    const menu = browserEl('browserMenu');
    if (!menu.hidden && !menu.contains(event.target) && !event.target.closest('[onclick="toggleBrowserMenu()"]')) menu.hidden = true;
  });
  // Shortcuts while focus is on the browser chrome (address bar, tabs)...
  document.addEventListener('keydown', event => {
    const popup = document.getElementById('popup2');
    if (!popup.classList.contains('active') || !popup.classList.contains('focused')) return;
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey || event.metaKey;
    let name = null;
    if (key === 'f5' || (ctrl && key === 'r')) name = 'reload';
    else if (event.altKey && key === 'arrowleft') name = 'back';
    else if (event.altKey && key === 'arrowright') name = 'forward';
    else if (ctrl && key === 'tab') name = event.shiftKey ? 'prev-tab' : 'next-tab';
    else if (ctrl && event.shiftKey && key === 'b') name = 'toggle-sidebar';
    else if (ctrl && /^[1-9]$/.test(key)) name = 'favorite-' + key;
    else if (ctrl) name = { t: 'new-tab', w: 'close-tab', l: 'focus-url', f: 'find', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset' }[key] || null;
    if (!name) return;
    event.preventDefault();
    runBrowserShortcut(name);
  });
  // Mouse back/forward over the browser chrome (tabs, toolbar) navigates the active tab.
  // Registered before the shell's blocker, which swallows these buttons everywhere else.
  window.addEventListener('mouseup', event => {
    if ((event.button === 3 || event.button === 4) && event.target.closest?.('#popup2')) {
      browserNav(event.button === 3 ? 'back' : 'fwd');
    }
  }, true);
  // ...and while focus is inside a page (forwarded by the Electron shell).
  window.hyadeOSElectron?.onBrowserShortcut?.(name => {
    if (document.getElementById('popup2').classList.contains('active')) runBrowserShortcut(name);
  });
  window.hyadeOSElectron?.onBrowserOpenTab?.(url => {
    if (/^https?:\/\//i.test(url)) openUrlInBrowserTab(url);
  });
})();

