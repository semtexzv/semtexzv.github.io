# CV — static site

Single-file, dependency-free HTML CV. Swiss/grid-brutalist, dark default with a
light toggle (remembers choice, respects `prefers-color-scheme` on first visit).

## Files
- `index.html` — the whole site (inline CSS + JS, no build step).
- `photo.jpg` — header portrait.
- `resume.pdf` — linked from the header (`↓ resume.pdf`) and from the print path.
- `.nojekyll` — tells GitHub Pages to serve files as-is.

## Preview locally
Just open `index.html`, or serve it:
```sh
python3 -m http.server -d . 8000   # → http://localhost:8000
```

## Deploy to GitHub Pages
**Option A — user page (`semtexzv.github.io`):**
1. Create/clone the repo `semtexzv/semtexzv.github.io`.
2. Copy `index.html`, `photo.jpg`, `resume.pdf`, `.nojekyll` to its root.
3. `git commit && git push`. Live at `https://semtexzv.github.io/` in ~1 min.

**Option B — project page (e.g. `semtexzv.github.io/cv`):**
1. Push these files to a repo (root or `/docs`).
2. Settings → Pages → Source: `main` branch, `/ (root)` or `/docs`.
3. Live at `https://semtexzv.github.io/<repo>/`.

## Print / PDF
`Cmd-P` forces a clean black-on-white layout (toggle + PDF link hidden,
page-break-safe entries). `resume.pdf` is generated from `index.html` itself:
copy it and `photo.jpg` to a temp dir, splice the phone number into the
`.contact` strip, serve the dir locally, and print with headless Chromium:
```sh
chromium --headless --no-pdf-header-footer --print-to-pdf=resume.pdf http://127.0.0.1:8123/
```
The `@page` / `@media print` rules in `index.html` produce a 3-page A4 document.

## Notes / before going public
- **Phone number is intentionally omitted** from this public page; it is spliced
  into `resume.pdf` at build time (see Print / PDF above).
- **Bedrock has no link** yet — add one to its `.entry-head` once the repo /
  promo page is public.
- **Confidentiality:** the first Gemini bullet was softened to "fleets of
  collaborating agents" (no specific scale / no "across the codebase") so it
  carries no internal-scale disclosure.
