const $ = (sel) => document.querySelector(sel);
const DEFAULT_ICON = '../icons/page.svg';

let windowId;
let state; // last WS.windowState() of this window, plus `collapsed`
let renderSeq = 0;
let renderTimer;
let drag = null; // { tabId } for an open tab, { itemId, item, tabId? } for a folder item
let editingId = null;
let editingColor = null;
let renamingFolder = null;
let renameDraft = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const classes = (...names) => names.filter(Boolean).join(' ');

// The first icon given, else the cached favicon of the URL's site, else the
// site's /favicon.ico.
const iconFor = (url, ...icons) => icons.find(Boolean) || state?.icons?.[WS.hostOf(url)] || WS.siteIcon(url);

// Speaker icon: with sound waves, or crossed out when muted.
function speakerIcon(muted) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const paths = [
    ['M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z', 'currentColor', 'none'],
    ...(muted
      ? [['M11 6l4 4M15 6l-4 4', 'none', 'currentColor']]
      : [['M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9', 'none', 'currentColor']]),
  ];
  for (const [d, fill, stroke] of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', fill);
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', '1.3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

// Mute toggle for an open tab: always shown while it plays sound or is muted,
// otherwise only on hover.
function muteButton(tab) {
  const muted = Boolean(tab.mutedInfo?.muted);
  const button = el('button', {
    className: classes('mute', (tab.audible || muted) && 'on', muted && 'muted'),
    title: muted ? 'Activar sonido' : 'Silenciar pestaña',
  }, speakerIcon(muted));
  button.onclick = (e) => {
    e.stopPropagation();
    browser.tabs.update(tab.id, { muted: !muted });
  };
  return button;
}

function favicon(src) {
  const ok = src && !src.startsWith('chrome://');
  const img = el('img', { className: 'icon', src: ok ? src : DEFAULT_ICON, alt: '' });
  img.onerror = () => {
    img.onerror = null;
    img.src = DEFAULT_ICON;
  };
  return img;
}

// Runs an action and refreshes; other sidebars refresh through WS.notify().
function act(promise) {
  return Promise.resolve(promise).then(scheduleRender, console.error);
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 30);
}

async function render() {
  const seq = ++renderSeq;
  const [next, { collapsed = {}, archive = [] }, archiveHours, autohide, icons, imported] = await Promise.all([
    WS.windowState(windowId).catch(() => null),
    browser.storage.local.get(['collapsed', 'archive']),
    WS.getArchiveHours(),
    WS.getAutohide(),
    WS.getIconCache(),
    WS.hasImported(),
  ]);
  if (!next || seq !== renderSeq) return;
  // While a switch is still running, keep showing its target workspace.
  state = { ...next, collapsed, archive, icons, activeId: pendingSwitch ?? next.activeId };
  paint();
  $('#archive-after').value = String(archiveHours);
  renderAutohide(autohide);
  $('#import').hidden = imported; // only needed once
}

// Draws everything from `state`, without reading anything.
function paint() {
  const ws = currentWorkspace();
  document.body.style.setProperty('--accent', ws.color);
  renderSpaces();
  renderFavs(ws);
  renderPinned(ws);
  renderTabs();
  renderArchive();
}

// --- Icon rail (auto-hide) ------------------------------------------------
// With auto-hide on, the closed panel is a strip of tab icons that can be
// clicked. Resting the cursor on it for a moment opens the whole panel;
// leaving the panel closes it. userChrome draws both states from the title.
const RAIL_REST_MS = 250;
const RAIL_HIDE_MS = 100;
const RAIL_CLOSE_ANIMATION_MS = 120;
let autohideOn = false;
let expanded = false;
let restTimer;
let hideTimer;

function setExpanded(on) {
  clearTimeout(restTimer);
  clearTimeout(hideTimer);
  if (expanded === on) return;
  expanded = on;
  // Wide layout before the panel opens; icon layout once it has closed.
  if (on) document.body.classList.remove('rail');
  else setTimeout(() => !expanded && autohideOn && document.body.classList.add('rail'), RAIL_CLOSE_ANIMATION_MS);
  browser.sidebarAction.setTitle({ windowId, title: WS.autohideTitle(on) }).catch(console.error);
}

