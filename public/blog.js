// Blog page — 3-col grid + modal
(function () {
  var modal = document.getElementById('bpModal');
  var modalImg = document.getElementById('bpModalImg');
  var modalMeta = document.getElementById('bpModalMeta');
  var modalTitle = document.getElementById('bpModalTitle');
  var modalContent = document.getElementById('bpModalContent');

  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function safeUrl(u) { return /^https?:\/\//i.test(u||'') ? u : ''; }

  function openModal(p) {
    if (p.image && safeUrl(p.image)) {
      modalImg.src = p.image; modalImg.style.display = 'block';
    } else {
      modalImg.style.display = 'none'; modalImg.src = '';
    }
    modalMeta.textContent = p.date_label || '';
    modalTitle.textContent = p.title || '';
    modalContent.textContent = p.body || '';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    modalImg.src = '';
  }

  document.getElementById('bpModalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  document.addEventListener('DOMContentLoaded', function () {
    var wrap = document.getElementById('blog-dynamic');
    if (!wrap) return;
    fetch('/api/posts')
      .then(function (r) { return r.json(); })
      .then(function (posts) {
        if (!posts || !posts.length) {
          wrap.innerHTML = '<p class="bp-loading">No thoughts published yet. Check back soon 🙏</p>';
          return;
        }
        wrap.innerHTML = posts.map(function (p) {
          var excerpt = (p.body || '').substring(0, 120) + ((p.body||'').length > 120 ? '…' : '');
          return '<div class="bp-card" data-id="' + p.id + '">'
            + (p.image && safeUrl(p.image) ? '<img class="bp-card-img" src="' + esc(safeUrl(p.image)) + '" alt="" loading="lazy" />' : '')
            + '<div class="bp-card-body">'
            + '<div class="bp-meta"><span>Spiritual</span>' + (p.date_label ? '<span>' + esc(p.date_label) + '</span>' : '') + '</div>'
            + '<div class="bp-card-title">' + esc(p.title) + '</div>'
            + (excerpt ? '<div class="bp-excerpt">' + esc(excerpt) + '</div>' : '')
            + '<span class="bp-read-more">Continue Reading…</span>'
            + '</div></div>';
        }).join('');
        wrap.querySelectorAll('.bp-card').forEach(function (card) {
          var id = Number(card.dataset.id);
          var p = posts.find(function (x) { return x.id === id; });
          card.addEventListener('click', function () { if (p) openModal(p); });
        });
      })
      .catch(function () {
        wrap.innerHTML = '<p class="bp-loading">Could not load thoughts. Please try again later.</p>';
      });
  });
})();
