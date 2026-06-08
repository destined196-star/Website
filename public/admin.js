const $ = id => document.getElementById(id);
// When opened as a local file, point API calls at the running server.
const API_BASE = location.protocol === 'file:' ? 'http://localhost:3000' : '';
const api = (url, opts = {}) => fetch(API_BASE + url, {
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, credentials: 'include', ...opts
}).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || r.status); return d; });

// ---- Auth ----
async function checkAuth() {
  const { admin } = await api('/api/me');
  if (admin) { showDash(admin.username); } else { $('loginView').classList.remove('hidden'); $('dashView').classList.add('hidden'); }
}
function showDash(name) {
  $('loginView').classList.add('hidden');
  $('dashView').classList.remove('hidden');
  $('who').textContent = name;
  loadMessages(); loadEvents(); loadPosts(); loadGallery(); loadDonations(); loadSettings(); loadSecurity();
}
async function login() {
  const el = $('loginErr');
  try {
    const body = { username: $('lUser').value, password: $('lPass').value };
    const tok = $('lToken').value.trim();
    if (tok) body.token = tok;
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify(body) });
    showDash(d.username);
  } catch (e) {
    if (e.message === '2fa_required') {
      $('l2faWrap').classList.remove('hidden');
      el.textContent = 'Enter your 6-digit authenticator code.';
      el.classList.remove('hidden');
      $('lToken').focus();
      return;
    }
    el.textContent = e.message; el.classList.remove('hidden');
  }
}
async function logout() { await api('/api/logout', { method: 'POST' }); location.reload(); }

// ---- Tabs ----
function tab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['messages', 'events', 'posts', 'gallery', 'donations', 'settings', 'security', 'password'].forEach(t => $('t-' + t).classList.toggle('hidden', t !== name));
}

// ---- Messages ----
async function loadMessages() {
  const list = await api('/api/admin/messages');
  $('msgList').innerHTML = list.length ? list.map(m => `
    <div class="item">
      <h4>${esc(m.name)} <span class="meta">&lt;${esc(m.email)}&gt;</span></h4>
      <div class="meta">📞 ${esc(m.phone) || '-'} &nbsp; 🕒 ${esc(m.created_at)}</div>
      ${m.subject ? `<div class="meta"><b>${esc(m.subject)}</b></div>` : ''}
      <p>${esc(m.message)}</p>
      <div class="actions"><button class="btn-sm btn-del" onclick="delMsg(${m.id})">Delete</button></div>
    </div>`).join('') : '<p class="meta">No messages yet.</p>';
}
async function delMsg(id) { if (!confirm('Delete this message?')) return; await api('/api/admin/messages/' + id, { method: 'DELETE' }); loadMessages(); }

