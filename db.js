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
db.pragma('foreign_keys = ON');   // enable CASCADE DELETE etc.

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

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    youtube_url TEXT NOT NULL,
    description TEXT,
    featured INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    cover_image TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlist_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    video_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    UNIQUE(playlist_id, video_id)
  );

  CREATE TABLE IF NOT EXISTS press_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    publication TEXT,
    date_label TEXT,
    content TEXT,
    image TEXT,
    sort_order INTEGER DEFAULT 0,
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
  upi_name: '',
  donation_note: 'Your contribution helps spread the message of devotion, supports satsang and seva. 🙏',
  bank_name: '',
  bank_account_name: '',
  bank_account_number: '',
  bank_ifsc: '',
  bank_branch: '',
  razorpay_link: '',
  gpay_number: '',
  phonepe_number: '',
  paytm_number: '',
  other_payment: ''
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
// Videos are managed from admin panel — no seed data
if (db.prepare('SELECT COUNT(*) c FROM press_articles').get().c === 0) {
  const ins = db.prepare('INSERT INTO press_articles (title,publication,date_label,content,image,sort_order) VALUES (?,?,?,?,?,?)');
  ins.run('Ganesh Mahotsav Satsang Coverage', 'Dainik Jagran', 'Aug 2023', 'Devi Murlika Gaur Ji delivered an inspiring spiritual discourse at the Ganesh Mahotsav satsang. Hundreds of devotees gathered to listen to her devotional thoughts on bhakti and inner peace. The event was widely appreciated for its spiritual depth and musical renditions.', '/images/press-1.jpg', 1);
  ins.run('Shrimad Bhagwat Katha — Special Report', 'Amar Ujala', 'Jan 2023', 'The seven-day Shrimad Bhagwat Katha organized by Devi Murlika Gaur Ji drew thousands of devotees from across the region. Her storytelling style, blending classical scripture with everyday wisdom, earned widespread praise. The katha concluded with a grand bhajan sandhya.', '/images/press-2.jpg', 2);
  ins.run('Interview: Spreading Devotion Through Digital Media', 'Haribhoomi', 'Mar 2022', 'In an exclusive interview, Devi Murlika Gaur Ji spoke about her journey as a spiritual speaker and content creator. She discussed how social media has helped spread the message of bhakti to millions of seekers worldwide and her plans for upcoming satsang programmes.', '/images/press-3.jpg', 3);
  ins.run('पट खुलते — Spiritual Programme Report', 'Nav Bharat Times', 'Nov 2021', 'The sacred programme "Patt Khulte" organized under the guidance of Devi Murlika Gaur Ji was a deeply moving spiritual event. The ceremony brought together devotees for prayers, bhajans and an enlightening discourse on the importance of devotion in daily life.', '/images/press-4.jpg', 4);
}

// Clean up any placeholder gallery images (picsum, broken URLs)
const galBad = db.prepare("SELECT COUNT(*) c FROM gallery WHERE image LIKE '%picsum%' OR image LIKE '% %' OR image=''").get().c;
if (galBad > 0) {
  db.prepare("DELETE FROM gallery WHERE image LIKE '%picsum%' OR image LIKE '% %' OR image=''").run();
}

export { DB_PATH };
export default db;
