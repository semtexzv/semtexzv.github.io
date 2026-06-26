/* blog.js — the only app-shell behaviour: open/close the mobile nav drawer.
   Theme toggling lives in /site.js. No SPA, no router — every page is static. */
(function () {
  var body = document.body;
  function close() { body.classList.remove('nav-open'); }
  var toggle = document.getElementById('navToggle');
  var backdrop = document.getElementById('backdrop');
  if (toggle) toggle.addEventListener('click', function () { body.classList.toggle('nav-open'); });
  if (backdrop) backdrop.addEventListener('click', close);
  // tapping a nav link closes the drawer (mobile)
  var links = document.querySelectorAll('.nav a');
  for (var i = 0; i < links.length; i++) links[i].addEventListener('click', close);
  // Esc closes
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();
