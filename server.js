// ServiceHub: ALL-IN-ONE secure backend (Express + Supabase PostgreSQL).
// Run:  npm install   then   npm start
require('dotenv').config();
const fs = require('fs'), path = require('path');
const express = require('express'), helmet = require('helmet'), cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const { z } = require('zod');
const { Pool, types } = require('pg');

// ============ 1. DATABASE (Supabase PostgreSQL) ============
const SCHEMA = `
-- ServiceHub schema for Supabase (PostgreSQL). The server runs this automatically on start;
-- you can also paste it into Supabase > SQL Editor. It is safe to run more than once.
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN('customer','provider','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  contact TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Pending','Suspended')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users(lower(email));
CREATE TABLE IF NOT EXISTS categories(id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS provider_profiles(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  description TEXT NOT NULL DEFAULT '',
  rate TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS availability(
  provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  slot SMALLINT NOT NULL CHECK(slot BETWEEN 0 AND 2),
  PRIMARY KEY(provider_id, weekday, slot)
);
CREATE TABLE IF NOT EXISTS bookings(
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  provider_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  slot SMALLINT NOT NULL CHECK(slot BETWEEN 0 AND 2),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN('Pending','Accepted','Rejected','Completed','Cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The database itself blocks double-booking, even if application code has a bug
CREATE UNIQUE INDEX IF NOT EXISTS one_booking_per_slot
  ON bookings(provider_id, date, slot) WHERE status IN('Accepted','Completed');
CREATE TABLE IF NOT EXISTS reviews(
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  rating SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs(
  id SERIAL PRIMARY KEY,
  user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
  ip TEXT, detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Supabase exposes tables through its own public API. Row Level Security with no policies
-- blocks that route completely; only this server (database owner role) can read or write.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- Starter categories (only when the table is empty)
INSERT INTO categories(name)
SELECT v FROM (VALUES ('Cleaning'),('Plumbing'),('Electrical'),('Gardening'),('Pet Care'),('Computer Repair')) AS t(v)
WHERE NOT EXISTS (SELECT 1 FROM categories);
`;
types.setTypeParser(20, v => parseInt(v, 10));   // BIGINT / COUNT(*) come back as numbers, not strings

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('[YOUR-PASSWORD]')) {
  console.error('Set DATABASE_URL in .env (Supabase > Connect > Session pooler, with your real password).');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },   // encrypted connection (Supabase requires SSL)
  max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000
});
pool.on('error', e => console.error('Database pool error:', e.message));

const q = (text, params = []) => pool.query(text, params);
const one = async (text, params = []) => (await pool.query(text, params)).rows[0];
const all = async (text, params = []) => (await pool.query(text, params)).rows;
// Transaction: everything succeeds together or nothing is saved
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
const init = () => pool.query(SCHEMA);
const db = { pool, q, one, all, tx, init };

// ============ 2. SECURITY (login, roles, validation, audit log) ============
// Authentication, RBAC, input validation, audit logging

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) { console.error('Set JWT_SECRET (32+ chars) in .env'); process.exit(1); }
const COOKIE = 'sh_token';

