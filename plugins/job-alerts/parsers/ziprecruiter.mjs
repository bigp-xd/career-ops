// @ts-check
// ZipRecruiter job-alert emails. Posting URLs carry jid=; alert links may be
// tracking redirects with the posting URL encoded inside, or opaque tokens
// that fall back to the link itself (opaqueJobKey).
import { COMMON_NOISE } from '../cards.mjs';
import { decodeLayers, opaqueJobKey, safeUrl } from '../links.mjs';

const HOST = /(^|\.)ziprecruiter\.com$/i;
const POSTING = /https?:\/\/(?:www\.)?ziprecruiter\.com(\/(?:c|jobs|job|k)\/[^\s"'<>?#]*)\?[^\s"'<>#]*?\bjid=([A-Za-z0-9]{6,})/i;
const NOISE = [/^(great match|top applicant|new job|1-click apply)$/i];

export const ziprecruiter = {
  id: 'ziprecruiter',
  label: 'ZipRecruiter',
  domain: 'ziprecruiter.com',
  /** Confirmed alert sender (seen on a real job-recommendation email). Other ziprecruiter.com mail is read for id-bearing links only. */
  senders: /^phil@ziprecruiter\.com$/i,
  noise: NOISE,
  /** @type {import('../cards.mjs').JobKeyFn} */
  jobKey(href, text) {
    const u = safeUrl(href);
    if (!u || !HOST.test(u.hostname)) return null;
    for (const layer of decodeLayers(href)) {
      const m = POSTING.exec(layer);
      if (m) return { key: `ziprecruiter:${m[2].toLowerCase()}`, url: `https://www.ziprecruiter.com${m[1]}?jid=${m[2]}` };
    }
    return opaqueJobKey(href, text, HOST, [...COMMON_NOISE, ...NOISE]);
  },
};
