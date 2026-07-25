import { neon } from '@neondatabase/serverless';
import { validateDrill, normalizeDrill, DEFAULT_DRILLS } from '../src/drillStore.js';

async function seedAndReturn(sql) {
  for (const drill of DEFAULT_DRILLS) {
    await sql`
      INSERT INTO pb3d_drills (id, name, tags, data)
      VALUES (${drill.id}, ${drill.name}, ${drill.tags || []}, ${JSON.stringify(drill)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  }
  return DEFAULT_DRILLS;
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);
  const id = req.query.id;

  if (req.method === 'GET') {
    if (id) {
      const rows = await sql`SELECT data FROM pb3d_drills WHERE id = ${id}`;
      if (!rows.length) return res.status(404).json({ error: 'not found' });
      return res.status(200).json(rows[0].data);
    }
    const rows = await sql`SELECT data FROM pb3d_drills ORDER BY created_at`;
    if (!rows.length) {
      const drills = await seedAndReturn(sql);
      return res.status(200).json({ drills });
    }
    return res.status(200).json({ drills: rows.map((r) => r.data) });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const drill = normalizeDrill(req.body);
    const errors = validateDrill(drill);
    if (errors.length) return res.status(400).json({ errors });

    if (req.method === 'POST') {
      const existing = await sql`SELECT id FROM pb3d_drills WHERE id = ${drill.id}`;
      if (existing.length) return res.status(409).json({ errors: ['a drill with id "' + drill.id + '" already exists'] });
      await sql`
        INSERT INTO pb3d_drills (id, name, tags, data)
        VALUES (${drill.id}, ${drill.name}, ${drill.tags || []}, ${JSON.stringify(drill)}::jsonb)
      `;
      return res.status(201).json(drill);
    }

    // PUT: update only, never create — keeps the two verbs' semantics distinct.
    const targetId = id || drill.id;
    const existing = await sql`SELECT id FROM pb3d_drills WHERE id = ${targetId}`;
    if (!existing.length) return res.status(404).json({ error: 'not found' });
    await sql`
      UPDATE pb3d_drills
      SET name = ${drill.name}, tags = ${drill.tags || []}, data = ${JSON.stringify(drill)}::jsonb, updated_at = now()
      WHERE id = ${targetId}
    `;
    return res.status(200).json(drill);
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id required' });
    await sql`DELETE FROM pb3d_drills WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'method not allowed' });
}
