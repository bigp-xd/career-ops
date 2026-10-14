// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { TOKEN_URL, GMAIL_API, getAccessToken, listMessageIds, fetchRawMessage } from '../gmail.mjs';

const creds = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };
const reply = (data) => ({ json: async () => data });

test('getAccessToken posts the refresh grant and returns the access token', async () => {
  /** @type {any} */
  let seen;
  const fetch = async (url, opts) => { seen = { url, opts }; return reply({ access_token: 'abc' }); };
  assert.equal(await getAccessToken(fetch, creds), 'abc');
  assert.equal(seen.url, TOKEN_URL);
  assert.equal(seen.opts.method, 'POST');
  const form = new URLSearchParams(seen.opts.body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'refresh');
  assert.equal(form.get('client_id'), 'id');
});

test('a failed sign-in explains how to fix it', async () => {
  const fetch = async () => { throw new Error('HTTP 400: {"error":"invalid_grant"}'); };
  await assert.rejects(getAccessToken(fetch, creds), /connect-gmail\.mjs --write[\s\S]*Testing/);
});

test('a reply without access_token is an error', async () => {
  await assert.rejects(getAccessToken(async () => reply({}), creds), /no access token/);
});

test('listMessageIds sends the query, follows pages and stops at max', async () => {
  const pages = { '': { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' }, p2: { messages: [{ id: 'c' }, { id: 'd' }] } };
  /** @type {any[]} */
  const seen = [];
  const fetch = async (url, opts) => {
    seen.push({ url, opts });
    return reply(pages[new URL(url).searchParams.get('pageToken') ?? '']);
  };
  assert.deepEqual(await listMessageIds(fetch, 'tok', 'label:"Job Alerts" newer_than:7d', 3), ['a', 'b', 'c']);
  assert.ok(seen[0].url.startsWith(`${GMAIL_API}/messages?`));
  assert.equal(new URL(seen[0].url).searchParams.get('q'), 'label:"Job Alerts" newer_than:7d');
  assert.equal(seen[0].opts.headers.Authorization, 'Bearer tok');
});

test('listMessageIds returns [] for an empty label', async () => {
  assert.deepEqual(await listMessageIds(async () => reply({ resultSizeEstimate: 0 }), 'tok', 'q'), []);
});

test('fetchRawMessage decodes base64url and requires a body', async () => {
  const raw = Buffer.from('Subject: hi\r\n\r\nbody');
  /** @type {string} */
  let url = '';
  const fetch = async (u) => { url = u; return reply({ raw: raw.toString('base64url') }); };
  assert.deepEqual(await fetchRawMessage(fetch, 'tok', 'id/1'), raw);
  assert.equal(url, `${GMAIL_API}/messages/id%2F1?format=raw`);
  await assert.rejects(fetchRawMessage(async () => reply({}), 'tok', 'x'), /no raw message/);
});
