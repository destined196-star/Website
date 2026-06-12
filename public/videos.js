(function() {
  var PLAY = '<span class="play"><svg viewBox="0 0 68 48" xmlns="http://www.w3.org/2000/svg"><rect width="68" height="48" rx="14" fill="#ff0000" opacity=".9"/><polygon points="27,14 50,24 27,34" fill="#fff"/></svg></span>';
  function vidId(url) { var m = (url||'').match(/[?&]v=([^&]+)/); return m ? m[1] : ''; }
  function esc(s) { return String(s||'').replace(/[&<>"']/g, function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); }

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
      gridEl.innerHTML = rest.map(function(v) {
        var id = vidId(v.youtube_url);
        return '<div class="video-card"><a class="yt-thumb" href="'+esc(v.youtube_url)+'" target="_blank" rel="noopener">'
          + '<img src="https://i.ytimg.com/vi/'+id+'/hqdefault.jpg" alt="'+esc(v.title)+'" loading="lazy" />'
          + PLAY + '</a><div class="vc-body"><h4>'+esc(v.title)+'</h4>'
          + (v.description ? '<p>'+esc(v.description)+'</p>' : '')
          + '</div></div>';
      }).join('');
    } else if (gridEl) {
      gridEl.innerHTML = '';
    }
  }).catch(function() {});
})();
