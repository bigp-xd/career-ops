// @ts-check
// Who sent this email, and did Gmail authenticate it?

/** The bare address in a From header, lower-cased ('' if none). @param {string} from */
export function senderAddress(from) {
  const angle = /<([^<>]*)>/.exec(from ?? '');
  const address = (angle ? angle[1] : String(from ?? '')).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(address) ? address.replace(/\.$/, '') : '';
}

/** @param {string} address */
export function domainOf(address) {
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1);
}

/**
 * True when the topmost Authentication-Results header (the one Gmail adds on
 * receipt) comes from mx.google.com and reports dmarc=pass. Headers further
 * down could have been written by the sender, so they are never trusted.
 * @param {{ getAll: (name: string) => string[] }} msg
 */
export function isGoogleDmarcPass(msg) {
  const top = msg.getAll('authentication-results')[0] ?? '';
  return /^\s*mx\.google\.com\s*;/i.test(top) && /\bdmarc=pass\b/i.test(top);
}