function applyRail(on) {
  if (on === autohideOn) return;
  autohideOn = on;
  expanded = false;
  document.body.classList.toggle('rail', on);
  // null drops this window's own title, back to the global one.
  browser.sidebarAction.setTitle({ windowId, title: on ? WS.autohideTitle(false) : null }).catch(console.error);
}

document.addEventListener('mousemove', () => {
  clearTimeout(hideTimer);
  if (!autohideOn || expanded) return;
  clearTimeout(restTimer);
  restTimer = setTimeout(() => setExpanded(true), RAIL_REST_MS);
});
// A click on an icon is the quick way through: don't open the panel after it
// until the cursor moves again.
document.addEventListener('mousedown', () => clearTimeout(restTimer));
window.addEventListener('mouseout', (e) => {
  if (e.relatedTarget || !autohideOn) return;
  clearTimeout(restTimer);
  hideTimer = setTimeout(() => setExpanded(false), RAIL_HIDE_MS);
});

function renderAutohide(on) {
  if (windowId !== undefined) applyRail(on);
  const button = $('#autohide');
  button.setAttribute('aria-pressed', String(on));
  button.title = on
    ? 'Ocultación automática activada: el panel aparece al acercar el cursor al borde. Clic para dejarlo fijo.'
    : 'Ocultar el panel automáticamente (aparece al acercar el cursor al borde)';
}

$('#autohide').onclick = async () => act(WS.setAutohide(!(await WS.getAutohide())));

const currentWorkspace = () => state.workspaces.find((w) => w.id === state.activeId);

function middleClick(node, onClick) {
  node.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
  node.addEventListener('auxclick', (e) => e.button === 1 && onClick());
}

function dropTarget(node, onDrop, { hoverClass = 'drop', accept = () => true } = {}) {
  node.addEventListener('dragover', (e) => {
    if (!drag || !accept(drag)) return;
    e.preventDefault();
    e.stopPropagation();
    node.classList.add(hoverClass);
  });
  node.addEventListener('dragleave', () => node.classList.remove(hoverClass));
  node.addEventListener('drop', (e) => {
    node.classList.remove(hoverClass);
    if (!drag || !accept(drag)) return;
    e.preventDefault();
    e.stopPropagation();
    onDrop(drag);
  });
}

function draggable(node, data, url) {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    drag = data;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', url);
    document.body.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    drag = null;
    document.body.classList.remove('dragging');
  });
}

const isTab = (d) => d.tabId !== undefined && !d.itemId;

// --- Workspaces bar -------------------------------------------------------

function renderSpaces() {
  const { workspaces, activeId } = state;
  const chips = workspaces.map((w, i) => {
    const chip = el('button', {
      className: classes('space', w.id === activeId && 'active'),
      title: `${w.name} — doble clic para editar (atajo ${i + 1})`,
    }, w.emoji ? el('span', { className: 'emoji', textContent: w.emoji }) : el('span', { className: 'dot' }),
    el('span', { className: 'name', textContent: w.name }));
    chip.style.setProperty('--c', w.color);
    chip.onclick = () => switchTo(w.id);
    chip.ondblclick = () => openEditor(w.id);
    chip.oncontextmenu = (e) => {
      e.preventDefault();
      openEditor(w.id);
    };
    dropTarget(chip, (d) => act(WS.moveTab(d.tabId, w.id)), { accept: isTab });
    return chip;
  });
  const add = el('button', { className: 'space add', textContent: '+', title: 'Nuevo workspace' });
  add.onclick = async () => {
    // The new workspace isn't in `state` yet, so switch for real and re-read.
    const id = await WS.createWorkspace(`Workspace ${workspaces.length + 1}`);
    await WS.switchTo(windowId, id);
    await render();
    playEnter(1);
    openEditor(id);
  };
  $('#spaces').replaceChildren(...chips, add);
}

// --- Favorites ----------------------------------------------------------

function renderFavs(ws) {
  const pinned = state.tabs.filter((t) => t.pinned);
  const favTabs = new Map(state.tabs.filter((t) => t.ws === ws.id && t.fav).map((t) => [t.fav, t]));
  $('#favs').replaceChildren(
    ...pinned.map((tab) => favTile({ title: tab.title, tab, pinned: true })),
    ...(ws.favorites ?? []).map((f) => favTile({ ...f, tab: favTabs.get(f.url), wsId: ws.id })),
  );
}

