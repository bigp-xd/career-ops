// @ts-check
// URL helpers shared by the board parsers. Pure: never touches the network.

/** @param {string} href */
export function safeUrl(href) {
  try { return new URL(href); } catch { return null; }
}

/** href plus up to `max` successively URL-decoded copies; tracking links nest the real URL. @param {string} href */
export function decodeLayers(href, max = 3) {
  const layers = [href];
  let current = href;
  for (let i = 0; i < max; i++) {
    let next;
    try { next = decodeURIComponent(current); } catch { break; }
    if (next === current) break;
    layers.push(next);
    current = next;
  }
  return layers;
}

const FOOTER_PATH = /\/(unsubscribe|optout|opt-out|settings|psettings|preferences|privacy|terms|help|support|account|profile|login|signin|download|feedback|jobs-search|search|saved-jobs|alerts?)(\/|$)/i;

/**
 * Fallback for a board link that carries no job id: the link itself becomes
 * the key and the URL. Only for https links on the board's own hosts, with
 * real (non-noise) text, that do not point at a footer-style page.
 * @param {string} href @param {string} text @param {RegExp} hostRe @param {RegExp[]} noise
 * @returns {import('./cards.mjs').JobKey | null}
 */
export function opaqueJobKey(href, text, hostRe, noise) {
  const u = safeUrl(href);
  if (!u || u.protocol !== 'https:' || !hostRe.test(u.hostname)) return null;
  if (!text || noise.some(re => re.test(text)) || FOOTER_PATH.test(u.pathname)) return null;
  u.hash = '';
  return { key: `opaque:${u.href}`, url: u.href, opaque: true };
}
