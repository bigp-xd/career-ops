// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMON_NOISE, decodeEntities, htmlToLines, extractCards } from '../cards.mjs';

/** @type {import('../cards.mjs').JobKeyFn} */
const fakeKey = (href) => {
  const m = /^https:\/\/jobs\.test\/view\/(\d+)/.exec(href);
  return m ? { key: `t:${m[1]}`, url: `https://jobs.test/view/${m[1]}` } : null;
};
const board = { jobKey: fakeKey, noise: COMMON_NOISE };
const cardsOf = (html) => extractCards(htmlToLines(html), board);

const card = (id, title, company, location, extra = '') => `
<table><tr>
  <td><a href="https://jobs.test/view/${id}?trk=logo"><img src="https://img.test/logo.png" alt=""></a></td>
  <td><a href="https://jobs.test/view/${id}?trk=title"><span>${title}</span></a>
      <div>${company}</div><div>${location}</div>${extra}
      <a href="https://jobs.test/view/${id}?trk=button">View job</a></td>
</tr></table>`;

test('decodeEntities handles named, decimal and hex entities', () => {
  assert.equal(decodeEntities('Caf&eacute; &amp; Co &#8212; &#x2014; &unknown;'), 'Café & Co — — &unknown;');
});

test('htmlToLines keeps link targets, splits blocks, joins inline text, drops head/style', () => {
  const lines = htmlToLines('<html><head><title>x</title><style>p{}</style></head><body>' +
    '<p>Acme<span> · </span>Toronto</p><a href="https://jobs.test/view/1?a=1&amp;b=2">Designer</a>' +
    '<a href="mailto:x@y.test">Mail us</a><!-- hidden --></body></html>');
  assert.deepEqual(lines, [
    { text: 'Acme · Toronto' },
    { text: 'Designer', href: 'https://jobs.test/view/1?a=1&b=2' },
    { text: 'Mail us' },
  ]);
});

test('htmlToLines splits a link that wraps a whole card into one line per block', () => {
  const lines = htmlToLines('<a href="https://jobs.test/view/9"><div>Brand Designer</div><div>Acme · Remote</div></a>');
  assert.deepEqual(lines, [
    { text: 'Brand Designer', href: 'https://jobs.test/view/9' },
    { text: 'Acme · Remote', href: 'https://jobs.test/view/9' },
  ]);
});

test('extracts title, company and location, ignoring logo, salary, age and buttons', () => {
  const html = card(1, 'Graphic Designer', 'Acme', 'Toronto, ON', '<div>$60,000 a year</div><div>3 days ago</div>') +
    card(2, 'Event Coordinator', 'Beta Events', 'New York, NY');
  assert.deepEqual(cardsOf(html), [
    { key: 't:1', url: 'https://jobs.test/view/1', opaque: false, title: 'Graphic Designer', company: 'Acme', location: 'Toronto, ON' },
    { key: 't:2', url: 'https://jobs.test/view/2', opaque: false, title: 'Event Coordinator', company: 'Beta Events', location: 'New York, NY' },
  ]);
});

test('splits "Company · Location" written on one line', () => {
  const html = '<a href="https://jobs.test/view/3">UX Designer</a><p>Gamma Studio · Remote (Canada)</p>';
  assert.deepEqual(cardsOf(html).map(c => [c.company, c.location]), [['Gamma Studio', 'Remote (Canada)']]);
});

test('a whole-card link yields the same card', () => {
  const html = '<a href="https://jobs.test/view/9"><div>Brand Designer</div><div>Acme · Remote</div></a>';
  assert.deepEqual(cardsOf(html).map(c => [c.title, c.company, c.location]), [['Brand Designer', 'Acme', 'Remote']]);
});

test('footer text after the last card is not taken as company or location', () => {
  const html = '<a href="https://jobs.test/view/4">Marketing Coordinator</a>' +
    '<p><a href="https://jobs.test/settings">Unsubscribe</a></p><p>You are receiving this email because you set an alert.</p>';
  assert.deepEqual(cardsOf(html).map(c => [c.company, c.location]), [['', '']]);
});

test('a job linked again later (summary list) does not collect stray text', () => {
  const html = card(1, 'Designer A', 'Acme', 'Toronto') + card(2, 'Designer B', 'Beta', 'Ottawa') +
    '<a href="https://jobs.test/view/1">Designer A</a><p>Recommended for you</p>';
  const [first] = cardsOf(html);
  assert.equal(first.company, 'Acme');
  assert.equal(first.location, 'Toronto');
});

test('a card with no usable title is dropped', () => {
  const html = '<a href="https://jobs.test/view/5"><img src="https://img.test/x.png"></a><a href="https://jobs.test/view/5">View job</a>';
  assert.deepEqual(cardsOf(html), []);
});
