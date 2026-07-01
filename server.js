import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { generateSecret as totpGenerateSecret, generateURI as totpGenerateURI, verifySync as totpVerify } from 'otplib';
import qrcode from 'qrcode';
import multer from 'multer';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import db, { DB_PATH } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.env.NODE_ENV === 'production';

// ---- Fail fast on missing/weak secrets (C2) ----
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
}

// Suppress non-error console output in production (Azure captures stderr for errors)
if (PROD) {
  console.log = function() {};
  console.debug = function() {};
  console.info = function() {};
  // console.warn and console.error stay active
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535)
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);

app.disable('x-powered-by');          // M2: don't leak the stack
app.set('trust proxy', 1);            // H5: correct secure-cookie behaviour behind Azure proxy

// ---- Security headers + CSP (M1) ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:  ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://picsum.photos', 'https://*.picsum.photos',
        'https://i.ytimg.com', 'https://quickchart.io', 'https://api.qrserver.com',
        'https://*.googleusercontent.com', 'https://*.ggpht.com'],
      frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.google.com'],
      connectSrc: ["'self'"],
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

// ---- SQLite-backed session store (survives restarts/deploys, no extra deps) ----
class SQLiteStore extends session.Store {
  constructor() {
    super();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions (expired_at);
    `);
    // Purge expired on startup
    db.prepare('DELETE FROM sessions WHERE expired_at < ?').run(Date.now());
    // Periodic cleanup every hour
    setInterval(() => {
      db.prepare('DELETE FROM sessions WHERE expired_at < ?').run(Date.now());
    }, 3600 * 1000).unref();
  }
  get(sid, cb) {
    const row = db.prepare('SELECT sess, expired_at FROM sessions WHERE sid=?').get(sid);
    if (!row || row.expired_at < Date.now()) return cb(null, null);
    try { cb(null, JSON.parse(row.sess)); } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    const ttl = sess.cookie?.maxAge ?? 1800000;
    const exp = Date.now() + ttl;
    db.prepare('INSERT INTO sessions (sid,sess,expired_at) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expired_at=excluded.expired_at')
      .run(sid, JSON.stringify(sess), exp);
    cb(null);
  }
  destroy(sid, cb) { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb(null); }
  touch(sid, sess, cb) {
    const ttl = sess.cookie?.maxAge ?? 1800000;
    db.prepare('UPDATE sessions SET expired_at=? WHERE sid=?').run(Date.now() + ttl, sid);
    cb(null);
  }
}

app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,   // idle timeout: each request resets the clock; inactivity expires the session
  store: new SQLiteStore(),
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 1000 * 60 * 60 * 8 } // 8 h idle
}));

// ---- Rate limiting (H3) ----
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'too many attempts, try later' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const healthzLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
// Tight limiter for contact form + donation order — prevents spam/order-flooding
const contactLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'too many submissions, please try again later' } });
app.use('/api/', apiLimiter);

// Health check (uptime monitoring)
app.get('/healthz', healthzLimiter, (req, res) => res.json({ ok: true, ts: Date.now() }));

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

// ---- Auth middleware ----
function requireAuth(req, res, next) {
  if (!req.session?.admin) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ================= PUBLIC API =================

// Site settings — public read.
// Sensitive bank transfer fields (account number, IFSC, branch) are excluded;
// only bank name and UPI ID are public (enough for donors to initiate transfers).
const PRIVATE_SETTINGS = new Set(['bank_account_number', 'bank_ifsc', 'bank_branch', 'bank_account_name']);
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all()
    .filter(r => !PRIVATE_SETTINGS.has(r.key));
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// ---- YouTube comments (cached 30 min) ----
let ytCache = { comments: [], at: 0 };
app.get('/api/yt-comments', async (req, res) => {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.json([]);
  if (ytCache.comments.length && Date.now() - ytCache.at < 30 * 60 * 1000)
    return res.json(ytCache.comments);
  try {
    // Pull video IDs from DB (featured first)
    const vids = db.prepare('SELECT youtube_url FROM videos ORDER BY featured DESC, sort_order LIMIT 10').all();
    const videoIds = vids.map(v => {
      const m = String(v.youtube_url || '').match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    }).filter(Boolean).slice(0, 6);
    if (!videoIds.length) return res.json([]);

    const all = [];
    for (const vid of videoIds) {
      try {
        const r = await fetch(
          `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${vid}&key=${encodeURIComponent(key)}&maxResults=20&order=relevance`
        );
        if (!r.ok) continue;
        const data = await r.json();
        for (const item of (data.items || [])) {
          const s = item.snippet.topLevelComment.snippet;
          const text = (s.textDisplay || '').replace(/<[^>]+>/g, '').trim();
          if (text.length < 60) continue;  // skip short emoji-only comments
          all.push({
            author: s.authorDisplayName || 'YouTube User',
            text,
            avatar: s.authorProfileImageUrl || '',
            likes: Number(s.likeCount) || 0,
            videoId: vid
          });
        }
      } catch (_) {}
    }
    all.sort((a, b) => b.likes - a.likes);
    ytCache = { comments: all.slice(0, 9), at: Date.now() };
    res.json(ytCache.comments);
  } catch (e) {
    console.error('[yt-comments]', e.message);
    res.json([]);
  }
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

// Playlists — public
app.get('/api/playlists', (req, res) => {
  const playlists = db.prepare('SELECT * FROM playlists ORDER BY sort_order, id').all();
  // Attach video count and videos to each playlist
  const getVids = db.prepare(`
    SELECT v.* FROM playlist_videos pv
    JOIN videos v ON v.id = pv.video_id
    WHERE pv.playlist_id = ?
    ORDER BY pv.sort_order, pv.id
  `);
  for (const p of playlists) {
    p.videos = getVids.all(p.id);
    p.video_count = p.videos.length;
  }
  res.json(playlists);
});
app.get('/api/playlists/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.videos = db.prepare(`
    SELECT v.* FROM playlist_videos pv
    JOIN videos v ON v.id = pv.video_id
    WHERE pv.playlist_id = ?
    ORDER BY pv.sort_order, pv.id
  `).all(p.id);
  p.video_count = p.videos.length;
  res.json(p);
});

app.get('/api/press', (req, res) => {
  res.json(db.prepare('SELECT * FROM press_articles ORDER BY sort_order, id').all());
});

// Razorpay: create an order (needs RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in env)
app.post('/api/donate/order', contactLimiter, async (req, res) => {
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
app.post('/api/donate/verify', contactLimiter, (req, res) => {
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
app.post('/api/contact', contactLimiter, async (req, res, next) => {
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
const COMMON_PW = new Set([
  'password','changeme123','admin123','12345678','qwerty123','password123',
  'letmein','welcome1','monkey123','dragon123','master123','abc123456',
  'iloveyou1','sunshine1','princess1','Password1','Password1!','Admin1234',
  'Welcome123','Summer2024','Winter2024','Spring2024','Autumn2024',
]);
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
    // Guard: totp_secret could be NULL if setup started but never confirmed
    if (!row.totp_secret) return fail('totp-secret-missing');
    if (!token) { audit(username, ip, false, '2fa-required'); return res.status(401).json({ error: '2fa_required' }); }
    const ok = totpVerify({ token: String(token).replace(/\s/g, ''), secret: row.totp_secret, type: 'totp', window: 1 }).valid;
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
    // Explicitly save session before responding so the cookie is persisted
    // before the browser navigates to /admin on the next request.
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'session error' });
      audit(username, ip, true, '');
      res.json({ ok: true, username: row.username });
    });
  });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
const ENFORCE_2FA = process.env.ENFORCE_2FA !== 'false';   // mandatory by default
app.get('/api/me', (req, res) => {
  const a = req.session?.admin;
  if (!a) return res.json({ admin: null });
  const row = db.prepare('SELECT totp_enabled FROM admin WHERE id=?').get(a.id);
  // Admin row deleted after session was created → invalidate session
  if (!row) {
    req.session.destroy(() => {});
    return res.json({ admin: null });
  }
  const enabled = !!row.totp_enabled;
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

// Admin-only settings read — returns ALL keys including private bank details
app.get('/api/admin/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// Settings update — only known keys (M6)
const ALLOWED_SETTINGS = new Set([
  'youtube', 'facebook', 'instagram', 'pinterest', 'phone', 'location', 'bio',
  // donation / payment
  'upi_id', 'upi_name', 'donation_note',
  'razorpay_key', 'razorpay_link',
  'paypal_link',
  'gpay_number', 'phonepe_number', 'paytm_number',
  'other_payment',
  'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_branch'
]);
app.put('/api/admin/settings', requireAuth, (req, res) => {
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(req.body || {})) {
    if (ALLOWED_SETTINGS.has(k)) up.run(k, String(v).slice(0, 2000));
  }
  res.json({ ok: true });
});

// Length cap helper (defense-in-depth on admin inputs)
const cap = (v, n) => String(v ?? '').slice(0, n);

// Thin try/catch wrapper so every DB error returns JSON 500 instead of leaking stack traces
const dbRoute = fn => (req, res, next) => { try { fn(req, res); } catch (e) { console.error('[db]', e.message); res.status(500).json({ error: 'database error' }); } };

// Events CRUD
app.post('/api/admin/events', requireAuth, dbRoute((req, res) => {
  const { title, description, day, month, link, sort_order } = req.body;
  if (!cap(title, 200).trim()) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO events (title,description,day,month,link,sort_order) VALUES (?,?,?,?,?,?)')
    .run(cap(title, 200), cap(description, 1000), cap(day, 8), cap(month, 12), cap(link, 500), Number(sort_order) || 0);
  res.json({ ok: true, id: r.lastInsertRowid });
}));
app.put('/api/admin/events/:id', requireAuth, dbRoute((req, res) => {
  const { title, description, day, month, link, sort_order } = req.body;
  db.prepare('UPDATE events SET title=?,description=?,day=?,month=?,link=?,sort_order=? WHERE id=?')
    .run(cap(title, 200), cap(description, 1000), cap(day, 8), cap(month, 12), cap(link, 500), Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/admin/events/:id', requireAuth, dbRoute((req, res) => {
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// Posts CRUD
app.post('/api/admin/posts', requireAuth, dbRoute((req, res) => {
  const { title, body, image, date_label } = req.body;
  if (!cap(title, 200).trim()) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO posts (title,body,image,date_label) VALUES (?,?,?,?)')
    .run(cap(title, 200), cap(body, 10000), cap(image, 500), cap(date_label, 40));
  res.json({ ok: true, id: r.lastInsertRowid });
}));
app.put('/api/admin/posts/:id', requireAuth, dbRoute((req, res) => {
  const { title, body, image, date_label } = req.body;
  db.prepare('UPDATE posts SET title=?,body=?,image=?,date_label=? WHERE id=?')
    .run(cap(title, 200), cap(body, 10000), cap(image, 500), cap(date_label, 40), req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/admin/posts/:id', requireAuth, dbRoute((req, res) => {
  const row = db.prepare('SELECT image FROM posts WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  if (row?.image?.startsWith('/uploads/')) {
    const fp = path.join(UPLOAD_DIR, path.basename(row.image));
    try { fs.unlinkSync(fp); } catch (_) {}
  }
  res.json({ ok: true });
}));

// Gallery CRUD
app.post('/api/admin/gallery', requireAuth, dbRoute((req, res) => {
  const { image, caption, sort_order } = req.body;
  if (!cap(image, 500).trim()) return res.status(400).json({ error: 'image required' });
  const r = db.prepare('INSERT INTO gallery (image,caption,sort_order) VALUES (?,?,?)')
    .run(cap(image, 500), cap(caption, 300), Number(sort_order) || 0);
  res.json({ ok: true, id: r.lastInsertRowid });
}));
app.put('/api/admin/gallery/:id', requireAuth, dbRoute((req, res) => {
  const { image, caption, sort_order } = req.body;
  db.prepare('UPDATE gallery SET image=?,caption=?,sort_order=? WHERE id=?')
    .run(cap(image, 500), cap(caption, 300), Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/admin/gallery/:id', requireAuth, dbRoute((req, res) => {
  const row = db.prepare('SELECT image FROM gallery WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);
  if (row?.image?.startsWith('/uploads/')) {
    const fp = path.join(UPLOAD_DIR, path.basename(row.image));
    try { fs.unlinkSync(fp); } catch (_) {}
  }
  res.json({ ok: true });
}));

// Videos admin
app.post('/api/admin/videos', requireAuth, dbRoute((req, res) => {
  const { title, youtube_url, description, featured, sort_order } = req.body;
  if (!cap(title, 200).trim() || !cap(youtube_url, 500).trim()) return res.status(400).json({ error: 'title and youtube_url required' });
  const r = db.prepare('INSERT INTO videos (title,youtube_url,description,featured,sort_order) VALUES (?,?,?,?,?)')
    .run(cap(title, 200), cap(youtube_url, 500), cap(description, 2000), Number(featured) ? 1 : 0, Number(sort_order) || 0);
  res.json({ id: r.lastInsertRowid });
}));
app.put('/api/admin/videos/:id', requireAuth, dbRoute((req, res) => {
  const { title, youtube_url, description, featured, sort_order } = req.body;
  db.prepare('UPDATE videos SET title=?,youtube_url=?,description=?,featured=?,sort_order=? WHERE id=?')
    .run(cap(title, 200), cap(youtube_url, 500), cap(description, 2000), Number(featured) ? 1 : 0, Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/admin/videos/:id', requireAuth, dbRoute((req, res) => {
  db.prepare('DELETE FROM videos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// Playlists admin
app.post('/api/admin/playlists', requireAuth, dbRoute((req, res) => {
  const { name, description, cover_image, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const r = db.prepare('INSERT INTO playlists (name,description,cover_image,sort_order) VALUES (?,?,?,?)')
    .run(cap(name, 200), cap(description, 500) || '', cover_image || '', Number(sort_order) || 0);
  res.json({ ok: true, id: r.lastInsertRowid });
}));
app.put('/api/admin/playlists/:id', requireAuth, dbRoute((req, res) => {
  const { name, description, cover_image, sort_order } = req.body;
  db.prepare('UPDATE playlists SET name=?,description=?,cover_image=?,sort_order=? WHERE id=?')
    .run(cap(name, 200), cap(description, 500) || '', cover_image || '', Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/admin/playlists/:id', requireAuth, dbRoute((req, res) => {
  db.prepare('DELETE FROM playlist_videos WHERE playlist_id=?').run(req.params.id);
  db.prepare('DELETE FROM playlists WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));
// Add/remove videos from playlist
app.post('/api/admin/playlists/:id/videos', requireAuth, dbRoute((req, res) => {
  const { video_ids } = req.body;
  if (!Array.isArray(video_ids)) return res.status(400).json({ error: 'video_ids array required' });
  const ids = video_ids.map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0);
  if (!ids.length) return res.status(400).json({ error: 'no valid video_ids' });
  const ins = db.prepare('INSERT OR IGNORE INTO playlist_videos (playlist_id,video_id,sort_order) VALUES (?,?,?)');
  const tx = db.transaction(() => { ids.forEach((vid, i) => ins.run(req.params.id, vid, i + 1)); });
  tx();
  res.json({ ok: true });
}));
app.delete('/api/admin/playlists/:pid/videos/:vid', requireAuth, dbRoute((req, res) => {
  db.prepare('DELETE FROM playlist_videos WHERE playlist_id=? AND video_id=?')
    .run(req.params.pid, req.params.vid);
  res.json({ ok: true });
}));

// Press articles admin
app.post('/api/admin/press', requireAuth, dbRoute((req, res) => {
  const { title, publication, date_label, content, image, sort_order } = req.body;
  if (!cap(title, 200).trim()) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO press_articles (title,publication,date_label,content,image,sort_order) VALUES (?,?,?,?,?,?)')
    .run(cap(title, 200), cap(publication, 200), cap(date_label, 40), cap(content, 10000), cap(image, 500), Number(sort_order) || 0);
  res.json({ id: r.lastInsertRowid });
}));
app.put('/api/admin/press/:id', requireAuth, dbRoute((req, res) => {
  const { title, publication, date_label, content, image, sort_order } = req.body;
  db.prepare('UPDATE press_articles SET title=?,publication=?,date_label=?,content=?,image=?,sort_order=? WHERE id=?')
    .run(cap(title, 200), cap(publication, 200), cap(date_label, 40), cap(content, 10000), cap(image, 500), Number(sort_order) || 0, req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/admin/press/:id', requireAuth, dbRoute((req, res) => {
  const row = db.prepare('SELECT image FROM press_articles WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM press_articles WHERE id=?').run(req.params.id);
  if (row?.image?.startsWith('/uploads/')) {
    const fp = path.join(UPLOAD_DIR, path.basename(row.image));
    try { fs.unlinkSync(fp); } catch (_) {}
  }
  res.json({ ok: true });
}));

// Donations list
app.get('/api/admin/donations', requireAuth, dbRoute((req, res) => {
  res.json(db.prepare('SELECT * FROM donations ORDER BY id DESC').all());
}));

// Manual donation entry (admin records offline cash/bank/UPI payments)
app.post('/api/admin/donations', requireAuth, dbRoute((req, res) => {
  const { name, email, amount, method, reference } = req.body;
  const amt = Math.max(0, Number(amount) || 0);
  if (!amt) return res.status(400).json({ error: 'amount required' });
  const r = db.prepare('INSERT INTO donations (name,email,amount,method,reference) VALUES (?,?,?,?,?)')
    .run(String(name || '').slice(0, 120), String(email || '').slice(0, 160),
      amt, String(method || 'manual').slice(0, 40), String(reference || '').slice(0, 80));
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// Delete a donation record
app.delete('/api/admin/donations/:id', requireAuth, dbRoute((req, res) => {
  db.prepare('DELETE FROM donations WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// Update admin account email
app.put('/api/admin/email', requireAuth, (req, res) => {
  const { email } = req.body;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'invalid email address' });
  db.prepare('UPDATE admin SET email=? WHERE id=?').run(email || null, req.session.admin.id);
  res.json({ ok: true });
});

// Get admin account email (for pre-filling the field)
app.get('/api/admin/account', requireAuth, (req, res) => {
  const row = db.prepare('SELECT email FROM admin WHERE id=?').get(req.session.admin.id);
  res.json({ email: row?.email || '' });
});

// Step 1 of password change: validate current password + new password, send OTP to email
app.post('/api/admin/password/otp', requireAuth, async (req, res) => {
  const { current, next, confirm } = req.body;
  const row = db.prepare('SELECT * FROM admin WHERE id=?').get(req.session.admin.id);
  if (!bcrypt.compareSync(current || '', row.password_hash))
    return res.status(400).json({ error: 'current password wrong' });
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: 'password needs ' + problem });
  if (next !== confirm) return res.status(400).json({ error: 'passwords do not match' });
  if (!row.email) return res.status(400).json({ error: 'no_email', message: 'Set your account email first — we need it to send the verification code.' });
  if (!mailer)   return res.status(400).json({ error: 'no_smtp', message: 'Email not configured on this server. Contact your hosting provider.' });

  // Generate 6-digit OTP, store hashed, expire in 10 min
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const otpHash = bcrypt.hashSync(otp, 8);   // cost 8 — fast, OTP is random enough
  const expires = Date.now() + 10 * 60 * 1000;
  db.prepare('UPDATE admin SET pw_otp=?, pw_otp_expires=? WHERE id=?').run(otpHash, expires, row.id);

  try {
    await mailer.sendMail({
      from: `"Devi Murlika Gaur Admin" <${process.env.SMTP_USER}>`,
      to: row.email,
      subject: 'Admin password change — verification code',
      text: `Your one-time verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, change your password immediately and check your account security.`,
      html: `<p>Your one-time verification code is:</p><h2 style="letter-spacing:8px;font-size:2rem">${otp}</h2><p>This code expires in <strong>10 minutes</strong>.</p><p style="color:#888;font-size:12px">If you did not request this, change your password immediately.</p>`
    });
  } catch (err) {
    console.error('[pw-otp] mail error:', err.message);
    return res.status(500).json({ error: 'Failed to send email. Check SMTP settings.' });
  }
  res.json({ ok: true, hint: `Code sent to ${row.email.replace(/(.{2}).+(@.+)/, '$1***$2')}` });
});

// Step 2 of password change: verify OTP and apply new password
app.put('/api/admin/password', requireAuth, (req, res) => {
  const { current, next, otp } = req.body;
  const row = db.prepare('SELECT * FROM admin WHERE id=?').get(req.session.admin.id);
  if (!bcrypt.compareSync(current || '', row.password_hash))
    return res.status(400).json({ error: 'current password wrong' });
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: 'password needs ' + problem });

  // If admin has an email and OTP was issued, require it
  if (row.email) {
    if (!otp) return res.status(400).json({ error: 'otp_required' });
    if (!row.pw_otp || !row.pw_otp_expires || Date.now() > row.pw_otp_expires)
      return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
    if (!bcrypt.compareSync(String(otp).replace(/\s/g, ''), row.pw_otp))
      return res.status(400).json({ error: 'Incorrect verification code.' });
  }

  db.prepare('UPDATE admin SET password_hash=?, pw_otp=NULL, pw_otp_expires=0 WHERE id=?')
    .run(bcrypt.hashSync(next, 12), row.id);
  // Invalidate all OTHER sessions so a stolen session can't persist after password change
  db.prepare("DELETE FROM sessions WHERE sid <> ?").run(req.sessionID);
  res.json({ ok: true });
});

// ---- Two-factor (TOTP) management ----
// Step 1: generate a secret + QR for the authenticator app (not yet enabled).
// If 2FA is already active, require the current password before overwriting the
// active secret (prevents an attacker with a stolen session from silently
// disabling 2FA by simply calling this endpoint).
app.post('/api/admin/2fa/setup', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM admin WHERE id=?').get(req.session.admin.id);
  if (row.totp_enabled) {
    if (!req.body.password) return res.status(400).json({ error: 'current password required to re-setup 2FA' });
    if (!bcrypt.compareSync(req.body.password || '', row.password_hash))
      return res.status(400).json({ error: 'current password wrong' });
  }
  const base32 = totpGenerateSecret();
  const otpauthUrl = totpGenerateURI({ label: req.session.admin.username, issuer: 'DeviMurlikaGaur', secret: base32 });
  // Store provisional secret; only flips to enabled once a valid code is confirmed.
  db.prepare('UPDATE admin SET totp_secret=?, totp_enabled=0 WHERE id=?').run(base32, req.session.admin.id);
  const qr = await qrcode.toDataURL(otpauthUrl);
  res.json({ qr, secret: base32 });
});

// Step 2: confirm a code to turn 2FA on.
app.post('/api/admin/2fa/enable', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM admin WHERE id=?').get(req.session.admin.id);
  if (!row.totp_secret) return res.status(400).json({ error: 'run setup first' });
  const ok = totpVerify({ token: String(req.body.token || '').replace(/\s/g, ''), secret: row.totp_secret, type: 'totp', window: 1 }).valid;
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
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${stamp}.db"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = fs.createReadStream(DB_PATH);
    stream.on('error', e => { console.error('[backup]', e.message); res.end(); });
    stream.pipe(res);
  } catch (e) { console.error('[backup]', e.message); res.status(500).json({ error: 'backup failed' }); }
});

// ---- Image upload: persistent on Azure (/home/uploads), local in public/uploads ----
const UPLOAD_DIR = process.env.WEBSITE_INSTANCE_ID
  ? '/home/uploads'
  : path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// On Azure, public/uploads isn't the same dir, so serve /home/uploads explicitly
if (process.env.WEBSITE_INSTANCE_ID) {
  app.use('/uploads', express.static(UPLOAD_DIR, { dotfiles: 'deny', index: false }));
}

// Magic-byte signatures for allowed image types
const IMAGE_MAGIC = [
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },  // RIFF header; bytes 8-11 = WEBP verified below
];
function validateImageMagic(filepath) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(filepath, 'r');
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  for (const sig of IMAGE_MAGIC) {
    if (sig.bytes.every((b, i) => buf[i] === b)) {
      if (sig.mime === 'image/webp') return buf.slice(8, 12).toString('ascii') === 'WEBP';
      return true;
    }
  }
  return false;
}

// Normalise browser MIME quirks: image/jpg → image/jpeg, image/jfif → image/jpeg
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/jfif']);
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/jfif': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      cb(null, crypto.randomBytes(12).toString('hex') + (MIME_EXT[file.mimetype] || '.jpg'));
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error(`Unsupported type ${file.mimetype}. Use jpg/png/webp/gif.`));
    cb(null, true);
  }
});
app.post('/api/admin/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received — use jpg/png/webp/gif' });
    if (!validateImageMagic(req.file.path)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File content does not match an image — rejected' });
    }
    res.json({ ok: true, url: '/uploads/' + req.file.filename });
  });
});

// Bulk upload — up to 20 images at once
const uploadBulk = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      cb(null, crypto.randomBytes(12).toString('hex') + (MIME_EXT[file.mimetype] || '.jpg'));
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error(`Unsupported type ${file.mimetype}. Use jpg/png/webp/gif.`));
    cb(null, true);
  }
});
app.post('/api/admin/upload-bulk', requireAuth, (req, res) => {
  uploadBulk.array('images', 20)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No valid images received. Use jpg/png/webp/gif under 8 MB each.' });
    const checked = req.files.map(f => ({ file: f, ok: validateImageMagic(f.path) }));
    checked.filter(r => !r.ok).forEach(r => { try { fs.unlinkSync(r.file.path); } catch (_) {} });
    const valid = checked.filter(r => r.ok).map(r => r.file);
    if (!valid.length) return res.status(400).json({ error: 'No valid image content detected — files may be corrupted' });
    const urls = valid.map(f => '/uploads/' + f.filename);
    res.json({ ok: true, urls });
  });
});

// Recent login attempts (audit trail)
app.get('/api/admin/audit', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT username,ip,success,reason,created_at FROM login_audit ORDER BY id DESC LIMIT 50').all());
});

// ---- Clean admin URL: /admin serves the login panel (no link anywhere on the site) ----
app.get('/admin', (req, res) => {
  // Server-side auth guard — unauthenticated requests never receive admin.html
  if (!req.session?.admin) return res.redirect(302, '/login.html');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
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
  const errPage = path.join(__dirname, 'public', '500.html');
  const fallback = path.join(__dirname, 'public', '404.html');
  res.status(500).sendFile(fs.existsSync(errPage) ? errPage : fallback);
});

// ---- Last-resort handlers ----
// unhandledRejection: log and exit — continuing in unknown state is dangerous
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});
// uncaughtException: flush WAL, then exit — PM2/Azure will restart cleanly
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
  try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch (_) {}
  process.exit(1);
});

// ---- Graceful shutdown: flush WAL + close DB before process exits ----
function gracefulShutdown(signal) {
  console.error(`[server] ${signal} received — shutting down gracefully`);
  server.close(() => {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch (_) {}
    process.exit(0);
  });
  // Force exit after 10 s if connections don't drain
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

const server = app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}  (admin: /admin)`));