// ---- Events ----
async function loadEvents() {
  const list = await api('/api/events');
  $('evList').innerHTML = list.map(e => `
    <div class="item">
      <h4>${esc(e.day)} ${esc(e.month)} — ${esc(e.title)}</h4>
      <div class="meta">${esc(e.description)}</div>
      ${e.link ? `<div class="meta">🔗 ${esc(e.link)}</div>` : ''}
      <div class="actions">
        <button class="btn-sm btn-edit" onclick='editEvent(${JSON.stringify(e)})'>Edit</button>
        <button class="btn-sm btn-del" onclick="delEvent(${e.id})">Delete</button>
      </div>
    </div>`).join('');
}
function editEvent(e) {
  $('evId').value = e.id; $('evDay').value = e.day; $('evMonth').value = e.month;
  $('evTitle').value = e.title; $('evDesc').value = e.description; $('evLink').value = e.link; $('evSort').value = e.sort_order;
  window.scrollTo(0, 0);
}
async function saveEvent() {
  const id = $('evId').value;
  const body = JSON.stringify({ day: $('evDay').value, month: $('evMonth').value, title: $('evTitle').value, description: $('evDesc').value, link: $('evLink').value, sort_order: Number($('evSort').value) });
  if (!$('evTitle').value) return alert('Title required');
  await api('/api/admin/events' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
  ['evId', 'evDay', 'evMonth', 'evTitle', 'evDesc', 'evLink'].forEach(i => $(i).value = ''); $('evSort').value = 0;
  loadEvents();
}
async function delEvent(id) { if (!confirm('Delete event?')) return; await api('/api/admin/events/' + id, { method: 'DELETE' }); loadEvents(); }

// ---- Posts ----
async function loadPosts() {
  const list = await api('/api/posts');
  $('poList').innerHTML = list.map(p => `
    <div class="item">
      <h4>${esc(p.title)}</h4>
      <div class="meta">${esc(p.date_label)}</div>
      <p>${esc(p.body)}</p>
      <div class="actions">
        <button class="btn-sm btn-edit" onclick='editPost(${JSON.stringify(p)})'>Edit</button>
        <button class="btn-sm btn-del" onclick="delPost(${p.id})">Delete</button>
      </div>
    </div>`).join('');
}
function editPost(p) {
  $('poId').value = p.id; $('poTitle').value = p.title; $('poBody').value = p.body; $('poImg').value = p.image; $('poDate').value = p.date_label;
  window.scrollTo(0, 0);
}
async function savePost() {
  const id = $('poId').value;
  if (!$('poTitle').value) return alert('Title required');
  const body = JSON.stringify({ title: $('poTitle').value, body: $('poBody').value, image: $('poImg').value, date_label: $('poDate').value });
  await api('/api/admin/posts' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
  ['poId', 'poTitle', 'poBody', 'poImg', 'poDate'].forEach(i => $(i).value = '');
  loadPosts();
}
async function delPost(id) { if (!confirm('Delete post?')) return; await api('/api/admin/posts/' + id, { method: 'DELETE' }); loadPosts(); }

// ---- Gallery ----
async function loadGallery() {
  const list = await api('/api/gallery');
  $('gList').innerHTML = list.map(g => `
    <div class="item">
      <div style="display:flex;gap:12px;align-items:center">
        <img src="${esc(g.image)}" style="width:64px;height:64px;object-fit:cover;border-radius:6px" />
        <div><h4>${esc(g.caption) || '(no caption)'}</h4><div class="meta">order ${g.sort_order} · ${esc(g.image)}</div></div>
      </div>
      <div class="actions">
        <button class="btn-sm btn-edit" onclick='editGallery(${JSON.stringify(g)})'>Edit</button>
        <button class="btn-sm btn-del" onclick="delGallery(${g.id})">Delete</button>
      </div>
    </div>`).join('') || '<p class="meta">No images yet.</p>';
}
function editGallery(g) { $('gId').value = g.id; $('gImg').value = g.image; $('gCap').value = g.caption; $('gSort').value = g.sort_order; window.scrollTo(0, 0); }
async function saveGallery() {
  const id = $('gId').value;
  if (!$('gImg').value) return alert('Image URL required');
  const body = JSON.stringify({ image: $('gImg').value, caption: $('gCap').value, sort_order: Number($('gSort').value) });
  await api('/api/admin/gallery' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
  ['gId', 'gImg', 'gCap'].forEach(i => $(i).value = ''); $('gSort').value = 0;
  loadGallery();
}
async function delGallery(id) { if (!confirm('Delete image?')) return; await api('/api/admin/gallery/' + id, { method: 'DELETE' }); loadGallery(); }

// ---- Donations ----
async function loadDonations() {
  const list = await api('/api/admin/donations');
  $('donList').innerHTML = list.length ? list.map(d => `
    <div class="item">
      <h4>₹${esc(d.amount)} <span class="meta">via ${esc(d.method) || '-'}</span></h4>
      <div class="meta">${esc(d.name) || 'Anonymous'} ${d.email ? '&lt;' + esc(d.email) + '&gt;' : ''} · ${esc(d.created_at)}</div>
      ${d.reference ? `<div class="meta">ref: ${esc(d.reference)}</div>` : ''}
    </div>`).join('') : '<p class="meta">No donations recorded yet.</p>';
}

// ---- Settings ----
const SETTING_KEYS = ['youtube', 'facebook', 'instagram', 'pinterest', 'phone', 'location', 'bio', 'paypal_link', 'razorpay_key', 'upi_id', 'donation_note'];
async function loadSettings() {
  const s = await api('/api/settings');
  SETTING_KEYS.forEach(k => { if ($('s_' + k)) $('s_' + k).value = s[k] || ''; });
}
async function saveSettings() {
  const body = {};
  SETTING_KEYS.forEach(k => { if ($('s_' + k)) body[k] = $('s_' + k).value; });
  await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
  const el = $('setMsg'); el.textContent = 'Saved! Changes are live on the site.'; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---- Password ----
async function changePw() {
  const el = $('pwMsg');
  try {
    await api('/api/admin/password', { method: 'PUT', body: JSON.stringify({ current: $('pwCur').value, next: $('pwNew').value }) });
    el.className = 'msg ok'; el.textContent = 'Password updated.'; $('pwCur').value = ''; $('pwNew').value = '';
  } catch (e) { el.className = 'msg err'; el.textContent = e.message; }
}

// ---- Security: 2FA + login audit ----
async function loadSecurity() {
  const me = await api('/api/me');
  const on = !!me.totp_enabled;
  $('twofaOn').classList.toggle('hidden', !on);
  $('twofaOff').classList.toggle('hidden', on);
  $('twofaSetup').classList.add('hidden');
  loadAudit();
}
async function setup2fa() {
  const d = await api('/api/admin/2fa/setup', { method: 'POST' });
  $('twofaQr').src = d.qr;
  $('twofaSecret').textContent = d.secret;
  $('twofaSetup').classList.remove('hidden');
}
async function enable2fa() {
  const el = $('twofaMsg');
  try {
    await api('/api/admin/2fa/enable', { method: 'POST', body: JSON.stringify({ token: $('twofaToken').value }) });
    el.className = 'msg ok'; el.textContent = '2FA enabled. You will need your code at next login.'; el.classList.remove('hidden');
    loadSecurity();
  } catch (e) { el.className = 'msg err'; el.textContent = e.message; el.classList.remove('hidden'); }
}
async function disable2fa() {
  const el = $('twofaMsg');
  try {
    await api('/api/admin/2fa/disable', { method: 'PUT', body: JSON.stringify({ password: $('twofaDisablePw').value }) });
    el.className = 'msg ok'; el.textContent = '2FA disabled.'; el.classList.remove('hidden');
    $('twofaDisablePw').value = ''; loadSecurity();
  } catch (e) { el.className = 'msg err'; el.textContent = e.message; el.classList.remove('hidden'); }
}
async function loadAudit() {
  const list = await api('/api/admin/audit');
  $('auditList').innerHTML = list.length ? list.map(a => `
    <div class="item" style="border-left:4px solid ${a.success ? '#3a7a2a' : '#c0563c'}">
      <div class="meta">${a.success ? '✅ success' : '❌ failed'} ${a.reason ? '(' + esc(a.reason) + ')' : ''}
      · user: <b>${esc(a.username) || '-'}</b> · IP: ${esc(a.ip)} · ${esc(a.created_at)}</div>
    </div>`).join('') : '<p class="meta">No login attempts logged yet.</p>';
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

checkAuth();