// Express 4 does not catch errors in async handlers by itself; this passes them to the error handler
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---- Authentication: signed token in an httpOnly cookie (JavaScript cannot read it) ---- */
function issueToken(res, user) {
  const token = jwt.sign({ sub: user.id }, SECRET, { algorithm: 'HS256', expiresIn: '2h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 2 * 3600 * 1000 });
}
const clearToken = res => res.clearCookie(COOKIE);

async function authenticate(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Login required' });
  let sub;
  try { ({ sub } = jwt.verify(token, SECRET, { algorithms: ['HS256'] })); }
  catch { return res.status(401).json({ error: 'Session expired. Please log in again.' }); }
  try {
    // Always re-check the database so suspended users lose access immediately
    const u = await db.one('SELECT id, role, name, email, status FROM users WHERE id = $1', [sub]);
    if (!u || u.status === 'Suspended') return res.status(401).json({ error: 'Account unavailable' });
    req.user = u; next();
  } catch (e) { next(e); }
}

/* ---- Authorization (RBAC) ---- */
const requireRole = (...roles) => async (req, res, next) => {
  if (roles.includes(req.user.role)) return next();
  await audit(req, 'ACCESS_DENIED', 'route', null, `${req.method} ${req.originalUrl}`);
  res.status(403).json({ error: 'You do not have permission to do that' });
};

/* ---- Audit log (never crashes a request if logging itself fails) ---- */
async function audit(req, action, entity, entityId, detail, userId) {
  try {
    await db.q('INSERT INTO audit_logs(user_id, action, entity, entity_id, ip, detail) VALUES($1,$2,$3,$4,$5,$6)',
      [userId ?? (req.user && req.user.id) ?? null, action, entity || null, entityId ?? null, req.ip, detail ? String(detail).slice(0, 300) : null]);
  } catch (e) { console.error('Audit log failed:', e.message); }
}

/* ---- Input validation ---- */
const validate = (schema, src = 'body') => (req, res, next) => {
  const r = schema.safeParse(req[src]);
  if (!r.success) return res.status(400).json({ error: 'Invalid input', fields: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
  req[src] = r.data; next();
};
const text = (min, max) => z.string().trim().min(min).max(max).regex(/^[^<>]*$/, 'The characters < and > are not allowed');
const emailS = z.string().trim().toLowerCase().email().max(120);
const password = z.string().min(10, 'At least 10 characters').max(72)
  .regex(/[a-z]/, 'Add a lowercase letter').regex(/[A-Z]/, 'Add an uppercase letter').regex(/\d/, 'Add a number');
const dateS = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(d => !isNaN(Date.parse(d)), 'Invalid date');
const id = z.coerce.number().int().positive();


// ============ 3. ROUTES ============
// ---- Login, register, password
const authRouter = (() => {
  const r = express.Router();

  const COST = 12;                       // bcrypt work factor
  const DUMMY = bcrypt.hashSync('timing-equalizer', COST);
  const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;

  const registerSchema = z.object({
    role: z.enum(['customer', 'provider']),   // 'admin' can never be self-registered
    name: text(2, 80), email: emailS, password,
    contact: text(5, 60), address: text(0, 160).default(''),
    categoryId: z.number().int().positive().optional()
  }).refine(d => d.role !== 'provider' || d.categoryId, { message: 'Providers must choose a category', path: ['categoryId'] });

  r.post('/register', validate(registerSchema), wrap(async (req, res) => {
    const d = req.body;
    if (await db.one('SELECT 1 FROM users WHERE lower(email) = lower($1)', [d.email])) return res.status(409).json({ error: 'That email is already registered' });
    if (d.role === 'provider' && !(await db.one('SELECT 1 FROM categories WHERE id = $1', [d.categoryId]))) return res.status(400).json({ error: 'Unknown category' });
    const hash = await bcrypt.hash(d.password, COST);
    let uid;
    try {
      uid = await db.tx(async c => {
        const status = d.role === 'provider' ? 'Pending' : 'Active';   // providers need admin approval
        const { rows } = await c.query('INSERT INTO users(role,name,email,password_hash,contact,address,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [d.role, d.name, d.email, hash, d.contact, d.address, status]);
        if (d.role === 'provider') await c.query('INSERT INTO provider_profiles(user_id, category_id) VALUES($1,$2)', [rows[0].id, d.categoryId]);
        return rows[0].id;
      });
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That email is already registered' }); throw e; }
    await audit(req, 'REGISTER', 'user', uid, d.role, uid);
    res.status(201).json({ message: d.role === 'provider' ? 'Registered. An administrator must approve your account before customers can find you.' : 'Registered. You can log in now.' });
  }));

  r.post('/login', validate(z.object({ email: emailS, password: z.string().min(1).max(72) })), wrap(async (req, res) => {
    const u = await db.one('SELECT * FROM users WHERE lower(email) = lower($1)', [req.body.email]);
    const now = Date.now();
    if (u && u.locked_until > now) { await audit(req, 'LOGIN_BLOCKED_LOCKED', 'user', u.id, null, u.id); return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' }); }
    const ok = await bcrypt.compare(req.body.password, u ? u.password_hash : DUMMY); // same timing whether or not the email exists
    if (!u || !ok) {
      if (u) {
        const fails = u.failed_attempts + 1, lock = fails >= MAX_FAILS;
        await db.q('UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [lock ? 0 : fails, lock ? now + LOCK_MS : 0, u.id]);
        await audit(req, lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', 'user', u.id, null, u.id);
      }
      return res.status(401).json({ error: 'Invalid email or password' });   // never say which one was wrong
    }
    if (u.status === 'Suspended') return res.status(403).json({ error: 'This account is suspended' });
    await db.q('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = $1', [u.id]);
    issueToken(res, u);
    await audit(req, 'LOGIN', 'user', u.id, null, u.id);
    res.json({ user: { id: u.id, role: u.role, name: u.name, email: u.email, status: u.status } });
  }));

  r.post('/logout', authenticate, wrap(async (req, res) => { await audit(req, 'LOGOUT', 'user', req.user.id); clearToken(res); res.json({ ok: true }); }));
  r.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

  r.post('/password', authenticate, validate(z.object({ current: z.string().max(72), next: password })), wrap(async (req, res) => {
    const u = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(req.body.current, u.password_hash))) return res.status(401).json({ error: 'Current password is incorrect' });
    await db.q('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.next, COST), req.user.id]);
    await audit(req, 'PASSWORD_CHANGED', 'user', req.user.id);
    res.json({ ok: true });
  }));
  return r;
})();

// ---- Providers
const providersRouter = (() => {
  const r = express.Router();

  // Customers see only approved providers, and never their contact details until a booking is accepted
  r.get('/', authenticate, validate(z.object({ categoryId: id.optional() }), 'query'), wrap(async (req, res) => {
    const cid = req.query.categoryId ?? null;
    const rows = await db.all(`
      SELECT u.id, u.name, u.address, p.description, p.rate, c.name AS category,
        (SELECT ROUND(AVG(rv.rating)::numeric, 1)::float8 FROM reviews rv JOIN bookings b ON b.id = rv.booking_id
          WHERE b.provider_id = u.id AND rv.hidden = false) AS rating
      FROM users u JOIN provider_profiles p ON p.user_id = u.id JOIN categories c ON c.id = p.category_id
      WHERE u.role = 'provider' AND u.status = 'Active' AND ($1::int IS NULL OR p.category_id = $1::int)
      ORDER BY u.name`, [cid]);
    const av = rows.length ? await db.all('SELECT provider_id, weekday, slot FROM availability WHERE provider_id = ANY($1::int[])', [rows.map(x => x.id)]) : [];
    res.json(rows.map(p => ({ ...p, availability: av.filter(a => a.provider_id === p.id).map(a => ({ weekday: a.weekday, slot: a.slot })) })));
  }));

  r.get('/me', authenticate, requireRole('provider'), wrap(async (req, res) => {
    const p = await db.one(`SELECT u.name, u.status, p.description, p.rate, p.category_id AS "categoryId"
      FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`, [req.user.id]);
    const availability = await db.all('SELECT weekday, slot FROM availability WHERE provider_id = $1', [req.user.id]);
    res.json({ ...p, availability });
  }));

  r.put('/me/profile', authenticate, requireRole('provider'),
    validate(z.object({ description: text(0, 500), rate: text(0, 60), categoryId: id })), wrap(async (req, res) => {
      if (!(await db.one('SELECT 1 FROM categories WHERE id = $1', [req.body.categoryId]))) return res.status(400).json({ error: 'Unknown category' });
      await db.q('UPDATE provider_profiles SET description = $1, rate = $2, category_id = $3 WHERE user_id = $4',
        [req.body.description, req.body.rate, req.body.categoryId, req.user.id]);   // always the logged-in provider's own row
      await audit(req, 'PROVIDER_PROFILE_UPDATED', 'user', req.user.id);
      res.json({ ok: true });
    }));

  r.put('/me/availability', authenticate, requireRole('provider'),
    validate(z.object({ slots: z.array(z.object({ weekday: z.number().int().min(0).max(6), slot: z.number().int().min(0).max(2) })).max(21) })), wrap(async (req, res) => {
      await db.tx(async c => {
        await c.query('DELETE FROM availability WHERE provider_id = $1', [req.user.id]);
        for (const s of req.body.slots)
          await c.query('INSERT INTO availability(provider_id, weekday, slot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [req.user.id, s.weekday, s.slot]);
      });
      await audit(req, 'AVAILABILITY_UPDATED', 'user', req.user.id, `${req.body.slots.length} slots`);
      res.json({ ok: true });
    }));
  return r;
})();

// ---- Bookings and reviews
const bookingsRouter = (() => {
  const r = express.Router();

  const weekday = d => new Date(d + 'T00:00:00Z').getUTCDay();
  const todayStr = () => new Date().toISOString().slice(0, 10);

  r.post('/', authenticate, requireRole('customer'),
    validate(z.object({ providerId: z.number().int().positive(), date: dateS, slot: z.number().int().min(0).max(2), note: text(0, 300).default('') })), wrap(async (req, res) => {
      const { providerId, date, slot, note } = req.body;
      if (date < todayStr()) return res.status(400).json({ error: 'Choose today or a future date' });
      if (!(await db.one("SELECT 1 FROM users WHERE id = $1 AND role = 'provider' AND status = 'Active'", [providerId]))) return res.status(404).json({ error: 'Provider not found' });
      if (!(await db.one('SELECT 1 FROM availability WHERE provider_id = $1 AND weekday = $2 AND slot = $3', [providerId, weekday(date), slot])))
        return res.status(409).json({ error: 'The provider is not available at that day and time' });
      if (await db.one("SELECT 1 FROM bookings WHERE provider_id = $1 AND date = $2 AND slot = $3 AND status IN('Accepted','Completed')", [providerId, date, slot]))
        return res.status(409).json({ error: 'That slot is already booked' });
      if (await db.one("SELECT 1 FROM bookings WHERE customer_id = $1 AND provider_id = $2 AND date = $3 AND slot = $4 AND status = 'Pending'", [req.user.id, providerId, date, slot]))
        return res.status(409).json({ error: 'You already requested this slot' });
      const b = await db.one('INSERT INTO bookings(customer_id, provider_id, date, slot, note) VALUES($1,$2,$3,$4,$5) RETURNING id', [req.user.id, providerId, date, slot, note]);
      await audit(req, 'BOOKING_CREATED', 'booking', b.id, `${date} slot ${slot}`);
      res.status(201).json({ id: b.id });
    }));

  // Each role sees only its own records (admin sees all). Contact details unlock only after acceptance.
  r.get('/', authenticate, wrap(async (req, res) => {
    const col = { customer: 'b.customer_id', provider: 'b.provider_id' }[req.user.role];
    const rows = await db.all(`
      SELECT b.id, b.date, b.slot, b.note, b.status, b.created_at,
        cu.name AS customer_name, cu.contact AS customer_contact, cu.address AS customer_address,
        pr.name AS provider_name, pr.contact AS provider_contact, c.name AS category,
        EXISTS(SELECT 1 FROM reviews rv WHERE rv.booking_id = b.id) AS reviewed
      FROM bookings b JOIN users cu ON cu.id = b.customer_id JOIN users pr ON pr.id = b.provider_id
      JOIN provider_profiles pp ON pp.user_id = pr.id JOIN categories c ON c.id = pp.category_id
      ${col ? `WHERE ${col} = $1` : ''} ORDER BY b.date DESC, b.id DESC`, col ? [req.user.id] : []);
    res.json(rows.map(b => {
      const open = ['Accepted', 'Completed'].includes(b.status);
      if (req.user.role === 'provider' && !open) { delete b.customer_contact; delete b.customer_address; }
      if (req.user.role === 'customer' && !open) delete b.provider_contact;
      if (req.user.role === 'customer') { delete b.customer_contact; delete b.customer_address; }
      if (req.user.role === 'provider') delete b.provider_contact;
      return b;
    }));
  }));

  // Allowed status changes per role
  const RULES = {
    customer: { Cancelled: ['Pending'] },
    provider: { Accepted: ['Pending'], Rejected: ['Pending'], Completed: ['Accepted'] }
  };
  r.patch('/:id/status', authenticate, validate(z.object({ id }), 'params'),
    validate(z.object({ status: z.enum(['Accepted', 'Rejected', 'Completed', 'Cancelled']) })), wrap(async (req, res) => {
      const b = await db.one('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
      const owner = b && (req.user.role === 'customer' ? b.customer_id : req.user.role === 'provider' ? b.provider_id : null);
      if (!b || owner !== req.user.id) {                    // not the owner (or admin): deny and log it
        await audit(req, 'UNAUTHORIZED_BOOKING_MODIFICATION', 'booking', req.params.id, req.body.status);
        return res.status(404).json({ error: 'Booking not found' });
      }
      const from = (RULES[req.user.role] || {})[req.body.status];
      if (!from || !from.includes(b.status)) return res.status(409).json({ error: `A ${b.status} booking cannot be set to ${req.body.status}` });
      try { await db.q('UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2', [req.body.status, b.id]); }
      catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That slot was just taken by another booking' }); throw e; }
      await audit(req, 'BOOKING_' + req.body.status.toUpperCase(), 'booking', b.id, `${b.status} -> ${req.body.status}`);
      res.json({ ok: true });
    }));

  r.post('/:id/review', authenticate, requireRole('customer'), validate(z.object({ id }), 'params'),
    validate(z.object({ rating: z.number().int().min(1).max(5), text: text(1, 500) })), wrap(async (req, res) => {
      const b = await db.one('SELECT * FROM bookings WHERE id = $1 AND customer_id = $2', [req.params.id, req.user.id]);
      if (!b || b.status !== 'Completed') return res.status(409).json({ error: 'Only your completed bookings can be reviewed' });
      try { await db.q('INSERT INTO reviews(booking_id, rating, text) VALUES($1,$2,$3)', [b.id, req.body.rating, req.body.text]); }
      catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'You already reviewed this booking' }); throw e; }
      await audit(req, 'REVIEW_CREATED', 'booking', b.id);
      res.status(201).json({ ok: true });
    }));
  return r;
})();

// ---- Administrator
const adminRouter = (() => {
  const r = express.Router();

  r.use(authenticate, requireRole('admin'));   // every route below is admin-only

  r.get('/users', wrap(async (req, res) => res.json(await db.all('SELECT id, role, name, email, contact, address, status, created_at FROM users ORDER BY id')))); // never returns password_hash

  r.patch('/users/:id/status', validate(z.object({ id }), 'params'), validate(z.object({ status: z.enum(['Active', 'Suspended']) })), wrap(async (req, res) => {
    const u = await db.one('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.role === 'admin') return res.status(403).json({ error: 'Administrator accounts cannot be changed here' });
    await db.q('UPDATE users SET status = $1 WHERE id = $2', [req.body.status, u.id]);
    await audit(req, 'USER_STATUS_CHANGED', 'user', u.id, req.body.status);   // 'Active' on a pending provider = approval
    res.json({ ok: true });
  }));

  r.post('/categories', validate(z.object({ name: text(2, 40) })), wrap(async (req, res) => {
    try {
      const c = await db.one('INSERT INTO categories(name) VALUES($1) RETURNING id', [req.body.name]);
      await audit(req, 'CATEGORY_CREATED', 'category', c.id, req.body.name);
      res.status(201).json({ id: c.id });
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Category already exists' }); throw e; }
  }));
  r.delete('/categories/:id', validate(z.object({ id }), 'params'), wrap(async (req, res) => {
    if (await db.one('SELECT 1 FROM provider_profiles WHERE category_id = $1', [req.params.id])) return res.status(409).json({ error: 'Move providers out of this category first' });
    await db.q('DELETE FROM categories WHERE id = $1', [req.params.id]);
    await audit(req, 'CATEGORY_DELETED', 'category', req.params.id);
    res.json({ ok: true });
  }));

  r.patch('/reviews/:id', validate(z.object({ id }), 'params'), validate(z.object({ hidden: z.boolean() })), wrap(async (req, res) => {
    await db.q('UPDATE reviews SET hidden = $1 WHERE id = $2', [req.body.hidden, req.params.id]);
    await audit(req, 'REVIEW_VISIBILITY_CHANGED', 'review', req.params.id, String(req.body.hidden));
    res.json({ ok: true });
  }));

  r.get('/stats', wrap(async (req, res) => res.json({
    customers: (await db.one("SELECT COUNT(*)::int AS n FROM users WHERE role = 'customer'")).n,
    providers: (await db.one("SELECT COUNT(*)::int AS n FROM users WHERE role = 'provider'")).n,
    bookingsByStatus: await db.all('SELECT status, COUNT(*)::int AS n FROM bookings GROUP BY status ORDER BY status')
  })));

  r.get('/audit-logs', validate(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), 'query'), wrap(async (req, res) =>
    res.json(await db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT $1', [req.query.limit]))));

  r.post('/backup', wrap(async (req, res) => {
    const file = await runBackup();
    await audit(req, 'BACKUP_CREATED', 'database', null, path.basename(file));
    res.json({ ok: true, file: path.basename(file) });
  }));
  return r;
})();

// ============ 4. BACKUP, RESTORE, ADMIN RESET ============
// Backup: exports every table to a JSON file and keeps the newest N.  Run: npm run backup
// Backups contain password hashes, so keep this folder private (it is already in .gitignore).
// Supabase also keeps its own backups on some plans; check what your plan includes.
const DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const TABLES = ['users', 'categories', 'provider_profiles', 'availability', 'bookings', 'reviews', 'audit_logs'];

async function runBackup(keep = 14) {
  fs.mkdirSync(DIR, { recursive: true });
  const data = {};
  for (const t of TABLES) data[t] = await db.all(`SELECT * FROM ${t}`);   // table names come from the fixed list above
  const file = path.join(DIR, `servicehub-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ created: new Date().toISOString(), data }));
  const all = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
  all.slice(0, Math.max(0, all.length - keep)).forEach(f => fs.unlinkSync(path.join(DIR, f)));
  return file;
}

// Restore replaces ALL data with a backup file.  Usage: npm run restore -- backups/<file>.json --yes
async function restoreFrom(file, flag) {
  if (!file || !fs.existsSync(file) || flag !== '--yes') throw new Error('Usage: npm run restore -- backups/<file>.json --yes   (this replaces ALL current data)');
  const { data } = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.tx(async c => {
    await c.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of TABLES) {
      for (const row of data[t] || []) {
        const cols = Object.keys(row);
        await c.query(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map(k => row[k]));
      }
    }
    for (const t of TABLES.filter(x => x !== 'provider_profiles' && x !== 'availability'))
      await c.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${t}`);
  });
  console.log('Restored from', file);
}

// Sets the administrator email and password to the values in .env.  Usage: npm run reset-admin
async function resetAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) in .env first');
  const r = await db.q("UPDATE users SET email = $1, password_hash = $2, failed_attempts = 0, locked_until = 0, status = 'Active' WHERE role = 'admin'", [ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(ADMIN_PASSWORD, 12)]);
  if (r.rowCount) { await db.q("INSERT INTO audit_logs(action, entity, detail) VALUES('ADMIN_CREDENTIALS_RESET', 'user', 'via reset-admin')"); console.log('Admin updated. Log in with the email and password from .env.'); }
  else console.log('No admin found. Run npm start once to create it.');
}


// ============ 5. SERVER ============
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'],
  fontSrc: ['https://fonts.gstatic.com'], objectSrc: ["'none'"], frameAncestors: ["'none'"],
  upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null } } }));  // off on localhost (plain http)
app.use(express.json({ limit: '10kb' }));          // blocks oversized payloads
app.use(cookieParser());

// Rate limiting (availability + brute-force protection)
const limiter = (max) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } });
app.use('/api', limiter(300));
app.use('/api/auth/login', limiter(10));
app.use('/api/auth/register', limiter(10));

