function esc(s) {
  return String(s||'').replace(/[&<>"']/g, function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});
}

function bindAccordion(container) {
  container.querySelectorAll('.press-card').forEach(function (card) {
    var header = card.querySelector('.press-card-header');
    function toggle() {
      var isOpen = card.classList.contains('open');
      container.querySelectorAll('.press-card.open').forEach(function (c) {
        c.classList.remove('open');
        c.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        card.classList.add('open');
        card.setAttribute('aria-expanded', 'true');
        setTimeout(function () {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
      }
    }
    header.addEventListener('click', toggle);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    var closeLink = card.querySelector('.press-read-less');
    if (closeLink) {
      closeLink.addEventListener('click', function (e) {
        e.stopPropagation();
        card.classList.remove('open');
        card.setAttribute('aria-expanded', 'false');
      });
    }
  });
}

fetch('/api/press').then(function(r){return r.json();}).then(function(articles) {
  var grid = document.getElementById('pressGrid');
  if (!grid) return;
  if (!articles.length) {
    grid.innerHTML = '<p style="color:var(--muted)">No press articles yet.</p>';
    return;
  }
  grid.innerHTML = articles.map(function(p) {
    var imgHtml = p.image
      ? '<img src="'+esc(p.image)+'" alt="'+esc(p.title)+'" style="width:100%;max-height:160px;object-fit:cover;" onerror="this.style.display=\'none\'" />'
      : '';
    var pubHtml = p.publication ? '<span class="press-source">📰 '+esc(p.publication)+'</span>' : '<span class="press-source">📰 Press</span>';
    var dateHtml = p.date_label ? '<span class="press-date">'+esc(p.date_label)+'</span>' : '';
    return '<div class="press-card" role="button" tabindex="0" aria-expanded="false">'
      + '<div class="press-card-accent"></div>'
      + '<div class="press-card-header">'
      + '<div class="press-meta">'+pubHtml+dateHtml+'</div>'
      + '<h2 class="press-headline">'+esc(p.title)+'</h2>'
      + '<div class="press-toggle"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>'
      + '</div>'
      + '<div class="press-card-body"><div class="press-body-inner">'
      + imgHtml
      + (imgHtml ? '<hr />' : '')
      + '<p>'+esc(p.content || '')+'</p>'
      + '<span class="press-read-less">▲ Close</span>'
      + '</div></div>'
      + '</div>';
  }).join('');
  bindAccordion(grid);
}).catch(function() {});
