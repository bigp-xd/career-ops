// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeLayers, opaqueJobKey } from '../../plugins/job-alerts/links.mjs';
import { linkedin } from '../../plugins/job-alerts/parsers/linkedin.mjs';
import { indeed } from '../../plugins/job-alerts/parsers/indeed.mjs';
import { ziprecruiter } from '../../plugins/job-alerts/parsers/ziprecruiter.mjs';
import { parseAlert, cleanField } from '../../plugins/job-alerts/parse.mjs';
import { COMMON_NOISE } from '../../plugins/job-alerts/cards.mjs';
import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

const JK = '0123456789abcdef';

test('decodeLayers unwraps nested URL encoding', () => {
  assert.deepEqual(decodeLayers('a%253Db'), ['a%253Db', 'a%3Db', 'a=b']);
});

test('opaqueJobKey keeps titled board links and refuses footer links', () => {
  const host = /(^|\.)example\.com$/i;
  assert.deepEqual(opaqueJobKey('https://click.example.com/ekm/ABC123#x', 'Event Coordinator', host, COMMON_NOISE),
    { key: 'opaque:https://click.example.com/ekm/ABC123', url: 'https://click.example.com/ekm/ABC123', opaque: true });
  assert.equal(opaqueJobKey('https://other.test/ekm/ABC', 'Designer', host, COMMON_NOISE), null);
  assert.equal(opaqueJobKey('https://www.example.com/unsubscribe/abc', 'Stop these emails', host, COMMON_NOISE), null);
  assert.equal(opaqueJobKey('https://www.example.com/ekm/ABC', 'View job', host, COMMON_NOISE), null);
  assert.equal(opaqueJobKey('https://www.example.com/ekm/ABC', '', host, COMMON_NOISE), null);
  assert.equal(opaqueJobKey('http://www.example.com/ekm/ABC', 'Designer', host, COMMON_NOISE), null);
});

test('linkedin.jobKey canonicalises every job-link shape and ignores the rest', () => {
  const want = { key: 'linkedin:4012345678', url: 'https://www.linkedin.com/jobs/view/4012345678/' };
  assert.deepEqual(linkedin.jobKey('https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc%3D%3D&refId=x', ''), want);
  assert.deepEqual(linkedin.jobKey('https://www.linkedin.com/jobs/view/senior-designer-at-acme-4012345678', ''), want);
  assert.deepEqual(linkedin.jobKey('https://www.linkedin.com/jobs/view/designer-2024-4012345678/', ''), want);
  assert.deepEqual(linkedin.jobKey('https://www.linkedin.com/comm/jobs/search?currentJobId=4012345678', ''), want);
  assert.equal(linkedin.jobKey('https://www.linkedin.com/comm/jobs/search?keywords=designer', 'See all jobs'), null);
  assert.equal(linkedin.jobKey('https://evil.test/jobs/view/4012345678', ''), null);
});

test('indeed.jobKey finds jk directly, on country hosts, and inside tracking redirects', () => {
  assert.deepEqual(indeed.jobKey(`https://www.indeed.com/rc/clk/dl?jk=${JK}&from=ja`, ''),
    { key: `indeed:${JK}`, url: `https://www.indeed.com/viewjob?jk=${JK}` });
  assert.deepEqual(indeed.jobKey(`https://ca.indeed.com/viewjob?jk=${JK.toUpperCase()}`, ''),
    { key: `indeed:${JK}`, url: `https://ca.indeed.com/viewjob?jk=${JK}` });
  const nested = `https://cts.indeed.com/v3/H4s?url=${encodeURIComponent(`https://ca.indeed.com/rc/clk?jk=${JK}&from=ja`)}`;
  assert.deepEqual(indeed.jobKey(nested, ''), { key: `indeed:${JK}`, url: `https://ca.indeed.com/viewjob?jk=${JK}` });
});

test('indeed.jobKey falls back to the link for titled id-less links only', () => {
  assert.deepEqual(indeed.jobKey('https://engage.indeed.com/f/a/XYZ123', 'Graphic Designer'),
    { key: 'opaque:https://engage.indeed.com/f/a/XYZ123', url: 'https://engage.indeed.com/f/a/XYZ123', opaque: true });
  assert.equal(indeed.jobKey('https://www.indeed.com/account/unsubscribe?x=1', 'Unsubscribe'), null);
  assert.equal(indeed.jobKey('https://www.indeed.com/f/a/XYZ', 'Full-time'), null);
});

test('ziprecruiter.jobKey keeps only jid on posting URLs, direct or wrapped', () => {
  const posting = 'https://www.ziprecruiter.com/c/Acme/Job/Graphic-Designer/-in-Toronto,ON?jid=a1b2c3d4e5&utm_source=alert';
  const want = { key: 'ziprecruiter:a1b2c3d4e5', url: 'https://www.ziprecruiter.com/c/Acme/Job/Graphic-Designer/-in-Toronto,ON?jid=a1b2c3d4e5' };
  assert.deepEqual(ziprecruiter.jobKey(posting, ''), want);
  assert.deepEqual(ziprecruiter.jobKey(`https://click.ziprecruiter.com/redirect?u=${encodeURIComponent(posting)}`, ''), want);
  assert.deepEqual(ziprecruiter.jobKey('https://click.ziprecruiter.com/ekm/AbCdEf123456', 'Event Coordinator'),
    { key: 'opaque:https://click.ziprecruiter.com/ekm/AbCdEf123456', url: 'https://click.ziprecruiter.com/ekm/AbCdEf123456', opaque: true });
  assert.equal(ziprecruiter.jobKey('https://www.ziprecruiter.com/alerts/manage', 'Manage alerts'), null);
});

