// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { parseMessage, decodeHeaderValue, decodeQuotedPrintable } from '../../plugins/job-alerts/mime.mjs';
import { buildEml } from './helpers.mjs';

test('reads headers, including folded and repeated ones', () => {
  const raw = Buffer.from([
    'Authentication-Results: mx.google.com; dmarc=pass',
    'Authentication-Results: other.example; dmarc=fail',
    'Subject: Graphic Designer at',
    '  Acme',
    'From: Jobs <jobs@example.com>',
    '',
    'body',
  ].join('\r\n'), 'utf8');
  const msg = parseMessage(raw);
  assert.equal(msg.get('subject'), 'Graphic Designer at Acme');
  assert.equal(msg.get('FROM'), 'Jobs <jobs@example.com>');
  assert.deepEqual(msg.getAll('authentication-results'), ['mx.google.com; dmarc=pass', 'other.example; dmarc=fail']);
  assert.equal(msg.get('x-missing'), '');
  assert.equal(msg.html, '');
});

test('decodes RFC 2047 encoded words', () => {
  const b64 = Buffer.from('Café Designer', 'utf8').toString('base64');
  assert.equal(decodeHeaderValue(`=?UTF-8?B?${b64}?=`), 'Café Designer');
  assert.equal(decodeHeaderValue('=?utf-8?Q?Caf=C3=A9_Designer?='), 'Café Designer');
  assert.equal(decodeHeaderValue('=?UTF-8?Q?New?= =?UTF-8?Q?_jobs?='), 'New jobs');
  assert.equal(decodeHeaderValue('Plain subject'), 'Plain subject');
});

test('decodes quoted-printable with soft line breaks', () => {
  const latin1 = decodeQuotedPrintable('Caf=C3=\r\n=A9 =3D ok');
  assert.equal(Buffer.from(latin1, 'latin1').toString('utf8'), 'Café = ok');
});

test('finds the HTML part of multipart/alternative (quoted-printable UTF-8)', () => {
  const msg = parseMessage(buildEml({ html: '<p>Café &amp; Co — Designer</p>', htmlEncoding: 'quoted-printable' }));
  assert.equal(msg.html, '<p>Café &amp; Co — Designer</p>');
});

test('decodes base64 HTML nested inside multipart/mixed', () => {
  const html = '<p>Événement coordinator</p>';
  const raw = Buffer.from([
    'Content-Type: multipart/mixed; boundary=outer',
    '',
    '--outer',
    'Content-Type: multipart/alternative; boundary="inner"',
    '',
    '--inner',
    'Content-Type: text/plain',
    '',
    'plain',
    '--inner',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    '--inner--',
    '--outer',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename=x.pdf',
    '',
    'JVBERi0=',
    '--outer--',
    '',
  ].join('\r\n'), 'utf8');
  assert.equal(parseMessage(raw).html, html);
});

test('skips an HTML attachment and returns the inline HTML part', () => {
  const raw = Buffer.from([
    'Content-Type: multipart/mixed; boundary=b1',
    '',
    '--b1',
    'Content-Type: text/html',
    'Content-Disposition: attachment; filename=old.html',
    '',
    '<p>attached</p>',
    '--b1',
    'Content-Type: text/html',
    '',
    '<p>inline</p>',
    '--b1--',
    '',
  ].join('\r\n'), 'utf8');
  assert.equal(parseMessage(raw).html, '<p>inline</p>');
});

test('a MIME part with no headers is plain text, not HTML', () => {
  const raw = Buffer.from([
    'Content-Type: multipart/alternative; boundary=b2',
    '',
    '--b2',
    '',
    'no headers here',
    '--b2',
    'Content-Type: text/html',
    '',
    '<p>html</p>',
    '--b2--',
    '',
  ].join('\r\n'), 'utf8');
  assert.equal(parseMessage(raw).html, '<p>html</p>');
});

test('honours a non-UTF-8 charset, and falls back to UTF-8 for unknown ones', () => {
  const head = Buffer.from('Content-Type: text/html; charset=windows-1252\r\n\r\n<p>Caf', 'latin1');
  const raw = Buffer.concat([head, Buffer.from([0xe9]), Buffer.from('</p>', 'latin1')]);
  assert.equal(parseMessage(raw).html, '<p>Café</p>');
  assert.equal(parseMessage(Buffer.from('Content-Type: text/html; charset=x-made-up\r\n\r\n<p>ok</p>')).html, '<p>ok</p>');
});

test('accepts LF-only line endings (files saved on macOS/Linux)', () => {
  const raw = Buffer.from('Subject: hi\nContent-Type: text/html\n\n<p>lf</p>', 'utf8');
  const msg = parseMessage(raw);
  assert.equal(msg.get('subject'), 'hi');
  assert.equal(msg.html, '<p>lf</p>');
});
