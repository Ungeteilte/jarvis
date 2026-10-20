// Nachrichten von tagesschau.de (RSS, CORS offen). Nur feste Feed-Adressen.
import { cleanText } from './sanitize.js';

export const NEWS_ALL_URL = 'https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml';
export const RESSORTS = Object.freeze({
  inland: { label: 'Inland', url: 'https://www.tagesschau.de/inland/index~rss2.xml' },
  ausland: { label: 'Ausland', url: 'https://www.tagesschau.de/ausland/index~rss2.xml' },
  wirtschaft: { label: 'Wirtschaft', url: 'https://www.tagesschau.de/wirtschaft/index~rss2.xml' },
  sport: { label: 'Sport', url: 'https://www.tagesschau.de/sport/index~rss2.xml' },
  wissen: { label: 'Wissen', url: 'https://www.tagesschau.de/wissen/index~rss2.xml' }
});
export const RESSORT_IDS = Object.freeze(Object.keys(RESSORTS));

/** Gesprochene Wörter → Ressort-IDs. */
const WORDS = [
  [/inland|deutschland|innenpolitik/, 'inland'],
  [/ausland|international|welt(?!raum)|aussenpolitik/, 'ausland'],
  [/wirtschaft|boerse|finanz/, 'wirtschaft'],
  [/sport|fussball|bundesliga/, 'sport'],
  [/wissen|wissenschaft|forschung|klima/, 'wissen']
];
export function ressortsFromWords(normalized) {
  const out = [];
  for (const [re, id] of WORDS) if (re.test(normalized) && !out.includes(id)) out.push(id);
  return out;
}

export const feedUrlsFor = (ressorts = []) => {
  const ids = (ressorts || []).filter((r) => RESSORTS[r]);
  return ids.length ? ids.map((r) => RESSORTS[r].url) : [NEWS_ALL_URL];
};

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    }
    return ENT[e.toLowerCase()] ?? ' ';
  });
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  let v = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  v = v.replace(/<[^>]*>/g, ' ');
  return decodeEntities(v);
}

/** Einfacher, begrenzter RSS-Leser (kein DOM nötig). → [{ title, summary, at }] */
export function parseRss(xml, { maxItems = 30 } = {}) {
  const src = String(xml || '');
  const out = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(src)) && out.length < maxItems) {
    const title = cleanText(tag(m[1], 'title'), 120);
    if (!title) continue;
    const summary = cleanText(tag(m[1], 'description'), 220);
    const at = Date.parse(tag(m[1], 'pubDate').trim()) || 0;
    out.push({ title, summary, at });
  }
  return out;
}

/** Mehrere Feeds mischen: neueste zuerst, reihum, ohne Dubletten. */
export function mergeFeeds(lists, max = 3) {
  const sorted = lists.map((l) => [...(l || [])].sort((a, b) => b.at - a.at));
  const seen = new Set();
  const out = [];
  for (let round = 0; out.length < max && sorted.some((l) => l.length > round); round++) {
    for (const l of sorted) {
      const it = l[round];
      if (!it || seen.has(it.title.toLowerCase())) continue;
      seen.add(it.title.toLowerCase());
      out.push(it);
      if (out.length >= max) break;
    }
  }
  return out;
}

export const newsLimitFor = (ressorts = []) => Math.min(5, Math.max(3, (ressorts || []).length));
