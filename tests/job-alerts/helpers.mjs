// @ts-check
// Shared test helpers. Later tasks append to this file.
import { Buffer } from 'node:buffer';
import { TOKEN_URL, GMAIL_API } from '../../plugins/job-alerts/gmail.mjs';

/**
 * Build a raw RFC 822 message (multipart/alternative: text + HTML).
 * @param {{ from?: string, subject?: string, date?: string, auth?: string[], html?: string, text?: string,
 *           htmlEncoding?: '8bit' | 'quoted-printable' | 'base64', extraHeaders?: string[] }} [o]
 * @returns {Buffer}
 */
export function buildEml({
  from = 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
  subject = 'Job alert',
  date = 'Tue, 13 Oct 2026 09:00:00 +0000',
  auth = ['mx.google.com; dkim=pass header.i=@linkedin.com; spf=pass; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=linkedin.com'],
  html = '<p>hello</p>',
  text = 'hello',
  htmlEncoding = '8bit',
  extraHeaders = [],
} = {}) {
  const boundary = 'test-boundary-42';
  const htmlBody = htmlEncoding === 'base64'
    ? Buffer.from(html, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')
    : htmlEncoding === 'quoted-printable' ? toQuotedPrintable(html) : html;
  const lines = [
    ...auth.map(a => `Authentication-Results: ${a}`),
    `From: ${from}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    ...extraHeaders,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    `Content-Transfer-Encoding: ${htmlEncoding}`,
    '',
    htmlBody,
    `--${boundary}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/** UTF-8 text → quoted-printable, 76-column soft line breaks. @param {string} s */
export function toQuotedPrintable(s) {
  let out = '';
  let lineLength = 0;
  for (const byte of Buffer.from(s, 'utf8')) {
    if (byte === 0x0d) continue;
    if (byte === 0x0a) { out += '\r\n'; lineLength = 0; continue; }
    const plain = (byte >= 33 && byte <= 126 && byte !== 61) || byte === 32;
    const chunk = plain ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    if (lineLength + chunk.length > 75) { out += '=\r\n'; lineLength = 0; }
    out += chunk;
    lineLength += chunk.length;
  }
  return out;
}

export const FULL_ENV = Object.freeze({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });

/**
 * Stand-in for ctx.fetch serving the three Gmail endpoints the plugin uses.
 * List order follows the insertion order of `messages`.
 * `onRaw` / `onList` may return a promise to simulate a slow response.
 * @param {{ messages?: Record<string, Buffer | Error>, tokenError?: string, onRaw?: (id: string) => unknown, onList?: () => unknown }} [o]
 */
export function fakeGmail({ messages = {}, tokenError, onRaw, onList } = {}) {
  /** @type {{ url: string, opts: any }[]} */
  const calls = [];
  const json = (data) => ({ ok: true, status: 200, json: async () => data });
  /** @param {string} url @param {any} [opts] */
  async function fetch(url, opts = {}) {
    calls.push({ url, opts });
    if (url === TOKEN_URL) {
      if (tokenError) throw new Error(tokenError);
      return json({ access_token: 'test-access-token' });
    }
    if (url.startsWith(`${GMAIL_API}/messages?`)) { await onList?.(); return json({ messages: Object.keys(messages).map(id => ({ id })) }); }
    const raw = /\/messages\/([^/?]+)\?format=raw$/.exec(url);
    if (raw) {
      const id = decodeURIComponent(raw[1]);
      await onRaw?.(id);
      const m = messages[id];
      if (m instanceof Error) throw m;
      return json({ raw: m.toString('base64url') });
    }
    throw new Error(`unexpected fetch ${url}`);
  }
  return { fetch, calls };
}

/** @param {{ fetch: any, settings?: object, env?: object, dryRun?: boolean }} o */
export function fakeCtx({ fetch, settings = {}, env = FULL_ENV, dryRun = false }) {
  /** @type {string[]} */
  const logs = [];
  const ctx = { fetch, env, settings, dryRun, log: (...a) => logs.push(a.join(' ')), normalizePostingUrl: (u) => u };
  return { ctx, logs };
}

/** One LinkedIn-style alert card. @param {{ n: number, id: string, title: string, company: string, location: string }} c */
export function linkedinCard({ n, id, title, company, location }) {
  const href = `https://www.linkedin.com/comm/jobs/view/${id}/?trackingId=t${n}&amp;refId=r${n}`;
  return `<table><tr><td><a href="${href}"><img src="https://media.licdn.com/logo${n}.png" alt=""></a></td>` +
    `<td><a href="${href}">${title}</a><p>${company} · ${location}</p><p>Actively recruiting</p></td></tr></table>`;
}

/** @param {string[]} cards */
export function alertHtml(cards) {
  return `<html><head><style>p{margin:0}</style></head><body><h1>Your job alert</h1>${cards.join('')}` +
    '<p><a href="https://www.linkedin.com/comm/psettings/email-unsubscribe?x=1">Unsubscribe</a></p></body></html>';
}

/** @param {number} ms */
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** A ZipRecruiter-style card whose only links are opaque /km/ tokens (title + "View Details" share one). @param {{ token: string, title: string, company: string, location: string }} c */
export function zipCard({ token, title, company, location }) {
  const href = `https://www.ziprecruiter.com/km/${token}?tsid=s${token}&amp;auth_token=secret`;
  return `<p><a href="${href}">${title}</a></p><p>${company}</p><p>${location}</p><p><a href="${href}">View Details</a></p>`;
}
