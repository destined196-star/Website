// Carousel
(function () {
  const slides = document.querySelectorAll('.slide');
  const dots = document.querySelectorAll('.dot');
  if (!slides.length) return;
  let idx = 0;
  let timer;

  function show(i) {
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    slides[i].classList.add('active');
    if (dots[i]) dots[i].classList.add('active');
    idx = i;
  }
  function next() { show((idx + 1) % slides.length); }
  function prev() { show((idx - 1 + slides.length) % slides.length); }
  function restart() { clearInterval(timer); timer = setInterval(next, 5000); }

  document.querySelector('.slide-nav.next')?.addEventListener('click', () => { next(); restart(); });
  document.querySelector('.slide-nav.prev')?.addEventListener('click', () => { prev(); restart(); });
  dots.forEach((d, i) => d.addEventListener('click', () => { show(i); restart(); }));
  restart();
})();

// Mobile menu
document.querySelector('.menu-toggle')?.addEventListener('click', () => {
  document.querySelector('nav').classList.toggle('open');
});