// CSRF defence (on top of SameSite=Strict cookies): changing requests need a custom header,
// which other websites cannot add without our permission.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('X-Requested-With') !== 'ServiceHub')
    return res.status(403).json({ error: 'Missing request header' });
  next();
});

app.get('/api/categories', wrap(async (req, res) => res.json(await db.all('SELECT id, name FROM categories ORDER BY name'))));
app.use('/api/auth', authRouter);
app.use('/api/providers', providersRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, 'public')));

// Never leak stack traces or SQL errors to the client
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err); res.status(500).json({ error: 'Something went wrong' });
});

(async function start() {
  await db.init();                                  // creates tables in Supabase if they do not exist
  const cmd = process.argv[2];                      // command line options: --backup, --restore, --reset-admin
  if (cmd === '--backup') { console.log('Backup saved:', await runBackup()); process.exit(0); }
  if (cmd === '--restore') { await restoreFrom(process.argv[3], process.argv[4]); process.exit(0); }
  if (cmd === '--reset-admin') { await resetAdmin(); process.exit(0); }
  if (!(await db.one("SELECT 1 FROM users WHERE role = 'admin'"))) {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ chars) in .env for first run');
    await db.q("INSERT INTO users(role, name, email, password_hash, contact) VALUES('admin', 'Administrator', $1, $2, '-')", [ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(ADMIN_PASSWORD, 12)]);
    console.log('Administrator account created.');
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`ServiceHub running on http://localhost:${PORT} (database: Supabase)`));
  setInterval(() => runBackup().catch(console.error), 24 * 3600 * 1000);   // daily automatic backup
})().catch(e => { console.error('Startup failed:', e.message); process.exit(1); });

