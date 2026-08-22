'use strict';

// Contract tests for api/drills.js, run against a stubbed Neon HTTP endpoint
// so they need no DATABASE_URL and no network. They exist because this
// handler was rewritten for latency (CDN caching, and collapsing the old
// SELECT-then-write pairs into single RETURNING statements) — the round-trip
// COUNT is now part of the contract, not an implementation detail, and the
// 409/404 answers now come from an empty RETURNING result rather than a
// separate existence check.
//
// Caveat: this verifies the SQL this handler *sends*. It does not execute it.
// The seed statement in particular (jsonb_to_recordset -> text[]) is only
// checked for shape here; see DRILLS.md for verifying it against live Neon.

import assert from 'node:assert';
import { makeRunner } from './helpers.mjs';

const { test, report } = makeRunner();

const realFetch = globalThis.fetch;
const realUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = 'postgresql://u:p@stub-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

// Neon's HTTP driver wants the raw wire shape: column descriptors plus rows as
// arrays of TEXT values, which it parses by dataTypeID (25=text, 3802=jsonb)
// into the row objects the handler consumes.
const OID = { id: 25, name: 25, data: 3802 };
function wire(rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return {
    command: 'SELECT',
    fields: cols.map((c, i) => ({
      name: c, dataTypeID: OID[c] ?? 25, tableID: 0,
      columnID: i + 1, dataTypeSize: -1, dataTypeModifier: -1, format: 'text'
    })),
    rows: rows.map((r) => cols.map((c) => (typeof r[c] === 'string' ? r[c] : JSON.stringify(r[c])))),
    rowCount: rows.length,
    rowAsArray: true
  };
}

let script = [];   // queued result sets, one per expected query
let seen = [];     // SQL actually sent, in order
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  seen.push(body.query.replace(/\s+/g, ' ').trim());
  const next = script.shift();
  if (next === undefined) throw new Error('unexpected extra query: ' + body.query);
  return new Response(JSON.stringify(wire(next)), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
};

const { default: handler } = await import('../api/drills.js');
const { DEFAULT_DRILLS } = await import('../src/drillStore.js');

function mkRes() {
  return {
    headers: {}, statusCode: 0, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    end(b) { this.body = b === undefined ? null : b; return this; },
    json(b) { this.body = JSON.stringify(b); return this; }
  };
}

// Runs one request against the stub. `rows` is the queued result set per query.
async function call(req, rows) {
  script = rows.slice();
  seen = [];
  const res = mkRes();
  await handler(Object.assign({ query: {}, headers: {} }, req), res);
  return { res, sql: seen };
}

// A real shipped drill (id changed) — a hand-rolled fixture trips
// validateDrill's roster/target rules for reasons unrelated to this handler.
const drill = Object.assign(JSON.parse(JSON.stringify(DEFAULT_DRILLS[0])), { id: 'newd' });

/* ------------------------------------------------------------- GET (cached) */
const list = await call({ method: 'GET' }, [[{ data: { id: 'a', name: 'A' } }]]);
test('GET list: 200 from a single query', () => {
  assert.strictEqual(list.res.statusCode, 200);
  assert.strictEqual(list.sql.length, 1);
});
test('GET list: CDN-cacheable, so most library opens never reach Neon', () => {
  assert.match(list.res.headers['cache-control'], /public/);
  assert.match(list.res.headers['cache-control'], /s-maxage=60/);
  assert.match(list.res.headers['cache-control'], /stale-while-revalidate=600/);
});
test('GET list: emits a weak ETag', () => {
  assert.match(list.res.headers.etag || '', /^W\/"/);
});

const cond = await call(
  { method: 'GET', headers: { 'if-none-match': list.res.headers.etag } },
  [[{ data: { id: 'a', name: 'A' } }]]
);
test('GET list: a matching If-None-Match answers 304 with no body', () => {
  assert.strictEqual(cond.res.statusCode, 304);
  assert.ok(!cond.res.body);
});

/* ------------------------------------------------------ POST (one round trip) */
const post = await call({ method: 'POST', body: drill }, [[{ id: 'newd' }]]);
test('POST: 201 from ONE query (was SELECT + INSERT)', () => {
  assert.strictEqual(post.res.statusCode, 201);
  assert.strictEqual(post.sql.length, 1);
  assert.match(post.sql[0], /ON CONFLICT \(id\) DO NOTHING RETURNING id/);
});
test('POST: response is not cached', () => {
  assert.strictEqual(post.res.headers['cache-control'], 'no-store');
});

// An empty RETURNING is the duplicate answer — atomic, unlike the old
// SELECT-then-INSERT pair, which could lose a race between the two.
const dup = await call({ method: 'POST', body: drill }, [[]]);
test('POST: duplicate id still 409, from the same single query', () => {
  assert.strictEqual(dup.res.statusCode, 409);
  assert.strictEqual(dup.sql.length, 1);
  assert.match(JSON.parse(dup.res.body).errors[0], /already exists/);
});

const bad = await call({ method: 'POST', body: { id: '', name: '' } }, []);
test('POST: invalid input is rejected before any query is issued', () => {
  assert.strictEqual(bad.res.statusCode, 400);
  assert.strictEqual(bad.sql.length, 0);
});

/* ------------------------------------------------------- PUT (one round trip) */
const put = await call({ method: 'PUT', query: { id: 'newd' }, body: drill }, [[{ id: 'newd' }]]);
test('PUT: 200 from ONE query (was SELECT + UPDATE)', () => {
  assert.strictEqual(put.res.statusCode, 200);
  assert.strictEqual(put.sql.length, 1);
  assert.match(put.sql[0], /UPDATE pb3d_drills.*RETURNING id/);
});
const putMissing = await call({ method: 'PUT', query: { id: 'nope' }, body: drill }, [[]]);
test('PUT: still never creates — an empty RETURNING is the 404', () => {
  assert.strictEqual(putMissing.res.statusCode, 404);
});

/* ------------------------------------------------------------------- seeding */
const seed = await call({ method: 'GET' }, [[], []]);
test('empty table: seeds with ONE batched INSERT (was one per default drill)', () => {
  assert.strictEqual(seed.res.statusCode, 200);
  assert.strictEqual(seed.sql.length, 2, 'expected the list SELECT + exactly one INSERT');
  assert.match(seed.sql[1], /jsonb_to_recordset/);
});
test('empty table: a second GET does not re-run the seed', () => {
  assert.strictEqual(seed.sql.length, 2);
});
const seedAgain = await call({ method: 'GET' }, [[]]);
test('empty table: the seed is not retried on every subsequent list GET', () => {
  assert.strictEqual(seedAgain.sql.length, 1);
});

/* ---------------------------------------------------------------------- misc */
const notAllowed = await call({ method: 'PATCH' }, []);
test('an unsupported method never touches the database', () => {
  assert.strictEqual(notAllowed.res.statusCode, 405);
  assert.strictEqual(notAllowed.sql.length, 0);
});

globalThis.fetch = realFetch;
if (realUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = realUrl;

report('drills-API');
