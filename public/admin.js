/* ══════════════════════════════════════════════
   Devi Murlika Gaur — Admin Panel (open, no login)
   ══════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const API_BASE = location.protocol === 'file:' ? 'http://localhost:3000' : '';

async function api(url, opts = {}) {
  const res = await fetch(API_BASE + url, {
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    credentials: 'include',
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ── Toast ───────────────────────────────────── */
let _tt;
function toast(msg, type = 'ok') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ── Tabs ────────────────────────────────────── */
const TABS = ['dashboard', 'messages', 'events', 'posts', 'gallery', 'videos', 'press', 'donations', 'settings'];

function switchTab(name) {
  document.querySelectorAll('.admin-nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name)
  );
  TABS.forEach(t => {
    const el = $('s-' + t);
    if (el) el.classList.toggle('active', t === name);
  });
}

document.querySelectorAll('.admin-nav button').forEach(btn =>
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
);

/* ── Data stores (lookup by ID) ──────────────── */
let msgs = [], msgMap = {};
let evts = [], evtMap = {};
let posts = [], postMap = {};
let gallery = [], galMap = {};

/* ── Charts ──────────────────────────────────── */
let _chartBar, _chartDough;

function buildCharts() {
  // Bar: messages per day last 7 days
  const labels = [], counts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
    const ds = d.toISOString().slice(0, 10);
    counts.push(msgs.filter(m => (m.created_at || '').startsWith(ds)).length);
  }

  const c1 = $('chartMsgs');
  if (c1 && typeof Chart !== 'undefined') {
    if (_chartBar) _chartBar.destroy();
    _chartBar = new Chart(c1.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Messages', data: counts,
          backgroundColor: 'rgba(232,166,30,.8)',
          borderColor: '#c8860e', borderWidth: 1, borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }

  // Doughnut: content breakdown
  const c2 = $('chartOverview');
  if (c2 && typeof Chart !== 'undefined') {
    if (_chartDough) _chartDough.destroy();
    _chartDough = new Chart(c2.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Gallery', 'Events', 'Thoughts', 'Messages'],
        datasets: [{
          data: [gallery.length, evts.length, posts.length, msgs.length],
          backgroundColor: ['#e8a61e', '#7a1c3c', '#c8860e', '#a04020'],
          borderColor: '#fff', borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } } }
      }
    });
  }
}

function updateCounts() {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('st-msg', msgs.length);
  set('st-gal', gallery.length);
  set('st-ev', evts.length);
  set('st-po', posts.length);
}

/* ══════════════════════════════════════════════
   MESSAGES
   ══════════════════════════════════════════════ */
