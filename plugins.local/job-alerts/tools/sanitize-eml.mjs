#!/usr/bin/env node
// @ts-check
// Turn a job-alert email downloaded from Gmail into a fixture safe to commit.
//
//   node plugins.local/job-alerts/tools/sanitize-eml.mjs <in.eml> <out.eml> [--replace "Jane Doe=Test Candidate"]...
//       [--forwarded --from "LinkedIn <jobs-noreply@linkedin.com>"]   # for an alert someone forwarded
//
// Keeps only From, Subject, Date, Gmail's own (topmost) Authentication-Results
// header, and the decoded HTML part. Replaces the recipient's addresses, every
// --replace string (case-insensitive), and every opaque token in link URLs
// (query values of 6+ characters and path segments of 20+) with stable
// placeholders REDACTED1, REDACTED2, ... so distinct links stay distinct. Job
// identifiers (jk, vjk, jid, currentJobId, numeric LinkedIn ids) are kept.
// Always read the output before committing it.
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { domainOf, senderAddress } from '../auth.mjs';
import { parseMessage } from '../mime.mjs';
import { isMainModule } from '../../../lib/is-main-module.mjs';

const KEEP_PARAMS = new Set(['jk', 'vjk', 'jid', 'currentjobid']);
const NESTED_JOB_URL = /^https?:\/\/.*(?:[?&](?:jk|vjk|jid|currentJobId)=|\/jobs\/view\/)/i;
const TOKEN_SEGMENT = /^[A-Za-z0-9_\-.~%=]{20,}$/;
const SLUG_WITH_ID = /^[a-z0-9-]*-\d{6,}$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BOARD_ADDRESS = /@([a-z0-9-]+\.)*(indeed|linkedin|ziprecruiter)\.com$/i;
const INDEED_CTS = /^cts\.indeed\.com$/i;

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @param {string} value @returns {string | null} the first decoding layer that is a job URL */
function nestedJobUrl(value) {
  let current = value;
  for (let i = 0; i < 3; i++) {
    if (NESTED_JOB_URL.test(current)) return current;
    let next;
    try { next = decodeURIComponent(current); } catch { return null; }
    if (next === current) return null;
    current = next;
  }
  return NESTED_JOB_URL.test(current) ? current : null;
}

