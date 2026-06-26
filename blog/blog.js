/* blog.js — sidebar toggle.
   Desktop: the hamburger collapses the sidebar and reflows the content to full
   width (persisted across pages). Mobile: it opens/closes the drawer overlay.
   State classes live on <html> so a tiny inline head script can restore the
   collapsed state before first paint — no flash, no animation on load. */
(function () {
  var root = document.documentElement;
  var DESK = '(min-width: 861px)';
  var KEY = 'blog-nav-collapsed';
  function closeDrawer() { root.classList.remove('nav-open'); }
  var toggle = document.getElementById('navToggle');
  var backdrop = document.getElementById('backdrop');
  if (toggle) toggle.addEventListener('click', function () {
    if (window.matchMedia(DESK).matches) {
      var collapsed = root.classList.toggle('nav-collapsed');
      try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) {}
    } else {
      root.classList.toggle('nav-open');
    }
  });
  if (backdrop) backdrop.addEventListener('click', closeDrawer);
  var links = document.querySelectorAll('.nav a');
  for (var i = 0; i < links.length; i++) links[i].addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
})();
