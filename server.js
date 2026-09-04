'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.SCIM_BEARER_TOKEN || 'demo-secret-change-me';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'scim-demo.db');
const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_RESPONSE = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    user_name TEXT NOT NULL,
    display_name TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_user_name ON users(user_name);
  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    external_id TEXT,
    result TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );
`);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ type: ['application/json', 'application/scim+json'], limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function now() { return new Date().toISOString(); }
function scimContent(res) { return res.type('application/scim+json'); }
function scimError(res, status, detail, scimType) {
  const body = { schemas: [ERROR_SCHEMA], status: String(status), detail };
  if (scimType) body.scimType = scimType;
  return scimContent(res).status(status).json(body);
}
function authorized(req) {
  const actual = req.get('authorization') || '';
  const expected = `Bearer ${TOKEN}`;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireBearer(req, res, next) {
  if (!authorized(req)) return scimError(res, 401, 'Bearer token is missing or invalid');
  next();
}
function readUser(row) { return row ? JSON.parse(row.payload) : null; }
function logSync(req, externalId, result) {
  db.prepare('INSERT INTO sync_log(method,path,external_id,result,occurred_at) VALUES(?,?,?,?,?)')
    .run(req.method, req.originalUrl, externalId || null, result, now());
}
function normalizeUser(input, existingId) {
  if (!input || typeof input !== 'object') throw new Error('JSON body is required');
  if (!input.externalId || typeof input.externalId !== 'string') throw new Error('externalId is required');
  if (!input.userName || typeof input.userName !== 'string') throw new Error('userName is required');
  const timestamp = now();
  return {
    ...input,
    schemas: Array.isArray(input.schemas) && input.schemas.length ? input.schemas : [CORE_USER],
    id: existingId || crypto.randomUUID(),
    externalId: input.externalId,
    userName: input.userName,
    active: input.active !== false,
    meta: {
      resourceType: 'User',
      created: input.meta?.created || timestamp,
      lastModified: timestamp
    }
  };
}
function saveUser(user, createdAt) {
  db.prepare(`
    INSERT INTO users(id,external_id,user_name,display_name,active,payload,created_at,updated_at)
    VALUES(@id,@externalId,@userName,@displayName,@active,@payload,@createdAt,@updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      external_id=excluded.external_id,
      user_name=excluded.user_name,
      display_name=excluded.display_name,
      active=excluded.active,
      payload=excluded.payload,
      updated_at=excluded.updated_at
  `).run({
    id: user.id,
    externalId: user.externalId,
    userName: user.userName,
    displayName: user.displayName || user.name?.formatted || '',
    active: user.active === false ? 0 : 1,
    payload: JSON.stringify(user),
    createdAt: createdAt || user.meta.created,
    updatedAt: user.meta.lastModified
  });
}
function parseEqFilter(raw) {
  if (!raw) return null;
  const match = String(raw).match(/^\s*(externalId|userName)\s+eq\s+"((?:\\.|[^"])*)"\s*$/i);
  if (!match) return null;
  const value = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return { attribute: match[1].toLowerCase(), value };
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/scim/v2', requireBearer);

app.get('/scim/v2/Users', (req, res) => {
  const filter = parseEqFilter(req.query.filter);
  let rows;
  if (req.query.filter && !filter) return scimError(res, 400, 'Only externalId eq "..." and userName eq "..." filters are supported', 'invalidFilter');
  if (!filter) rows = db.prepare('SELECT payload FROM users ORDER BY updated_at DESC').all();
  else if (filter.attribute === 'externalid') rows = db.prepare('SELECT payload FROM users WHERE external_id = ?').all(filter.value);
  else rows = db.prepare('SELECT payload FROM users WHERE user_name = ?').all(filter.value);
  const resources = rows.map(readUser);
  return scimContent(res).json({ schemas: [LIST_RESPONSE], totalResults: resources.length, startIndex: 1, itemsPerPage: resources.length, Resources: resources });
});

app.get('/scim/v2/Users/:id', (req, res) => {
  const user = readUser(db.prepare('SELECT payload FROM users WHERE id = ?').get(req.params.id));
  if (!user) return scimError(res, 404, 'User not found');
  return scimContent(res).json(user);
});

app.post('/scim/v2/Users', (req, res) => {
  try {
    const duplicate = req.body?.externalId && db.prepare('SELECT id FROM users WHERE external_id = ?').get(req.body.externalId);
    if (duplicate) return scimError(res, 409, 'A user with this externalId already exists', 'uniqueness');
    const user = normalizeUser(req.body);
    saveUser(user);
    logSync(req, user.externalId, 'created');
    res.location(`/scim/v2/Users/${encodeURIComponent(user.id)}`);
    return scimContent(res).status(201).json(user);
  } catch (error) {
    return scimError(res, 400, error.message, 'invalidValue');
  }
});

app.put('/scim/v2/Users/:id', (req, res) => {
  const row = db.prepare('SELECT created_at FROM users WHERE id = ?').get(req.params.id);
  if (!row) return scimError(res, 404, 'User not found');
  try {
    const user = normalizeUser(req.body, req.params.id);
    user.meta.created = row.created_at;
    saveUser(user, row.created_at);
    logSync(req, user.externalId, 'updated');
    return scimContent(res).json(user);
  } catch (error) {
    return scimError(res, 400, error.message, 'invalidValue');
  }
});

app.patch('/scim/v2/Users/:id', (req, res) => {
  const current = readUser(db.prepare('SELECT payload FROM users WHERE id = ?').get(req.params.id));
  if (!current) return scimError(res, 404, 'User not found');
  if (!Array.isArray(req.body?.schemas) || !req.body.schemas.includes(PATCH_OP) || !Array.isArray(req.body.Operations)) {
    return scimError(res, 400, 'A SCIM PatchOp body with Operations is required', 'invalidSyntax');
  }
  let next = structuredClone(current);
  for (const operation of req.body.Operations) {
    const op = String(operation.op || '').toLowerCase();
    if (op !== 'replace' && op !== 'add') return scimError(res, 400, `Unsupported patch operation: ${op}`, 'invalidSyntax');
    if (!operation.path && operation.value && typeof operation.value === 'object') next = { ...next, ...operation.value };
    else if (operation.path) next[operation.path] = operation.value;
  }
  try {
    next = normalizeUser(next, req.params.id);
    next.meta.created = current.meta?.created || now();
    saveUser(next, next.meta.created);
    logSync(req, next.externalId, 'patched');
    return scimContent(res).json(next);
  } catch (error) {
    return scimError(res, 400, error.message, 'invalidValue');
  }
});

app.delete('/scim/v2/Users/:id', (req, res) => {
  const row = db.prepare('SELECT external_id FROM users WHERE id = ?').get(req.params.id);
  if (!row) return scimError(res, 404, 'User not found');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logSync(req, row.external_id, 'deleted');
  return res.status(204).end();
});

app.get('/api/users', (_req, res) => {
  const users = db.prepare('SELECT id,external_id,user_name,display_name,active,created_at,updated_at,payload FROM users ORDER BY updated_at DESC').all()
    .map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  res.json(users);
});
app.get('/api/logs', (_req, res) => res.json(db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 30').all()));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof SyntaxError) return scimError(res, 400, 'Invalid JSON', 'invalidSyntax');
  return scimError(res, 500, 'Internal server error');
});

app.listen(PORT, () => {
  console.log(`SCIM demo app: http://localhost:${PORT}`);
  console.log(`SCIM base URL: http://localhost:${PORT}/scim/v2`);
  if (TOKEN === 'demo-secret-change-me') console.warn('WARNING: Set SCIM_BEARER_TOKEN before exposing this app.');
});