/** @param {Array<[string, string]>} [replacements] */
export function createSanitizer(replacements = []) {
  /** @type {Map<string, string>} */
  const tokens = new Map();
  /** @param {string} value */
  const placeholder = (value) => {
    if (!tokens.has(value)) tokens.set(value, `REDACTED${tokens.size + 1}`);
    return /** @type {string} */ (tokens.get(value));
  };

  /**
   * An Indeed cts.indeed.com payload (base64url(gzip(JSON))) re-encoded with
   * its target URL scrubbed and every metadata value of 6+ characters
   * (account id, tokens) replaced. null when the segment is not one.
   * @param {string} seg @param {number} depth
   */
  function scrubIndeedPayload(seg, depth) {
    let data;
    try { data = JSON.parse(gunzipSync(Buffer.from(seg, 'base64url'), { maxOutputLength: 64 * 1024 }).toString('utf8')); } catch { return null; }
    if (!data || typeof data !== 'object') return null;
    const meta = Object.fromEntries(Object.entries(data.m ?? {})
      .map(([k, v]) => [k, typeof v === 'string' && v.length >= 6 ? placeholder(v) : v]));
    const scrubbed = { u: typeof data.u === 'string' ? scrubUrl(data.u, depth + 1) : '', m: meta };
    return gzipSync(Buffer.from(JSON.stringify(scrubbed), 'utf8')).toString('base64url');
  }

  /** @param {string} href @param {number} [depth] @returns {string} */
  function scrubUrl(href, depth = 0) {
    let u;
    try { u = new URL(href); } catch { return href; }
    u.username = '';
    u.password = '';
    const cts = INDEED_CTS.test(u.hostname);
    u.pathname = u.pathname.split('/')
      .map(seg => (cts && seg.length >= 16 && scrubIndeedPayload(seg, depth))
        || (TOKEN_SEGMENT.test(seg) && !SLUG_WITH_ID.test(seg) ? placeholder(seg) : seg))
      .join('/');
    for (const [key, value] of [...u.searchParams]) {
      if (KEEP_PARAMS.has(key.toLowerCase())) continue;
      const nested = depth < 3 ? nestedJobUrl(value) : null;
      if (nested) u.searchParams.set(key, scrubUrl(nested, depth + 1));
      else if (value.length >= 6) u.searchParams.set(key, placeholder(value));
    }
    if (u.hash.length > 7) u.hash = `#${placeholder(u.hash.slice(1))}`;
    return u.href;
  }

  /** @param {string} s */
  function scrubText(s) {
    let out = s;
    for (const [from, to] of replacements) if (from) out = out.replace(new RegExp(escapeRegExp(from), 'gi'), () => to);
    return out.replace(EMAIL, (addr) => (BOARD_ADDRESS.test(addr) ? addr : 'candidate@example.com'));
  }

  /** @param {string} html */
  function scrubHtml(html) {
    const rewritten = html.replace(/\b(href|src)(\s*=\s*)(["'])(.*?)\3/gi, (_, name, eq, quote, value) =>
      `${name}${eq}${quote}${scrubUrl(value.replace(/&amp;/g, '&')).replace(/&/g, '&amp;')}${quote}`);
    return scrubText(rewritten);
  }

  return { scrubUrl, scrubText, scrubHtml };
}

/**
 * The fixture's headers and scrubbed HTML. A Gmail forward's own From and
 * Authentication-Results describe the forwarder, not the board, so for a
 * forwarded copy pass the original sender as `from` with `forwarded: true`:
 * the sender is restored and a clearly labelled synthetic Gmail DMARC result
 * for that sender's domain stands in for the one the forward lost.
 * @param {import('../mime.mjs').ParsedMessage} msg
 * @param {ReturnType<typeof createSanitizer>} s
 * @param {{ from?: string, forwarded?: boolean }} [o]
 */
export function fixtureFields(msg, s, { from = '', forwarded = false } = {}) {
  const sender = from || s.scrubText(msg.get('from'));
  return {
    from: sender,
    subject: s.scrubText(msg.get('subject').replace(/^\s*(fwd?|fw):\s*/i, '')),
    date: msg.get('date'),
    auth: forwarded
      ? `mx.google.com; dmarc=pass (synthetic: fixture built from a forwarded copy) header.from=${domainOf(senderAddress(sender))}`
      : s.scrubText(msg.getAll('authentication-results')[0] ?? ''),
    html: s.scrubHtml(msg.html),
  };
}

/** @param {{ from: string, subject: string, date: string, auth: string, html: string }} f */
export function buildFixture({ from, subject, date, auth, html }) {
  return [
    `Authentication-Results: ${auth}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
  ].join('\r\n');
}

/** @param {string[]} argv */
function main(argv) {
  const [input, output, ...rest] = argv;
  if (!input || !output) {
    console.error('Usage: node plugins.local/job-alerts/tools/sanitize-eml.mjs <in.eml> <out.eml> [--replace "from=to"]...');
    process.exit(1);
  }
  /** @type {Array<[string, string]>} */
  const replacements = [];
  let from = '';
  let forwarded = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--replace' && rest[i + 1]) {
      const [find, ...to] = rest[++i].split('=');
      replacements.push([find, to.join('=')]);
    } else if (rest[i] === '--from' && rest[i + 1]) {
      from = rest[++i];
    } else if (rest[i] === '--forwarded') {
      forwarded = true;
    }
  }
  if (forwarded && !from) {
    console.error('--forwarded needs --from "<the original sender, e.g. LinkedIn <jobs-noreply@linkedin.com>>"');
    process.exit(1);
  }
  const msg = parseMessage(readFileSync(input));
  for (const header of [...msg.getAll('from'), ...msg.getAll('to'), ...msg.getAll('delivered-to'), ...msg.getAll('x-original-to')]) {
    for (const addr of header.match(EMAIL) ?? []) if (!BOARD_ADDRESS.test(addr)) replacements.push([addr, 'candidate@example.com']);
  }
  writeFileSync(output, buildFixture(fixtureFields(msg, createSanitizer(replacements), { from, forwarded })), 'utf8');
  console.log(`✓ wrote ${output}. Search it for the candidate's name, email, phone and city before committing.`);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
