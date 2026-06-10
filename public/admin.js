/* ══════════════════════════════════════════════
   Devi Murlika Gaur — Admin Panel
   Open admin (no login required)
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

/* ── Toast notification ──────────────────────── */
let _toastTimer;
function toast(msg, type = 'ok') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ── Tab switching ───────────────────────────── */
const TABS = ['dashboard', 'messages', 'events', 'posts', 'gallery', 'donations', 'settings'];

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

/* ── Shared data ─────────────────────────────── */
let allMessages = [], allGallery = [], allEvents = [], allPosts = [];

/* ── Charts ──────────────────────────────────── */
let chartBar, chartDough;

function buildCharts() {
  /* Bar: messages per day last 7 days */
  const labels = [], counts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
    const ds = d.toISOString().slice(0, 10);
    counts.push(allMessages.filter(m => (m.created_at || '').startsWith(ds)).length);
  }
  const ctx1 = $('chartMsgs');
  if (ctx1) {
    if (chartBar) chartBar.destroy();
    chartBar = new Chart(ctx1.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Messages',
          data: counts,
          backgroundColor: 'rgba(232,166,30,.75)',
          borderColor: '#c8860e',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }

  /* Doughnut: content breakdown */
  const ctx2 = $('chartOverview');
  if (ctx2) {
    if (chartDough) chartDough.destroy();
    chartDough = new Chart(ctx2.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Gallery', 'Events', 'Thoughts', 'Messages'],
        datasets: [{
          data: [allGallery.length, allEvents.length, allPosts.length, allMessages.length],
          backgroundColor: ['#e8a61e', '#7a1c3c', '#c8860e', '#a04020'],
          borderColor: '#fff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11 }, padding: 12 }
          }
        }
      }
    });
  }
}

/* ── Messages ────────────────────────────────── */
async function loadMessages() {
  allMessages = await api('/api/admin/messages').catch(() => []);
  const countEl = $('st-msg');
  if (countEl) countEl.textContent = allMessages.length;

  /* Dashboard recent (top 5) */
  const dash = $('dashMsgList');
  if (dash) {
    if (!allMessages.length) {
      dash.innerHTML = '<p style="color:var(--muted)">No messages yet.</p>';
    } else {
      dash.innerHTML = allMessages.slice(0, 5).map(m => `
        <div class="dash-msg">
          <div>
            <span class="dm-who">${esc(m.name)}</span>
            <span class="dm-time">&lt;${esc(m.email)}&gt; · ${esc(m.created_at || '')}</span>
          </div>
          <div class="dm-text">${esc((m.message || '').substring(0, 150))}${(m.message || '').length > 150 ? '…' : ''}</div>
        </div>`).join('');
    }
  }

  /* Messages tab full list */
  const list = $('msgList');
  if (list) {
    list.innerHTML = allMessages.length
      ? allMessages.map(m => `
        <div class="a-item">
          <div class="a-item-body">
            <h4>${esc(m.name)} <span class="meta">&lt;${esc(m.email)}&gt;</span></h4>
            <div class="meta">📞 ${esc(m.phone) || '–'} &nbsp;·&nbsp; 🕒 ${esc(m.created_at || '')}</div>
            <p style="font-size:14px;margin:6px 0 0;line-height:1.6">${esc(m.message)}</p>
            <div class="a-item-actions">
              <button class="btn-del" onclick="delMsg(${m.id})">🗑 Delete</button>
            </div>
          </div>
        </div>`).join('')
      : '<p style="color:var(--muted)">No messages yet.</p>';
  }
}

async function delMsg(id) {
  if (!confirm('Delete this message?')) return;
  await api('/api/admin/messages/' + id, { method: 'DELETE' });
  toast('Message deleted', 'ok');
  await loadMessages();
  buildCharts();
}

