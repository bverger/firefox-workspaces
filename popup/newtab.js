// Arc-style command bar for opening a new tab: a single field with
// suggestions from open tabs, bookmarks and history, plus "go to URL" or
// "search" for what was typed. New tabs join the current workspace through the
// background script, like any other new tab.
const $ = (sel) => document.querySelector(sel);
const input = $('#q');
const list = $('#results');
const DEFAULT_ICON = '../icons/page.svg';

let results = [];
let selected = -1;
let seq = 0;
let icons = {};
let engineName = 'tu buscador';

const KINDS = {
  url: 'Abrir',
  search: () => `Buscar en ${engineName}`,
  tab: 'Ir a la pestaña',
  bookmark: 'Marcador',
  history: 'Historial',
};

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const looksLikeUrl = (q) => SCHEME.test(q) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]\S*)?$/i.test(q);
const toUrl = (q) => (SCHEME.test(q) ? q : `https://${q}`);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function favicon(url, src) {
  const icon = src && !src.startsWith('chrome://') ? src : icons[WS.hostOf(url)];
  const img = el('img', { className: 'icon', src: icon || DEFAULT_ICON, alt: '' });
  img.onerror = () => {
    img.onerror = null;
    img.src = DEFAULT_ICON;
  };
  return img;
}

async function update() {
  const q = input.value.trim();
  const mine = ++seq;
  const [tabs, bookmarks, history] = await Promise.all([
    q ? browser.tabs.query({}) : [],
    q ? browser.bookmarks.search(q) : [],
    browser.history.search({ text: q, startTime: 0, maxResults: q ? 30 : 10 }),
  ]);
  if (mine !== seq) return;

  const lower = q.toLowerCase();
  const seen = new Set();
  const out = [];
  const add = (r) => {
    if (r.url && seen.has(r.url)) return;
    if (r.url) seen.add(r.url);
    out.push(r);
  };

  if (q) add(looksLikeUrl(q) ? { kind: 'url', title: q, url: toUrl(q) } : { kind: 'search', title: q });
  tabs
    .filter((t) => `${t.title} ${t.url}`.toLowerCase().includes(lower))
    .slice(0, 4)
    .forEach((t) => add({ kind: 'tab', title: t.title, url: t.url, icon: t.favIconUrl, tabId: t.id, windowId: t.windowId }));
  bookmarks.filter((b) => b.url).slice(0, 4).forEach((b) => add({ kind: 'bookmark', title: b.title, url: b.url }));
  history.forEach((h) => add({ kind: 'history', title: h.title, url: h.url }));

  results = out.slice(0, 12);
  // With an empty field, Enter opens a blank tab instead of the first item.
  selected = q ? 0 : -1;
  paint();
}

function paint() {
  list.replaceChildren(...results.map((r, i) => {
    const kind = typeof KINDS[r.kind] === 'function' ? KINDS[r.kind]() : KINDS[r.kind];
    const row = el('li', { className: `result${i === selected ? ' selected' : ''}` },
      r.kind === 'search' ? el('img', { className: 'icon', src: '../icons/search.svg', alt: '' }) : favicon(r.url, r.icon),
      el('div', { className: 'text' },
        el('div', { className: 'title', textContent: r.title || r.url }),
        ...(r.url && r.kind !== 'url' ? [el('div', { className: 'url', textContent: r.url })] : [])),
      el('span', { className: 'kind', textContent: kind }));
    row.onmousemove = () => {
      if (selected === i) return;
      selected = i;
      paint();
    };
    row.onclick = () => go(r);
    return row;
  }));
  list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

async function go(r) {
  if (!r) {
    await browser.tabs.create({});
  } else if (r.kind === 'tab') {
    await browser.tabs.update(r.tabId, { active: true });
    await browser.windows.update(r.windowId, { focused: true });
  } else if (r.kind === 'search') {
    await browser.search.search({ query: r.title, disposition: 'NEW_TAB' });
  } else {
    await browser.tabs.create({ url: r.url });
  }
  window.close();
}

input.addEventListener('input', update);
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!results.length) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    selected = (selected + step + results.length) % results.length;
    paint();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    go(results[selected]).catch(console.error);
  } else if (e.key === 'Escape') {
    window.close();
  }
});

(async () => {
  input.focus();
  [icons] = await Promise.all([
    WS.getIconCache(),
    browser.search.get().then((engines) => {
      engineName = engines.find((e) => e.isDefault)?.name ?? engineName;
    }),
  ]);
  update();
})();