function favTile({ url, title, icon, tab, pinned, wsId }) {
  const tile = el('button', {
    className: classes('fav', tab && 'open', tab?.active && 'active', pinned && 'pinned'),
    title: pinned ? `${title} (fijada en todos los workspaces)` : title || url,
  }, favicon(iconFor(url ?? tab?.url, tab?.favIconUrl, icon)));
  tile.onclick = () => (tab ? browser.tabs.update(tab.id, { active: true }) : act(WS.openFavorite(windowId, wsId, url)));
  middleClick(tile, () => tab && browser.tabs.remove(tab.id));
  if (tab) tile.oncontextmenu = () => browser.menus.overrideContext({ context: 'tab', tabId: tab.id });
  if (tab && !pinned) draggable(tile, { tabId: tab.id }, url);
  if (!pinned) {
    const remove = el('span', { className: 'unfav', textContent: '×', title: 'Quitar de favoritos' });
    remove.onclick = (e) => {
      e.stopPropagation();
      act(WS.removeFavorite(wsId, url));
    };
    tile.append(remove);
  }
  return tile;
}

// --- Pinned tabs and folders --------------------------------------------
// The pinned section is the workspace's root folder, rendered without a
// header. Like in Arc, its entries mix saved tabs and folders, and folders
// can be nested.

const itemTabsOf = (ws) => new Map(state.tabs.filter((t) => t.ws === ws.id && t.item).map((t) => [t.item, t]));

// Dropping at `index` of a folder: open tabs are saved there, items and
// folders are moved there.
const dropInto = (folderId, index) => (d) => act(
  d.folderId ? WS.moveFolder(d.folderId, folderId, index)
    : d.itemId ? WS.moveItem(d.itemId, folderId, index)
      : WS.addToFolder(d.tabId, folderId, index),
);

function renderPinned(ws) {
  const root = state.folders[ws.pinnedFolder];
  const itemTabs = itemTabsOf(ws);
  const nodes = (root?.items ?? [])
    .map((entry, index) => entryNode(ws, root, entry, index, itemTabs, 'Desfijar'))
    .filter(Boolean);
  const hint = el('li', { className: 'hint', textContent: 'Arrastra aquí pestañas para fijarlas' });
  $('#pinned-items').replaceChildren(...(nodes.length ? nodes : [hint]));
}

function entryNode(ws, folder, entry, index, itemTabs, removeTitle) {
  if (!WS.isFolderRef(entry)) return itemRow(ws, folder, entry, index, itemTabs.get(entry.id), removeTitle);
  const sub = state.folders[entry.folder];
  return sub && el('li', { className: 'folder-entry' }, folderBlock(ws, sub, index, folder, itemTabs));
}