/* ── Events ──────────────────────────────────── */
async function loadEvents() {
  allEvents = await api('/api/events').catch(() => []);
  const countEl = $('st-ev');
  if (countEl) countEl.textContent = allEvents.length;

  const list = $('evList');
  if (!list) return;
  list.innerHTML = allEvents.length
    ? allEvents.map(e => `
      <div class="a-item">
        <div class="a-item-body">
          <h4>📅 ${esc(e.day)} ${esc(e.month)} — ${esc(e.title)}</h4>
          ${e.description ? `<div class="meta">${esc(e.description)}</div>` : ''}
          ${e.link ? `<div class="meta">🔗 <a href="${esc(e.link)}" target="_blank">${esc(e.link)}</a></div>` : ''}
          <div class="meta" style="margin-top:2px">Sort: ${e.sort_order || 0}</div>
          <div class="a-item-actions">
            <button class="btn-edit" onclick='fillEvent(${safeJson(e)})'>✏️ Edit</button>
            <button class="btn-del" onclick="delEvent(${e.id})">🗑 Delete</button>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No events yet. Add one above.</p>';
}

function fillEvent(e) {
  $('evId').value = e.id;
  $('evDay').value = e.day;
  $('evMonth').value = e.month;
  $('evTitle').value = e.title;
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
  const body = JSON.stringify({
    day: $('evDay').value,
    month: $('evMonth').value,
    title: $('evTitle').value,
    description: $('evDesc').value,
    link: $('evLink').value,
    sort_order: Number($('evSort').value) || 0
  });
  await api('/api/admin/events' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
  toast(id ? 'Event updated ✓' : 'Event added ✓');
  clearEvent();
  await loadEvents();
  buildCharts();
}

async function delEvent(id) {
  if (!confirm('Delete this event?')) return;
  await api('/api/admin/events/' + id, { method: 'DELETE' });
  toast('Event deleted', 'ok');
  await loadEvents();
  buildCharts();
}

/* ── Posts / Thoughts ────────────────────────── */
async function loadPosts() {
  allPosts = await api('/api/posts').catch(() => []);
  const countEl = $('st-po');
  if (countEl) countEl.textContent = allPosts.length;

  const list = $('poList');
  if (!list) return;
  list.innerHTML = allPosts.length
    ? allPosts.map(p => `
      <div class="a-item">
        ${p.image ? `<img src="${esc(p.image)}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;flex-shrink:0" loading="lazy" />` : ''}
        <div class="a-item-body">
          <h4>${esc(p.title)}</h4>
          <div class="meta">${esc(p.date_label || '')}</div>
          <p style="font-size:13px;color:var(--muted);margin:4px 0 0;line-height:1.5">
            ${esc((p.body || '').substring(0, 130))}${(p.body || '').length > 130 ? '…' : ''}
          </p>
          <div class="a-item-actions">
            <button class="btn-edit" onclick='fillPost(${safeJson(p)})'>✏️ Edit</button>
            <button class="btn-del" onclick="delPost(${p.id})">🗑 Delete</button>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No thoughts yet. Add one above.</p>';
}

function fillPost(p) {
  $('poId').value = p.id;
  $('poTitle').value = p.title;
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
  const body = JSON.stringify({
    title: $('poTitle').value,
    body: $('poBody').value,
    image: $('poImg').value,
    date_label: $('poDate').value
  });
  await api('/api/admin/posts' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
  toast(id ? 'Post updated ✓' : 'Post added ✓');
  clearPost();
  await loadPosts();
  buildCharts();
}

async function delPost(id) {
  if (!confirm('Delete this post?')) return;
  await api('/api/admin/posts/' + id, { method: 'DELETE' });
  toast('Post deleted', 'ok');
  await loadPosts();
  buildCharts();
}

/* ── Gallery ─────────────────────────────────── */
async function loadGallery() {
  allGallery = await api('/api/gallery').catch(() => []);
  const countEl = $('st-gal');
  if (countEl) countEl.textContent = allGallery.length;
  const gCount = $('gCount');
  if (gCount) gCount.textContent = allGallery.length;

  const grid = $('gGrid');
  if (!grid) return;
  if (!allGallery.length) {
    grid.innerHTML = '<p style="color:var(--muted)">No images yet. Upload one above.</p>';
    return;
  }
  grid.innerHTML = allGallery.map(g => `
    <div class="g-cell">
      <img src="${esc(g.image)}" alt="${esc(g.caption || '')}" loading="lazy" />
      ${g.caption ? `<div class="g-cap">${esc(g.caption)}</div>` : ''}
      <div class="g-overlay">
        <button class="btn-edit" style="width:84px" onclick='fillGallery(${safeJson(g)})'>✏️ Edit</button>
        <button class="btn-del" style="width:84px" onclick="delGallery(${g.id})">🗑 Delete</button>
      </div>
    </div>`).join('');
}

function fillGallery(g) {
  $('gId').value = g.id;
  $('gImg').value = g.image;
  $('gCap').value = g.caption || '';
  $('gSort').value = g.sort_order || 0;
  switchTab('gallery');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearGallery() {
  ['gId', 'gImg', 'gCap'].forEach(i => $(i).value = '');
  $('gSort').value = 0;
  $('gUpMsg').textContent = '';
}

async function saveGallery() {
  const id = $('gId').value;
  if (!$('gImg').value.trim()) { toast('Image URL required', 'err'); return; }
  const body = JSON.stringify({
    image: $('gImg').value,
    caption: $('gCap').value,
    sort_order: Number($('gSort').value) || 0
  });
  await api('/api/admin/gallery' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
  toast(id ? 'Image updated ✓' : 'Image added ✓');
  clearGallery();
  await loadGallery();
  buildCharts();
}

async function delGallery(id) {
  if (!confirm('Delete this image?')) return;
  await api('/api/admin/gallery/' + id, { method: 'DELETE' });
  toast('Image deleted', 'ok');
  await loadGallery();
  buildCharts();
}

/* File upload from device */
$('gFile').addEventListener('change', async function () {
  const file = this.files[0];
  if (!file) return;
  const statusEl = $('gUpMsg');
  statusEl.textContent = '⏳ Uploading…';
  const fd = new FormData();
  fd.append('image', file);
  try {
    const res = await fetch(API_BASE + '/api/admin/upload', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'fetch' },
      body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    $('gImg').value = data.url;
    statusEl.textContent = '✅ Uploaded! Add a caption below then click "Add / Update Image"';
    toast('Photo uploaded!');
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    toast(e.message, 'err');
  }
  this.value = ''; // reset so same file can be re-selected
});

/* ── Donations ───────────────────────────────── */
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

/* ── Settings ────────────────────────────────── */
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
  SETTINGS_KEYS.forEach(k => {
    const el = $('s_' + k);
    if (el) body[k] = el.value;
  });
  await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
  const msg = $('setMsg');
  if (msg) {
    msg.textContent = '✅ Settings saved! Changes are live on the site.';
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 3500);
  }
  toast('Settings saved ✓');
}

/* ── Misc ────────────────────────────────────── */
function downloadBackup() {
  window.location = API_BASE + '/api/admin/backup';
}

/* Safely serialize for inline onclick */
function safeJson(obj) {
  return JSON.stringify(obj).replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

/* ── Initialise ──────────────────────────────── */
async function init() {
  await Promise.all([
    loadMessages(),
    loadGallery(),
    loadEvents(),
    loadPosts()
  ]);
  buildCharts();
  loadDonations();
  loadSettings();
}

init();
