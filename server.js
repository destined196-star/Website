import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import multer from 'multer';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.env.NODE_ENV === 'production';

// ---- Fail fast on missing/weak secrets (C2) ----
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
}

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');          // M2: don't leak the stack
app.set('trust proxy', 1);            // H5: correct secure-cookie behaviour behind Azure proxy

// ---- Security headers + CSP (M1) ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://picsum.photos', 'https://*.picsum.photos',
        'https://i.ytimg.com', 'https://quickchart.io', 'https://api.qrserver.com'],
      frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.google.com'],
      connectSrc: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],   // allow onclick/onerror attrs in HTML
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false      // allow YouTube/Razorpay iframes
}));

app.use(express.json({ limit: '16kb' }));            // M3: cap body size
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

// ---- Production access logging (stdout → captured by pm2 / Azure) ----
if (PROD) {
  app.use((req, res, next) => {
    res.on('finish', () => {
      console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.path} ${res.statusCode}`);
    });
    next();
  });
}

// ---- Optional CORS, pinned to one origin (H1). Same-origin needs none. ----
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN;
if (PUBLIC_ORIGIN) {
  app.use((req, res, next) => {
    if (req.headers.origin === PUBLIC_ORIGIN) {
      res.header('Access-Control-Allow-Origin', PUBLIC_ORIGIN);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,   // idle timeout: each request resets the clock; inactivity expires the session
  cookie: { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 1000 * 60 * 30 } // 30 min idle
}));

// Health check (uptime monitoring)
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Rate limiting (H3) ----
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'too many attempts, try later' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

// ---- CSRF defence: mutations must carry a custom header (H2) ----
// Browsers cannot set custom headers on cross-site requests without a CORS
// pre-flight we don't grant, so this blocks forged form posts from other sites.
function csrfGuard(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.get('X-Requested-With') !== 'fetch')
    return res.status(403).json({ error: 'forbidden' });
  next();
}
app.use('/api/', csrfGuard);

// ---- Optional email (only if SMTP env vars set) ----
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  console.log('[mail] SMTP configured');
} else {
  console.log('[mail] no SMTP env — messages stored in DB only');
}

// ---- Auth middleware (disabled: open admin) ----
function requireAuth(req, res, next) { return next(); }

// ================= PUBLIC API =================

// Site settings (links, bio, phone) — public read
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

app.get('/api/events', (req, res) => {
  res.json(db.prepare('SELECT * FROM events ORDER BY sort_order, id').all());
});

app.get('/api/posts', (req, res) => {
  res.json(db.prepare('SELECT * FROM posts ORDER BY id DESC').all());
});

app.get('/api/gallery', (req, res) => {
  res.json(db.prepare('SELECT * FROM gallery ORDER BY sort_order, id').all());
});

app.get('/api/videos', (req, res) => {
  res.json(db.prepare('SELECT * FROM videos ORDER BY sort_order, id').all());
});

app.get('/api/press', (req, res) => {
  res.json(db.prepare('SELECT * FROM press_articles ORDER BY sort_order, id').all());
});

// Razorpay: create an order (needs RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in env)
app.post('/api/donate/order', async (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) return res.status(400).json({ error: 'Razorpay not configured on server' });
  const amount = Math.min(1_000_000, Math.max(1, Number(req.body.amount) || 0)); // bounded (LOW)
  try {
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64')
      },
      body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', payment_capture: 1 })
    });
    const order = await r.json();
    if (!r.ok) return res.status(400).json({ error: 'could not create order' });
    res.json({ order_id: order.id, amount: order.amount, key_id: keyId });
  } catch (e) { console.error('[razorpay]', e.message); res.status(500).json({ error: 'payment error' }); }
});

// Verify a Razorpay payment signature BEFORE recording (H4). Never trust the client.
app.post('/api/donate/verify', (req, res) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return res.status(400).json({ error: 'not configured' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, name, email, amount } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ error: 'missing payment fields' });
  const expected = crypto.createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  const ok = expected.length === razorpay_signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));
  if (!ok) return res.status(400).json({ error: 'invalid signature' });
  db.prepare('INSERT INTO donations (name,email,amount,method,reference) VALUES (?,?,?,?,?)')
    .run(String(name || '').slice(0, 120), String(email || '').slice(0, 160),
      Math.max(0, Number(amount) || 0), 'razorpay', String(razorpay_payment_id).slice(0, 80));
  res.json({ ok: true });
});

// Visitor submits contact details
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post('/api/contact', async (req, res, next) => {
  try {
    // Honeypot: a hidden field real users never fill. Bots do → silently drop.
    if (req.body.company) return res.json({ ok: true });
    let { name, email, phone, subject, message } = req.body;
    name = String(name || '').trim(); email = String(email || '').trim();
    message = String(message || '').trim();
    phone = String(phone || '').trim(); subject = String(subject || '').trim();
    if (!name || !email || !message) return res.status(400).json({ error: 'name, email, message required' });
    if (!EMAIL_RE.test(email) || email.length > 160) return res.status(400).json({ error: 'invalid email' });
    if (name.length > 120 || message.length > 4000 || phone.length > 30 || subject.length > 200)
      return res.status(400).json({ error: 'input too long' });
    db.prepare('INSERT INTO messages (name,email,phone,subject,message) VALUES (?,?,?,?,?)')
      .run(name, email, phone, subject, message);

    if (mailer && process.env.MAIL_TO) {
      try {
        await mailer.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.MAIL_TO,
          subject: `New message: ${subject || 'Website contact'}`,
          text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || '-'}\n\n${message}`
        });
      } catch (e) { console.error('[mail] send failed:', e.message); }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ================= ADMIN AUTH =================
const MAX_FAILS = 3;             // failed tries before lockout
const LOCK_MINUTES = 15;         // lockout duration

// Strong-password policy: >=10 chars, upper, lower, digit, symbol; not a common one.
const COMMON_PW = new Set(['password', 'changeme123', 'admin123', '12345678', 'qwerty123', 'password123']);
function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 10) return 'at least 10 characters';
  if (!/[a-z]/.test(pw)) return 'a lowercase letter';
  if (!/[A-Z]/.test(pw)) return 'an uppercase letter';
  if (!/[0-9]/.test(pw)) return 'a number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'a symbol';
  if (COMMON_PW.has(pw.toLowerCase())) return 'a less common password';
  return null;
}
const audit = (username, ip, success, reason) =>
  db.prepare('INSERT INTO login_audit (username,ip,success,reason) VALUES (?,?,?,?)')
    .run(String(username || '').slice(0, 80), String(ip || '').slice(0, 60), success ? 1 : 0, reason || '');

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password, token } = req.body;
  const ip = req.ip;
  const row = db.prepare('SELECT * FROM admin WHERE username=?').get(username || '');

  // Generic failure used for every wrong-credential case (no user enumeration).
  const fail = (reason) => { audit(username, ip, false, reason); return res.status(401).json({ error: 'invalid credentials' }); };

  if (!row) return fail('no-such-user');

  // Account lockout
  const now = Date.now();
  if (row.locked_until && row.locked_until > now) {
    audit(username, ip, false, 'locked');
    const mins = Math.ceil((row.locked_until - now) / 60000);
    return res.status(429).json({ error: `account locked, try again in ${mins} min` });
  }

  // Password check (constant-time via bcrypt)
  if (!bcrypt.compareSync(password || '', row.password_hash)) {
    const fails = (row.failed_attempts || 0) + 1;
    if (fails >= MAX_FAILS) {
      db.prepare('UPDATE admin SET failed_attempts=0, locked_until=? WHERE id=?')
        .run(now + LOCK_MINUTES * 60000, row.id);
      audit(username, ip, false, 'locked-now');
      return res.status(429).json({ error: `too many failed attempts — locked ${LOCK_MINUTES} min` });
    }
    db.prepare('UPDATE admin SET failed_attempts=? WHERE id=?').run(fails, row.id);
    return fail('bad-password');
  }

  // Second factor (TOTP) if enabled
  if (row.totp_enabled) {
    if (!token) { audit(username, ip, false, '2fa-required'); return res.status(401).json({ error: '2fa_required' }); }
    const ok = speakeasy.totp.verify({ secret: row.totp_secret, encoding: 'base32', token: String(token).replace(/\s/g, ''), window: 1 });
    if (!ok) {
      const fails = (row.failed_attempts || 0) + 1;
      db.prepare('UPDATE admin SET failed_attempts=? WHERE id=?').run(fails, row.id);
      return fail('bad-2fa');
    }
  }

  // Success: clear counters, regenerate session id (prevents session fixation)
  db.prepare('UPDATE admin SET failed_attempts=0, locked_until=0 WHERE id=?').run(row.id);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'session error' });
    req.session.admin = { id: row.id, username: row.username };
    audit(username, ip, true, '');
    res.json({ ok: true, username: row.username });
  });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
