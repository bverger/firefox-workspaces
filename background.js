// Keeps tab/window membership consistent and handles menus and shortcuts.
// Delays below give session restore time to bring back stored values before
// we assign defaults.
const RESTORE_GRACE_MS = 1000;
const ARCHIVE_ALARM = 'auto-archive';

// Alarms don't survive a browser restart, so this runs on every start.
function scheduleArchive() {
  browser.alarms.create(ARCHIVE_ALARM, { delayInMinutes: 1, periodInMinutes: 10 });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ARCHIVE_ALARM) WS.autoArchive().catch(console.error);
});

async function syncAllWindows() {
  for (const win of await browser.windows.getAll({ windowTypes: ['normal'] })) {
    await WS.switchTo(win.id, await WS.getActiveId(win.id));
  }
}

browser.runtime.onInstalled.addListener(async () => {
  await WS.migrateFolders();
  buildMenus();
  scheduleArchive();
  WS.applyAutohide();
  syncAllWindows();
});

browser.runtime.onStartup.addListener(() => {
  buildMenus();
  scheduleArchive();
  WS.applyAutohide();
  setTimeout(syncAllWindows, RESTORE_GRACE_MS * 1.5);
});

// Also fires when Firefox Sync brings changes from another computer.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.autohide) WS.applyAutohide();
  if (Object.keys(changes).some((key) => key !== 'autohide' && key !== 'archiveAfterHours')) buildMenus();
});

// New tabs join the workspace that is active in their window.
browser.tabs.onCreated.addListener((created) => {
  setTimeout(async () => {
    try {
      const tab = await browser.tabs.get(created.id);
      if (tab.pinned || (await browser.sessions.getTabValue(tab.id, 'ws'))) return;
      await browser.sessions.setTabValue(tab.id, 'ws', await WS.getActiveId(tab.windowId));
    } catch {
      // Tab closed in the meantime.
    }
  }, RESTORE_GRACE_MS);
});

browser.windows.onCreated.addListener((win) => {
  if (win.type !== 'normal') return;
  setTimeout(async () => {
    try {
      if (await browser.sessions.getWindowValue(win.id, 'ws')) return;
      await WS.switchTo(win.id, await WS.getActiveId(win.id));
    } catch {
      // Window closed in the meantime.
    }
  }, RESTORE_GRACE_MS);
});

// Selecting a tab of another workspace (all-tabs menu, search, ...) switches to
// it. When Firefox falls back to such a tab because the last one of the current
// workspace was closed (previousTabId is gone), stay in the current workspace.
browser.tabs.onActivated.addListener(async ({ tabId, windowId, previousTabId }) => {
  const tab = await browser.tabs.get(tabId);
  if (tab.pinned) return;
  const [tabWs, activeId] = await Promise.all([
    browser.sessions.getTabValue(tabId, 'ws'),
    WS.getActiveId(windowId),
  ]);
  if (!tabWs || tabWs === activeId) return;
  await WS.switchTo(windowId, previousTabId === undefined ? activeId : tabWs);
});

// A tab dragged into another window joins that window's workspace, unless it
// is the only tab (detached into a new window): then the window follows it.
browser.tabs.onAttached.addListener(async (tabId, { newWindowId }) => {
  const tab = await browser.tabs.get(tabId);
  if (tab.pinned) return;
  const [tabs, tabWs] = await Promise.all([
    browser.tabs.query({ windowId: newWindowId }),
    browser.sessions.getTabValue(tabId, 'ws'),
  ]);
  if (tabs.length === 1 && tabWs) {
    await WS.switchTo(newWindowId, tabWs);
  } else {
    await browser.sessions.setTabValue(tabId, 'ws', await WS.getActiveId(newWindowId));
    WS.notify();
  }
});

browser.commands.onCommand.addListener(async (command) => {
  const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
  if (command === 'ws-next') return WS.switchBy(win.id, 1);
  if (command === 'ws-prev') return WS.switchBy(win.id, -1);
  if (command === 'toggle-autohide') return WS.setAutohide(!(await WS.getAutohide()));
  const n = Number(command.match(/^ws-(\d)$/)?.[1]);
  const target = (await WS.getWorkspaces())[n - 1];
  if (target) await WS.switchTo(win.id, target.id);
});

browser.action.onClicked.addListener(() => browser.sidebarAction.toggle());

