// Public-facing dynamic wiring: pulls settings + content from the API.
(async function () {
  const API = location.protocol === 'file:' ? 'http://localhost:3000' : '';
  const get = u => fetch(API + u, { credentials: 'include' }).then(r => r.json());
  const post = (u, body) => fetch(API + u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, credentials: 'include', body: JSON.stringify(body) });
  // Only allow safe URL schemes in rendered href/src (M4 — blocks javascript: etc.)
  const safeUrl = u => { const v = String(u || '').trim(); return /^(https?:\/\/|\/|\.\/|#|mailto:|tel:)/i.test(v) ? v : '#'; };
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
        `<a href="${esc(safeUrl(g.caption || g.image))}" target="_blank" rel="noopener" title="Watch on YouTube"><img src="${esc(safeUrl(g.image))}" alt="Devi Murlika Gaur" /></a>`
      ).join('') || '<p style="text-align:center;color:var(--muted)">No images yet.</p>';
    } catch (e) {}
  }

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
        company: form.company?.value || ''   // honeypot
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
