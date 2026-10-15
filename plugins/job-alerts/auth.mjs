// @ts-check
// Who sent this email, and did Gmail authenticate it?

const ADDRESS = /^[^\s@<>",]+@[^\s@<>",]+$/;

/**
 * The bare address in a From header, lower-cased ('' if none or ambiguous).
 * Quoted display names are dropped first, so an address written inside one
 * ("<jobs@linkedin.com>" <me@attacker.test>) is never taken for the sender.
 * Headers carrying more than one address are refused.
 * @param {string} from
 */
export function senderAddress(from) {
  const raw = String(from ?? '').trim();
  const unquoted = raw.replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  const angles = [...unquoted.matchAll(/<([^<>]*)>/g)];
  if (angles.length > 1) return '';
  if (unquoted.includes(',') && (unquoted.match(/@/g) ?? []).length > 1) return '';
  const address = (angles.length === 1 ? angles[0][1] : raw).trim().toLowerCase();
  return ADDRESS.test(address) ? address.replace(/\.$/, '') : '';
}

/** @param {string} address */
export function domainOf(address) {
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1);
}

/**
 * True when the topmost Authentication-Results header (the one Gmail adds on
 * receipt) comes from mx.google.com, reports dmarc=pass, and names the From
 * address's own domain as header.from. Headers further down could have been
 * written by the sender, so they are never trusted; and a pass for some other
 * domain says nothing about this sender.
 * @param {{ get: (name: string) => string, getAll: (name: string) => string[] }} msg
 */
export function isGoogleDmarcPass(msg) {
  const top = msg.getAll('authentication-results')[0] ?? '';
  if (!/^\s*mx\.google\.com\s*;/i.test(top)) return false;
  const headerFrom = /\bdmarc=pass\b[^;]*?\bheader\.from=([^\s;)]+)/i.exec(top)?.[1]?.toLowerCase().replace(/\.$/, '');
  const domain = domainOf(senderAddress(msg.get('from')));
  return Boolean(domain) && headerFrom === domain;
}
