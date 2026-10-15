// @ts-check
// One alert email's HTML → clean job leads, using the board's rules.
import { COMMON_NOISE, extractCards, htmlToLines } from './cards.mjs';
import { opaqueKey, opaqueUrl } from './links.mjs';

const MAX_FIELD = 200;
// C0/C1 controls, zero-width characters, line/paragraph separators, bidi
// overrides and isolates, BOM. Email text is untrusted: none of these belong
// in a pipeline line.
const range = (/** @type {number} */ from, /** @type {number} */ to) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const UNSAFE = new RegExp(`[${range(0x00, 0x1f)}${range(0x7f, 0x9f)}${range(0x200b, 0x200f)}${range(0x2028, 0x202e)}${range(0x2066, 0x2069)}${range(0xfeff, 0xfeff)}]`, "g");

/** @typedef {{ title: string, company: string, location: string, url: string }} Job */

/** @param {unknown} s */
export function cleanField(s) {
  return String(s ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD).trim();
}

/**
 * @param {{ label: string, noise: RegExp[], jobKey: import('./cards.mjs').JobKeyFn }} board
 * @param {string} html
 * @param {{ allowOpaque?: boolean }} [opts] false = id-bearing job links only (mail from senders not confirmed as alerts)
 * @returns {{ jobs: Job[], warnings: string[] }}
 */
export function parseAlert(board, html, { allowOpaque = true } = {}) {
  /** @type {import('./cards.mjs').JobKeyFn} */
  const jobKey = allowOpaque ? board.jobKey : (href, text) => {
    const key = board.jobKey(href, text);
    return key && !key.opaque ? key : null;
  };
  const lines = htmlToLines(html);
  const cards = extractCards(lines, { jobKey, noise: [...COMMON_NOISE, ...board.noise] });
  // A real job card links its target at least twice (title and "View job" /
  // "View Details", whatever their text). A lone id-less link is a promo
  // ("Complete Your Profile", "Search Jobs"), not a job.
  /** @type {Map<string, number>} */
  const targets = new Map();
  for (const line of lines) {
    const url = line.href ? opaqueUrl(line.href) : null;
    if (url) targets.set(opaqueKey(url), (targets.get(opaqueKey(url)) ?? 0) + 1);
  }
  /** @type {Job[]} */
  const jobs = [];
  let opaque = 0;
  for (const card of cards) {
    const title = cleanField(card.title);
    if (!title || !/^https:\/\//i.test(card.url)) continue;
    if (card.opaque && (targets.get(card.key) ?? 0) < 2) continue;
    if (card.opaque) opaque++;
    jobs.push({ title, company: cleanField(card.company), location: cleanField(card.location), url: card.url });
  }
  // Count-free on purpose: index.mjs dedups warnings, so this prints once per board per run.
  const warnings = opaque ? [`${board.label}: some job links had no job id, so the original links were kept`] : [];
  return { jobs, warnings };
}
