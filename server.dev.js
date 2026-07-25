import { config } from 'dotenv';
config({ path: '.env.local' });

import express from 'express';
import drillsHandler from './api/drills.js';

if (!process.env.DATABASE_URL) {
  console.warn('server.dev.js: no DATABASE_URL in .env.local — /api/drills will error on any request. The app still works via the bundled DEFAULT_DRILLS fallback.');
}

const app = express();
app.use(express.json());
app.all('/api/drills', (req, res) => {
  drillsHandler(req, res).catch((err) => {
    console.error('server.dev.js: /api/drills error', err);
    res.status(500).json({ error: 'internal error' });
  });
});
app.listen(3001, () => console.log('API: http://localhost:3001'));
