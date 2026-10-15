// @ts-check
// Minimal RFC 822 / MIME reader for job-alert emails.
//
// Input is the raw message bytes: Gmail's format=raw (base64url-decoded) in
// production, a downloaded .eml in tests, so both run through the same code.
// Output is the header list plus the first text/html part, decoded to a
// string. Attachments are skipped. Bytes travel as a latin1 string (one char
// per byte) until a part's charset is known, so non-UTF-8 parts decode right.

import { Buffer } from 'node:buffer';

/** @typedef {{ name: string, value: string }} Header */
/**
 * @typedef {object} ParsedMessage
 * @property {Header[]} headers
 * @property {(name: string) => string} get      First value of a header ('' if absent).
 * @property {(name: string) => string[]} getAll All values of a header, top to bottom.
 * @property {string} html                      First text/html part ('' if none).
 */

/** @param {Buffer | string} raw @returns {ParsedMessage} */
export function parseMessage(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw);
  const { headers, body } = splitEntity(text);
  const found = { html: '' };
  walk(headers, body, found, 0);
  /** @param {string} name */
  const named = (name) => headers.filter(h => h.name.toLowerCase() === name.toLowerCase());
  return {
    headers,
    get: (name) => named(name)[0]?.value ?? '',
    getAll: (name) => named(name).map(h => h.value),
    html: found.html,
  };
}

/** @param {string} text @returns {{ headers: Header[], body: string }} */
function splitEntity(text) {
  if (/^\r?\n/.test(text)) return { headers: [], body: text.replace(/^\r?\n/, '') };
  const gap = /\r?\n\r?\n/.exec(text);
  const head = gap ? text.slice(0, gap.index) : text;
  const body = gap ? text.slice(gap.index + gap[0].length) : '';
  /** @type {Header[]} */
  const headers = [];
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers.push({ name: line.slice(0, colon).trim(), value: decodeHeaderValue(line.slice(colon + 1).trim()) });
  }
  return { headers, body };
}

/** @param {Header[]} headers @param {string} name */
function headerValue(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name)?.value ?? '';
}

/** @param {Header[]} headers @param {string} body @param {{ html: string }} found @param {number} depth */
function walk(headers, body, found, depth) {
  if (found.html || depth > 10) return;
  if (/^\s*attachment\b/i.test(headerValue(headers, 'content-disposition'))) return;
  const type = parseParams(headerValue(headers, 'content-type') || 'text/plain');
  if (type.value.startsWith('multipart/') && type.params.boundary) {
    for (const part of splitMultipart(body, type.params.boundary)) {
      const entity = splitEntity(part);
      walk(entity.headers, entity.body, found, depth + 1);
      if (found.html) return;
    }
  } else if (type.value === 'text/html') {
    found.html = decodeBody(body, headerValue(headers, 'content-transfer-encoding'), type.params.charset);
  }
}

/** "text/html; charset=UTF-8" → { value: 'text/html', params: { charset: 'UTF-8' } } @param {string} value */
function parseParams(value) {
  /** @type {Record<string, string>} */
  const params = {};
  const re = /;\s*([\w.-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]*))/g;
  let m;
  while ((m = re.exec(value))) params[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  return { value: value.split(';')[0].trim().toLowerCase(), params };
}

/** @param {string} body @param {string} boundary @returns {string[]} */
function splitMultipart(body, boundary) {
  const parts = [];
  for (const piece of body.split(`--${boundary}`).slice(1)) {
    if (piece.startsWith('--')) break; // closing delimiter
    parts.push(piece.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n$/, ''));
  }
  return parts;
}

/** @param {string} body @param {string} encoding @param {string | undefined} charset */
function decodeBody(body, encoding, charset) {
  const enc = encoding.trim().toLowerCase();
  const bytes = enc === 'base64' ? Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
    : enc === 'quoted-printable' ? Buffer.from(decodeQuotedPrintable(body), 'latin1')
    : Buffer.from(body, 'latin1');
  return decodeBytes(bytes, charset);
}

/** Quoted-printable → one char per byte (latin1). @param {string} s */
export function decodeQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** @param {Buffer} bytes @param {string | undefined} charset */
function decodeBytes(bytes, charset) {
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

/**
 * Raw header value (bytes carried as latin1) → text, with RFC 2047 encoded
 * words decoded. Adjacent encoded words join without the space between them.
 * @param {string} value
 */
export function decodeHeaderValue(value) {
  return Buffer.from(value, 'latin1').toString('utf8')
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
      const bytes = enc.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64')
        : Buffer.from(decodeQuotedPrintable(data.replace(/_/g, ' ')), 'latin1');
      return decodeBytes(bytes, charset);
    });
}
