// Build resume.pdf from index.html with real fidelity:
// light theme, backgrounds and exact colors, CSS @page size, embedded fonts.
// Usage:  cd tools && npm install && npm run pdf   (or: node tools/build-pdf.mjs [--theme dark] [--out file])
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const theme = opt('--theme', 'light');
const out = path.resolve(root, opt('--out', 'resume.pdf'));
const scale = Number(opt('--scale', '0.94'));   // uniform print scale; 0.94 lands the current content on 3 full pages, ~0.72 forces 2

// tiny static server so root-absolute URLs (/photo.jpg, /icons/…) resolve like on GitHub Pages
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: theme, viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.addInitScript(t => { try { localStorage.setItem('cv-theme', t); } catch {} }, theme);
await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
await page.evaluate(() => document.fonts.ready);
if (args.includes('--measure')) {
  await page.emulateMedia({ media: 'print' });
  const m = await page.evaluate(() => [...document.querySelectorAll('.row')].map(r => ({
    label: r.querySelector('.row-label')?.innerText.replace(/\s+/g,' ').trim(),
    rowH: Math.round(r.getBoundingClientRect().height),
    entries: [...r.querySelectorAll('.entry, .skill-row')].map(e => Math.round(e.getBoundingClientRect().height)) })));
  console.log(JSON.stringify(m, null, 1));
}
await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, scale });
await browser.close();
server.close();
console.log(`wrote ${path.relative(root, out)} (theme=${theme}, scale=${scale})`);