function folderBlock(ws, folder, index, parent, itemTabs) {
  const collapsed = Boolean(state.collapsed[folder.id]);
  const header = el('div', { className: collapsed ? 'folder-header collapsed' : 'folder-header' },
    el('span', { className: 'chevron' }),
    el('span', { className: 'folder-icon', textContent: collapsed ? '📁' : '📂' }),
  );

  if (renamingFolder === folder.id) {
    // Tab updates re-render the sidebar while typing, so keep the draft and
    // only select the whole name the first time.
    const first = renameDraft === null;
    const input = el('input', { className: 'folder-rename', value: renameDraft ?? folder.name, maxLength: 40 });
    const finish = (save) => {
      if (renamingFolder !== folder.id) return;
      renamingFolder = null;
      renameDraft = null;
      const name = input.value.trim();
      act(save && name && name !== folder.name ? WS.renameFolder(folder.id, name) : null);
    };
    input.oninput = () => {
      renameDraft = input.value;
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    };
    input.onblur = () => input.isConnected && finish(true);
    input.onclick = (e) => e.stopPropagation();
    header.append(input);
    requestAnimationFrame(() => {
      input.focus();
      if (first) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    });
  } else {
    header.append(el('span', { className: 'title', textContent: folder.name }));
  }
  if (collapsed && folder.items.length) {
    header.append(el('span', { className: 'count', textContent: folder.items.length }));
  }

  const addSub = el('button', { className: 'close', textContent: '+', title: 'Nueva subcarpeta' });
  addSub.onclick = async (e) => {
    e.stopPropagation();
    renamingFolder = await WS.createFolder(ws.id, 'Nueva carpeta', folder.id);
    if (collapsed) await toggleFolder(folder.id);
    scheduleRender();
  };
  const remove = el('button', { className: 'close', textContent: '×', title: 'Eliminar carpeta y su contenido' });
  remove.onclick = (e) => {
    e.stopPropagation();
    if (!folder.items.length || remove.dataset.confirm) return act(WS.deleteFolder(folder.id));
    remove.dataset.confirm = '1';
    remove.textContent = '¿Borrar?';
    remove.classList.add('confirm');
  };
  header.append(addSub, remove);

  header.onclick = () => toggleFolder(folder.id);
  header.ondblclick = (e) => {
    e.stopPropagation();
    renamingFolder = folder.id;
    scheduleRender();
  };
  header.oncontextmenu = (e) => {
    e.preventDefault();
    renamingFolder = folder.id;
    scheduleRender();
  };
  draggable(header, { folderId: folder.id }, folder.name);
  // Onto the header: into the folder (at the end).
  dropTarget(header, dropInto(folder.id), { accept: (d) => d.folderId !== folder.id });

  const block = el('div', { className: 'folder' }, header);
  if (!collapsed) {
    const children = folder.items.map((entry, i) => entryNode(ws, folder, entry, i, itemTabs)).filter(Boolean);
    block.append(el('ul', { className: 'folder-items' }, ...children));
  }
  return block;
}

async function toggleFolder(id) {
  const { collapsed = {} } = await browser.storage.local.get('collapsed');
  if (collapsed[id]) delete collapsed[id];
  else collapsed[id] = true;
  await browser.storage.local.set({ collapsed });
}

function itemRow(ws, folder, item, index, tab, removeLabel = 'Quitar de la carpeta') {
  const row = el('li', {
    className: classes('tab', 'item', !tab && 'closed', tab?.active && 'active'),
    title: `${tab?.title || item.title}\n${tab?.url || item.url}`,
  }, favicon(iconFor(item.url, tab?.favIconUrl, item.icon)), el('span', { className: 'title', textContent: tab?.title || item.title || item.url }));

  if (tab) {
    // Navigated away from the saved URL: go back to it, like Arc.
    if (tab.url !== item.url) {
      const back = el('button', { className: 'close', textContent: '↩', title: `Volver a ${item.url}` });
      back.onclick = (e) => {
        e.stopPropagation();
        browser.tabs.update(tab.id, { url: item.url, active: true });
      };
      row.append(back);
    }
    row.append(muteButton(tab));
    // Like Arc's "−" on pinned tabs: closes the tab and keeps the saved item,
    // which reopens at its saved URL. Unpinning is in the right-click menu.
    const close = el('button', { className: 'close', textContent: '−', title: 'Cerrar (se queda guardada)' });
    close.onclick = (e) => {
      e.stopPropagation();
      browser.tabs.remove(tab.id);
    };
    row.append(close);
  }

  row.onclick = () => act(WS.openItem(windowId, ws.id, item));
  middleClick(row, () => tab && browser.tabs.remove(tab.id));
  row.oncontextmenu = (e) => {
    if (tab) return browser.menus.overrideContext({ context: 'tab', tabId: tab.id });
    e.preventDefault();
    showMenu(e, [
      ['Abrir', () => act(WS.openItem(windowId, ws.id, item))],
      [removeLabel, () => act(WS.removeItem(item.id))],
    ]);
  };
  draggable(row, { itemId: item.id, item, tabId: tab?.id }, item.url);
  // Onto an item: before it, in the same folder.
  dropTarget(row, dropInto(folder.id, index), { hoverClass: 'over', accept: (d) => d.itemId !== item.id });
  return row;
}

