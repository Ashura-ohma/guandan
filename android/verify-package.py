#!/usr/bin/env python3
"""Check that the APK contains the exact prepared offline assets and no extra payloads."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import os
import subprocess
import sys

base = Path(__file__).resolve().parent
root = base.parent
apk = Path(sys.argv[1]) if len(sys.argv) > 1 else base / 'build/guandan-1.0.0.apk'
checksums = json.loads((base / 'build/asset-checksums.json').read_text())
with ZipFile(apk) as z:
    assert z.testzip() is None, 'ZIP integrity failed'
    assets = {name for name in z.namelist() if name.startswith('assets/')}
    expected = {'assets/www/' + name for name in checksums['bundled']}
    assert assets == expected, f'Unexpected APK assets: {assets ^ expected}'
    for name, expected_hash in checksums['bundled'].items():
        assert hashlib.sha256(z.read('assets/www/' + name)).hexdigest() == expected_hash, f'Bundled asset hash mismatch: {name}'
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == checksums['source'][name], f'Source changed after packaging: {name}'
    forbidden = ('.jks', '.keystore', '.p12', '.pem', '.key', '.java')
    assert not any(name.lower().endswith(forbidden) or 'password' in name.lower() for name in z.namelist()), 'Private or source material found in APK'
    assert 'classes.dex' in z.namelist(), 'DEX missing'
    html = z.read('assets/www/index.html').decode()
    assert 'Content-Security-Policy' in html and "connect-src 'none'" in html, 'Offline CSP missing'
aapt = os.environ.get('AAPT', 'aapt')
permissions = subprocess.check_output([aapt, 'dump', 'permissions', str(apk)], text=True)
assert 'uses-permission' not in permissions, permissions
badging = subprocess.check_output([aapt, 'dump', 'badging', str(apk)], text=True)
for marker in ("name='io.neonguandan.game'", "versionName='1.0.0'", "sdkVersion:'26'", "targetSdkVersion:'35'", "application-label:'星曜掼蛋'"):
    assert marker in badging, f'Manifest mismatch: {marker}'
assert 'application-debuggable' not in badging, 'Debuggable APK'
print('PASS: four exact offline assets, current source checksums, no credentials, no Android permissions, release manifest, valid ZIP')
print('APK SHA-256:', hashlib.sha256(apk.read_bytes()).hexdigest())
print('APK bytes:', apk.stat().st_size)
