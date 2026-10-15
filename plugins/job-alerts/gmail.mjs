// @ts-check
// Gmail REST access. Every request goes through the fetch function passed in
// (ctx.fetch in production) so the engine's egress allowlist applies. Written
// for this plugin rather than imported from plugins/gmail, so an upstream
// change there cannot break it.
import { Buffer } from 'node:buffer';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** @typedef {(url: string, opts?: any) => Promise<{ json: () => Promise<any> }>} FetchFn */

/**
 * Exchange the long-lived refresh token for a short-lived access token.
 * @param {FetchFn} fetchFn
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} creds
 */
export async function getAccessToken(fetchFn, { clientId, clientSecret, refreshToken }) {
  let data;
  try {
    const res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    data = await res.json();
  } catch (err) {
    throw new Error(
      `job-alerts: Gmail sign-in failed (${String(/** @type {Error} */ (err).message).slice(0, 200)}). ` +
      'Run `node plugins/job-alerts/connect-gmail.mjs --write` to sign in again. ' +
      'If this happens every week, your Google Cloud app is still in "Testing": publish it (README, step 1).',
    );
  }
  if (!data?.access_token) throw new Error('job-alerts: Gmail sign-in returned no access token. Run connect-gmail.mjs --write again.');
  return /** @type {string} */ (data.access_token);
}

/**
 * Ids of the messages matching a Gmail search, newest first.
 * @param {FetchFn} fetchFn @param {string} token @param {string} query @param {number} [max]
 * @returns {Promise<string[]>}
 */
export async function listMessageIds(fetchFn, token, query, max = 500) {
  /** @type {string[]} */
  const ids = [];
  let pageToken = '';
  do {
    const url = new URL(`${GMAIL_API}/messages`);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await (await fetchFn(url.href, { headers: { Authorization: `Bearer ${token}` } })).json();
    for (const m of data.messages ?? []) {
      if (ids.length >= max) break;
      ids.push(m.id);
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken && ids.length < max);
  return ids;
}

/**
 * The full RFC 822 message (Gmail format=raw).
 * @param {FetchFn} fetchFn @param {string} token @param {string} id
 * @returns {Promise<Buffer>}
 */
export async function fetchRawMessage(fetchFn, token, id) {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=raw`;
  const data = await (await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (typeof data.raw !== 'string') throw new Error('Gmail returned no raw message body');
  return Buffer.from(data.raw, 'base64url');
}
