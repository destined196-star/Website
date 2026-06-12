// Public-facing dynamic wiring: pulls settings + content from the API.
(async function () {
  const API = location.protocol === 'file:' ? 'http://localhost:3000' : '';
  const get = u => fetch(API + u, { credentials: 'include' }).then(r => r.json());
  const post = (u, body) => fetch(API + u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, credentials: 'include', body: JSON.stringify(body) });
  // Only allow safe URL schemes in rendered href/src (M4 — blocks javascript: etc.)
  const safeUrl = u => { const v = String(u || '').trim(); return /^(https?:\/\/|\/|\.\/|#|mailto:|tel:)/i.test(v) ? v : '#'; };
  // Gallery links: only same-origin paths or YouTube URLs (prevents open redirect via admin-set caption)
  const safeGalleryHref = u => { const v = String(u || '').trim(); return /^(\/|\.\/)|^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(v) ? v : '#'; };
  let s = {};
  try { s = await get('/api/settings'); } catch (e) { /* server not running — static fallback */ }

  // Update social links anywhere on the page by matching their domain
  const map = [
    ['youtube.com', s.youtube],
    ['facebook.com', s.facebook],
    ['instagram.com', s.instagram],
    ['pinterest.com', s.pinterest]
  ];
  for (const [domain, url] of map) {
    if (!url) continue;
    document.querySelectorAll(`a[href*="${domain}"]`).forEach(a => { a.href = url; });
  }

  // Elements with data-setting get text from settings
  document.querySelectorAll('[data-setting]').forEach(el => {
    const v = s[el.dataset.setting];
    if (v) el.textContent = v;
  });

  // ---- Events container ----
  const evWrap = document.getElementById('events-dynamic');
  if (evWrap) {
    try {
      const events = await get('/api/events');
      evWrap.innerHTML = events.map(e => `
        <div class="event">
          <div class="event-date"><div class="day">${esc(e.day)}</div><div class="month">${esc(e.month)}</div></div>
          <div><h4>${esc(e.title)}</h4><p>${esc(e.description)}</p></div>
          ${e.link ? `<a href="${esc(safeUrl(e.link))}" target="_blank" rel="noopener" class="btn">Join</a>` : `<a href="contact.html" class="btn">Enquire</a>`}
        </div>`).join('') || '<p style="text-align:center;color:var(--muted)">No upcoming events.</p>';
    } catch (e) {}
  }

  // ---- Gallery container ----
  const galWrap = document.getElementById('gallery-dynamic');
  if (galWrap) {
    try {
      const imgs = await get('/api/gallery');
      galWrap.innerHTML = imgs.map(g =>
        `<a href="${esc(safeGalleryHref(g.caption || g.image))}" target="_blank" rel="noopener" title="Watch on YouTube"><img src="${esc(safeUrl(g.image))}" alt="Devi Murlika Gaur" /></a>`
      ).join('') || '<p style="text-align:center;color:var(--muted)">No images yet.</p>';
    } catch (e) {}
  }

  // ---- YouTube live comments ----
  async function loadYtComments() {
    const wrap = document.getElementById('yt-comments');
    if (!wrap) return;
    try {
      const comments = await get('/api/yt-comments');
      if (!comments.length) {
        wrap.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px 0">Comments loading — check back soon.</p>';
        return;
      }
      wrap.innerHTML = comments.map(c => `
        <div class="testi-card">
          <p class="testi-text">${esc(c.text.length > 300 ? c.text.slice(0, 297) + '…' : c.text)}</p>
          <div class="testi-author">
            ${c.avatar
              ? `<img class="testi-avatar-img" src="${esc(c.avatar)}" alt="${esc(c.author)}" loading="lazy" />`
              : `<div class="testi-avatar">🙏</div>`}
            <div>
              <div class="testi-name">${esc(c.author)}</div>
              ${c.likes > 0 ? `<div class="testi-likes">👍 ${c.likes.toLocaleString('en-IN')}</div>` : ''}
              <a class="testi-yt-badge" href="https://www.youtube.com/watch?v=${esc(c.videoId)}" target="_blank" rel="noopener">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.95C5.12 20 12 20 12 20s6.88 0 8.59-.47a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon fill="currentColor" points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/></svg>
                YouTube
              </a>
            </div>
          </div>
        </div>`).join('');
    } catch (_) {}
  }
  loadYtComments();
  setInterval(loadYtComments, 10 * 60 * 1000); // refresh every 10 min

  // ---- Blog/posts container ----
  const blogWrap = document.getElementById('blog-dynamic');
  if (blogWrap) {
    try {
      const posts = await get('/api/posts');
      blogWrap.innerHTML = posts.map(p => `
        <div class="blog-card">
          ${p.image ? `<img src="${esc(safeUrl(p.image))}" alt="" />` : ''}
          <div class="blog-body">
            <div class="blog-date">${esc(p.date_label)}</div>
            <h4>${esc(p.title)}</h4>
            <p>${esc(p.body)}</p>
          </div>
        </div>`).join('');
    } catch (e) {}
  }

  // ---- Contact form -> API ----
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const note = document.getElementById('formMsg');
      const nameVal = form.name.value.trim();
      const emailVal = form.email.value.trim();
      const msgVal = form.message.value.trim();
      // Basic validation — show inline styled error instead of browser popup
      if (!nameVal) {
        note.style.display = 'block'; note.style.color = '#c0563c';
        note.textContent = 'Please enter your name.'; return;
      }
      if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        note.style.display = 'block'; note.style.color = '#c0563c';
        note.textContent = 'Please enter a valid email address.'; return;
      }
      if (!msgVal) {
        note.style.display = 'block'; note.style.color = '#c0563c';
        note.textContent = 'Please enter a message.'; return;
      }
      note.style.display = 'none';
      const payload = {
        name: nameVal, email: emailVal, phone: form.phone?.value || '',
        subject: form.subject?.value || '', message: msgVal,
        company: form.hp_field?.value || ''   // honeypot
      };
      try {
        const r = await post('/api/contact', payload);
        if (!r.ok) throw new Error();
        form.reset();
        note.style.display = 'block';
        note.style.color = 'var(--saffron-dark)';
        note.textContent = '🙏 Thank you! Your details have been received.';
      } catch (e) {
        note.style.display = 'block';
        note.style.color = '#c0563c';
        note.textContent = 'Could not send. Make sure the server is running.';
      }
    });
  }

  function esc(t) { return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
})();
