import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// On Azure App Service, WEBSITE_INSTANCE_ID is always set.
// Use /home/data.db there — /home persists across deployments.
// Locally keep data.db in project root.
const DB_PATH = process.env.WEBSITE_INSTANCE_ID
  ? '/home/data.db'
  : path.join(__dirname, 'data.db');
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    day TEXT,
    month TEXT,
    link TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    image TEXT,
    date_label TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS login_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    ip TEXT,
    success INTEGER,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image TEXT NOT NULL,
    caption TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    amount REAL,
    method TEXT,
    reference TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Add login-security columns to admin if missing (TOTP 2FA + lockout)
const adminCols = db.prepare("PRAGMA table_info(admin)").all().map(c => c.name);
const addCol = (name, def) => { if (!adminCols.includes(name)) db.exec(`ALTER TABLE admin ADD COLUMN ${name} ${def}`); };
addCol('totp_secret', 'TEXT');
addCol('totp_enabled', 'INTEGER DEFAULT 0');
addCol('failed_attempts', 'INTEGER DEFAULT 0');
addCol('locked_until', 'INTEGER DEFAULT 0');

// Seed admin from env (only if none exists). No insecure default password (C2).
const adminCount = db.prepare('SELECT COUNT(*) c FROM admin').get().c;
if (adminCount === 0) {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS;
  if (!pass || pass.length < 8) {
    throw new Error('No admin exists yet. Set ADMIN_PASS (min 8 chars) in .env before first run.');
  }
  const hash = bcrypt.hashSync(pass, 12);
  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run(user, hash);
  console.log(`[db] seeded admin user "${user}"`);
}

// Seed default settings (social links + texts) once
const defaults = {
  youtube: 'https://www.youtube.com/@devimurlikagaur',
  facebook: 'https://facebook.com/devimurlika',
  instagram: 'https://instagram.com/devimurlika_madhu',
  pinterest: 'https://in.pinterest.com/devimurlikagaur/',
  phone: '',
  location: 'India',
  bio: 'Devi Murlika Gaur is a spiritual speaker and devotional content creator who shares thoughts on bhakti, faith and living a meaningful life.',
  paypal_link: '',
  razorpay_key: '',
  upi_id: '',
  donation_note: 'Your contribution helps spread the message of devotion, supports satsang and seva. 🙏'
};
const getSetting = db.prepare('SELECT value FROM settings WHERE key=?');
const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(defaults)) setSetting.run(k, v);

// Seed sample events/posts if empty
if (db.prepare('SELECT COUNT(*) c FROM events').get().c === 0) {
  const ins = db.prepare('INSERT INTO events (title,description,day,month,link,sort_order) VALUES (?,?,?,?,?,?)');
  ins.run('Online Satsang & Bhajan Sandhya', 'Live devotional session streamed on YouTube', '12', 'Jul', 'https://www.youtube.com/@devimurlikagaur', 1);
  ins.run('Janmashtami Special Programme', 'Celebration with kirtan, thoughts and songs', '22', 'Aug', '', 2);
  ins.run('Spiritual Thoughts Workshop', 'Interactive session on devotion and positive living', '05', 'Sep', '', 3);
}
if (db.prepare('SELECT COUNT(*) c FROM posts').get().c === 0) {
  const ins = db.prepare('INSERT INTO posts (title,body,image,date_label) VALUES (?,?,?,?)');
  ins.run('The Power of Daily Devotion', 'How a few mindful moments of bhakti each day can transform your inner world.', 'https://picsum.photos/seed/db1/600/400', '19 Nov 2025');
  ins.run('Finding Peace in a Busy Life', 'Simple spiritual practices to stay grounded amid the rush of modern living.', 'https://picsum.photos/seed/db2/600/400', '12 Nov 2025');
  ins.run('Gratitude as a Spiritual Practice', 'Why a thankful heart is the foundation of devotion and lasting happiness.', 'https://picsum.photos/seed/db3/600/400', '04 Nov 2025');
}
if (db.prepare('SELECT COUNT(*) c FROM gallery').get().c === 0) {
  const ins = db.prepare('INSERT INTO gallery (image,caption,sort_order) VALUES (?,?,?)');
  for (let i = 1; i <= 8; i++) ins.run(`https://picsum.photos/seed/gal${i}/500/500`, '', i);
}

export default db;
