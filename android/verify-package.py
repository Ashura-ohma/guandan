#!/usr/bin/env python3
"""Check that the APK contains the exact prepared offline assets and no extra payloads."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import os
import re
import subprocess
import sys

base = Path(__file__).resolve().parent
root = base.parent
apk = Path(sys.argv[1]) if len(sys.argv) > 1 else base / 'build/guandan-1.2.0.apk'
asset_names = {'index.html', 'style.css', 'game.js', 'engine.js', 'audio.js', 'hand-layout.js'}
checksums = json.loads((base / 'build/asset-checksums.json').read_text())
assert set(checksums['source']) == asset_names, 'Source checksum asset set must match the exact six-file allowlist'
assert set(checksums['bundled']) == asset_names, 'Bundled checksum asset set must match the exact six-file allowlist'
with ZipFile(apk) as z:
    assert z.testzip() is None, 'ZIP integrity failed'
    assets = {name for name in z.namelist() if name.startswith('assets/')}
    expected = {'assets/www/' + name for name in asset_names}
    assert len(z.namelist()) == len(set(z.namelist())), 'Duplicate entries in APK'
    assert assets == expected, f'Unexpected APK assets: {assets ^ expected}'
    for name, expected_hash in checksums['bundled'].items():
        assert hashlib.sha256(z.read('assets/www/' + name)).hexdigest() == expected_hash, f'Bundled asset hash mismatch: {name}'
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == checksums['source'][name], f'Source changed after packaging: {name}'
    forbidden = ('.jks', '.keystore', '.p12', '.pem', '.key', '.java')
    assert not any(name.lower().endswith(forbidden) or 'password' in name.lower() for name in z.namelist()), 'Private or source material found in APK'
    assert 'classes.dex' in z.namelist(), 'DEX missing'
    html = z.read('assets/www/index.html').decode()
    assert 'Content-Security-Policy' in html, 'Offline CSP missing'
    for directive in ("connect-src 'none'", "media-src 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'"):
        assert directive in html, f'Offline CSP missing: {directive}'
    game = z.read('assets/www/game.js').decode()
    for module in ('./audio.js', './hand-layout.js'):
        assert module in game, f'Frontend does not load the packaged module: {module}'
aapt = os.environ.get('AAPT', 'aapt')
permissions = subprocess.check_output([aapt, 'dump', 'permissions', str(apk)], text=True)
assert 'uses-permission' not in permissions, permissions
badging = subprocess.check_output([aapt, 'dump', 'badging', str(apk)], text=True)
for marker in ("name='io.neonguandan.game'", "versionCode='3'", "versionName='1.2.0'", "sdkVersion:'26'", "targetSdkVersion:'35'", "application-label:'星曜掼蛋'"):
    assert marker in badging, f'Manifest mismatch: {marker}'
assert 'application-debuggable' not in badging, 'Debuggable APK'
xmltree = subprocess.check_output([aapt, 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
orientation = next((line for line in xmltree.splitlines() if 'android:screenOrientation(' in line), '')
assert '=(type 0x10)0xa' in orientation, f'Expected FULL_SENSOR in compiled manifest: {orientation}'
signer_jar = os.environ.get('APKSIGNER_JAR')
signer_command = [os.environ.get('JAVA', 'java'), '-jar', signer_jar] if signer_jar else ['apksigner']
signature = subprocess.check_output(signer_command + ['verify', '--print-certs', str(apk)], text=True)
certificate_hashes = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$', signature, re.MULTILINE)
expected_signer = (base / 'signer-certificate.sha256').read_text().strip()
assert certificate_hashes == [expected_signer], 'APK must use the original 1.0.0 signing certificate'
print('PASS: six exact offline assets (including generated audio and hand layout), current source checksums, no credentials, no Android permissions, release manifest, FULL_SENSOR, valid ZIP')
print('PASS: APK signature matches the original 1.0.0 certificate')
print('APK SHA-256:', hashlib.sha256(apk.read_bytes()).hexdigest())
print('APK bytes:', apk.stat().st_size)
