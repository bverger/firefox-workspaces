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
  site: 'Web',
};

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const looksLikeUrl = (q) => SCHEME.test(q) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]\S*)?$/i.test(q);
const toUrl = (q) => (SCHEME.test(q) ? q : `https://${q}`);

// History is read once when the bar opens and filtered here on every key:
// history.search's own text matching misses partial words, and it orders by
// last visit, so a site used every day could lose to one opened once.
const HISTORY_DAYS = 90;
const HISTORY_POOL = 3000;
let historyPool = Promise.resolve([]);

function loadHistory() {
  return browser.history
    .search({ text: '', startTime: Date.now() - HISTORY_DAYS * 864e5, maxResults: HISTORY_POOL })
    .then((items) => items.filter((h) => /^https?:/.test(h.url)))
    .catch((e) => {
      console.error(e);
      return [];
    });
}

// Every typed word must appear in the title or URL. Sites whose domain starts
// with what was typed come first, then words starting with it, then the rest;
// within each, the most visited first.
function matchHistory(pool, q, limit) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const h of pool) {
    const title = (h.title || '').toLowerCase();
    const url = h.url.toLowerCase();
    const text = `${title} ${url}`;
    if (!words.every((w) => text.includes(w))) continue;
    let rank = 0;
    if (words.length) {
      const host = WS.hostOf(h.url).toLowerCase().replace(/^www\./, '');
      if (host.startsWith(words[0])) rank = 2;
      else if (new RegExp(`(^|[^a-z0-9])${words[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) rank = 1;
    }
    scored.push({ h, rank });
  }
  scored.sort((a, b) => b.rank - a.rank
    || (b.h.visitCount ?? 0) - (a.h.visitCount ?? 0)
    || (b.h.lastVisitTime ?? 0) - (a.h.lastVisitTime ?? 0));
  return scored.slice(0, limit).map((s) => s.h);
}

// Sites (not pages) whose domain starts with a single typed word, most visited
// first, counting every page of the site: typing "x." should offer x.com
// itself, not the posts read on it.
function matchSites(pool, q, limit) {
  const word = q.toLowerCase();
  if (!word || /\s/.test(word)) return [];
  const sites = new Map();
  for (const h of pool) {
    let origin;
    let host;
    try {
      ({ origin, hostname: host } = new URL(h.url));
    } catch {
      continue;
    }
    const bare = host.toLowerCase().replace(/^www\./, '');
    if (!bare.startsWith(word)) continue;
    const site = sites.get(bare) ?? { host: bare, origin, visits: 0 };
    site.visits += h.visitCount ?? 1;
    sites.set(bare, site);
  }
  return [...sites.values()].sort((a, b) => b.visits - a.visits).slice(0, limit);
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function favicon(url, src) {
  const icon = src && !src.startsWith('chrome://') ? src : icons[WS.hostOf(url)] || WS.siteIcon(url);
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
  const [tabs, bookmarks, pool] = await Promise.all([
    q ? browser.tabs.query({}) : [],
    q ? browser.bookmarks.search(q) : [],
    historyPool,
  ]);
  if (mine !== seq) return;
  const history = matchHistory(pool, q, q ? 30 : 10);

  const lower = q.toLowerCase();
  const seen = new Set();
  const out = [];
  const add = (r) => {
    if (r.url && seen.has(r.url)) return;
    if (r.url) seen.add(r.url);
    out.push(r);
  };

  // A known site goes first, so Enter opens it, like the address bar's autofill.
  matchSites(pool, q, 2).forEach((s) => add({ kind: 'site', title: s.host, url: `${s.origin}/` }));
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
        ...(r.url && r.kind !== 'url' && r.kind !== 'site' ? [el('div', { className: 'url', textContent: r.url })] : [])),
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
  historyPool = loadHistory();
  [icons] = await Promise.all([
    WS.getIconCache(),
    browser.search.get().then((engines) => {
      engineName = engines.find((e) => e.isDefault)?.name ?? engineName;
    }),
  ]);
  update();
})();