async function loadMessages() {
  msgs = await api('/api/admin/messages').catch(() => []);
  msgMap = Object.fromEntries(msgs.map(m => [m.id, m]));
  updateCounts();

  // Dashboard recent (top 5)
  const dash = $('dashMsgList');
  if (dash) {
    dash.innerHTML = msgs.length
      ? msgs.slice(0, 5).map(m => `
        <div class="dash-msg">
          <div>
            <span class="dm-who">${esc(m.name)}</span>
            <span class="dm-time">&lt;${esc(m.email)}&gt; &nbsp;·&nbsp; ${esc(m.created_at || '')}</span>
          </div>
          <div class="dm-text">${esc((m.message || '').substring(0, 150))}${(m.message || '').length > 150 ? '…' : ''}</div>
        </div>`).join('')
      : '<p style="color:var(--muted)">No messages yet.</p>';
  }

  // Messages tab
  const list = $('msgList');
  if (!list) return;
  list.innerHTML = msgs.length
    ? msgs.map(m => `
      <div class="a-item">
        <div class="a-item-body">
          <h4>${esc(m.name)} <span class="meta">&lt;${esc(m.email)}&gt;</span></h4>
          <div class="meta">📞 ${esc(m.phone) || '–'} &nbsp;·&nbsp; 🕒 ${esc(m.created_at || '')}</div>
          <p style="font-size:14px;margin:6px 0 0;line-height:1.6">${esc(m.message)}</p>
          <div class="a-item-actions">
            <button class="btn-del msg-del" data-id="${m.id}">🗑 Delete</button>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No messages yet.</p>';

  list.querySelectorAll('.msg-del').forEach(btn =>
    btn.addEventListener('click', () => delMsg(Number(btn.dataset.id)))
  );
}

async function delMsg(id) {
  if (!confirm('Delete this message?')) return;
  await api('/api/admin/messages/' + id, { method: 'DELETE' });
  toast('Message deleted');
  await loadMessages();
  buildCharts();
}

/* ══════════════════════════════════════════════
   EVENTS
   ══════════════════════════════════════════════ */
async function loadEvents() {
  evts = await api('/api/events').catch(() => []);
  evtMap = Object.fromEntries(evts.map(e => [e.id, e]));
  updateCounts();

  const list = $('evList');
  if (!list) return;
  list.innerHTML = evts.length
    ? evts.map(e => `
      <div class="a-item">
        <div class="a-item-body">
          <h4>📅 ${esc(e.day)} ${esc(e.month)} — ${esc(e.title)}</h4>
          ${e.description ? `<div class="meta">${esc(e.description)}</div>` : ''}
          ${e.link ? `<div class="meta">🔗 <a href="${esc(e.link)}" target="_blank" style="color:var(--saffron-dark)">${esc(e.link)}</a></div>` : ''}
          <div class="a-item-actions">
            <button class="btn-edit ev-edit" data-id="${e.id}">✏️ Edit</button>
            <button class="btn-del ev-del" data-id="${e.id}">🗑 Delete</button>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No events yet. Add one above.</p>';

  list.querySelectorAll('.ev-edit').forEach(btn =>
    btn.addEventListener('click', () => { fillEvent(evtMap[btn.dataset.id]); })
  );
  list.querySelectorAll('.ev-del').forEach(btn =>
    btn.addEventListener('click', () => delEvent(Number(btn.dataset.id)))
  );
}

function fillEvent(e) {
  if (!e) return;
  $('evId').value = e.id;
  $('evDay').value = e.day || '';
  $('evMonth').value = e.month || '';
  $('evTitle').value = e.title || '';
  $('evDesc').value = e.description || '';
  $('evLink').value = e.link || '';
  $('evSort').value = e.sort_order || 0;
  $('evFormTitle').textContent = 'Edit Event';
  switchTab('events');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearEvent() {
  ['evId', 'evDay', 'evMonth', 'evTitle', 'evDesc', 'evLink'].forEach(i => $(i).value = '');
  $('evSort').value = 0;
  $('evFormTitle').textContent = 'Add New Event';
}

async function saveEvent() {
  const id = $('evId').value;
  if (!$('evTitle').value.trim()) { toast('Title is required', 'err'); return; }
  await api('/api/admin/events' + (id ? '/' + id : ''), {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify({
      day: $('evDay').value, month: $('evMonth').value,
      title: $('evTitle').value, description: $('evDesc').value,
      link: $('evLink').value, sort_order: Number($('evSort').value) || 0
    })
  });
  toast(id ? 'Event updated ✓' : 'Event added ✓');
  clearEvent();
  await loadEvents();
  buildCharts();
}

async function delEvent(id) {
  if (!confirm('Delete this event?')) return;
  await api('/api/admin/events/' + id, { method: 'DELETE' });
  toast('Event deleted');
  await loadEvents();
  buildCharts();
}

/* ══════════════════════════════════════════════
   POSTS / THOUGHTS
   ══════════════════════════════════════════════ */
async function loadPosts() {
  posts = await api('/api/posts').catch(() => []);
  postMap = Object.fromEntries(posts.map(p => [p.id, p]));
  updateCounts();

  const list = $('poList');
  if (!list) return;
  list.innerHTML = posts.length
    ? posts.map(p => `
      <div class="a-item">
        ${p.image ? `<img src="${esc(p.image)}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;flex-shrink:0" loading="lazy" />` : ''}
        <div class="a-item-body">
          <h4>${esc(p.title)}</h4>
          <div class="meta">${esc(p.date_label || '')}</div>
          <p style="font-size:13px;color:var(--muted);margin:4px 0 0;line-height:1.5">
            ${esc((p.body || '').substring(0, 130))}${(p.body || '').length > 130 ? '…' : ''}
          </p>
          <div class="a-item-actions">
            <button class="btn-edit po-edit" data-id="${p.id}">✏️ Edit</button>
            <button class="btn-del po-del" data-id="${p.id}">🗑 Delete</button>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No thoughts yet. Add one above.</p>';

  list.querySelectorAll('.po-edit').forEach(btn =>
    btn.addEventListener('click', () => fillPost(postMap[btn.dataset.id]))
  );
  list.querySelectorAll('.po-del').forEach(btn =>
    btn.addEventListener('click', () => delPost(Number(btn.dataset.id)))
  );
}

function fillPost(p) {
  if (!p) return;
  $('poId').value = p.id;
  $('poTitle').value = p.title || '';
  $('poBody').value = p.body || '';
  $('poImg').value = p.image || '';
  $('poDate').value = p.date_label || '';
  $('poFormTitle').textContent = 'Edit Thought';
  switchTab('posts');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearPost() {
  ['poId', 'poTitle', 'poBody', 'poImg', 'poDate'].forEach(i => $(i).value = '');
  $('poFormTitle').textContent = 'Add New Thought';
}

async function savePost() {
  const id = $('poId').value;
  if (!$('poTitle').value.trim()) { toast('Title is required', 'err'); return; }
  await api('/api/admin/posts' + (id ? '/' + id : ''), {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify({
      title: $('poTitle').value, body: $('poBody').value,
      image: $('poImg').value, date_label: $('poDate').value
    })
  });
  toast(id ? 'Post updated ✓' : 'Post added ✓');
  clearPost();
  await loadPosts();
  buildCharts();
}

async function delPost(id) {
  if (!confirm('Delete this post?')) return;
  await api('/api/admin/posts/' + id, { method: 'DELETE' });
  toast('Post deleted');
  await loadPosts();
  buildCharts();
}

/* ══════════════════════════════════════════════
   GALLERY
   ══════════════════════════════════════════════ */
async function loadGallery() {
  gallery = await api('/api/gallery').catch(() => []);
  galMap = Object.fromEntries(gallery.map(g => [g.id, g]));
  updateCounts();

  const gCount = $('gCount');
  if (gCount) gCount.textContent = gallery.length;

  const grid = $('gGrid');
  if (!grid) return;

  if (!gallery.length) {
    grid.innerHTML = '<p style="color:var(--muted)">No images yet. Upload one above.</p>';
    return;
  }

  grid.innerHTML = gallery.map(g => `
    <div class="g-cell">
      <img src="${esc(g.image)}" alt="${esc(g.caption || '')}" loading="lazy"
           onerror="this.style.opacity='.3'" />
      ${g.caption ? `<div class="g-cap">${esc(g.caption)}</div>` : ''}
      <div class="g-overlay">
        <button class="btn-edit g-edit" data-id="${g.id}">✏️ Edit</button>
        <button class="btn-del g-del" data-id="${g.id}">🗑 Delete</button>
      </div>
    </div>`).join('');

  // Event delegation — no inline JSON, no fragile strings
  grid.querySelectorAll('.g-edit').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      fillGallery(galMap[btn.dataset.id]);
    })
  );
  grid.querySelectorAll('.g-del').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      delGallery(Number(btn.dataset.id));
    })
  );
}

function fillGallery(g) {
  if (!g) return;
  $('gId').value = g.id;
  $('gImg').value = g.image || '';
  $('gCap').value = g.caption || '';
  $('gSort').value = g.sort_order || 0;
  switchTab('gallery');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearGallery() {
  ['gId', 'gImg', 'gCap'].forEach(i => $(i).value = '');
  $('gSort').value = 0;
  $('gUpMsg').textContent = '';
  const gFile = $('gFile'); if (gFile) gFile.value = '';
}

async function saveGallery() {
  const id = $('gId').value;
  if (!$('gImg').value.trim()) { toast('Image URL required', 'err'); return; }
  await api('/api/admin/gallery' + (id ? '/' + id : ''), {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify({
      image: $('gImg').value,
      caption: $('gCap').value,
      sort_order: Number($('gSort').value) || 0
    })
  });
  toast(id ? 'Image updated ✓' : 'Image added ✓');
  clearGallery();
  await loadGallery();
  buildCharts();
}

async function delGallery(id) {
  if (!confirm('Delete this image?')) return;
  await api('/api/admin/gallery/' + id, { method: 'DELETE' });
  toast('Image deleted');
  await loadGallery();
  buildCharts();
}

// File upload from device
const gFileEl = $('gFile');
if (gFileEl) {
  gFileEl.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    const statusEl = $('gUpMsg');
    statusEl.textContent = '⏳ Uploading…';
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch(API_BASE + '/api/admin/upload', {
        method: 'POST', credentials: 'include',
        headers: { 'X-Requested-With': 'fetch' }, body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      $('gImg').value = data.url;
      statusEl.textContent = '✅ Uploaded! Add a caption then click "Add / Update Image"';
      toast('Photo uploaded!');
    } catch (e) {
      statusEl.textContent = '❌ ' + e.message;
      toast(e.message, 'err');
    }
    this.value = '';
  });
}

/* ══════════════════════════════════════════════
   VIDEOS
   ══════════════════════════════════════════════ */
let videos = [], videoMap = {};

async function loadVideos() {
  videos = await api('/api/videos').catch(() => []);
  videoMap = Object.fromEntries(videos.map(v => [v.id, v]));
  const list = $('vidList');
  if (!list) return;
  list.innerHTML = videos.length
    ? videos.map(v => {
        const vid = (v.youtube_url || '').match(/[?&]v=([^&]+)/)?.[1] || '';
        return `
        <div class="a-item">
          ${vid ? `<img src="https://i.ytimg.com/vi/${vid}/default.jpg" style="width:80px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0" />` : ''}
          <div class="a-item-body">
            <h4>${esc(v.title)} ${v.featured ? '<span style="background:var(--saffron);color:#fff;font-size:10px;padding:2px 7px;border-radius:3px;margin-left:6px">FEATURED</span>' : ''}</h4>
            <div class="meta"><a href="${esc(v.youtube_url)}" target="_blank" style="color:var(--saffron-dark)">${esc(v.youtube_url)}</a></div>
            ${v.description ? `<div class="meta">${esc(v.description)}</div>` : ''}
            <div class="a-item-actions">
              <button class="btn-edit vid-edit" data-id="${v.id}">✏️ Edit</button>
              <button class="btn-del vid-del" data-id="${v.id}">🗑 Delete</button>
            </div>
          </div>
        </div>`;
      }).join('')
    : '<p style="color:var(--muted)">No videos yet. Add one above.</p>';

  list.querySelectorAll('.vid-edit').forEach(btn =>
    btn.addEventListener('click', () => fillVideo(videoMap[btn.dataset.id]))
  );
  list.querySelectorAll('.vid-del').forEach(btn =>
    btn.addEventListener('click', () => delVideo(Number(btn.dataset.id)))
  );
}

function fillVideo(v) {
  if (!v) return;
  $('vidId').value = v.id;
  $('vidTitle').value = v.title || '';
  $('vidUrl').value = v.youtube_url || '';
  $('vidDesc').value = v.description || '';
  $('vidSort').value = v.sort_order || 0;
  $('vidFeatured').value = v.featured ? '1' : '0';
  $('vidFormTitle').textContent = 'Edit Video';
  switchTab('videos');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearVideo() {
  ['vidId', 'vidTitle', 'vidUrl', 'vidDesc'].forEach(i => $(i).value = '');
  $('vidSort').value = 0; $('vidFeatured').value = '0';
  $('vidFormTitle').textContent = 'Add New Video';
}

async function saveVideo() {
  const id = $('vidId').value;
  if (!$('vidTitle').value.trim()) { toast('Title required', 'err'); return; }
  if (!$('vidUrl').value.trim()) { toast('YouTube URL required', 'err'); return; }
  await api('/api/admin/videos' + (id ? '/' + id : ''), {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify({ title: $('vidTitle').value, youtube_url: $('vidUrl').value, description: $('vidDesc').value, featured: $('vidFeatured').value, sort_order: Number($('vidSort').value) || 0 })
  });
  toast(id ? 'Video updated ✓' : 'Video added ✓');
  clearVideo(); await loadVideos();
}

async function delVideo(id) {
  if (!confirm('Delete this video?')) return;
  await api('/api/admin/videos/' + id, { method: 'DELETE' });
  toast('Video deleted'); await loadVideos();
}

/* ══════════════════════════════════════════════
   PRESS ARTICLES
   ══════════════════════════════════════════════ */
let pressArr = [], pressMap = {};

async function loadPress() {
  pressArr = await api('/api/press').catch(() => []);
  pressMap = Object.fromEntries(pressArr.map(p => [p.id, p]));
  const list = $('pressList');
  if (!list) return;
  list.innerHTML = pressArr.length
    ? pressArr.map(p => `
      <div class="a-item">
        ${p.image ? `<img src="${esc(p.image)}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;flex-shrink:0" onerror="this.style.display='none'" />` : ''}
        <div class="a-item-body">
          <h4>${esc(p.title)}</h4>
          <div class="meta">📰 ${esc(p.publication || '–')} &nbsp;·&nbsp; ${esc(p.date_label || '')}</div>
          <p style="font-size:13px;color:var(--muted);margin:4px 0 0;line-height:1.5">
            ${esc((p.content || '').substring(0, 120))}${(p.content || '').length > 120 ? '…' : ''}
          </p>
          <div class="a-item-actions">
            <button class="btn-edit pr-edit" data-id="${p.id}">✏️ Edit</button>
            <button class="btn-del pr-del" data-id="${p.id}">🗑 Delete</button>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No press articles yet.</p>';

  list.querySelectorAll('.pr-edit').forEach(btn =>
    btn.addEventListener('click', () => fillPress(pressMap[btn.dataset.id]))
  );
  list.querySelectorAll('.pr-del').forEach(btn =>
    btn.addEventListener('click', () => delPress(Number(btn.dataset.id)))
  );
}

function fillPress(p) {
  if (!p) return;
  $('pressId').value = p.id;
  $('pressTitle').value = p.title || '';
  $('pressPub').value = p.publication || '';
  $('pressDate').value = p.date_label || '';
  $('pressContent').value = p.content || '';
  $('pressImg').value = p.image || '';
  $('pressSort').value = p.sort_order || 0;
  $('pressFormTitle').textContent = 'Edit Press Article';
  switchTab('press');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearPress() {
  ['pressId', 'pressTitle', 'pressPub', 'pressDate', 'pressContent', 'pressImg'].forEach(i => $(i).value = '');
  $('pressSort').value = 0;
  $('pressFormTitle').textContent = 'Add Press Article';
}

async function savePress() {
  const id = $('pressId').value;
  if (!$('pressTitle').value.trim()) { toast('Title required', 'err'); return; }
  await api('/api/admin/press' + (id ? '/' + id : ''), {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify({ title: $('pressTitle').value, publication: $('pressPub').value, date_label: $('pressDate').value, content: $('pressContent').value, image: $('pressImg').value, sort_order: Number($('pressSort').value) || 0 })
  });
  toast(id ? 'Article updated ✓' : 'Article added ✓');
  clearPress(); await loadPress();
}

async function delPress(id) {
  if (!confirm('Delete this article?')) return;
  await api('/api/admin/press/' + id, { method: 'DELETE' });
  toast('Article deleted'); await loadPress();
}

/* ══════════════════════════════════════════════
   DONATIONS
   ══════════════════════════════════════════════ */
async function loadDonations() {
  const list = await api('/api/admin/donations').catch(() => []);
  const el = $('donList');
  if (!el) return;
  el.innerHTML = list.length
    ? list.map(d => `
      <div class="a-item">
        <div class="a-item-body">
          <h4>₹${esc(String(d.amount))} <span class="meta">via ${esc(d.method || '–')}</span></h4>
          <div class="meta">
            ${esc(d.name) || 'Anonymous'}${d.email ? ` &lt;${esc(d.email)}&gt;` : ''}
            &nbsp;·&nbsp; ${esc(d.created_at || '')}
          </div>
          ${d.reference ? `<div class="meta">Ref: ${esc(d.reference)}</div>` : ''}
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No donations recorded yet.</p>';
}

/* ══════════════════════════════════════════════
   SETTINGS
   ══════════════════════════════════════════════ */
const SETTINGS_KEYS = [
  'youtube', 'facebook', 'instagram', 'pinterest',
  'phone', 'location', 'bio',
  'paypal_link', 'upi_id', 'donation_note'
];

async function loadSettings() {
  const s = await api('/api/settings').catch(() => ({}));
  SETTINGS_KEYS.forEach(k => {
    const el = $('s_' + k);
    if (el) el.value = s[k] || '';
  });
}

async function saveSettings() {
  const body = {};
  SETTINGS_KEYS.forEach(k => { const el = $('s_' + k); if (el) body[k] = el.value; });
  await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
  const msg = $('setMsg');
  if (msg) {
    msg.textContent = '✅ Settings saved! Changes are live on the site.';
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 3500);
  }
  toast('Settings saved ✓');
}

function downloadBackup() { window.location = API_BASE + '/api/admin/backup'; }

/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */
async function init() {
  await Promise.all([loadMessages(), loadGallery(), loadEvents(), loadPosts(), loadVideos(), loadPress()]);
  buildCharts();
  loadDonations();
  loadSettings();
}

init();
