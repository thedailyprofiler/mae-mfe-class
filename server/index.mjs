/**
 * Tiny storage backend for the MAE/MFE dashboard.
 *
 * Zero npm dependencies — uses Node's built-in `http` server and built-in
 * SQLite (`node:sqlite`, Node 22.5+). The whole dashboard document is stored
 * as a single JSON blob per profile, mirroring the production schema (one
 * schemaless `data` column) but in a local file you can commit, copy, or back
 * up by hand: server/data/mae-mfe.db
 *
 *   node server/index.mjs            → http://localhost:8787
 *
 * Routes:
 *   GET    /api/doc?profile=default  → { doc, updatedAt }   (doc=null if none yet)
 *   PUT    /api/doc?profile=default  → body { doc }          (upsert)
 *   DELETE /api/doc?profile=default  → wipe that profile
 *   GET    /api/health               → { ok: true }
 */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'mae-mfe.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    profile    TEXT PRIMARY KEY,
    doc        TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const getStmt = db.prepare('SELECT doc, updated_at FROM submissions WHERE profile = ?');
const putStmt = db.prepare(`
  INSERT INTO submissions (profile, doc, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(profile) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at
`);
const delStmt = db.prepare('DELETE FROM submissions WHERE profile = ?');

const PORT = Number(process.env.PORT) || 8787;

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    // Permit direct cross-origin use (in dev, Vite proxies same-origin anyway).
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) reject(new Error('payload too large')); // 25MB ceiling
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const profile = url.searchParams.get('profile') || 'default';

  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (url.pathname === '/api/health') return send(res, 200, { ok: true });

  if (url.pathname === '/api/doc') {
    try {
      if (req.method === 'GET') {
        const row = getStmt.get(profile);
        return send(res, 200, {
          doc: row ? JSON.parse(row.doc) : null,
          updatedAt: row ? row.updated_at : null,
        });
      }
      if (req.method === 'PUT') {
        const body = await readJson(req);
        if (body == null || body.doc == null) return send(res, 400, { error: 'missing doc' });
        const now = new Date().toISOString();
        putStmt.run(profile, JSON.stringify(body.doc), now);
        return send(res, 200, { ok: true, updatedAt: now });
      }
      if (req.method === 'DELETE') {
        delStmt.run(profile);
        return send(res, 200, { ok: true });
      }
    } catch (err) {
      return send(res, 400, { error: String(err && err.message ? err.message : err) });
    }
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`MAE/MFE storage → http://localhost:${PORT}  (db: server/data/mae-mfe.db)`);
});
