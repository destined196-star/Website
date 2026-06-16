(function() {
  var PLAY = '<span class="play"><svg viewBox="0 0 68 48" xmlns="http://www.w3.org/2000/svg"><rect width="68" height="48" rx="14" fill="#ff0000" opacity=".9"/><polygon points="27,14 50,24 27,34" fill="#fff"/></svg></span>';
  function vidId(url) { var m = (url||'').match(/[?&]v=([^&]+)/); return m ? m[1] : ''; }
  function esc(s) { return String(s||'').replace(/[&<>"']/g, function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); }

  function videoCard(v) {
    var id = vidId(v.youtube_url);
    return '<div class="video-card"><a class="yt-thumb" href="'+esc(v.youtube_url)+'" target="_blank" rel="noopener">'
      + '<img src="https://i.ytimg.com/vi/'+id+'/hqdefault.jpg" alt="'+esc(v.title)+'" loading="lazy" />'
      + PLAY + '</a><div class="vc-body"><h4>'+esc(v.title)+'</h4></div></div>';
  }

  // Load playlists
  fetch('/api/playlists').then(function(r){return r.json();}).then(function(pls) {
    var nav = document.getElementById('playlistNav');
    var wrap = document.getElementById('playlistsWrap');
    if (!wrap || !pls.length) return;

    // Build nav pills
    if (nav) {
      nav.innerHTML = pls.map(function(p, i) {
        return '<a href="#pl-'+p.id+'" data-pl="'+p.id+'">'+esc(p.name.split('|')[0].trim())+' <span style="opacity:.6">('+p.video_count+')</span></a>';
      }).join('');

      nav.addEventListener('click', function(e) {
        var a = e.target.closest('a[data-pl]');
        if (!a) return;
        e.preventDefault();
        var plId = a.dataset.pl;
        var grid = document.getElementById('pl-grid-'+plId);
        var toggle = document.querySelector('#pl-'+plId+' .pl-toggle');
        if (grid) {
          var wasCollapsed = grid.classList.contains('pl-collapsed');
          grid.classList.toggle('pl-collapsed');
          if (toggle) toggle.classList.toggle('open', wasCollapsed);
          if (wasCollapsed) {
            document.getElementById('pl-'+plId).scrollIntoView({behavior:'smooth', block:'start'});
          }
        }
      });
    }

    // Build playlist sections
    wrap.innerHTML = pls.map(function(p) {
      var vidsHtml = p.videos.map(videoCard).join('');
      return '<div class="pl-section" id="pl-'+p.id+'">'
        + '<div class="pl-header" onclick="var g=document.getElementById(\'pl-grid-'+p.id+'\');var t=this.querySelector(\'.pl-toggle\');g.classList.toggle(\'pl-collapsed\');t.classList.toggle(\'open\')">'
        + '<span class="pl-toggle">▶</span>'
        + '<h3>'+esc(p.name)+'</h3>'
        + '<span class="pl-count">'+p.video_count+' videos</span>'
        + '</div>'
        + (p.description ? '<p class="pl-desc">'+esc(p.description)+'</p>' : '')
        + '<div class="pl-grid pl-collapsed" id="pl-grid-'+p.id+'">'
        + vidsHtml
        + '</div></div>';
    }).join('');

    // Auto-expand first playlist
    var firstGrid = wrap.querySelector('.pl-grid');
    var firstToggle = wrap.querySelector('.pl-toggle');
    if (firstGrid) { firstGrid.classList.remove('pl-collapsed'); }
    if (firstToggle) { firstToggle.classList.add('open'); }

  }).catch(function() {});

  // Load all videos (featured + grid)
  fetch('/api/videos').then(function(r){return r.json();}).then(function(vids) {
    var featured = vids.find(function(v){return v.featured;}) || vids[0];
    var rest = vids.filter(function(v){return !v.featured;});

    var featEl = document.getElementById('featuredVideo');
    if (featEl && featured) {
      var id = vidId(featured.youtube_url);
      featEl.innerHTML = '<a class="yt-thumb featured-thumb" href="'+esc(featured.youtube_url)+'" target="_blank" rel="noopener">'
        + '<img src="https://i.ytimg.com/vi/'+id+'/maxresdefault.jpg" onerror="this.src=\'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg\'" alt="'+esc(featured.title)+'" />'
        + PLAY + '</a>'
        + '<p style="text-align:center;margin-top:12px;font-weight:600;color:var(--maroon)">'+esc(featured.title)+'</p>';
    }

    var gridEl = document.getElementById('videoGrid');
    if (gridEl && rest.length) {
      gridEl.innerHTML = rest.map(videoCard).join('');
    } else if (gridEl) {
      gridEl.innerHTML = '';
    }
  }).catch(function() {});
})();