// Small context menu for things without a native one (closed saved tabs).
function showMenu(e, entries) {
  closeMenu();
  const menu = el('div', { className: 'menu' }, ...entries.map(([label, run]) => {
    const button = el('button', { textContent: label });
    button.onclick = () => {
      closeMenu();
      run();
    };
    return button;
  }));
  document.body.append(menu);
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - width - 4)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - height - 4)}px`;
}

const closeMenu = () => document.querySelector('.menu')?.remove();
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.menu')) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

// --- Today --------------------------------------------------------------

// With a search query, tabs of every workspace are listed (marked with their
// workspace colour); otherwise the active workspace's Today tabs (open tabs
// that aren't favorites, pinned or in a folder).
function renderTabs() {
  if (!state) return;
  const { workspaces, folders, activeId, tabs } = state;
  const ws = currentWorkspace();
  const query = $('#search').value.trim().toLowerCase();
  const saved = WS.savedSets(ws, folders);
  const colors = new Map(workspaces.map((w) => [w.id, w.color]));
  const list = query
    ? tabs.filter((t) => !t.pinned && `${t.title} ${t.url}`.toLowerCase().includes(query))
    : tabs.filter((t) => t.ws === activeId && !WS.isSaved(t, saved));
  $('#tabs').replaceChildren(...list.map((t) => tabRow(t, query && t.ws !== activeId ? colors.get(t.ws) : null)));
  $('#clear-today').hidden = Boolean(query) || !list.length;
}

// --- Archive ------------------------------------------------------------

const timeAgo = (ms) => {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
};

function renderArchive() {
  const { archive } = state;
  const toggle = $('#archive-toggle');
  const list = $('#archive');
  $('#archive-bar').hidden = !archive.length;
  $('#archive-clear').hidden = list.hidden;
  toggle.textContent = `${list.hidden ? '▸' : '▾'} Archivadas (${archive.length})`;
  list.replaceChildren(...archive.map((a) => {
    const remove = el('button', { className: 'close', textContent: '×', title: 'Quitar del archivo' });
    remove.onclick = (e) => {
      e.stopPropagation();
      act(WS.removeArchived(a.closedAt, a.url));
    };
    const row = el('li', { className: 'tab archived', title: `${a.title}\n${a.url}` },
      favicon(iconFor(a.url, a.icon)),
      el('span', { className: 'title', textContent: a.title || a.url }),
      el('span', { className: 'ago', textContent: timeAgo(a.closedAt) }),
      remove);
    row.onclick = () => act(WS.restoreArchived(windowId, state.activeId, a.closedAt, a.url));
    return row;
  }));
}

function resetClearArchive() {
  const button = $('#archive-clear');
  delete button.dataset.confirm;
  button.textContent = 'Vaciar';
  button.classList.remove('confirm');
}

$('#archive-toggle').onclick = () => {
  $('#archive').hidden = !$('#archive').hidden;
  resetClearArchive();
  renderArchive();
};

// Two clicks to empty the archive: sidebars can't show confirm() dialogs.
$('#archive-clear').onclick = (e) => {
  const button = e.currentTarget;
  if (!button.dataset.confirm) {
    button.dataset.confirm = '1';
    button.textContent = '¿Vaciar todo?';
    button.classList.add('confirm');
    return;
  }
  resetClearArchive();
  $('#archive').hidden = true;
  act(WS.clearArchive());
};

$('#archive-after').onchange = (e) => browser.storage.sync.set({ archiveAfterHours: Number(e.target.value) });

$('#clear-today').onclick = () => act(WS.clearToday(windowId));

function tabRow(tab, otherColor) {
  const row = el('li', {
    className: classes('tab', tab.active && 'active', tab.discarded && 'discarded'),
    title: `${tab.title}\n${tab.url}`,
  });
  if (otherColor) {
    const dot = el('span', { className: 'dot' });
    dot.style.setProperty('--c', otherColor);
    row.append(dot);
  }
  row.append(favicon(iconFor(tab.url, tab.favIconUrl)), el('span', { className: 'title', textContent: tab.title || tab.url }));

  row.append(muteButton(tab));
  const close = el('button', { className: 'close', textContent: '×', title: 'Cerrar pestaña' });
  close.onclick = (e) => {
    e.stopPropagation();
    browser.tabs.remove(tab.id);
  };
  row.append(close);

  row.onclick = () => browser.tabs.update(tab.id, { active: true });
  middleClick(row, () => browser.tabs.remove(tab.id));
  row.oncontextmenu = () => browser.menus.overrideContext({ context: 'tab', tabId: tab.id });
  draggable(row, { tabId: tab.id }, tab.url);
  if (!otherColor) {
    dropTarget(row, (d) => act(d.itemId ? WS.unpinItem(windowId, state.activeId, d.item) : browser.tabs.move(d.tabId, { index: tab.index })), {
      hoverClass: 'over',
      accept: (d) => d.itemId || (isTab(d) && d.tabId !== tab.id),
    });
  }
  return row;
}

// Switching shows the target workspace right away from the state we already
// have; Firefox hides/shows the tabs in the background and a render afterwards
// picks up anything that changed.
let pendingSwitch = null;

function switchTo(wsId, direction) {
  if (!state || wsId === state.activeId) return;
  const ids = state.workspaces.map((w) => w.id);
  direction ??= ids.indexOf(wsId) > ids.indexOf(state.activeId) ? 1 : -1;
  pendingSwitch = wsId;
  state = { ...state, activeId: wsId };
  paint();
  playEnter(direction);
  WS.switchTo(windowId, wsId).catch(console.error).then(() => {
    if (pendingSwitch === wsId) pendingSwitch = null;
    scheduleRender();
  });
}

function switchBy(step) {
  const ids = state.workspaces.map((w) => w.id);
  switchTo(ids[(ids.indexOf(state.activeId) + step + ids.length) % ids.length], step);
}

function playEnter(direction) {
  const main = $('#main');
  main.classList.remove('enter-next', 'enter-prev');
  void main.offsetWidth; // restart the animation
  main.classList.add(direction > 0 ? 'enter-next' : 'enter-prev');
}

// --- Swipe between workspaces, like Arc ---------------------------------
// A two-finger horizontal swipe on the trackpad (or Shift + mouse wheel) over
// the sidebar moves to the next/previous workspace. The list follows the
// fingers until the threshold. After a switch, the trackpad keeps sending
// momentum events with shrinking deltas; those are ignored, but deltas that
// grow again after slowing down mean a new swipe has started.
const SWIPE_THRESHOLD = 60;
const SWIPE_END_MS = 150;
let swipeDistance = 0;
let swipeLocked = false;
let swipeMinDelta = Infinity;
let swipeEndTimer;

function resetSwipeVisual() {
  const main = $('#main');
  main.classList.remove('swiping');
  main.style.transform = '';
  main.style.opacity = '';
}

function endSwipe() {
  swipeDistance = 0;
  swipeLocked = false;
  resetSwipeVisual();
}

document.addEventListener('wheel', (e) => {
  const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 20 : 1;
  const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * scale;
  const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (!horizontal || !dx || !state || state.workspaces.length < 2) return;
  e.preventDefault();

  clearTimeout(swipeEndTimer);
  swipeEndTimer = setTimeout(endSwipe, SWIPE_END_MS);

  const size = Math.abs(dx);
  if (swipeLocked) {
    swipeMinDelta = Math.min(swipeMinDelta, size);
    if (swipeMinDelta > 4 || size < swipeMinDelta + 8) return;
    swipeLocked = false; // a new swipe on top of the old momentum
    swipeDistance = 0;
  }

  swipeDistance += dx;
  const main = $('#main');
  main.classList.add('swiping');
  const progress = Math.min(Math.abs(swipeDistance) / SWIPE_THRESHOLD, 1);
  main.style.transform = `translateX(${-Math.sign(swipeDistance) * progress * 40}px)`;
  main.style.opacity = String(1 - progress * 0.4);

  if (Math.abs(swipeDistance) >= SWIPE_THRESHOLD) {
    swipeLocked = true;
    swipeMinDelta = Infinity;
    resetSwipeVisual();
    switchBy(swipeDistance > 0 ? 1 : -1);
    swipeDistance = 0;
  }
}, { passive: false });

// --- Workspace editor ---------------------------------------------------
function openEditor(id) {
  const ws = state?.workspaces.find((w) => w.id === id);
  if (!ws) return;
  editingId = id;
  editingColor = ws.color;
  $('#ws-name').value = ws.name;
  $('#ws-emoji').value = ws.emoji ?? '';
  const del = $('#ws-delete');
  del.textContent = 'Eliminar';
  del.disabled = state.workspaces.length < 2;
  renderSwatches();
  $('#editor').hidden = false;
  $('#ws-name').select();
}

function renderSwatches() {
  $('#ws-colors').replaceChildren(...WS.COLORS.map((color) => {
    const swatch = el('button', { className: classes('swatch', color === editingColor && 'selected'), title: color });
    swatch.style.background = color;
    swatch.onclick = () => {
      editingColor = color;
      renderSwatches();
    };
    return swatch;
  }));
}

function closeEditor() {
  editingId = null;
  $('#editor').hidden = true;
}

async function saveEditor() {
  const name = $('#ws-name').value.trim();
  const emoji = $('#ws-emoji').value.trim() || undefined;
  if (editingId && name) await WS.editWorkspace(editingId, { name, emoji, color: editingColor });
  closeEditor();
  scheduleRender();
}

$('#ws-save').onclick = saveEditor;
$('#ws-cancel').onclick = closeEditor;
$('#ws-emoji').onkeydown = $('#ws-name').onkeydown = (e) => {
  if (e.key === 'Enter') saveEditor();
  if (e.key === 'Escape') closeEditor();
};
// Two clicks to delete: sidebars can't show confirm() dialogs.
$('#ws-delete').onclick = async (e) => {
  const button = e.currentTarget;
  if (button.dataset.confirm !== editingId) {
    button.dataset.confirm = editingId;
    button.textContent = '¿Seguro? Pulsa otra vez';
    return;
  }
  delete button.dataset.confirm;
  const id = editingId;
  closeEditor();
  await act(WS.deleteWorkspace(id));
};

// --- Search, new tab, new folder ----------------------------------------
$('#search').oninput = renderTabs;
$('#search').onkeydown = (e) => {
  if (e.key === 'Escape') {
    e.target.value = '';
    renderTabs();
  }
  if (e.key === 'Enter') $('#tabs .tab')?.click();
};

// Opens the Arc-style command bar; a blank tab if the popup can't open.
$('#new-tab').onclick = () => {
  browser.action.openPopup({ windowId }).catch(() => act(WS.newTab(windowId, state.activeId)));
};

$('#new-folder').onclick = async () => {
  renamingFolder = await WS.createFolder(state.activeId);
  scheduleRender();
};

dropTarget($('#favs'), (d) => act(WS.addFavorite(d.tabId)), { accept: (d) => d.tabId !== undefined });
// Dropping on the pinned area (outside a folder) pins the tab or item.
dropTarget($('#pinned'), (d) => act(
  d.folderId ? WS.moveFolder(d.folderId, currentWorkspace().pinnedFolder)
    : d.itemId ? WS.pinItem(d.itemId, state.activeId)
      : WS.pinTab(d.tabId),
));
// Dropping a folder item among the open tabs turns it back into a normal tab.
dropTarget($('#divider'), (d) => act(WS.unpinItem(windowId, state.activeId, d.item)), { accept: (d) => d.itemId });
dropTarget($('#tabs'), (d) => act(WS.unpinItem(windowId, state.activeId, d.item)), { accept: (d) => d.itemId });

// --- Import -------------------------------------------------------------
$('#import').onclick = () => $('#import-file').click();
$('#import-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('#import-status');
  status.textContent = 'Importando…';
  try {
    const summary = await WS.importData(JSON.parse(await file.text()));
    status.textContent = summary.map((s) => `${s.name}: ${s.tabs} fijadas, ${s.folders} carpetas`).join(' · ');
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${err.message}`;
  }
  scheduleRender();
};

// --- Init ---------------------------------------------------------------
(async () => {
  windowId = (await browser.windows.getCurrent()).id;
  for (const event of [
    browser.tabs.onCreated, browser.tabs.onRemoved, browser.tabs.onActivated,
    browser.tabs.onMoved, browser.tabs.onAttached, browser.tabs.onDetached,
  ]) {
    event.addListener(scheduleRender);
  }
  browser.tabs.onUpdated.addListener(scheduleRender, {
    windowId,
    properties: ['title', 'favIconUrl', 'url', 'hidden', 'pinned', 'discarded', 'audible', 'mutedInfo'],
  });
  browser.storage.onChanged.addListener(scheduleRender);
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ws-refresh') scheduleRender();
  });
  render();
})();