// Tab context menu, shown on the native tabs and on the sidebar's tabs.
let menusReady = Promise.resolve();
function buildMenus() {
  menusReady = menusReady.then(async () => {
    await browser.menus.removeAll();
    const workspaces = await WS.getWorkspaces();
    browser.menus.create({ id: 'move', title: 'Mover a workspace', contexts: ['tab'] });
    for (const w of workspaces) {
      browser.menus.create({ id: `move:${w.id}`, parentId: 'move', title: w.name, contexts: ['tab'] });
    }
    browser.menus.create({ id: 'pin', title: 'Fijar en el workspace', contexts: ['tab'] });
    browser.menus.create({ id: 'fav', title: 'Añadir a favoritos del workspace', contexts: ['tab'] });
    browser.menus.create({ id: 'folder', title: 'Mover a carpeta', contexts: ['tab'] });
    browser.menus.create({ id: 'folder-new', parentId: 'folder', title: 'Nueva carpeta', contexts: ['tab'] });
    browser.menus.create({ id: 'folder-sep', parentId: 'folder', type: 'separator', contexts: ['tab'] });
    browser.menus.create({ id: 'folder-out', title: 'Quitar de la carpeta', contexts: ['tab'] });
    folderMenuIds = [];
  }).catch(console.error);
}

// The folder submenu lists the folders of the clicked tab's workspace, so it
// is rebuilt every time the menu opens.
let folderMenuIds = [];

browser.menus.onShown.addListener(async (info, tab) => {
  if (!tab || !info.contexts.includes('tab')) return;
  await menusReady;
  const [{ workspaces, folders }, ws, fav, item] = await Promise.all([
    WS.readSync(),
    WS.tabWorkspace(tab),
    browser.sessions.getTabValue(tab.id, 'fav'),
    browser.sessions.getTabValue(tab.id, 'item'),
  ]);
  await Promise.all(folderMenuIds.map((id) => browser.menus.remove(id)));
  const workspace = workspaces.find((w) => w.id === ws);
  const pinnedFolder = folders[workspace?.pinnedFolder];
  // Every folder of the workspace, nested ones as "Parent › Child".
  const wsFolders = [];
  const walk = (folder, path) => {
    for (const e of folder.items) {
      const sub = WS.isFolderRef(e) && folders[e.folder];
      if (!sub) continue;
      const title = path ? `${path} › ${sub.name}` : sub.name;
      wsFolders.push({ folder: sub, title });
      walk(sub, title);
    }
  };
  if (pinnedFolder) walk(pinnedFolder, '');
  folderMenuIds = wsFolders.map(({ folder, title }) => browser.menus.create({
    id: `folder:${folder.id}`, parentId: 'folder', title, contexts: ['tab'],
  }));
  const linkedFolder = item && wsFolders.find(({ folder }) => folder.items.some((i) => i.id === item))?.folder;
  const isPinned = Boolean(item && pinnedFolder?.items.some((i) => i.id === item));
  await Promise.all([
    browser.menus.update('move', { enabled: !tab.pinned }),
    browser.menus.update('pin', {
      title: isPinned ? 'Desfijar del workspace' : 'Fijar en el workspace',
      enabled: isPinned || WS.canSave(tab),
    }),
    ...workspaces.map((w) => browser.menus.update(`move:${w.id}`, { enabled: w.id !== ws })),
    browser.menus.update('fav', {
      title: fav ? 'Quitar de favoritos del workspace' : 'Añadir a favoritos del workspace',
      enabled: Boolean(fav) || WS.canSave(tab),
    }),
    browser.menus.update('folder', { enabled: WS.canSave(tab) }),
    ...wsFolders.map(({ folder }) => browser.menus.update(`folder:${folder.id}`, { enabled: folder !== linkedFolder })),
    browser.menus.update('folder-out', { visible: Boolean(linkedFolder) }),
  ]);
  browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  if (id === 'fav') WS.toggleFavorite(tab.id);
  else if (id === 'pin') await togglePin(tab);
  else if (id.startsWith('move:')) WS.moveTab(tab.id, id.slice('move:'.length));
  else if (id.startsWith('folder:')) WS.addToFolder(tab.id, id.slice('folder:'.length));
  else if (id === 'folder-new') WS.addToFolder(tab.id, await WS.createFolder(await WS.tabWorkspace(tab)));
  else if (id === 'folder-out') WS.removeItem(await browser.sessions.getTabValue(tab.id, 'item'));
});

async function togglePin(tab) {
  const item = await browser.sessions.getTabValue(tab.id, 'item');
  const [{ workspaces, folders }, wsId] = await Promise.all([WS.readSync(), WS.tabWorkspace(tab)]);
  const ws = workspaces.find((w) => w.id === wsId);
  if (item && folders[ws?.pinnedFolder]?.items.some((i) => i.id === item)) await WS.removeItem(item);
  else await WS.pinTab(tab.id);
}

// Saved items without an icon (imported, or saved before the page loaded) take
// the favicon of their tab once it has one.
browser.tabs.onUpdated.addListener(async (tabId, { favIconUrl }) => {
  const item = await browser.sessions.getTabValue(tabId, 'item');
  if (item) await WS.updateItemIcon(item, favIconUrl);
}, { properties: ['favIconUrl'] });
