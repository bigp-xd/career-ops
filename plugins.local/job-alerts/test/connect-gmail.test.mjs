// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  AUTH_URL, TOKEN_URL, SCOPE, pkcePair, buildAuthUrl, readCallback, exchangeCode, readClientCreds, upsertEnvValue,
} from '../connect-gmail.mjs';

test('pkcePair derives an S256 challenge from the verifier', () => {
  const { verifier, challenge } = pkcePair(() => Buffer.alloc(32, 7));
  assert.equal(verifier, Buffer.alloc(32, 7).toString('base64url'));
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
});

test('buildAuthUrl asks for offline, read-only Gmail access with PKCE', () => {
  const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555', challenge: 'ch', state: 'st' }));
  assert.equal(`${u.origin}${u.pathname}`, AUTH_URL);
  const p = Object.fromEntries(u.searchParams);
  assert.deepEqual(p, {
    client_id: 'cid', redirect_uri: 'http://127.0.0.1:5555', response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: 'ch', code_challenge_method: 'S256', state: 'st',
  });
});

test('readCallback checks state and reports Google errors', () => {
  assert.deepEqual(readCallback('/?state=st&code=abc', 'st'), { code: 'abc' });
  assert.match(/** @type {any} */ (readCallback('/?state=other&code=abc', 'st')).error, /state mismatch/);
  assert.match(/** @type {any} */ (readCallback('/?state=st&error=access_denied', 'st')).error, /access_denied/);
  assert.match(/** @type {any} */ (readCallback('/?state=st', 'st')).error, /no code/);
});

test('exchangeCode sends the code and verifier and returns the refresh token', async () => {
  /** @type {any} */
  let seen;
  const fetchFn = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ refresh_token: 'rt' }) }; };
  const token = await exchangeCode({ fetchFn, clientId: 'cid', clientSecret: 'cs', code: 'abc', verifier: 'v', redirectUri: 'http://127.0.0.1:1' });
  assert.equal(token, 'rt');
  assert.equal(seen.url, TOKEN_URL);
  const form = new URLSearchParams(seen.opts.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code_verifier'), 'v');
  assert.equal(form.get('redirect_uri'), 'http://127.0.0.1:1');
});

test('exchangeCode explains a failure and a missing refresh token', async () => {
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
  await assert.rejects(exchangeCode({ fetchFn: bad, clientId: 'c', clientSecret: 's', code: 'x', verifier: 'v', redirectUri: 'r' }), /400 invalid_grant/);
  const noRefresh = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'a' }) });
  await assert.rejects(exchangeCode({ fetchFn: noRefresh, clientId: 'c', clientSecret: 's', code: 'x', verifier: 'v', redirectUri: 'r' }), /myaccount\.google\.com\/permissions/);
});

test('readClientCreds reads .env text and names what is missing', () => {
  assert.deepEqual(readClientCreds('GMAIL_CLIENT_ID=abc\nGMAIL_CLIENT_SECRET="s3"\n'), { clientId: 'abc', clientSecret: 's3' });
  assert.throws(() => readClientCreds('GMAIL_CLIENT_ID=abc\n'), /GMAIL_CLIENT_SECRET/);
});

test('upsertEnvValue replaces or appends one line, literally', () => {
  assert.equal(upsertEnvValue('A=1\nGMAIL_REFRESH_TOKEN=old\nB=2\n', 'GMAIL_REFRESH_TOKEN', 'new'), 'A=1\nGMAIL_REFRESH_TOKEN=new\nB=2\n');
  assert.equal(upsertEnvValue('A=1', 'GMAIL_REFRESH_TOKEN', 'x'), 'A=1\nGMAIL_REFRESH_TOKEN=x\n');
  assert.equal(upsertEnvValue('', 'K', 'v'), 'K=v\n');
  assert.equal(upsertEnvValue('K=old\n', 'K', '$&$1'), 'K=$&$1\n');
});
