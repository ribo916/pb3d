import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { validateDrill, normalizeDrill, DEFAULT_DRILLS } from '../src/drillStore.js';

// Module scope, not per-invocation: a warm instance reuses this client, and a
// request that never queries (405) no longer builds one at all. Built lazily
// rather than at import time so a missing DATABASE_URL (local dev with no
// .env.local) still yields a per-request error instead of failing the whole
// module load — server.dev.js imports this at startup.
let _sql = null;
function db() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// The drill list is identical for every visitor, so it is fully CDN-cacheable.
// With this header most library opens are served from Vercel's edge and never
// reach Neon at all — which also means a Neon cold start (autosuspend wake)
// stops being on the critical path of a screen render.
// Keep in sync with MUTATION_QUIET_MS in src/drillStore.js, which must exceed
// S_MAXAGE so a background refresh can't serve a pre-save copy.
const S_MAXAGE = 60;
const LIST_CACHE_CONTROL = `public, s-maxage=${S_MAXAGE}, stale-while-revalidate=600`;

// One INSERT for the whole default set instead of one round trip per drill.
// `seeded` stops a warm instance retrying the seed on every list GET while the
// table is empty — the original re-ran the full loop on each request.
let seeded = false;

async function seedAndReturn() {
  if (!seeded) {
    await db()`
      INSERT INTO pb3d_drills (id, name, tags, data)
      SELECT d.id, d.name, d.tags, d.data
      FROM jsonb_to_recordset(${JSON.stringify(DEFAULT_DRILLS.map((d) => ({
        id: d.id, name: d.name, tags: d.tags || [], data: d
      })))}::jsonb)
        AS d(id text, name text, tags text[], data jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
    seeded = true;
  }
  return DEFAULT_DRILLS;
}

// Weak ETag over the serialized body, so a repeat fetch that missed the CDN
// still costs a 304 instead of the full JSONB payload.
function sendJson(res, status, body, cacheControl, req) {
  const payload = JSON.stringify(body);
  if (cacheControl) {
    res.setHeader('Cache-Control', cacheControl);
    const etag = 'W/"' + createHash('sha1').update(payload).digest('base64') + '"';
    res.setHeader('ETag', etag);
    if (req && req.headers['if-none-match'] === etag) return res.status(304).end();
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.setHeader('Content-Type', 'application/json');
  return res.status(status).end(payload);
}

export default async function handler(req, res) {
  const id = req.query.id;

  if (req.method === 'GET') {
    if (id) {
      const rows = await db()`SELECT data FROM pb3d_drills WHERE id = ${id}`;
      if (!rows.length) return sendJson(res, 404, { error: 'not found' }, null);
      return sendJson(res, 200, rows[0].data, LIST_CACHE_CONTROL, req);
    }
    const rows = await db()`SELECT data FROM pb3d_drills ORDER BY created_at`;
    if (!rows.length) {
      const drills = await seedAndReturn();
      return sendJson(res, 200, { drills }, LIST_CACHE_CONTROL, req);
    }
    return sendJson(res, 200, { drills: rows.map((r) => r.data) }, LIST_CACHE_CONTROL, req);
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const drill = normalizeDrill(req.body);
    const errors = validateDrill(drill);
    if (errors.length) return sendJson(res, 400, { errors }, null);

    // Both verbs used to do a SELECT-then-write pair: two sequential round
    // trips, and non-atomic (a real TOCTOU race on duplicate id). RETURNING
    // collapses each to one query and makes the check atomic — an empty
    // result set IS the "already exists" / "not found" answer.
    if (req.method === 'POST') {
      const inserted = await db()`
        INSERT INTO pb3d_drills (id, name, tags, data)
        VALUES (${drill.id}, ${drill.name}, ${drill.tags || []}, ${JSON.stringify(drill)}::jsonb)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      if (!inserted.length) {
        return sendJson(res, 409, { errors: ['a drill with id "' + drill.id + '" already exists'] }, null);
      }
      return sendJson(res, 201, drill, null);
    }

    // PUT: update only, never create — keeps the two verbs' semantics distinct.
    const targetId = id || drill.id;
    const updated = await db()`
      UPDATE pb3d_drills
      SET name = ${drill.name}, tags = ${drill.tags || []}, data = ${JSON.stringify(drill)}::jsonb, updated_at = now()
      WHERE id = ${targetId}
      RETURNING id
    `;
    if (!updated.length) return sendJson(res, 404, { error: 'not found' }, null);
    return sendJson(res, 200, drill, null);
  }

  if (req.method === 'DELETE') {
    if (!id) return sendJson(res, 400, { error: 'id required' }, null);
    await db()`DELETE FROM pb3d_drills WHERE id = ${id}`;
    return sendJson(res, 200, { ok: true }, null);
  }

  return sendJson(res, 405, { error: 'method not allowed' }, null);
}
