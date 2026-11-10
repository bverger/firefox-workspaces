// Shared by the background script and the sidebar.
//
// Workspaces, favorites and folders live in storage.sync; which workspace /
// favorite / folder item each open tab belongs to lives in session values on
// the tab, so nothing depends on the background event page staying alive.
// Workspaces are a visual grouping: switching shows the tabs of one workspace
// and hides the rest with tabs.hide.
const WS = (() => {
  const COLORS = ['#4f8cff', '#f59e0b', '#10b981', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];
  const DEFAULTS = [
    { id: 'personal', name: 'Personal', color: COLORS[0], favorites: [] },
    { id: 'work', name: 'Work', color: COLORS[1], favorites: [] },
  ];

  // Mutations from the same page run one after another so rapid shortcuts or
  // swipes don't interleave their show/hide calls.
  let queue = Promise.resolve();
  function serial(fn) {
    const p = queue.then(fn);
    queue = p.catch(console.error);
    return p;
  }

  function notify() {
    browser.runtime.sendMessage({ type: 'ws-refresh' }).catch(() => {});
  }

  const uuid = () => crypto.randomUUID();
  const folderKey = (id) => `folder:${id}`;
  const ARCHIVE_MAX = 50;
  const ARCHIVE_MAX_DAYS = 30;
  const DEFAULT_ARCHIVE_HOURS = 12; // Arc's default

  // Firefox Sync carries storage.sync to the user's other computers. Each
  // workspace and each folder is its own item to stay under the 8 KB per-item
  // quota. Open tabs and the active workspace stay per device.
  async function readSync() {
    const all = await browser.storage.sync.get(null);
    const list = (all.wsOrder ?? []).map((id) => all[`ws:${id}`]).filter(Boolean);
    const folders = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith('folder:')) folders[value.id] = value;
    }
    return { workspaces: list.length ? list : structuredClone(DEFAULTS), folders };
  }

  const getWorkspaces = async () => (await readSync()).workspaces;

  async function saveWorkspaces(list) {
    const stored = Object.keys(await browser.storage.sync.get(null));
    const data = { wsOrder: list.map((w) => w.id) };
    for (const w of list) data[`ws:${w.id}`] = w;
    await browser.storage.sync.set(data);
    const stale = stored.filter((key) => key.startsWith('ws:') && !(key in data));
    if (stale.length) await browser.storage.sync.remove(stale);
  }

  async function updateWorkspaces(fn) {
    const list = await getWorkspaces();
    fn(list);
    await saveWorkspaces(list);
  }

  async function updateFolder(id, fn) {
    const key = folderKey(id);
    const { [key]: folder } = await browser.storage.sync.get(key);
    if (!folder) return;
    fn(folder);
    await browser.storage.sync.set({ [key]: folder });
  }

  async function getActiveId(windowId, workspaces) {
    workspaces ??= await getWorkspaces();
    const id = await browser.sessions.getWindowValue(windowId, 'ws');
    if (workspaces.some((w) => w.id === id)) return id;
    const { lastWs } = await browser.storage.local.get('lastWs');
    return workspaces.some((w) => w.id === lastWs) ? lastWs : workspaces[0].id;
  }

  // Every tab of a window, tagged with `ws` (null for native pinned tabs, which
  // stay visible everywhere), `fav` (the favorite URL it was opened from) and
  // `item` (the folder item it was opened from). Tabs with no stored workspace
  // yet (just created, or restored before session values came back) count as
  // part of the active one; nothing is written here.
  async function windowState(windowId) {
    const { workspaces, folders } = await readSync();
    const [activeId, tabs] = await Promise.all([
      getActiveId(windowId, workspaces),
      browser.tabs.query({ windowId }),
    ]);
    const ids = new Set(workspaces.map((w) => w.id));
    await Promise.all(tabs.map(async (tab) => {
      const [ws, fav, item] = await Promise.all(
        ['ws', 'fav', 'item'].map((key) => browser.sessions.getTabValue(tab.id, key)),
      );
      tab.ws = tab.pinned ? null : ids.has(ws) ? ws : activeId;
      tab.wsStored = ws === tab.ws;
      tab.fav = fav;
      tab.item = item;
    }));
    tabs.sort((a, b) => a.index - b.index);
    return { workspaces, folders, activeId, tabs };
  }

  const setTabWs = (tabId, wsId) => browser.sessions.setTabValue(tabId, 'ws', wsId);

  // Removes a session value from every tab where it is one of `values`.
  async function clearTabValues(key, values) {
    if (!values.size) return;
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map(async (t) => {
      if (values.has(await browser.sessions.getTabValue(t.id, key))) {
        await browser.sessions.removeTabValue(t.id, key);
      }
    }));
  }

  async function newTab(windowId, wsId, url) {
    const tab = await browser.tabs.create({ windowId, url, active: true });
    await setTabWs(tab.id, wsId);
    return tab;
  }

  // Shows the tabs of `wsId`, hides the rest and makes sure the selected tab
  // belongs to it. Called with the current workspace it re-syncs the window.
  async function doSwitch(windowId, wsId) {
    const { workspaces, tabs } = await windowState(windowId);
    if (!workspaces.some((w) => w.id === wsId)) return;
    await browser.sessions.setWindowValue(windowId, 'ws', wsId);
    await browser.storage.local.set({ lastWs: wsId });
    await Promise.all(tabs.filter((t) => t.ws && !t.wsStored).map((t) => setTabWs(t.id, t.ws)));

    const own = tabs.filter((t) => t.ws === wsId);
    const hiddenOwn = own.filter((t) => t.hidden).map((t) => t.id);
    if (hiddenOwn.length) await browser.tabs.show(hiddenOwn);

    // The selected tab can't be hidden, so move the selection first.
    const active = tabs.find((t) => t.active);
    if (active?.ws && active.ws !== wsId) {
      const target = own.sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
      if (target) await browser.tabs.update(target.id, { active: true });
      else await newTab(windowId, wsId);
    }
    const toHide = tabs.filter((t) => t.ws && t.ws !== wsId && !t.hidden).map((t) => t.id);
    if (toHide.length) await browser.tabs.hide(toHide);
    notify();
  }

  const switchTo = (windowId, wsId) => serial(() => doSwitch(windowId, wsId));

  // Next (step 1) or previous (step -1) workspace, wrapping around.
  const switchBy = (windowId, step) => serial(async () => {
    const workspaces = await getWorkspaces();
    const activeId = await getActiveId(windowId, workspaces);
    const i = workspaces.findIndex((w) => w.id === activeId);
    const next = workspaces[(i + step + workspaces.length) % workspaces.length];
    await doSwitch(windowId, next.id);
  });

  // The tab leaves its favorite / folder item behind (they stay in the old
  // workspace, closed).
  const moveTab = (tabId, wsId) => serial(async () => {
    const tab = await browser.tabs.get(tabId);
    if (tab.pinned) return;
    await setTabWs(tabId, wsId);
    await browser.sessions.removeTabValue(tabId, 'fav');
    await browser.sessions.removeTabValue(tabId, 'item');
    await doSwitch(tab.windowId, await getActiveId(tab.windowId));
  });

  async function tabWorkspace(tab) {
    const workspaces = await getWorkspaces();
    const ws = await browser.sessions.getTabValue(tab.id, 'ws');
    return workspaces.some((w) => w.id === ws) ? ws : getActiveId(tab.windowId, workspaces);
  }

  // Only web pages can be saved: tabs.create refuses about:, file:, etc.
  const canSave = (tab) => !tab.pinned && /^https?:/.test(tab.url);

  function savedEntry(tab) {
    // data: icons can be large; skip them to keep the synced items small.
    const icon = /^https?:/.test(tab.favIconUrl) ? tab.favIconUrl : undefined;
    return { url: tab.url, title: tab.title, icon };
  }

  // Unlinks a tab from the favorite or folder item it came from, removing that
  // entry, so dragging between favorites and folders moves instead of copying.
  async function detachTab(tab) {
    const [fav, item] = await Promise.all([
      browser.sessions.getTabValue(tab.id, 'fav'),
      browser.sessions.getTabValue(tab.id, 'item'),
    ]);
    if (fav) await removeFavorite(await tabWorkspace(tab), fav);
    if (item) await removeItem(item);
  }

  // --- Favorites ----------------------------------------------------------

  async function addFavorite(tabId) {
    const tab = await browser.tabs.get(tabId);
    if (!canSave(tab)) return;
    await detachTab(tab);
    const ws = await tabWorkspace(tab);
    await updateWorkspaces((list) => {
      const w = list.find((x) => x.id === ws);
      w.favorites ??= [];
      if (!w.favorites.some((f) => f.url === tab.url)) w.favorites.push(savedEntry(tab));
    });
    await browser.sessions.setTabValue(tabId, 'fav', tab.url);
    notify();
  }

  // Open tabs of the favorite stay open as normal tabs.
  async function removeFavorite(wsId, url) {
    await updateWorkspaces((list) => {
      const w = list.find((x) => x.id === wsId);
      if (w) w.favorites = (w.favorites ?? []).filter((f) => f.url !== url);
    });
    await clearTabValues('fav', new Set([url]));
    notify();
  }

  async function toggleFavorite(tabId) {
    const tab = await browser.tabs.get(tabId);
    const fav = await browser.sessions.getTabValue(tabId, 'fav');
    if (fav) await removeFavorite(await tabWorkspace(tab), fav);
    else await addFavorite(tabId);
  }

  async function openFavorite(windowId, wsId, url) {
    const { tabs } = await windowState(windowId);
    const open = tabs.find((t) => t.ws === wsId && t.fav === url);
    if (open) return browser.tabs.update(open.id, { active: true });
    const tab = await newTab(windowId, wsId, url);
    await browser.sessions.setTabValue(tab.id, 'fav', url);
  }

  // --- Folders and pinned tabs ----------------------------------------------
  // Like Arc: a folder holds entries, either saved items ({id, url, title,
  // icon}) or subfolders ({folder: id}). Clicking an item opens or selects its
  // tab; closing that tab keeps the item. The pinned section of a workspace is
  // a hidden root folder (`ws.pinnedFolder`), so pinned tabs and top-level
  // folders share all the folder logic and keep Arc's mixed order.

  const isFolderRef = (entry) => 'folder' in entry;

  async function ensurePinnedFolder(wsId) {
    const list = await getWorkspaces();
    const w = list.find((x) => x.id === wsId);
    if (w.pinnedFolder) return w.pinnedFolder;
    const id = uuid();
    await browser.storage.sync.set({ [folderKey(id)]: { id, name: '', items: [] } });
    w.pinnedFolder = id;
    await saveWorkspaces(list);
    return id;
  }

  // Ids of `rootId` and every folder nested under it.
  function subtree(folders, rootId) {
    const ids = [];
    const walk = (id) => {
      if (!folders[id] || ids.includes(id)) return;
      ids.push(id);
      for (const e of folders[id].items) if (isFolderRef(e)) walk(e.folder);
    };
    walk(rootId);
    return ids;
  }

  const workspaceFolders = (ws, folders) => subtree(folders, ws.pinnedFolder);

  // The folder whose entries include `folderId` as a subfolder.
  const parentOf = (folders, folderId) =>
    Object.values(folders).find((f) => f.items.some((e) => e.folder === folderId));

  // Earlier versions kept top-level folders in `ws.folders`; move them into the
  // pinned root.
  async function migrateFolders() {
    const list = await getWorkspaces();
    for (const w of list.filter((x) => x.folders?.length)) {
      const root = await ensurePinnedFolder(w.id);
      await updateFolder(root, (f) => f.items.push(...w.folders.map((folder) => ({ folder }))));
      await updateWorkspaces((l) => {
        delete l.find((x) => x.id === w.id).folders;
      });
    }
  }

  async function pinTab(tabId, index) {
    const ws = await tabWorkspace(await browser.tabs.get(tabId));
    await addToFolder(tabId, await ensurePinnedFolder(ws), index);
  }

  const pinItem = async (itemId, wsId) => moveItem(itemId, await ensurePinnedFolder(wsId));

  // Favorite URLs and pinned/folder item ids of a workspace: tabs linked to
  // them are "saved"; every other open tab belongs to Today.
  function savedSets(ws, folders) {
    const items = workspaceFolders(ws, folders).flatMap((id) => folders[id].items.filter((e) => !isFolderRef(e)));
    return {
      favUrls: new Set((ws.favorites ?? []).map((f) => f.url)),
      itemIds: new Set(items.map((i) => i.id)),
    };
  }

  const isSaved = (tab, { favUrls, itemIds }) => tab.pinned || favUrls.has(tab.fav) || itemIds.has(tab.item);

  // A new empty folder at the end of `parentId` (the pinned root by default).
  async function createFolder(wsId, name = 'Nueva carpeta', parentId) {
    const id = uuid();
    await browser.storage.sync.set({ [folderKey(id)]: { id, name, items: [] } });
    await updateFolder(parentId ?? (await ensurePinnedFolder(wsId)), (f) => f.items.push({ folder: id }));
    notify();
    return id;
  }

  async function renameFolder(id, name) {
    await updateFolder(id, (f) => {
      f.name = name;
    });
    notify();
  }

  // Deletes folders by id (not their subfolders). Open tabs of their items
  // stay open as normal tabs.
  async function deleteFolders(ids) {
    if (!ids.length) return;
    const keys = ids.map(folderKey);
    const stored = await browser.storage.sync.get(keys);
    await browser.storage.sync.remove(keys);
    const items = Object.values(stored).flatMap((f) => f.items.filter((e) => !isFolderRef(e)).map((i) => i.id));
    await clearTabValues('item', new Set(items));
  }

  // Deletes a folder with everything inside it.
  async function deleteFolder(id) {
    const { folders } = await readSync();
    const parent = parentOf(folders, id);
    if (parent) {
      await updateFolder(parent.id, (f) => {
        f.items = f.items.filter((e) => e.folder !== id);
      });
    }
    await deleteFolders(subtree(folders, id));
    notify();
  }

  // Moves a folder (with its contents) to `index` of `toParentId`.
  async function moveFolder(folderId, toParentId, index) {
    const { folders } = await readSync();
    if (subtree(folders, folderId).includes(toParentId)) return; // into itself
    const from = parentOf(folders, folderId);
    if (!from) return;
    await moveEntry(from, from.items.findIndex((e) => e.folder === folderId), toParentId, index);
  }

  async function findItem(itemId) {
    const { folders } = await readSync();
    return Object.values(folders).find((f) => f.items.some((i) => i.id === itemId));
  }

  async function addToFolder(tabId, folderId, index) {
    const tab = await browser.tabs.get(tabId);
    if (!canSave(tab)) return;
    await detachTab(tab);
    const item = { id: uuid(), ...savedEntry(tab) };
    await updateFolder(folderId, (f) => f.items.splice(index ?? f.items.length, 0, item));
    await browser.sessions.setTabValue(tabId, 'item', item.id);
    notify();
  }

  // Its open tab, if any, stays open as a normal tab.
  async function removeItem(itemId) {
    const folder = await findItem(itemId);
    if (folder) {
      await updateFolder(folder.id, (f) => {
        f.items = f.items.filter((i) => i.id !== itemId);
      });
    }
    await clearTabValues('item', new Set([itemId]));
    notify();
  }

  // Moves entry `fromIndex` of folder `from` to `index` of `toFolderId` (end
  // when omitted); also reorders inside a folder.
  async function moveEntry(from, fromIndex, toFolderId, index) {
    if (fromIndex < 0) return;
    const entry = from.items[fromIndex];
    if (from.id === toFolderId) {
      await updateFolder(from.id, (f) => {
        f.items.splice(fromIndex, 1);
        const to = index ?? f.items.length;
        f.items.splice(to > fromIndex ? to - 1 : to, 0, entry);
      });
    } else {
      await updateFolder(from.id, (f) => f.items.splice(fromIndex, 1));
      await updateFolder(toFolderId, (f) => f.items.splice(index ?? f.items.length, 0, entry));
    }
    notify();
  }

  async function moveItem(itemId, toFolderId, index) {
    const from = await findItem(itemId);
    if (from) await moveEntry(from, from.items.findIndex((i) => i.id === itemId), toFolderId, index);
  }

  // Keeps the icon of an imported or old item once its tab shows a favicon.
  async function updateItemIcon(itemId, icon) {
    if (!/^https?:/.test(icon)) return;
    const folder = await findItem(itemId);
    if (!folder || folder.items.find((i) => i.id === itemId).icon === icon) return;
    await updateFolder(folder.id, (f) => {
      f.items.find((i) => i.id === itemId).icon = icon;
    });
  }

  async function openItem(windowId, wsId, item) {
    const { tabs } = await windowState(windowId);
    const open = tabs.find((t) => t.ws === wsId && t.item === item.id);
    if (open) return browser.tabs.update(open.id, { active: true });
    const tab = await newTab(windowId, wsId, item.url);
    await browser.sessions.setTabValue(tab.id, 'item', item.id);
  }

  // Turns an item back into a normal open tab (dragged out of its folder).
  async function unpinItem(windowId, wsId, item) {
    await openItem(windowId, wsId, item);
    await removeItem(item.id);
  }

  // --- Import -------------------------------------------------------------
  // Data from tools/arc-export.py: {workspaces: [{name, emoji, color,
  // favorites: [{title, url}], pinned: [{title, url} | {name, children}]}]}.
  // Each workspace is merged into the one with the same name, or created.
  async function importData(data) {
    const summary = [];
    for (const src of data.workspaces ?? []) {
      let list = await getWorkspaces();
      let ws = list.find((w) => w.name.toLowerCase() === src.name.toLowerCase());
      if (!ws) {
        await createWorkspace(src.name);
        list = await getWorkspaces();
        ws = list.at(-1);
      }
      await editWorkspace(ws.id, {
        ...(src.emoji && { emoji: src.emoji }),
        ...(src.color && { color: src.color }),
      });

      let tabs = 0;
      let folderCount = 0;
      const writes = {};
      const build = (entries) => entries.map((e) => {
        if (!e.children) {
          tabs++;
          return { id: uuid(), url: e.url, title: e.title };
        }
        folderCount++;
        const id = uuid();
        writes[folderKey(id)] = { id, name: e.name, items: build(e.children) };
        return { folder: id };
      });
      const entries = build(src.pinned ?? []);
      await browser.storage.sync.set(writes);
      const root = await ensurePinnedFolder(ws.id);
      await updateFolder(root, (f) => f.items.push(...entries));

      const favorites = (src.favorites ?? []).filter((f) => /^https?:/.test(f.url));
      if (favorites.length) {
        await updateWorkspaces((l) => {
          const w = l.find((x) => x.id === ws.id);
          w.favorites ??= [];
          for (const f of favorites) {
            if (!w.favorites.some((x) => x.url === f.url)) w.favorites.push({ url: f.url, title: f.title });
          }
        });
      }
      summary.push({ name: ws.name, tabs, folders: folderCount, favorites: favorites.length });
    }
    // Synced, so the import button disappears on every computer.
    await browser.storage.sync.set({ importedAt: Date.now() });
    notify();
    return summary;
  }

  async function hasImported() {
    const { importedAt } = await browser.storage.sync.get('importedAt');
    return Boolean(importedAt);
  }

  // Versions before the importedAt flag: treat any saved pinned/folder item
  // as a sign the import was already done.
  async function markImportedIfPinned() {
    if (await hasImported()) return;
    const { folders } = await readSync();
    if (Object.values(folders).some((f) => f.items.length)) {
      await browser.storage.sync.set({ importedAt: Date.now() });
    }
  }

  // --- Favicon cache --------------------------------------------------------
  // Firefox often reports favicons as data: URIs, too big for storage.sync, so
  // each device keeps the last favicon seen per site in storage.local
  // (`icon:<hostname>`). Saved items that aren't open show it.

  const MAX_ICON_LENGTH = 20000;

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  // Last resort for sites this device hasn't seen yet: the site's own
  // /favicon.ico, asked of the site itself (no third-party icon service).
  // Sites without one fall back to the default icon through the img's onerror.
  function siteIcon(url) {
    try {
      const { protocol, origin } = new URL(url);
      return /^https?:$/.test(protocol) ? `${origin}/favicon.ico` : undefined;
    } catch {
      return undefined;
    }
  }

  async function cacheIcon(url, icon) {
    const host = hostOf(url);
    if (!host || !icon || icon.length > MAX_ICON_LENGTH || !/^(https?:|data:image\/)/.test(icon)) return;
    const key = `icon:${host}`;
    const { [key]: cached } = await browser.storage.local.get(key);
    if (cached !== icon) await browser.storage.local.set({ [key]: icon });
  }

  async function getIconCache() {
    const all = await browser.storage.local.get(null);
    const icons = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith('icon:')) icons[key.slice(5)] = value;
    }
    return icons;
  }

  // --- Today and archive ------------------------------------------------------
  // Like Arc, Today tabs (open, not saved) that haven't been used for
  // `archiveAfterHours` are closed and kept in a per-device archive; saved tabs
  // are only unloaded. Native pinned, selected and playing tabs are left alone.

  async function getArchiveHours() {
    const { archiveAfterHours } = await browser.storage.sync.get('archiveAfterHours');
    return archiveAfterHours ?? DEFAULT_ARCHIVE_HOURS;
  }

  // The archive keeps the newest ARCHIVE_MAX entries, none older than
  // ARCHIVE_MAX_DAYS.
  const pruned = (archive) => {
    const cutoff = Date.now() - ARCHIVE_MAX_DAYS * 24 * 3600 * 1000;
    return archive.filter((a) => a.closedAt >= cutoff).slice(0, ARCHIVE_MAX);
  };

  async function archiveTabs(tabs) {
    if (!tabs.length) return;
    const now = Date.now();
    const entries = tabs.filter(canSave).map((t) => ({ ...savedEntry(t), closedAt: now }));
    if (entries.length) {
      const { archive = [] } = await browser.storage.local.get('archive');
      await browser.storage.local.set({ archive: pruned([...entries, ...archive]) });
    }
    await browser.tabs.remove(tabs.map((t) => t.id));
  }

  // Runs with the auto-archive alarm, so old entries expire even when nothing
  // new is archived (and with auto-archive set to "never").
  async function expireArchive() {
    const { archive = [] } = await browser.storage.local.get('archive');
    const kept = pruned(archive);
    if (kept.length !== archive.length) await browser.storage.local.set({ archive: kept });
  }

  async function todayTabs(windowId) {
    const { workspaces, folders, activeId, tabs } = await windowState(windowId);
    const sets = new Map(workspaces.map((w) => [w.id, savedSets(w, folders)]));
    return { activeId, tabs, today: tabs.filter((t) => t.ws && !isSaved(t, sets.get(t.ws))) };
  }

  // Arc's "Clear": archives every Today tab of the active workspace.
  async function clearToday(windowId) {
    const { activeId, today } = await todayTabs(windowId);
    await archiveTabs(today.filter((t) => t.ws === activeId));
  }

  async function autoArchive() {
    await expireArchive();
    const hours = await getArchiveHours();
    if (!hours) return;
    const cutoff = Date.now() - hours * 3600 * 1000;
    const stale = (t) => !t.active && !t.audible && !t.pinned && t.lastAccessed < cutoff;
    for (const win of await browser.windows.getAll({ windowTypes: ['normal'] })) {
      const { tabs, today } = await todayTabs(win.id);
      const todayIds = new Set(today.map((t) => t.id));
      const unload = tabs.filter((t) => stale(t) && !todayIds.has(t.id) && !t.discarded).map((t) => t.id);
      if (unload.length) await browser.tabs.discard(unload);
      await archiveTabs(today.filter(stale));
    }
  }

  async function removeArchived(closedAt, url) {
    const { archive = [] } = await browser.storage.local.get('archive');
    await browser.storage.local.set({ archive: archive.filter((a) => !(a.closedAt === closedAt && a.url === url)) });
  }

  const clearArchive = () => browser.storage.local.set({ archive: [] });

  async function restoreArchived(windowId, wsId, closedAt, url) {
    await removeArchived(closedAt, url);
    await newTab(windowId, wsId, url);
  }

  // --- Auto-hide ------------------------------------------------------------
  // The extension can't change Firefox's UI, but userChrome.css can see the
  // sidebar title: a trailing zero-width space turns its auto-hide rules on.

  const AUTOHIDE_MARK = '​';

  async function getAutohide() {
    const { autohide = false } = await browser.storage.sync.get('autohide');
    return autohide;
  }

  async function applyAutohide() {
    const name = browser.runtime.getManifest().name;
    await browser.sidebarAction.setTitle({ title: (await getAutohide()) ? name + AUTOHIDE_MARK : name });
  }

  async function setAutohide(on) {
    await browser.storage.sync.set({ autohide: on });
    await applyAutohide();
  }

  // --- Workspaces -----------------------------------------------------------

  async function createWorkspace(name) {
    const id = uuid();
    await updateWorkspaces((list) => {
      list.push({ id, name, color: COLORS[list.length % COLORS.length], favorites: [] });
    });
    return id;
  }

  const editWorkspace = (id, patch) => updateWorkspaces((list) => {
    const w = list.find((x) => x.id === id);
    if (w) Object.assign(w, patch);
  });

  // Tabs of a deleted workspace move to the first remaining one; its folders
  // and pinned tabs are deleted.
  const deleteWorkspace = (id) => serial(async () => {
    const list = await getWorkspaces();
    if (list.length < 2) return;
    const rest = list.filter((w) => w.id !== id);
    const fallback = rest[0].id;
    await saveWorkspaces(rest);
    const deleted = list.find((w) => w.id === id);
    const { folders } = await readSync();
    await deleteFolders([deleted.pinnedFolder, ...(deleted.folders ?? [])].flatMap((f) => subtree(folders, f)));
    for (const win of await browser.windows.getAll({ windowTypes: ['normal'] })) {
      const tabs = await browser.tabs.query({ windowId: win.id });
      await Promise.all(tabs.map(async (t) => {
        if ((await browser.sessions.getTabValue(t.id, 'ws')) === id) await setTabWs(t.id, fallback);
      }));
      const active = await browser.sessions.getWindowValue(win.id, 'ws');
      await doSwitch(win.id, !active || active === id ? fallback : active);
    }
  });

  return {
    COLORS, notify, readSync, getWorkspaces, getActiveId, windowState, tabWorkspace, canSave,
    newTab, switchTo, switchBy, moveTab,
    addFavorite, removeFavorite, toggleFavorite, openFavorite,
    createFolder, renameFolder, deleteFolder, moveFolder, addToFolder, removeItem, moveItem, openItem, unpinItem,
    updateItemIcon, pinTab, pinItem, savedSets, isSaved, isFolderRef, workspaceFolders, migrateFolders, importData, hasImported, markImportedIfPinned,
    DEFAULT_ARCHIVE_HOURS, getArchiveHours, clearToday, autoArchive, restoreArchived, removeArchived, clearArchive,
    getAutohide, applyAutohide, setAutohide, hostOf, siteIcon, cacheIcon, getIconCache,
    createWorkspace, editWorkspace, deleteWorkspace,
  };
})();
