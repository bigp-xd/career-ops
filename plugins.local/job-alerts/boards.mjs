// @ts-check
// The three supported boards, and which one (if any) an alert sender belongs to.
import { domainOf } from './auth.mjs';
import { indeed } from './parsers/indeed.mjs';
import { linkedin } from './parsers/linkedin.mjs';
import { ziprecruiter } from './parsers/ziprecruiter.mjs';

/** @typedef {{ id: string, label: string, domain: string, senders: RegExp, noise: RegExp[], jobKey: import('./cards.mjs').JobKeyFn }} Board */

/** @type {Board[]} */
export const BOARDS = [indeed, linkedin, ziprecruiter];

/** @param {string} address @returns {Board | null} */
export function boardForSender(address) {
  const domain = domainOf(address);
  if (!domain) return null;
  return BOARDS.find(b => (domain === b.domain || domain.endsWith(`.${b.domain}`)) && b.senders.test(address)) ?? null;
}
