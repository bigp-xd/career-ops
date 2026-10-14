// @ts-check
// Board-agnostic job-card extraction from alert-email HTML.
//
// An alert is a list of cards. A card has one or more links to the same job
// (logo, title, "View job") and some plain text (company, location, salary,
// age). htmlToLines() flattens the HTML into ordered text lines, each carrying
// the href of the link it sat in, if any. extractCards() walks the lines and
// opens a new card whenever a link resolves, through the board's jobKey(), to
// a job it has not seen yet. The first non-noise link text becomes the title;
// the next non-noise texts become company and location.

/** @typedef {{ text: string, href?: string }} Line */
/** @typedef {{ key: string, url: string, opaque?: boolean }} JobKey */
/** @typedef {(href: string, text: string) => JobKey | null} JobKeyFn */
/** @typedef {{ key: string, url: string, opaque: boolean, title: string, company: string, location: string }} Card */

/** Text that is never a title, company or location, on any board. */
export const COMMON_NOISE = [
  /^(view|see|apply|save|share|show|learn)( (job|jobs|now|details|more|all|all jobs|this job|similar jobs))?$/i,
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

/** @type {Record<string, string>} */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', bull: '•', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', zwnj: '', zwj: '', shy: '', copy: '©', reg: '®',
  trade: '™', eacute: 'é', Eacute: 'É', egrave: 'è', agrave: 'à', aacute: 'á', iacute: 'í', oacute: 'ó',
  uacute: 'ú', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç',
};

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

/** @param {string} s */
const squash = (s) => s.replace(/[\s ]+/g, ' ').trim();

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
    if (!current || isNoise(line.text)) continue;
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
