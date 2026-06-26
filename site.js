/* site.js — shared theme toggle (CV / bedrock / blog).
   Persists to the same key ('cv-theme') so the choice carries across pages,
   and fires a 'themechange' event so a page (e.g. bedrock's WebGL hero) can
   re-theme its own canvas. */
(function () {
  var root = document.documentElement;
  var KEY = 'cv-theme';
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var label = document.getElementById('themeName');
    if (label) label.textContent = theme.toUpperCase();
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  var initial = stored ||
    ((window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark');
  var btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', function () {
    apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  apply(initial);
})();
