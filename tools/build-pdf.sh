#!/bin/sh
# Build resume.pdf from index.html with headless Chromium (Playwright).
# Usage: tools/build-pdf.sh            -> writes ./resume.pdf
set -e
cd "$(dirname "$0")/.."
PW="npx -y playwright@1.63.0-alpha-2026-08-05"
PORT=${PORT:-8765}
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
HTTPD=$!
trap 'kill $HTTPD 2>/dev/null' EXIT
sleep 1
$PW pdf --wait-for-timeout 1500 --paper-format A4 "http://127.0.0.1:$PORT/index.html" resume.pdf >/dev/null
echo "resume.pdf: $(pdfinfo resume.pdf 2>/dev/null | awk '/Pages/{print $2}') pages, $(stat -f%z resume.pdf) bytes"