test('cleanField strips control and bidi characters, collapses space, caps length', () => {
  assert.equal(cleanField(`  Graphic${String.fromCharCode(0x202e)}  Designer${String.fromCharCode(0x07)} `), 'Graphic Designer');
  assert.equal(cleanField('x'.repeat(300)).length, 200);
  assert.equal(cleanField(undefined), '');
});

test('parseAlert returns clean jobs and counts id-less links', () => {
  const html = `<a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=a">Graphic&nbsp;Designer</a><p>Acme · Toronto, ON</p>`;
  assert.deepEqual(parseAlert(linkedin, html), {
    jobs: [{ title: 'Graphic Designer', company: 'Acme', location: 'Toronto, ON', url: 'https://www.linkedin.com/jobs/view/4012345678/' }],
    warnings: [],
  });
  const opaque = parseAlert(indeed, '<a href="https://engage.indeed.com/f/a/XYZ123">Event Coordinator</a><div>Beta</div><div>Remote</div><a href="https://engage.indeed.com/f/a/XYZ123">View job</a>');
  assert.equal(opaque.jobs.length, 1);
  assert.deepEqual(opaque.warnings, ['Indeed: some job links had no job id, so the original links were kept']);
});

/** A cts.indeed.com tracking link wrapping `target`, the way real Indeed emails do. @param {string} target */
const ctsLink = (target) => {
  const payload = { u: target, m: { accountId: '111222333', clickType: 'viewjob', tk: 'abc123def456ghi7' } };
  return `https://cts.indeed.com/v3/${gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64url')}`;
};

test('indeed.jobKey reads jk from the compressed payload of a cts.indeed.com link', () => {
  assert.deepEqual(indeed.jobKey(ctsLink(`https://www.indeed.com/rc/clk?jk=${JK}&from=match&tk=abc`), 'View job'),
    { key: `indeed:${JK}`, url: `https://www.indeed.com/viewjob?jk=${JK}` });
  assert.deepEqual(indeed.jobKey(ctsLink(`https://ca.indeed.com/rc/clk?jk=${JK}`), 'Graphic Designer'),
    { key: `indeed:${JK}`, url: `https://ca.indeed.com/viewjob?jk=${JK}` });
});

test('a decodable cts.indeed.com link without a jk is a known non-job link, never an opaque job', () => {
  assert.equal(indeed.jobKey(ctsLink('https://match.indeed.com/invitations/abc?tk=x'), 'This is a bad match'), null);
  assert.equal(indeed.jobKey(ctsLink('https://profile.indeed.com/'), 'Edit profile'), null);
});

test('cts.indeed.com payloads that are not gzip JSON, or are oversized, are not trusted', () => {
  assert.equal(indeed.jobKey('https://cts.indeed.com/v3/not-a-real-payload-at-all', 'Designer'), null);
  const bomb = gzipSync(Buffer.alloc(200_000, 0x20)).toString('base64url');
  assert.equal(indeed.jobKey(`https://cts.indeed.com/v3/${bomb}`, 'Designer'), null);
});

test('parseAlert with allowOpaque: false keeps id-bearing job links only', () => {
  const html = '<a href="https://engage.indeed.com/f/a/XYZ123">Event Coordinator</a><div>Beta</div>' +
    `<a href="https://www.indeed.com/viewjob?jk=${JK}">Graphic Designer</a><div>Acme</div><div>Remote</div>`;
  assert.deepEqual(parseAlert(indeed, html, { allowOpaque: false }), {
    jobs: [{ title: 'Graphic Designer', company: 'Acme', location: 'Remote', url: `https://www.indeed.com/viewjob?jk=${JK}` }],
    warnings: [],
  });
});

test('opaque links drop login-like query parameters', () => {
  const host = /(^|\.)ziprecruiter\.com$/i;
  const k = opaqueJobKey('https://www.ziprecruiter.com/km/AbC123?tsid=777&auth_token=SECRET&contact_id=42&expires=99&email=a%40b.c&Token=x', 'Event Coordinator', host, COMMON_NOISE);
  assert.deepEqual(k, { key: 'opaque:https://www.ziprecruiter.com/km/AbC123?tsid=777', url: 'https://www.ziprecruiter.com/km/AbC123?tsid=777', opaque: true });
});

test('an id-less link becomes a job only when the email links that same target at least twice', () => {
  const single = '<p><a href="https://www.ziprecruiter.com/km/AAAprofile1">Complete Your Profile</a></p><p>It only takes 2 minutes.</p>' +
    '<p><a href="https://www.ziprecruiter.com/km/AAAsearch22">Search Jobs</a></p><p>Phil</p><p>Your Career Advisor</p>';
  assert.deepEqual(parseAlert(ziprecruiter, single).jobs, []);
  const card = '<p><a href="https://www.ziprecruiter.com/km/AAAjob333?tsid=1&amp;auth_token=x">Event Coordinator</a></p><p>Beta</p><p>Remote</p>' +
    '<p><a href="https://www.ziprecruiter.com/km/AAAjob333?tsid=1&amp;auth_token=y">View Details</a></p>';
  assert.deepEqual(parseAlert(ziprecruiter, card).jobs.map(j => j.title), ['Event Coordinator']);
});
