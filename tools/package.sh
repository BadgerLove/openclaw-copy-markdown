#!/bin/sh
# Builds dist/ zips: one for the Chrome Web Store (manifest at the top level)
# and one for manual "Load unpacked" installs.
set -e
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json, os, zipfile
version = json.load(open('extension/manifest.json'))['version']
os.makedirs('dist', exist_ok=True)
files = sorted(os.path.join(r, f) for r, _, fs in os.walk('extension') for f in fs)
store = f'dist/copy-as-markdown-for-openclaw-{version}-webstore.zip'
with zipfile.ZipFile(store, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in files:
        z.write(p, os.path.relpath(p, 'extension'))
manual = f'dist/copy-as-markdown-for-openclaw-{version}.zip'
with zipfile.ZipFile(manual, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in files:
        z.write(p, os.path.join('copy-as-markdown-for-openclaw', p))
    for p in ('README.md', 'LICENSE', 'PRIVACY.md'):
        z.write(p, os.path.join('copy-as-markdown-for-openclaw', p))
for p in (store, manual):
    print(p, os.path.getsize(p), 'bytes')
PY
