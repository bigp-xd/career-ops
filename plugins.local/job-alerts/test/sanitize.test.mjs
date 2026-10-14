// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createSanitizer, buildFixture, fixtureFields } from '../tools/sanitize-eml.mjs';
import { parseMessage } from '../mime.mjs';
import { buildEml } from './helpers.mjs';

const JK = '0123456789abcdef';

test('scrubUrl keeps job ids and replaces every other token with a stable placeholder', () => {
  const s = createSanitizer();
  const a = s.scrubUrl('https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abcDEF123%3D%3D&refId=xyz789&lang=en');
  const b = s.scrubUrl('https://www.linkedin.com/comm/jobs/view/4098765432/?trackingId=zzzYYY999&refId=xyz789');
  assert.equal(a, 'https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=REDACTED1&refId=REDACTED2&lang=en');
  assert.equal(b, 'https://www.linkedin.com/comm/jobs/view/4098765432/?trackingId=REDACTED3&refId=REDACTED2');
});

test('scrubUrl recurses into a wrapped job URL and keeps its jk', () => {
  const s = createSanitizer();
  const wrapped = `https://cts.indeed.com/v3/x?url=${encodeURIComponent(`https://ca.indeed.com/rc/clk?jk=${JK}&tk=secret123`)}&sig=abcdef`;
  const out = new URL(s.scrubUrl(wrapped));
  const inner = new URL(/** @type {string} */ (out.searchParams.get('url')));
  assert.equal(inner.searchParams.get('jk'), JK);
  assert.equal(inner.searchParams.get('tk'), 'REDACTED1');
  assert.equal(out.searchParams.get('sig'), 'REDACTED2');
});

test('scrubUrl replaces long path tokens but keeps slug-with-id segments', () => {
  const s = createSanitizer();
  assert.equal(s.scrubUrl('https://click.ziprecruiter.com/ekm/AbCdEfGhIjKlMnOpQrSt123'), 'https://click.ziprecruiter.com/ekm/REDACTED1');
  assert.equal(s.scrubUrl('https://www.linkedin.com/jobs/view/senior-designer-at-acme-4012345678'), 'https://www.linkedin.com/jobs/view/senior-designer-at-acme-4012345678');
});

test('scrubText replaces personal strings and addresses, keeping board addresses', () => {
  const s = createSanitizer([['Jane Doe', 'Test Candidate']]);
  assert.equal(s.scrubText('Hi JANE DOE, sent to jane.doe@gmail.com by jobalerts-noreply@linkedin.com'),
    'Hi Test Candidate, sent to candidate@example.com by jobalerts-noreply@linkedin.com');
});

test('scrubHtml rewrites href/src values and keeps &amp; encoding', () => {
  const s = createSanitizer();
  const html = s.scrubHtml('<a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abcdef1&amp;refId=xyz789">X</a>');
  assert.equal(html, '<a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=REDACTED1&amp;refId=REDACTED2">X</a>');
});

test('buildFixture output parses back to the same HTML and headers', () => {
  const eml = buildFixture({ from: 'A <jobalerts-noreply@linkedin.com>', subject: 'Café jobs', date: 'Tue, 13 Oct 2026 09:00:00 +0000', auth: 'mx.google.com; dmarc=pass', html: '<p>Café</p>' });
  const msg = parseMessage(Buffer.from(eml, 'utf8'));
  assert.equal(msg.html, '<p>Café</p>\r\n');
  assert.equal(msg.get('subject'), 'Café jobs');
  assert.equal(msg.get('authentication-results'), 'mx.google.com; dmarc=pass');
});

test('fixtureFields restores the original sender of a forwarded alert and labels the synthetic DMARC result', () => {
  const msg = parseMessage(buildEml({
    from: 'Jane Doe <jane.doe@gmail.com>',
    subject: 'Fwd: Designer at Acme',
    auth: ['mx.google.com; dkim=pass; dmarc=pass (p=NONE) header.from=gmail.com'],
    html: '<p>Hi Jane Doe</p>',
  }));
  const s = createSanitizer([['Jane Doe', 'Test Candidate']]);
  const fwd = fixtureFields(msg, s, { from: 'LinkedIn <jobs-noreply@linkedin.com>', forwarded: true });
  assert.equal(fwd.from, 'LinkedIn <jobs-noreply@linkedin.com>');
  assert.equal(fwd.subject, 'Designer at Acme');
  assert.equal(fwd.auth, 'mx.google.com; dmarc=pass (synthetic: fixture built from a forwarded copy) header.from=linkedin.com');
  assert.equal(fwd.html, '<p>Hi Test Candidate</p>');
  const plain = fixtureFields(msg, s);
  assert.equal(plain.from, 'Test Candidate <candidate@example.com>');
  assert.equal(plain.auth, 'mx.google.com; dkim=pass; dmarc=pass (p=NONE) header.from=gmail.com');
});
