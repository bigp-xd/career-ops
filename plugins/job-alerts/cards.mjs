// @ts-check
// Board-agnostic job-card extraction from alert-email HTML.
//
// An alert is a list of cards. A card has one or more links to the same job
// (logo, title, "View job") and some plain text (company, location, salary,
// age). htmlToLines() flattens the HTML into ordered text lines, each carrying
// the href of the link it sat in, if any. extractCards() walks the lines and
// opens a new card whenever a link resolves, through the board's jobKey(), to
// a job it has not seen yet. The first non-noise link text becomes the title;
// the next non-noise texts after it become company and location.

/** @typedef {{ text: string, href?: string }} Line */
/** @typedef {{ key: string, url: string, opaque?: boolean }} JobKey */
/** @typedef {(href: string, text: string) => JobKey | null} JobKeyFn */
/** @typedef {{ key: string, url: string, opaque: boolean, title: string, company: string, location: string }} Card */

/** Text that is never a title, company or location, on any board. */
export const COMMON_NOISE = [
  /^(view|see|apply|save|share|show|learn)( (job|jobs|now|details|more|more jobs|all|all jobs|this job|similar jobs))?$/i,
  /^(easy apply|quick apply|1-click apply|apply easily)$/i,
  /^(new|promoted|featured|sponsored|reposted|urgently hiring|actively recruiting|be an early applicant|hiring multiple candidates|responsive employer)$/i,
  /\b\d+\+?\s*(minutes?|hours?|days?|weeks?|months?|[mhdw])\s+ago$/i,
  /^\$|\$\s?\d/,
  /^\d+\s+(applicants?|connections?|alumni)\b/i,
  /^(unsubscribe|help|privacy|terms|settings|manage|preferences|feedback|download|get the app|view in browser|edit alert|edit this alert|this email was|you are receiving|you're receiving|©)/i,
  /^[·•|\-–—]+$/,
];

const BLOCK_NAMES = 'p|div|td|th|tr|table|tbody|thead|tfoot|li|ul|ol|h[1-6]|br|hr|section|article|header|footer|center|blockquote';
const BLOCK_TAG = new RegExp(`<\\/?(?:${BLOCK_NAMES})\\b[^>]*>`, 'gi');
const BLOCK_NAME = new RegExp(`^(?:${BLOCK_NAMES})$`, 'i');
const TOKEN = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>|<\/?([a-z][a-z0-9]*)\b[^>]*>|([^<]+)|</gi;
const SEPARATOR = /\s[·•]\s/;

// HTML named entities: the full Latin-1 set (U+00A0..U+00FF, in code-point
// order) plus the typographic ones alert emails use. Built from code points so
// no invisible character has to sit in this source file.
const LATIN1_NAMES = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr ' +
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml ' +
  'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');
const OTHER_CODE_POINTS = {
  OElig: 0x152, oelig: 0x153, Scaron: 0x160, scaron: 0x161, Yuml: 0x178, fnof: 0x192, circ: 0x2c6, tilde: 0x2dc,
  ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009, ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019,
  sbquo: 0x201a, ldquo: 0x201c, rdquo: 0x201d, bdquo: 0x201e, dagger: 0x2020, Dagger: 0x2021, bull: 0x2022,
  hellip: 0x2026, permil: 0x2030, prime: 0x2032, lsaquo: 0x2039, rsaquo: 0x203a, euro: 0x20ac, trade: 0x2122,
  larr: 0x2190, rarr: 0x2192,
};
/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
LATIN1_NAMES.forEach((name, i) => { ENTITIES[name] = String.fromCharCode(0xa0 + i); });
for (const [name, cp] of Object.entries(OTHER_CODE_POINTS)) ENTITIES[name] = String.fromCharCode(cp);
// Invisible formatting: soft hyphen, zero-width joiners, direction marks.
for (const name of ['shy', 'zwnj', 'zwj', 'lrm', 'rlm']) ENTITIES[name] = '';

/** @param {string} s */
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const cp = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[body] ?? whole;
  });
}

/** JS `\s` already covers no-break and other Unicode spaces. @param {string} s */
const squash = (s) => s.replace(/\s+/g, " ").trim();

/** @param {string} attrs @param {string} name */
function attr(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
}

/** @param {string} html @returns {Line[]} */
export function htmlToLines(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '');
  /** @type {Line[]} */
  const lines = [];
  let buf = '';
  const flush = () => { const text = squash(buf); if (text) lines.push({ text }); buf = ''; };
  for (const m of cleaned.matchAll(TOKEN)) {
    if (m[1] !== undefined) {                       // <a …>…</a>
      flush();
      const href = attr(m[1], 'href');
      const parts = m[2].split(BLOCK_TAG).map(p => squash(decodeEntities(p.replace(/<[^>]*>/g, ' ')))).filter(Boolean);
      if (/^https?:\/\//i.test(href)) {
        if (parts.length === 0) lines.push({ text: '', href });
        for (const text of parts) lines.push({ text, href });
      } else {
        for (const text of parts) lines.push({ text });
      }
    } else if (m[3] !== undefined) {                // any other tag
      if (BLOCK_NAME.test(m[3])) flush();
    } else {                                        // text, or a stray "<"
      buf += decodeEntities(m[4] ?? '<');
    }
  }
  flush();
  return lines;
}

/**
 * @param {Line[]} lines
 * @param {{ jobKey: JobKeyFn, noise: RegExp[] }} board
 * @returns {Card[]}
 */
export function extractCards(lines, { jobKey, noise }) {
  /** @param {string} t */
  const isNoise = (t) => !t || noise.some(re => re.test(t));
  /** @typedef {{ key: string, url: string, opaque: boolean, title: string, details: string[] }} Draft */
  /** @type {Map<string, Draft>} */
  const cards = new Map();
  /** @type {Draft | null} */
  let current = null;
  for (const line of lines) {
    const job = line.href ? jobKey(line.href, line.text) : null;
    if (job) {
      const known = cards.get(job.key);
      if (!known) {
        current = { key: job.key, url: job.url, opaque: Boolean(job.opaque), title: '', details: [] };
        cards.set(job.key, current);
      } else if (known !== current) {
        current = null; // an earlier job linked again out of place (e.g. a summary list)
        continue;
      }
      if (current && !current.title && !isNoise(line.text)) { current.title = line.text; continue; }
    }
    // Company and location follow the title on every board seen so far; text
    // before it (feedback links, badges) is not a detail of this card.
    if (!current || !current.title || isNoise(line.text)) continue;
    if (line.text === current.title || current.details.includes(line.text)) continue;
    current.details.push(line.text);
  }
  return [...cards.values()].filter(c => c.title).map(toCard);
}

/** @param {{ key: string, url: string, opaque: boolean, title: string, details: string[] }} c @returns {Card} */
function toCard(c) {
  let [company = '', location = ''] = c.details;
  const sep = SEPARATOR.exec(company);
  if (sep) { location = company.slice(sep.index + sep[0].length); company = company.slice(0, sep.index); }
  return { key: c.key, url: c.url, opaque: c.opaque, title: c.title, company: company.trim(), location: location.trim() };
}
