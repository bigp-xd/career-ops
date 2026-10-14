// @ts-check
// Indeed job-alert emails. A job link carries the posting key as jk= (or
// vjk=), sometimes inside a URL-encoded tracking redirect. Links without a
// key fall back to the link itself (opaqueJobKey).
import { COMMON_NOISE } from '../cards.mjs';
import { decodeLayers, opaqueJobKey, safeUrl } from '../links.mjs';

const HOST = /(^|\.)indeed\.com$/i;
const COUNTRY_HOST = /^[a-z]{2}\.indeed\.com$/i;
// The lookahead stops a match from running across into a nested URL, so the
// innermost indeed URL (the real posting) is the one whose host is used.
const JK_IN_URL = /https?:\/\/([a-z0-9.-]*indeed\.com)\/(?:(?!https?:\/\/)[^\s"'<>])*?[?&](?:jk|vjk)=([0-9a-f]{16})(?![0-9a-z])/i;
const JK = /[?&](?:jk|vjk)=([0-9a-f]{16})(?![0-9a-z])/i;
const NOISE = [
  /^(full-time|part-time|contract|temporary|internship|permanent|seasonal)$/i,
  /^(easily apply|apply with your indeed resume)$/i,
];

export const indeed = {
  id: 'indeed',
  label: 'Indeed',
  domain: 'indeed.com',
  /** Any indeed.com address until the sample email shows the alert sender (PLAN Task 11). */
  senders: /@([a-z0-9-]+\.)*indeed\.com$/i,
  noise: NOISE,
  /** @type {import('../cards.mjs').JobKeyFn} */
  jobKey(href, text) {
    const u = safeUrl(href);
    if (!u || !HOST.test(u.hostname)) return null;
    for (const layer of decodeLayers(href)) {
      const nested = JK_IN_URL.exec(layer);
      const jk = (nested?.[2] ?? JK.exec(layer)?.[1])?.toLowerCase();
      if (!jk) continue;
      const host = nested && COUNTRY_HOST.test(nested[1]) ? nested[1].toLowerCase()
        : COUNTRY_HOST.test(u.hostname) ? u.hostname.toLowerCase()
        : 'www.indeed.com';
      return { key: `indeed:${jk}`, url: `https://${host}/viewjob?jk=${jk}` };
    }
    return opaqueJobKey(href, text, HOST, [...COMMON_NOISE, ...NOISE]);
  },
};