const ENFORCE_2FA = process.env.ENFORCE_2FA !== 'false';   // mandatory by default
app.get('/api/me', (req, res) => {
  const a = req.session?.admin;
  if (!a) return res.json({ admin: null });
  const row = db.prepare('SELECT totp_enabled FROM admin WHERE id=?').get(a.id);
  const enabled = !!(row && row.totp_enabled);
  res.json({ admin: a, totp_enabled: enabled, must_setup_2fa: ENFORCE_2FA && !enabled });
});

// ================= ADMIN (protected) =================

// Messages
app.get('/api/admin/messages', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC').all());
});
app.delete('/api/admin/messages/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Settings update — only known keys (M6)
const ALLOWED_SETTINGS = new Set(['youtube', 'facebook', 'instagram', 'pinterest', 'phone',
  'location', 'bio', 'paypal_link', 'razorpay_key', 'upi_id', 'donation_note']);
app.put('/api/admin/settings', requireAuth, (req, res) => {
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(req.body || {})) {
    if (ALLOWED_SETTINGS.has(k)) up.run(k, String(v).slice(0, 2000));
  }
  res.json({ ok: true });
});

// Length cap helper (defense-in-depth on admin inputs)
const cap = (v, n) => String(v ?? '').slice(0, n);

// Events CRUD
app.post('/api/admin/events', requireAuth, (req, res) => {
  const { title, description, day, month, link, sort_order } = req.body;
  if (!cap(title, 200).trim()) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO events (title,description,day,month,link,sort_order) VALUES (?,?,?,?,?,?)')
    .run(cap(title, 200), cap(description, 1000), cap(day, 8), cap(month, 12), cap(link, 500), Number(sort_order) || 0);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/admin/events/:id', requireAuth, (req, res) => {
  const { title, description, day, month, link, sort_order } = req.body;
  db.prepare('UPDATE events SET title=?,description=?,day=?,month=?,link=?,sort_order=? WHERE id=?')
    .run(cap(title, 200), cap(description, 1000), cap(day, 8), cap(month, 12), cap(link, 500), Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/events/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Posts CRUD
app.post('/api/admin/posts', requireAuth, (req, res) => {
  const { title, body, image, date_label } = req.body;
  if (!cap(title, 200).trim()) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO posts (title,body,image,date_label) VALUES (?,?,?,?)')
    .run(cap(title, 200), cap(body, 10000), cap(image, 500), cap(date_label, 40));
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/admin/posts/:id', requireAuth, (req, res) => {
  const { title, body, image, date_label } = req.body;
  db.prepare('UPDATE posts SET title=?,body=?,image=?,date_label=? WHERE id=?')
    .run(cap(title, 200), cap(body, 10000), cap(image, 500), cap(date_label, 40), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/posts/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Gallery CRUD
app.post('/api/admin/gallery', requireAuth, (req, res) => {
  const { image, caption, sort_order } = req.body;
  if (!cap(image, 500).trim()) return res.status(400).json({ error: 'image required' });
  const r = db.prepare('INSERT INTO gallery (image,caption,sort_order) VALUES (?,?,?)')
    .run(cap(image, 500), cap(caption, 300), Number(sort_order) || 0);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/admin/gallery/:id', requireAuth, (req, res) => {
  const { image, caption, sort_order } = req.body;
  db.prepare('UPDATE gallery SET image=?,caption=?,sort_order=? WHERE id=?')
    .run(cap(image, 500), cap(caption, 300), Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/gallery/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Videos admin
app.post('/api/admin/videos', requireAuth, (req, res) => {
  const { title, youtube_url, description, featured, sort_order } = req.body;
  if (!title || !youtube_url) return res.status(400).json({ error: 'title and youtube_url required' });
  const r = db.prepare('INSERT INTO videos (title,youtube_url,description,featured,sort_order) VALUES (?,?,?,?,?)')
    .run(title, youtube_url, description || '', featured ? 1 : 0, Number(sort_order) || 0);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/admin/videos/:id', requireAuth, (req, res) => {
  const { title, youtube_url, description, featured, sort_order } = req.body;
  db.prepare('UPDATE videos SET title=?,youtube_url=?,description=?,featured=?,sort_order=? WHERE id=?')
    .run(title, youtube_url, description || '', featured ? 1 : 0, Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/videos/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM videos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Press articles admin
app.post('/api/admin/press', requireAuth, (req, res) => {
  const { title, publication, date_label, content, image, sort_order } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO press_articles (title,publication,date_label,content,image,sort_order) VALUES (?,?,?,?,?,?)')
    .run(title, publication || '', date_label || '', content || '', image || '', Number(sort_order) || 0);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/admin/press/:id', requireAuth, (req, res) => {
  const { title, publication, date_label, content, image, sort_order } = req.body;
  db.prepare('UPDATE press_articles SET title=?,publication=?,date_label=?,content=?,image=?,sort_order=? WHERE id=?')
    .run(title, publication || '', date_label || '', content || '', image || '', Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/press/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM press_articles WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Donations list
app.get('/api/admin/donations', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM donations ORDER BY id DESC').all());
});

// Change admin password
app.put('/api/admin/password', requireAuth, (req, res) => {
  const { current, next } = req.body;
  const row = db.prepare('SELECT * FROM admin WHERE id=?').get(req.session.admin.id);
  if (!bcrypt.compareSync(current || '', row.password_hash))
    return res.status(400).json({ error: 'current password wrong' });
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: 'password needs ' + problem });
  db.prepare('UPDATE admin SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 12), row.id);
  res.json({ ok: true });
});

// ---- Two-factor (TOTP) management ----
// Step 1: generate a secret + QR for the authenticator app (not yet enabled).
app.post('/api/admin/2fa/setup', requireAuth, async (req, res) => {
  const secret = speakeasy.generateSecret({ name: `DeviMurlikaGaur (${req.session.admin.username})` });
  // Store provisional secret; only flips to enabled once a valid code is confirmed.
  db.prepare('UPDATE admin SET totp_secret=?, totp_enabled=0 WHERE id=?').run(secret.base32, req.session.admin.id);
  const qr = await qrcode.toDataURL(secret.otpauth_url);
  res.json({ qr, secret: secret.base32 });
});

// Step 2: confirm a code to turn 2FA on.
app.post('/api/admin/2fa/enable', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM admin WHERE id=?').get(req.session.admin.id);
  if (!row.totp_secret) return res.status(400).json({ error: 'run setup first' });
  const ok = speakeasy.totp.verify({ secret: row.totp_secret, encoding: 'base32', token: String(req.body.token || '').replace(/\s/g, ''), window: 1 });
  if (!ok) return res.status(400).json({ error: 'invalid code' });
  db.prepare('UPDATE admin SET totp_enabled=1 WHERE id=?').run(row.id);
  res.json({ ok: true });
});

// Disable 2FA (requires current password). Blocked when 2FA is mandatory.
app.put('/api/admin/2fa/disable', requireAuth, (req, res) => {
  if (ENFORCE_2FA) return res.status(403).json({ error: '2FA is mandatory and cannot be disabled' });
  const row = db.prepare('SELECT * FROM admin WHERE id=?').get(req.session.admin.id);
  if (!bcrypt.compareSync(req.body.password || '', row.password_hash))
    return res.status(400).json({ error: 'password wrong' });
  db.prepare('UPDATE admin SET totp_enabled=0, totp_secret=NULL WHERE id=?').run(row.id);
  res.json({ ok: true });
});

// ---- DB backup: stream a consistent copy of the SQLite database (admin only) ----
app.get('/api/admin/backup', requireAuth, (req, res) => {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');           // flush WAL into the main file
    const src = path.join(__dirname, 'data.db');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${stamp}.db"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(src).pipe(res);
  } catch (e) { console.error('[backup]', e.message); res.status(500).json({ error: 'backup failed' }); }
});

// ---- Image upload: persistent on Azure (/home/uploads), local in public/uploads ----
const UPLOAD_DIR = process.env.WEBSITE_INSTANCE_ID
  ? '/home/uploads'
  : path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// On Azure, public/uploads isn't the same dir, so serve /home/uploads explicitly
if (process.env.WEBSITE_INSTANCE_ID) {
  app.use('/uploads', express.static(UPLOAD_DIR));
}
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype] || '';
      cb(null, crypto.randomBytes(12).toString('hex') + ext);   // random name, no user-controlled path
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },               // 50 MB
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype))
});
app.post('/api/admin/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'image must be jpg/png/webp/gif' });
    res.json({ ok: true, url: '/uploads/' + req.file.filename });
  });
});

// Bulk upload — up to 20 images at once
const uploadBulk = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype] || '';
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype))
});
app.post('/api/admin/upload-bulk', requireAuth, (req, res) => {
  uploadBulk.array('images', 20)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No valid images received' });
    const urls = req.files.map(f => '/uploads/' + f.filename);
    res.json({ ok: true, urls });
  });
});

// Recent login attempts (audit trail)
app.get('/api/admin/audit', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT username,ip,success,reason,created_at FROM login_audit ORDER BY id DESC LIMIT 50').all());
});

// ---- Clean admin URL: /admin serves the login panel (no link anywhere on the site) ----
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
// Keep the old .html path working but send people to the clean URL
app.get('/admin.html', (req, res) => res.redirect(301, '/admin'));

// ---- Static files: serve ONLY the public folder, never the project root (C1) ----
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: 'index.html' }));

// ---- 404: JSON for API, custom page for everything else ----
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ---- Central error handler (no stack leak to client) ----
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'server error' });
  res.status(500).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ---- Last-resort handlers: log, don't crash silently ----
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err.message));

app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}  (admin: /admin)`));
