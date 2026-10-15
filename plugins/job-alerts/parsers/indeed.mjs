// @ts-check
// Indeed job-alert emails. Indeed wraps every link in a cts.indeed.com
// tracking URL whose path is base64url(gzip(JSON)) with the real target in
// "u"; the posting key is jk= (or vjk=) on that target. Older and other
// formats carry jk directly or inside a URL-encoded redirect. Only non-cts
// links without a key fall back to the link itself (opaqueJobKey).
import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { COMMON_NOISE } from '../cards.mjs';
import { decodeLayers, opaqueJobKey, safeUrl } from '../links.mjs';

const HOST = /(^|\.)indeed\.com$/i;
const CTS_HOST = /^cts\.indeed\.com$/i;
const CTS_PAYLOAD = /^\/v3\/([A-Za-z0-9_-]{16,})/;
const MAX_PAYLOAD_BYTES = 64 * 1024; // real payloads are ~500 B; refuse decompression bombs
const COUNTRY_HOST = /^[a-z]{2}\.indeed\.com$/i;
// The lookahead stops a match from running across into a nested URL, so the
// innermost indeed URL (the real posting) is the one whose host is used.
const JK_IN_URL = /https?:\/\/([a-z0-9.-]*indeed\.com)\/(?:(?!https?:\/\/)[^\s"'<>])*?[?&](?:jk|vjk)=([0-9a-f]{16})(?![0-9a-z])/i;
const JK = /[?&](?:jk|vjk)=([0-9a-f]{16})(?![0-9a-z])/i;
const NOISE = [
  /^(full-time|part-time|contract|temporary|internship|permanent|seasonal)$/i,
  /^(easily apply|apply with your indeed resume)$/i,
];

/**
 * The target URL inside a cts.indeed.com tracking link: a string ('' when the
 * payload has no target), or null when the path is not a readable payload.
 * Local decoding only; nothing is fetched.
 * @param {URL} u
 */
export function ctsTarget(u) {
  const m = CTS_PAYLOAD.exec(u.pathname);
  if (!m) return null;
  try {
    const data = JSON.parse(gunzipSync(Buffer.from(m[1], 'base64url'), { maxOutputLength: MAX_PAYLOAD_BYTES }).toString('utf8'));
    return typeof data?.u === 'string' ? data.u : '';
  } catch {
    return null;
  }
}

/** @param {string} target @param {string} fallbackHost */
function keyFromTarget(target, fallbackHost) {
  for (const layer of decodeLayers(target)) {
    const nested = JK_IN_URL.exec(layer);
    const jk = (nested?.[2] ?? JK.exec(layer)?.[1])?.toLowerCase();
    if (!jk) continue;
    const host = nested && COUNTRY_HOST.test(nested[1]) ? nested[1].toLowerCase()
      : COUNTRY_HOST.test(fallbackHost) ? fallbackHost.toLowerCase()
      : 'www.indeed.com';
    return { key: `indeed:${jk}`, url: `https://${host}/viewjob?jk=${jk}` };
  }
  return null;
}

export const indeed = {
  id: 'indeed',
  label: 'Indeed',
  domain: 'indeed.com',
  /** Confirmed alert senders (seen on a real job-match email). Other indeed.com mail is read for id-bearing links only. */
  senders: /^donotreply@match\.indeed\.com$/i,
  noise: NOISE,
  /** @type {import('../cards.mjs').JobKeyFn} */
  jobKey(href, text) {
    const u = safeUrl(href);
    if (!u || !HOST.test(u.hostname)) return null;
    if (CTS_HOST.test(u.hostname)) {
      // A tracking link is a job link only if its payload decodes to a target
      // carrying jk; "bad match", "Yes/No", profile and footer links do not.
      const target = ctsTarget(u);
      if (target === null) return keyFromTarget(href, u.hostname);
      const targetUrl = safeUrl(target);
      return target ? keyFromTarget(target, targetUrl?.hostname ?? '') : null;
    }
    return keyFromTarget(href, u.hostname) ?? opaqueJobKey(href, text, HOST, [...COMMON_NOISE, ...NOISE]);
  },
};
