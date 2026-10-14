// @ts-check
// Shared test helpers. Later tasks append to this file.
import { Buffer } from 'node:buffer';

/**
 * Build a raw RFC 822 message (multipart/alternative: text + HTML).
 * @param {{ from?: string, subject?: string, date?: string, auth?: string[], html?: string, text?: string,
 *           htmlEncoding?: '8bit' | 'quoted-printable' | 'base64', extraHeaders?: string[] }} [o]
 * @returns {Buffer}
 */
export function buildEml({
  from = 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
  subject = 'Job alert',
  date = 'Tue, 13 Oct 2026 09:00:00 +0000',
  auth = ['mx.google.com; dkim=pass header.i=@linkedin.com; spf=pass; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=linkedin.com'],
  html = '<p>hello</p>',
  text = 'hello',
  htmlEncoding = '8bit',
  extraHeaders = [],
} = {}) {
  const boundary = 'test-boundary-42';
  const htmlBody = htmlEncoding === 'base64'
    ? Buffer.from(html, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')
    : htmlEncoding === 'quoted-printable' ? toQuotedPrintable(html) : html;
  const lines = [
    ...auth.map(a => `Authentication-Results: ${a}`),
    `From: ${from}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    ...extraHeaders,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    `Content-Transfer-Encoding: ${htmlEncoding}`,
    '',
    htmlBody,
    `--${boundary}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/** UTF-8 text → quoted-printable, 76-column soft line breaks. @param {string} s */
export function toQuotedPrintable(s) {
  let out = '';
  let lineLength = 0;
  for (const byte of Buffer.from(s, 'utf8')) {
    if (byte === 0x0d) continue;
    if (byte === 0x0a) { out += '\r\n'; lineLength = 0; continue; }
    const plain = (byte >= 33 && byte <= 126 && byte !== 61) || byte === 32;
    const chunk = plain ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    if (lineLength + chunk.length > 75) { out += '=\r\n'; lineLength = 0; }
    out += chunk;
    lineLength += chunk.length;
  }
  return out;
}
