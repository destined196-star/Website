/* ══════════════════════════════════════════════
   Devi Murlika Gaur — Admin Panel
   ══════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const API_BASE = location.protocol === 'file:' ? 'http://localhost:3000' : '';

// Format UTC DB timestamp → IST (India Standard Time, UTC+5:30)
function fmtIST(utcStr) {
  if (!utcStr) return '';
  // SQLite stores as "YYYY-MM-DD HH:MM:SS" without Z — treat as UTC
  const d = new Date(utcStr.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

async function api(url, opts = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (!(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(API_BASE + url, {
    credentials: 'include',
    headers,
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
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

/* ── Undo delete system ──────────────────────── */
let _undo = null; // { timerId, countId }

function delWithUndo(label, sub, executeFn) {
  // Commit any already-pending delete before starting new one
  if (_undo) {
    clearTimeout(_undo.timerId);
    clearInterval(_undo.countId);
    hideUndoBar();
    _undo.executeFn();
    _undo = null;
  }

  let secs = 5;
  const bar = $('undoBar');
  const msg = $('undoMsg');
  const subEl = $('undoSub');
  const secsEl = $('undoSecs');

  if (msg) msg.textContent = label;
  if (subEl) subEl.textContent = sub || '';
  if (secsEl) secsEl.textContent = secs;

  // Reset + restart animation by forcing reflow
  if (bar) {
    bar.classList.remove('show');
    void bar.offsetWidth; // reflow
    bar.classList.add('show');
  }

  const countId = setInterval(() => {
    secs--;
    if (secsEl) secsEl.textContent = Math.max(0, secs);
    if (secs <= 0) clearInterval(countId);
  }, 1000);

  const timerId = setTimeout(async () => {
    clearInterval(countId);
    hideUndoBar();
    _undo = null;
    await executeFn();
  }, 5000);

  _undo = { timerId, countId, executeFn };
}

function hideUndoBar() {
  const bar = $('undoBar');
  if (bar) bar.classList.remove('show');
}

// Wire undo button
const _undoBtnEl = $('undoBtn');
if (_undoBtnEl) {
  _undoBtnEl.addEventListener('click', () => {
    if (!_undo) return;
    clearTimeout(_undo.timerId);
    clearInterval(_undo.countId);
    hideUndoBar();
    _undo = null;
    toast('Deletion cancelled ✓', 'info');
  });
}

/* ── Tabs ────────────────────────────────────── */
const TABS = ['events', 'posts', 'gallery', 'videos', 'press', 'messages', 'donations', 'settings'];

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

