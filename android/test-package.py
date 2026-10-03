#!/usr/bin/env python3
"""Exercise APK verifier failure paths with synthetic ZIPs and stubbed SDK output.

This checks verifier logic only. A release build must also verify the real signed APK.
"""
from contextlib import redirect_stdout
from copy import deepcopy
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile
import hashlib
import json
import runpy
import shutil
import warnings

base = Path(__file__).resolve().parent
names = ('index.html', 'style.css', 'game.js', 'engine.js', 'audio.js', 'hand-layout.js')
csp = "default-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'"
content = {name: '// synthetic test asset\n' for name in names}
content['index.html'] = f'<head><meta http-equiv="Content-Security-Policy" content="{csp}"></head>'
content['game.js'] = "import './audio.js'; import './hand-layout.js';"
certificate = (base / 'signer-certificate.sha256').read_text().strip()
badging = "package: name='io.neonguandan.game' versionCode='3' versionName='1.2.0'\nsdkVersion:'26'\ntargetSdkVersion:'35'\napplication-label:'星曜掼蛋'"
checks = 0


def verify_case(label, expected_error=None, mutate=None, sdk=None, duplicate=False):
    global checks
    with TemporaryDirectory(prefix='guandan-package-test-') as temp:
        root = Path(temp)
        android = root / 'android'
        (android / 'build').mkdir(parents=True)
        shutil.copy2(base / 'verify-package.py', android / 'verify-package.py')
        shutil.copy2(base / 'signer-certificate.sha256', android / 'signer-certificate.sha256')
        source = deepcopy(content)
        assets = deepcopy(content)
        hashes = {name: hashlib.sha256(text.encode()).hexdigest() for name, text in assets.items()}
        checksums = {'source': deepcopy(hashes), 'bundled': deepcopy(hashes)}
        payloads = {'classes.dex': b'synthetic dex; not an Android build'}
        if mutate:
            mutate(source, assets, checksums, payloads)
        for name, text in source.items():
            (root / name).write_text(text)
        (android / 'build/asset-checksums.json').write_text(json.dumps(checksums))
        apk = android / 'build/guandan-1.2.0.apk'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with ZipFile(apk, 'w') as zipped:
                for name, text in assets.items():
                    zipped.writestr('assets/www/' + name, text)
                for name, data in payloads.items():
                    zipped.writestr(name, data)
                if duplicate:
                    zipped.writestr('assets/www/audio.js', assets['audio.js'])
        responses = {
            'permissions': "package: io.neonguandan.game\n",
            'badging': badging,
            'xmltree': 'A: android:screenOrientation(0x0101001e)=(type 0x10)0xa',
            'verify': f'Signer #1 certificate SHA-256 digest: {certificate}\n',
        }
        responses.update(sdk or {})

        def command(args, **kwargs):
            for key in responses:
                if key in args:
                    return responses[key]
            raise AssertionError(f'Unexpected tool call: {args}')

        error = None
        try:
            with patch('sys.argv', [str(android / 'verify-package.py')]), patch('subprocess.check_output', side_effect=command), redirect_stdout(StringIO()):
                runpy.run_path(str(android / 'verify-package.py'), run_name='__main__')
        except AssertionError as exception:
            error = str(exception)
        if expected_error is None:
            assert error is None, f'{label}: unexpected failure: {error}'
        else:
            assert error is not None and expected_error in error, f'{label}: expected {expected_error!r}, got {error!r}'
        checks += 1


def change_bundled_asset(name, text):
    def mutate(source, assets, checksums, payloads):
        assets[name] = text
        checksums['bundled'][name] = hashlib.sha256(text.encode()).hexdigest()
    return mutate


verify_case('valid six-file package')
verify_case('missing audio', 'Unexpected APK assets', lambda s, a, c, p: a.pop('audio.js'))
verify_case('extra media', 'Unexpected APK assets', lambda s, a, c, p: a.update({'music.mp3': 'not allowed'}))
verify_case('duplicate entry', 'Duplicate entries', duplicate=True)
verify_case('bundled corruption', 'Bundled asset hash mismatch', lambda s, a, c, p: a.update({'audio.js': 'changed'}))
verify_case('changed source', 'Source changed after packaging', lambda s, a, c, p: s.update({'hand-layout.js': 'changed'}))
verify_case('untrusted source asset list', 'Source checksum asset set', lambda s, a, c, p: c['source'].pop('audio.js'))
verify_case('untrusted bundled asset list', 'Bundled checksum asset set', lambda s, a, c, p: c['bundled'].pop('audio.js'))
verify_case('private material', 'Private or source material', lambda s, a, c, p: p.update({'private/signing.key': b'fake test key'}))
verify_case('missing DEX', 'DEX missing', lambda s, a, c, p: p.pop('classes.dex'))
verify_case('missing CSP', 'Offline CSP missing', change_bundled_asset('index.html', '<head></head>'))
verify_case('network CSP changed', "connect-src 'none'", change_bundled_asset('index.html', content['index.html'].replace("connect-src 'none'", "connect-src https:")))
verify_case('media CSP changed', "media-src 'none'", change_bundled_asset('index.html', content['index.html'].replace("media-src 'none'", "media-src https:")))
verify_case('missing module import', 'Frontend does not load', change_bundled_asset('game.js', "import './audio.js';"))
verify_case('permission requested', 'uses-permission', sdk={'permissions': "uses-permission: name='android.permission.INTERNET'"})
verify_case('stale version', 'Manifest mismatch', sdk={'badging': badging.replace("versionCode='3'", "versionCode='2'")})
verify_case('debuggable', 'Debuggable APK', sdk={'badging': badging + '\napplication-debuggable'})
verify_case('wrong orientation', 'Expected FULL_SENSOR', sdk={'xmltree': 'A: android:screenOrientation(0x0101001e)=(type 0x10)0x1'})
verify_case('wrong signer', 'original 1.0.0 signing certificate', sdk={'verify': 'Signer #1 certificate SHA-256 digest: ' + '0' * 64 + '\n'})
print(f'PASS: {checks} package-verifier regression cases (synthetic ZIPs; SDK output stubbed, not device tests)')
