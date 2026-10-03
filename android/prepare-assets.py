#!/usr/bin/env python3
"""Copy the original game into the offline Android package."""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
out = root / 'android/build/assets/www'
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)
files = ('index.html', 'style.css', 'game.js', 'engine.js')
for filename in files:
    source = root / filename
    if not source.is_file():
        raise SystemExit(f'Missing game asset: {filename}')
    shutil.copy2(source, out / filename)
html = (out / 'index.html').read_text()
csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"
html = html.replace('<head>', f'<head><meta http-equiv="Content-Security-Policy" content="{csp}">', 1)
html = html.replace('保存在当前浏览器', '保存在此设备')
(out / 'index.html').write_text(html)
# Preserve the same responsive app in portrait and landscape; only suppress overscroll.
with (out / 'style.css').open('a') as css:
    css.write('\n/* Offline Android WebView shell. */\nhtml,body{overscroll-behavior:none;-webkit-tap-highlight-color:transparent}\n')
manifest = {'source': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files},
            'bundled': {name: hashlib.sha256((out / name).read_bytes()).hexdigest() for name in files}}
(root / 'android/build/asset-checksums.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(out)