/* ── Form show/hide helpers ──────────────────── */
function toggleForm(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  if (el.style.display === 'block') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showForm(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelForm(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
}

/* ── Data stores ─────────────────────────────── */
let msgs = [], msgMap = {};
let evts = [], evtMap = {};
let posts = [], postMap = {};
let gallery = [], galMap = {};
let videos = [], videoMap = {};
let pressArr = [], pressMap = {};

/* ── Charts ──────────────────────────────────── */
let _chartBar;

function buildCharts() {
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
        datasets: [{ label: 'Messages', data: counts,
          backgroundColor: 'rgba(232,166,30,.8)', borderColor: '#c8860e',
          borderWidth: 1, borderRadius: 4 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }
}

function updateCounts() {
  // Update badge counts in tab headers where present
}

/* ══════════════════════════════════════════════
   MESSAGES
   ══════════════════════════════════════════════ */
async function loadMessages() {
  msgs = await api('/api/admin/messages').catch(() => []);
  msgMap = Object.fromEntries(msgs.map(m => [m.id, m]));
  updateCounts();

  // Update count in tab header
  const stMsg = $('st-msg');
  if (stMsg) stMsg.textContent = msgs.length ? `(${msgs.length})` : '';

  const list = $('msgList');
  if (!list) return;
  list.innerHTML = msgs.length
    ? msgs.map(m => `
      <div class="msg-card">
        <div class="mc-who">${esc(m.name)} <span style="font-weight:400;color:var(--muted)">&lt;${esc(m.email)}&gt;</span></div>
        <div class="mc-meta">📞 ${esc(m.phone) || '–'} &nbsp;·&nbsp; 🕒 ${fmtIST(m.created_at)}</div>
        <div class="mc-body">${esc(m.message)}</div>
        <div class="admin-item-bar">
          <button class="btn-del msg-del" data-id="${m.id}">🗑 Delete</button>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No messages yet.</p>';

  list.querySelectorAll('.msg-del').forEach(btn =>
    btn.addEventListener('click', () => delMsg(Number(btn.dataset.id)))
  );
}

async function delMsg(id) {
  const item = msgMap[id];
  delWithUndo('💬 Message deleted', item ? `From: ${item.name}` : '', async () => {
    try {
      await api('/api/admin/messages/' + id, { method: 'DELETE' });
      await loadMessages();
      buildCharts();
    } catch (e) { toast(e.message, 'err'); }
  });
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

  if (!evts.length) {
    list.innerHTML = '<p style="color:var(--muted)">No events yet. Click "+ Add New Event" above to create one.</p>';
    return;
  }

  list.innerHTML = evts.map(e => `
    <div style="background:#fff;border-radius:8px;border:1px solid var(--line);margin-bottom:12px;
      box-shadow:0 2px 8px rgba(0,0,0,.04);display:grid;grid-template-columns:90px 1fr;
      gap:20px;padding:20px;align-items:start">
      <div class="event-date">
        <div class="day">${esc(e.day || '–')}</div>
        <div class="month">${esc(e.month || '')}</div>
      </div>
      <div>
        <h4 style="color:var(--maroon);margin-bottom:4px">${esc(e.title)}</h4>
        ${e.description ? `<p style="color:var(--muted);font-size:14px;margin:0 0 4px">${esc(e.description)}</p>` : ''}
        ${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--saffron-dark);font-size:13px">🔗 View event</a>` : ''}
        <div class="admin-item-bar">
          <button class="btn-edit ev-edit" data-id="${e.id}">✏️ Edit</button>
          <button class="btn-del ev-del" data-id="${e.id}">🗑 Delete</button>
        </div>
      </div>
    </div>`).join('');

  list.querySelectorAll('.ev-edit').forEach(btn =>
    btn.addEventListener('click', () => fillEvent(evtMap[btn.dataset.id]))
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
  showForm('evForm');
  switchTab('events');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearEvent() {
  ['evId', 'evDay', 'evMonth', 'evTitle', 'evDesc', 'evLink'].forEach(i => {
    const el = $(i); if (el) el.value = '';
  });
  const s = $('evSort'); if (s) s.value = 0;
  const t = $('evFormTitle'); if (t) t.textContent = 'Add New Event';
}

async function saveEvent() {
  if (!$('evTitle').value.trim()) { toast('Title is required', 'err'); return; }
  const id = $('evId').value;
  try {
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
    cancelForm('evForm');
    await loadEvents();
    buildCharts();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function delEvent(id) {
  const item = evtMap[id];
  delWithUndo('📅 Event deleted', item ? `${item.day || ''} ${item.month || ''} — ${item.title}` : '', async () => {
    try {
      await api('/api/admin/events/' + id, { method: 'DELETE' });
      await loadEvents();
      buildCharts();
    } catch (e) { toast(e.message, 'err'); }
  });
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

  if (!posts.length) {
    list.innerHTML = '<p style="color:var(--muted);grid-column:1/-1">No thoughts yet. Click "+ Add New Post" to create one.</p>';
    return;
  }

  list.innerHTML = posts.map(p => `
    <div class="admin-blog-card">
      ${p.image
        ? `<img class="blog-img" src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" data-img-err="hide" />`
        : `<div class="blog-img-ph">🙏</div>`}
      <div class="blog-body">
        <div class="blog-date">${esc(p.date_label || '')}</div>
        <h4>${esc(p.title)}</h4>
        <p>${esc((p.body || '').substring(0, 130))}${(p.body || '').length > 130 ? '…' : ''}</p>
      </div>
      <div class="admin-item-bar">
        <button class="btn-edit po-edit" data-id="${p.id}">✏️ Edit</button>
        <button class="btn-del po-del" data-id="${p.id}">🗑 Delete</button>
      </div>
    </div>`).join('');

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
  // Show existing image preview
  const prev = $('poImgPreview');
  if (prev && p.image) { prev.src = p.image; prev.style.display = 'block'; }
  const lbl = $('poUploadLabel'); if (lbl && p.image) lbl.textContent = '📎 Click to change image';
  $('poFormTitle').textContent = 'Edit Thought';
  showForm('poForm');
  switchTab('posts');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function previewPoImg(input) {
  const file = input.files[0];
  if (!file) return;
  $('poUploadLabel').textContent = '📎 ' + file.name;
  const prev = $('poImgPreview');
  prev.src = URL.createObjectURL(file);
  prev.style.display = 'block';
  $('poImg').value = ''; // clear URL field — file takes priority
}

function clearPost() {
  ['poId', 'poTitle', 'poBody', 'poImg', 'poDate'].forEach(i => {
    const el = $(i); if (el) el.value = '';
  });
  const fileEl = $('poFile'); if (fileEl) fileEl.value = '';
  const prev = $('poImgPreview'); if (prev) { prev.src = ''; prev.style.display = 'none'; }
  const lbl = $('poUploadLabel'); if (lbl) lbl.textContent = '📎 Click to upload image';
  const t = $('poFormTitle'); if (t) t.textContent = 'Add New Thought';
}

async function savePost() {
  if (!$('poTitle').value.trim()) { toast('Title is required', 'err'); return; }
  const id = $('poId').value;
  try {
    // Upload file if selected, otherwise fall back to typed URL
    let imageUrl = $('poImg').value.trim();
    const fileEl = $('poFile');
    if (fileEl && fileEl.files[0]) {
      const fd = new FormData();
      fd.append('image', fileEl.files[0]);
      const r = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'X-Requested-With': 'fetch' },
        credentials: 'include',
        body: fd
      });
      if (!r.ok) throw new Error('Image upload failed');
      const data = await r.json();
      imageUrl = data.url;
    }
    await api('/api/admin/posts' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        title: $('poTitle').value, body: $('poBody').value,
        image: imageUrl, date_label: $('poDate').value
      })
    });
    toast(id ? 'Post updated ✓' : 'Post added ✓');
    clearPost();
    cancelForm('poForm');
    await loadPosts();
    buildCharts();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function delPost(id) {
  const item = postMap[id];
  delWithUndo('✍️ Post deleted', item ? item.title : '', async () => {
    try {
      await api('/api/admin/posts/' + id, { method: 'DELETE' });
      await loadPosts();
      buildCharts();
    } catch (e) { toast(e.message, 'err'); }
  });
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
    grid.innerHTML = '<p style="color:var(--muted)">No images yet. Click "+ Add / Upload Photo" above.</p>';
    return;
  }

  grid.innerHTML = gallery.map(g => `
    <div class="g-cell">
      <img src="${esc(g.image)}" alt="${esc(g.caption || '')}" loading="lazy"
           data-img-err="fade" />
      <div class="g-order-badge" title="Display order — click to change" data-id="${g.id}">
        <input type="number" class="g-order-input" data-id="${g.id}"
          value="${g.sort_order || 0}" min="0" max="9999"
          title="Set display order (lower = shown first)" />
      </div>
      ${g.caption ? `<div class="g-cap">${esc(g.caption)}</div>` : ''}
      <div class="g-overlay">
        <button class="btn-edit g-edit" data-id="${g.id}">✏️ Edit</button>
        <button class="btn-del g-del" data-id="${g.id}">🗑 Delete</button>
      </div>
    </div>`).join('');

  // Inline sort-order save on blur / Enter
  grid.querySelectorAll('.g-order-input').forEach(input => {
    const save = async () => {
      const id = input.dataset.id;
      const val = Number(input.value) || 0;
      const g = galMap[id];
      if (!g || val === (g.sort_order || 0)) return;
      try {
        await api('/api/admin/gallery/' + id, {
          method: 'PUT',
          body: JSON.stringify({ image: g.image, caption: g.caption || '', sort_order: val })
        });
        toast('Order updated ✓');
        await loadGallery();
      } catch (e) { toast('Save failed', 'err'); }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    input.addEventListener('click', e => e.stopPropagation());
  });

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
  // Populate the visible edit form fields
  const capEl = $('gEditCap'); if (capEl) capEl.value = g.caption || '';
  const sortEl = $('gEditSort'); if (sortEl) sortEl.value = g.sort_order || 0;
  const prevEl = $('gEditPreview');
  if (prevEl) { prevEl.src = g.image || ''; prevEl.style.display = g.image ? 'block' : 'none'; }
  showForm('galEditForm');
  switchTab('gallery');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearGallery() {
  ['gId', 'gImg', 'gCap'].forEach(i => { const el = $(i); if (el) el.value = ''; });
  const gs = $('gSort'); if (gs) gs.value = 0;
  const gm = $('gUpMsg'); if (gm) gm.textContent = '';
  const gf = $('gFile'); if (gf) gf.value = '';
  // Also clear edit form
  const ec = $('gEditCap'); if (ec) ec.value = '';
  const eso = $('gEditSort'); if (eso) eso.value = 0;
  const ep = $('gEditPreview'); if (ep) { ep.src = ''; ep.style.display = 'none'; }
  cancelForm('galEditForm');
}

async function saveGallery() {
  if (!$('gImg').value.trim()) { toast('Upload a photo first or paste an image URL', 'err'); return; }
  const id = $('gId').value;
  // When editing (id set), read caption/sort from visible edit form fields
  const caption = id ? (($('gEditCap') || {}).value || '') : (($('gCap') || {}).value || '');
  const sort_order = id ? Number(($('gEditSort') || {}).value) || 0 : Number(($('gSort') || {}).value) || 0;
  try {
    await api('/api/admin/gallery' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        image: $('gImg').value,
        caption,
        sort_order
      })
    });
    toast(id ? 'Image updated ✓' : 'Image added ✓');
    clearGallery();
    cancelForm('galUpload');
    cancelForm('galEditForm');
    await loadGallery();
    buildCharts();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function delGallery(id) {
  const item = galMap[id];
  delWithUndo('🖼️ Image deleted', item ? (item.caption || item.image?.split('/').pop() || '') : '', async () => {
    try {
      await api('/api/admin/gallery/' + id, { method: 'DELETE' });
      await loadGallery();
      buildCharts();
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ── Bulk Gallery Upload ── */
let bulkFiles = [];
const gBulkEl = $('gBulkFiles');
if (gBulkEl) {
  gBulkEl.addEventListener('change', function () {
    bulkFiles = Array.from(this.files).slice(0, 8);
    const preview = $('bulkPreview');
    const thumbGrid = $('bulkThumbGrid');
    const countEl = $('bulkCount');
    if (!bulkFiles.length) { if (preview) preview.style.display = 'none'; return; }
    if (preview) preview.style.display = '';
    if (countEl) countEl.textContent = bulkFiles.length + ' image' + (bulkFiles.length > 1 ? 's' : '') + ' selected';
    if (thumbGrid) {
      thumbGrid.innerHTML = '';
      bulkFiles.forEach((f, i) => {
        const url = URL.createObjectURL(f);
        thumbGrid.innerHTML += `<div style="position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;border:1px solid var(--line)">
          <img src="${url}" style="width:100%;height:100%;object-fit:cover" />
          <span style="position:absolute;top:2px;left:4px;font-size:10px;background:rgba(0,0,0,.6);color:#fff;padding:1px 5px;border-radius:3px">${i + 1}</span>
        </div>`;
      });
    }
  });
}

function clearBulkUpload() {
  bulkFiles = [];
  const bf = $('gBulkFiles'); if (bf) bf.value = '';
  const bp = $('bulkPreview'); if (bp) bp.style.display = 'none';
  const bg = $('bulkThumbGrid'); if (bg) bg.innerHTML = '';
  const pr = $('bulkProgress'); if (pr) pr.style.display = 'none';
}

async function autoNumberGallery() {
  if (!gallery.length) return;
  try {
    for (let i = 0; i < gallery.length; i++) {
      const g = gallery[i];
      await api('/api/admin/gallery/' + g.id, {
        method: 'PUT',
        body: JSON.stringify({ image: g.image, caption: g.caption || '', sort_order: i + 1 })
      });
    }
    toast('Auto-numbered ✓');
    await loadGallery();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function doBulkUpload() {
  if (!bulkFiles.length) { toast('Select images first', 'err'); return; }
  const caption = ($('gBulkCaption') || {}).value || '';
  // Start sort_order after current max
  const maxOrder = gallery.reduce((m, g) => Math.max(m, g.sort_order || 0), 0);
  let nextOrder = maxOrder + 1;
  const progressEl = $('bulkProgress');
  const barEl = $('bulkBar');
  const statusEl = $('bulkStatus');
  const btn = $('bulkUploadBtn');
  if (progressEl) progressEl.style.display = '';
  if (btn) btn.disabled = true;

  let uploaded = 0;
  let failed = 0;
  let lastErr = '';
  const total = bulkFiles.length;

  function updateProgress() {
    const pct = Math.round(((uploaded + failed) / total) * 100);
    if (barEl) barEl.style.width = pct + '%';
    if (statusEl) statusEl.textContent = `Uploaded ${uploaded}/${total}` + (failed ? ` (${failed} failed)` : '') + '…';
  }

  // Upload in batches of 5 for speed
  for (let i = 0; i < total; i += 5) {
    const batch = bulkFiles.slice(i, i + 5);
    await Promise.all(batch.map(async (file) => {
      const fd = new FormData();
      fd.append('image', file);
      try {
        const res = await fetch(API_BASE + '/api/admin/upload', {
          method: 'POST', credentials: 'include',
          headers: { 'X-Requested-With': 'fetch' }, body: fd
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        // Save to gallery DB
        await api('/api/admin/gallery', {
          method: 'POST',
          body: JSON.stringify({ image: data.url, caption, sort_order: nextOrder++ })
        });
        uploaded++;
      } catch (e) {
        failed++;
        lastErr = e.message;
        console.error('Bulk upload error:', file.name, e.message);
      }
      updateProgress();
    }));
  }

  if (btn) btn.disabled = false;
  if (statusEl) statusEl.textContent = `Done! ${uploaded} uploaded` + (failed ? `, ${failed} failed` : '');
  if (uploaded > 0) {
    toast(`${uploaded} image${uploaded !== 1 ? 's' : ''} added to gallery` + (failed ? ` (${failed} failed)` : '') + ' ✓');
  } else {
    toast(`All ${failed} upload${failed !== 1 ? 's' : ''} failed: ${lastErr || 'unknown error'}`, 'err');
  }
  if (failed > 0 && uploaded > 0) toast(`${failed} failed: ${lastErr}`, 'err');

  await loadGallery();
  buildCharts();

  // Auto-clear after 2s
  setTimeout(() => {
    clearBulkUpload();
    cancelForm('galUpload');
  }, 2000);
}

// Single file upload from device
const gFileEl = $('gFile');
if (gFileEl) {
  gFileEl.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    const statusEl = $('gUpMsg');
    if (statusEl) statusEl.textContent = '⏳ Uploading…';
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch(API_BASE + '/api/admin/upload', {
        method: 'POST', credentials: 'include',
        headers: { 'X-Requested-With': 'fetch' }, body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const gi = $('gImg'); if (gi) gi.value = data.url;
      if (statusEl) statusEl.textContent = '✅ Uploaded! Add a caption then click "Save Image"';
      toast('Photo uploaded!');
    } catch (e) {
      if (statusEl) statusEl.textContent = '❌ ' + e.message;
      toast(e.message, 'err');
    }
    this.value = '';
  });
}

/* ══════════════════════════════════════════════
   VIDEOS
   ══════════════════════════════════════════════ */
async function loadVideos() {
  videos = await api('/api/videos').catch(() => []);
  videoMap = Object.fromEntries(videos.map(v => [v.id, v]));

  const list = $('vidList');
  if (!list) return;

  if (!videos.length) {
    list.innerHTML = '<p style="color:var(--muted);grid-column:1/-1">No videos yet. Click "+ Add New Video" above.</p>';
    return;
  }

  list.innerHTML = videos.map(v => {
    const vid = (v.youtube_url || '').match(/[?&]v=([^&]+)/)?.[1]
      || (v.youtube_url || '').match(/youtu\.be\/([^?]+)/)?.[1] || '';
    const thumb = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '';
    return `
    <div class="admin-video-card">
      ${thumb
        ? `<img class="vc-thumb" src="${esc(thumb)}" alt="${esc(v.title)}" loading="lazy" data-img-err="hide" />`
        : `<div style="aspect-ratio:16/9;background:var(--maroon);display:flex;align-items:center;justify-content:center;font-size:36px">▶️</div>`}
      <div class="vc-body">
        <h4>${esc(v.title)}${v.featured ? '<span class="featured-badge">Featured</span>' : ''}</h4>
        ${v.description ? `<div class="meta" style="margin-bottom:4px">${esc(v.description)}</div>` : ''}
        <div class="meta"><a href="${esc(v.youtube_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--saffron-dark)">Watch on YouTube ↗</a></div>
      </div>
      <div class="admin-item-bar">
        <button class="btn-edit vid-edit" data-id="${v.id}">✏️ Edit</button>
        <button class="btn-del vid-del" data-id="${v.id}">🗑 Delete</button>
      </div>
    </div>`;
  }).join('');

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
  showForm('vidForm');
  switchTab('videos');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearVideo() {
  ['vidId', 'vidTitle', 'vidUrl', 'vidDesc'].forEach(i => { const el = $(i); if (el) el.value = ''; });
  const vs = $('vidSort'); if (vs) vs.value = 0;
  const vf = $('vidFeatured'); if (vf) vf.value = '0';
  const vt = $('vidFormTitle'); if (vt) vt.textContent = 'Add New Video';
}

async function saveVideo() {
  if (!$('vidTitle').value.trim()) { toast('Title required', 'err'); return; }
  if (!$('vidUrl').value.trim()) { toast('YouTube URL required', 'err'); return; }
  const id = $('vidId').value;
  try {
    await api('/api/admin/videos' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        title: $('vidTitle').value,
        youtube_url: $('vidUrl').value,
        description: $('vidDesc').value,
        featured: $('vidFeatured').value,
        sort_order: Number($('vidSort').value) || 0
      })
    });
    toast(id ? 'Video updated ✓' : 'Video added ✓');
    clearVideo();
    cancelForm('vidForm');
    await loadVideos();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function delVideo(id) {
  const item = videoMap[id];
  delWithUndo('🎬 Video deleted', item ? item.title : '', async () => {
    try {
      await api('/api/admin/videos/' + id, { method: 'DELETE' });
      await loadVideos();
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ══════════════════════════════════════════════
   PLAYLISTS (under Videos tab)
   ══════════════════════════════════════════════ */
async function loadPlaylists() {
  const pls = await api('/api/playlists').catch(() => []);
  const el = $('plList');
  if (!el) return;
  if (!pls.length) {
    el.innerHTML = '<p style="color:var(--muted)">No playlists yet.</p>';
    return;
  }
  el.innerHTML = pls.map(p => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line)">
      <div style="flex:1">
        <strong>${esc(p.name)}</strong>
        <span style="color:var(--muted);font-size:13px;margin-left:8px">${esc(String(p.video_count))} videos</span>
        ${p.description ? `<br><small style="color:var(--muted)">${esc(p.description)}</small>` : ''}
      </div>
      <button class="btn-del pl-del" style="font-size:12px" data-pl-id="${esc(String(p.id))}" data-pl-name="${esc(p.name)}">🗑</button>
    </div>
  `).join('');
  el.querySelectorAll('.pl-del').forEach(btn =>
    btn.addEventListener('click', () => delPlaylist(Number(btn.dataset.plId), btn.dataset.plName))
  );
}

async function delPlaylist(id, name) {
  delWithUndo('📁 Playlist deleted', name, async () => {
    try {
      await api('/api/admin/playlists/' + id, { method: 'DELETE' });
      await loadPlaylists();
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ══════════════════════════════════════════════
   PRESS ARTICLES
   ══════════════════════════════════════════════ */
async function loadPress() {
  pressArr = await api('/api/press').catch(() => []);
  pressMap = Object.fromEntries(pressArr.map(p => [p.id, p]));

  const list = $('pressList');
  if (!list) return;

  if (!pressArr.length) {
    list.innerHTML = '<p style="color:var(--muted)">No press articles yet. Click "+ Add Press Article" above.</p>';
    return;
  }

  list.innerHTML = pressArr.map(p => `
    <div class="admin-press-item">
      <div class="pi-head">
        ${p.image
          ? `<img class="pi-img" src="${esc(p.image)}" alt="" loading="lazy" data-img-err="hide" />`
          : `<div class="pi-img-ph">📰</div>`}
        <div class="pi-info">
          <h4>${esc(p.title)}</h4>
          <div class="pi-meta">📰 ${esc(p.publication || '–')} &nbsp;·&nbsp; ${esc(p.date_label || '')}</div>
          ${p.content ? `<button style="background:none;border:none;color:var(--saffron-dark);font-size:12px;cursor:pointer;padding:4px 0;font-weight:600" class="pi-toggle">▼ Show content</button>` : ''}
        </div>
      </div>
      ${p.content ? `<div class="pi-body">${esc(p.content)}</div>` : ''}
      <div class="admin-item-bar">
        <button class="btn-edit pr-edit" data-id="${p.id}">✏️ Edit</button>
        <button class="btn-del pr-del" data-id="${p.id}">🗑 Delete</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.pi-toggle').forEach(btn =>
    btn.addEventListener('click', () => {
      const body = btn.closest('.admin-press-item').querySelector('.pi-body');
      if (!body) return;
      body.classList.toggle('open');
      btn.textContent = body.classList.contains('open') ? '▲ Hide content' : '▼ Show content';
    })
  );
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
  showForm('pressForm');
  switchTab('press');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearPress() {
  ['pressId', 'pressTitle', 'pressPub', 'pressDate', 'pressContent', 'pressImg'].forEach(i => {
    const el = $(i); if (el) el.value = '';
  });
  const ps = $('pressSort'); if (ps) ps.value = 0;
  const pt = $('pressFormTitle'); if (pt) pt.textContent = 'Add Press Article';
}

async function savePress() {
  if (!$('pressTitle').value.trim()) { toast('Title required', 'err'); return; }
  const id = $('pressId').value;
  try {
    await api('/api/admin/press' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        title: $('pressTitle').value,
        publication: $('pressPub').value,
        date_label: $('pressDate').value,
        content: $('pressContent').value,
        image: $('pressImg').value,
        sort_order: Number($('pressSort').value) || 0
      })
    });
    toast(id ? 'Article updated ✓' : 'Article added ✓');
    clearPress();
    cancelForm('pressForm');
    await loadPress();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function delPress(id) {
  const item = pressMap[id];
  delWithUndo('📰 Article deleted', item ? item.title : '', async () => {
    try {
      await api('/api/admin/press/' + id, { method: 'DELETE' });
      await loadPress();
    } catch (e) { toast(e.message, 'err'); }
  });
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
      <div class="msg-card" style="border-left-color:var(--gold)">
        <div class="mc-who">₹${esc(String(d.amount))} <span style="font-weight:400;color:var(--muted)">via ${esc(d.method || '–')}</span></div>
        <div class="mc-meta">
          ${esc(d.name) || 'Anonymous'}${d.email ? ` &lt;${esc(d.email)}&gt;` : ''}
          &nbsp;·&nbsp; ${fmtIST(d.created_at)}
        </div>
        ${d.reference ? `<div class="mc-body">Ref: ${esc(d.reference)}</div>` : ''}
        <div class="admin-item-bar">
          <button class="btn-del don-del" data-id="${d.id}">🗑 Delete</button>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted)">No donations recorded yet.</p>';

  el.querySelectorAll('.don-del').forEach(btn =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this donation record?')) return;
      try {
        await api('/api/admin/donations/' + btn.dataset.id, { method: 'DELETE' });
        await loadDonations();
        toast('Donation record deleted');
      } catch (e) { toast(e.message, 'err'); }
    })
  );
}

async function saveDonation() {
  const name = ($('don_name') || {}).value || '';
  const email = ($('don_email') || {}).value || '';
  const amount = ($('don_amount') || {}).value || '';
  const method = ($('don_method') || {}).value || 'cash';
  const reference = ($('don_reference') || {}).value || '';
  if (!amount || Number(amount) <= 0) { toast('Enter a valid amount', 'err'); return; }
  try {
    await api('/api/admin/donations', { method: 'POST', body: JSON.stringify({ name, email, amount: Number(amount), method, reference }) });
    cancelForm('donForm');
    // Clear fields
    ['don_name','don_email','don_amount','don_reference'].forEach(id => { const el=$(id); if(el) el.value=''; });
    await loadDonations();
    toast('Donation recorded ✓');
  } catch (e) { toast(e.message, 'err'); }
}

/* ══════════════════════════════════════════════
   SETTINGS
   ══════════════════════════════════════════════ */
const SETTINGS_KEYS = [
  'youtube', 'facebook', 'instagram', 'pinterest',
  'phone', 'location', 'bio',
  'paypal_link', 'upi_id', 'upi_name', 'donation_note',
  'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_branch',
  'razorpay_link', 'gpay_number', 'phonepe_number', 'paytm_number', 'other_payment'
];

async function loadSettings() {
  const s = await api('/api/admin/settings').catch(() => ({}));
  SETTINGS_KEYS.forEach(k => {
    const el = $('s_' + k);
    if (el) el.value = s[k] || '';
  });
  // Load admin email into account panel
  const acc = await api('/api/admin/account').catch(() => ({}));
  const emailEl = $('adminEmail');
  if (emailEl && acc.email) emailEl.value = acc.email;
}

async function saveSettings() {
  const body = {};
  SETTINGS_KEYS.forEach(k => { const el = $('s_' + k); if (el) body[k] = el.value; });
  try {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
    const msg = $('setMsg');
    if (msg) {
      msg.textContent = '✅ Settings saved! Changes are now live on the site.';
      msg.style.display = 'block';
      setTimeout(() => { msg.style.display = 'none'; }, 3500);
    }
    toast('Settings saved ✓');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

function downloadBackup() { window.location = API_BASE + '/api/admin/backup'; }

function _pwStatus(elId, msg, ok) {
  var el = $(elId); if (!el) return;
  el.textContent = msg; el.style.display = 'block';
  el.style.background = ok ? '#e3f3df' : '#fdecea';
  el.style.color      = ok ? '#3a7a2a' : '#b0120a';
}

async function saveAdminEmail() {
  var email = ($('adminEmail') || {}).value || '';
  try {
    await api('/api/admin/email', { method: 'PUT', body: JSON.stringify({ email }) });
    _pwStatus('emailMsg', '✅ Email saved.', true);
  } catch (e) {
    _pwStatus('emailMsg', '❌ ' + e.message, false);
  }
}

async function requestPwOtp() {
  var current = ($('pwCurrent') || {}).value || '';
  var next    = ($('pwNew')     || {}).value || '';
  var confirm = ($('pwConfirm') || {}).value || '';
  if (!current)         return _pwStatus('pwMsg', 'Enter your current password.', false);
  if (!next)            return _pwStatus('pwMsg', 'Enter a new password.', false);
  if (next !== confirm) return _pwStatus('pwMsg', 'New passwords do not match.', false);
  try {
    var d = await api('/api/admin/password/otp', { method: 'POST', body: JSON.stringify({ current, next, confirm }) });
    // Show OTP step
    $('pwStep1').style.display = 'none';
    $('pwStep2').style.display = 'block';
    if ($('pwOtpHint')) $('pwOtpHint').textContent = d.hint || 'Check your email for the verification code.';
    if ($('pwOtp')) $('pwOtp').focus();
  } catch (e) {
    if (e.message === 'no_email') {
      _pwStatus('pwMsg', '❌ Set your account email first (panel above).', false);
    } else {
      _pwStatus('pwMsg', '❌ ' + e.message, false);
    }
  }
}

async function confirmPwChange() {
  var otp     = ($('pwOtp')     || {}).value || '';
  var current = ($('pwCurrent') || {}).value || '';
  var next    = ($('pwNew')     || {}).value || '';
  if (!otp) return _pwStatus('pwMsg2', 'Enter the 6-digit code from your email.', false);
  try {
    await api('/api/admin/password', { method: 'PUT', body: JSON.stringify({ current, next, otp }) });
    _pwStatus('pwMsg2', '✅ Password updated. Other sessions signed out.', true);
    // Reset form
    ['pwCurrent','pwNew','pwConfirm','pwOtp'].forEach(function(id){ var el=$(id); if(el) el.value=''; });
    setTimeout(function(){ $('pwStep1').style.display='block'; $('pwStep2').style.display='none'; }, 2000);
  } catch (e) {
    _pwStatus('pwMsg2', '❌ ' + e.message, false);
  }
}

function cancelPwChange() {
  $('pwStep1').style.display = 'block';
  $('pwStep2').style.display = 'none';
  ['pwCurrent','pwNew','pwConfirm','pwOtp'].forEach(function(id){ var el=$(id); if(el) el.value=''; });
  var m=$('pwMsg'); if(m) m.style.display='none';
  var m2=$('pwMsg2'); if(m2) m2.style.display='none';
}

/* ══════════════════════════════════════════════
   EVENT DELEGATION — replaces all onclick= attrs
   ══════════════════════════════════════════════ */
(function wireAdminEvents() {
  // Delegated handler for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var map = {
      addEvent:       function() { toggleForm('evForm'); },
      saveEvent:      function() { saveEvent(); },
      cancelEvent:    function() { cancelForm('evForm'); clearEvent(); },
      addPost:        function() { toggleForm('poForm'); },
      savePost:       function() { savePost(); },
      cancelPost:     function() { cancelForm('poForm'); clearPost(); },
      autoNumber:     function() { autoNumberGallery(); },
      addGallery:     function() { toggleForm('galUpload'); },
      saveGallery:    function() { saveGallery(); },
      cancelGallery:  function() { clearGallery(); cancelForm('galEditForm'); },
      clearBulk:      function() { clearBulkUpload(); },
      addVideo:       function() { toggleForm('vidForm'); },
      saveVideo:      function() { saveVideo(); },
      cancelVideo:    function() { cancelForm('vidForm'); clearVideo(); },
      addPress:       function() { toggleForm('pressForm'); },
      savePress:      function() { savePress(); },
      cancelPress:    function() { cancelForm('pressForm'); clearPress(); },
      addDonation:    function() { toggleForm('donForm'); },
      saveDonation:   function() { saveDonation(); },
      cancelDonation: function() { cancelForm('donForm'); },
      downloadBackup:  function() { downloadBackup(); },
      saveSettings:    function() { saveSettings(); },
      saveAdminEmail:  function() { saveAdminEmail(); },
      requestPwOtp:    function() { requestPwOtp(); },
      confirmPwChange: function() { confirmPwChange(); },
      cancelPwChange:  function() { cancelPwChange(); }
    };
    var fn = map[btn.dataset.action];
    if (fn) fn();
  });

  // Upload zone clicks (open file picker)
  var poZone = document.getElementById('poUploadZone');
  var poFile = document.getElementById('poFile');
  if (poZone && poFile) {
    poZone.addEventListener('click', function() { poFile.click(); });
    poFile.addEventListener('change', function() { previewPoImg(this); });
  }
  var bulkZone = document.getElementById('bulkUploadZone');
  var bulkFiles = document.getElementById('gBulkFiles');
  if (bulkZone && bulkFiles) {
    bulkZone.addEventListener('click', function() { bulkFiles.click(); });
  }
  var bulkBtn = document.getElementById('bulkUploadBtn');
  if (bulkBtn) {
    bulkBtn.addEventListener('click', function() { doBulkUpload(); });
  }

  // Global image error handler (replaces onerror= attrs in generated HTML)
  document.addEventListener('error', function(e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    if (t.dataset.imgFb && !t.dataset.fbUsed) {
      t.dataset.fbUsed = '1';
      t.src = t.dataset.imgFb;
      return;
    }
    if (t.dataset.imgErr === 'hide') t.style.display = 'none';
    else if (t.dataset.imgErr === 'fade') t.style.opacity = '.3';
  }, true);
})();

/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */
async function init() {
  try {
    await Promise.all([
      loadMessages(), loadGallery(), loadEvents(),
      loadPosts(), loadVideos(), loadPress(),
      loadDonations(), loadPlaylists(), loadSettings()
    ]);
    buildCharts();
  } catch (e) {
    console.error('Admin init error:', e);
    toast('Load error: ' + e.message, 'err');
  }
}

/* ══════════════════════════════════════════════
   AUTH — server already verified session before
   serving this page. Just wire the logout button.
   ══════════════════════════════════════════════ */
(function () {
  // Show logged-in username from /api/me
  fetch(API_BASE + '/api/me', { credentials: 'include', headers: { 'X-Requested-With': 'fetch' } })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.admin) { window.location.replace('/login.html'); return; }
      var lbl = document.getElementById('adminUserLabel');
      if (lbl) lbl.textContent = '👤 ' + d.admin.username;
      // Show 2FA setup warning if enforced but not yet enabled
      if (d.must_setup_2fa) {
        var banner = document.createElement('div');
        banner.id = 'twoFaBanner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;text-align:center;padding:10px 16px;font-size:14px;font-weight:600;';
        banner.innerHTML = '⚠️ Two-factor authentication is required but not set up. <a href="#" onclick="showForm(\'twofa\');document.getElementById(\'twoFaBanner\').style.display=\'none\';return false;" style="color:#fde68a;text-decoration:underline;">Set up 2FA now →</a>';
        document.body.prepend(banner);
      }
    })
    .catch(function () { window.location.replace('/login.html'); });

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch(API_BASE + '/api/logout', {
        method: 'POST', credentials: 'include',
        headers: { 'X-Requested-With': 'fetch' }
      }).finally(function () { window.location.replace('/login.html'); });
    });
  }
})();

init();
