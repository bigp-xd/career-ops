#!/usr/bin/env node
// @ts-check
// One-time Gmail sign-in for the job-alerts plugin.
//
//   node plugins/job-alerts/connect-gmail.mjs           # prints GMAIL_REFRESH_TOKEN
//   node plugins/job-alerts/connect-gmail.mjs --write   # saves it into .env instead
//
// Google's loopback flow for desktop apps: a listener on 127.0.0.1 catches the
// sign-in redirect on this machine; PKCE and a random state guard the code.
// The ingest hook never imports this file (it uses node:http and global fetch,
// which hook code must not).
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { isMainModule } from '../../lib/is-main-module.mjs';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TIMEOUT_MS = 5 * 60_000;

/** @param {(size: number) => Buffer} [rand] */
export function pkcePair(rand = randomBytes) {
  const verifier = rand(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** @param {{ clientId: string, redirectUri: string, challenge: string, state: string }} o */
export function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL(AUTH_URL);
  const params = {
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.href;
}

/** @param {string} requestUrl @param {string} expectedState @returns {{ code: string } | { error: string }} */
export function readCallback(requestUrl, expectedState) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  if (url.searchParams.get('state') !== expectedState) return { error: 'state mismatch (that sign-in link was not the one this script printed)' };
  const error = url.searchParams.get('error');
  if (error) return { error: `Google returned "${error}"` };
  const code = url.searchParams.get('code');
  return code ? { code } : { error: 'no code in the redirect' };
}

/**
 * @param {{ fetchFn?: (url: string, opts: any) => Promise<any>, clientId: string, clientSecret: string,
 *           code: string, verifier: string, redirectUri: string }} o
 */
export async function exchangeCode({ fetchFn = globalThis.fetch, clientId, clientSecret, code, verifier, redirectUri }) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${data.error ?? ''} ${data.error_description ?? ''}`.trim());
  if (!data.refresh_token) throw new Error('Google returned no refresh token. Remove the app at https://myaccount.google.com/permissions, then run this again.');
  return /** @type {string} */ (data.refresh_token);
}

/** @param {string} envText */
export function readClientCreds(envText) {
  const env = parseEnv(envText);
  const clientId = env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim();
  const missing = [!clientId && 'GMAIL_CLIENT_ID', !clientSecret && 'GMAIL_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) throw new Error(`${missing.join(' and ')} must be in .env first (README, step 2).`);
  return { clientId: /** @type {string} */ (clientId), clientSecret: /** @type {string} */ (clientSecret) };
}

/** Set KEY=value in .env text, replacing an existing line or appending one. @param {string} text @param {string} key @param {string} value */
export function upsertEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const existing = new RegExp(`^${key}=.*$`, 'm');
  if (existing.test(text)) return text.replace(existing, () => line);
  return `${text && !text.endsWith('\n') ? `${text}\n` : text}${line}\n`;
}

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

const USAGE = `Usage: node plugins/job-alerts/connect-gmail.mjs [--write]

One-time Gmail sign-in for the job-alerts plugin. Reads GMAIL_CLIENT_ID and
GMAIL_CLIENT_SECRET from .env, prints a Google sign-in link, and waits up to
5 minutes for you to sign in.

  --write   save GMAIL_REFRESH_TOKEN into .env instead of printing it
  --help    show this help`;

/** @param {string[]} argv */
async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return; }
  const write = argv.includes('--write');
  const envFile = path.join(getCareerOpsRoot(), '.env');
  if (!existsSync(envFile)) throw new Error(`no .env at ${envFile}. Create it with GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET (README, step 2).`);
  const { clientId, clientSecret } = readClientCreds(readFileSync(envFile, 'utf8'));
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');

  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(undefined)); });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  console.log('\nOpen this link in your browser and sign in with the Gmail account that receives the job alerts:\n');
  console.log(buildAuthUrl({ clientId, redirectUri, challenge, state }));
  console.log('\nGoogle may say the app is not verified. That is expected for your own app: choose Advanced, then "Go to …".');
  console.log('Waiting up to 5 minutes…');

  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  /** @type {{ code: string } | { error: string }} */
  const result = await new Promise((resolve) => {
    timer = setTimeout(() => resolve({ error: 'timed out after 5 minutes' }), TIMEOUT_MS);
    server.on('request', (req, res) => {
      const reqUrl = req.url ?? '/';
      if (!reqUrl.includes('state=')) { res.writeHead(404).end(); return; } // favicon and other browser noise
      const r = readCallback(reqUrl, state);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('error' in r ? `<p>Sign-in failed: ${escapeHtml(r.error)}. You can close this tab.</p>` : '<p>Signed in. You can close this tab and go back to the terminal.</p>');
      resolve(r);
    });
  });
  clearTimeout(timer);
  server.close();
  if ('error' in result) throw new Error(result.error);

  const refreshToken = await exchangeCode({ clientId, clientSecret, code: result.code, verifier, redirectUri });
  if (write) {
    writeFileSync(envFile, upsertEnvValue(readFileSync(envFile, 'utf8'), 'GMAIL_REFRESH_TOKEN', refreshToken), { encoding: 'utf8', mode: 0o600 });
    chmodSync(envFile, 0o600);
    console.log(`\n✓ Saved GMAIL_REFRESH_TOKEN to ${envFile}.`);
    console.log('Next: node plugins.mjs run job-alerts --dry-run');
  } else {
    console.log('\n=== GMAIL_REFRESH_TOKEN: paste this line into .env ===');
    console.log(`GMAIL_REFRESH_TOKEN=${refreshToken}`);
    console.log('=== end ===');
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`connect-gmail: ${err.message}`);
    process.exit(1);
  });
}
