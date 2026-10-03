#!/usr/bin/env python3
"""Run JVM allowlist tests and static Android contracts, without claiming device tests."""
from pathlib import Path
import ast
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET

base = Path(__file__).resolve().parent
ns = '{http://schemas.android.com/apk/res/android}'
manifest = ET.parse(base / 'AndroidManifest.xml').getroot()
activity = manifest.find('./application/activity')
application = manifest.find('./application')
assert manifest.attrib[ns + 'versionCode'] == '3'
assert manifest.attrib[ns + 'versionName'] == '1.2.0'
assert activity.attrib[ns + 'screenOrientation'] == 'fullSensor'
assert {'orientation', 'screenSize', 'smallestScreenSize', 'screenLayout'} <= set(activity.attrib[ns + 'configChanges'].split('|'))
assert manifest.findall('uses-permission') == []
for flag in ('allowBackup', 'debuggable', 'usesCleartextTraffic'):
    assert application.attrib[ns + flag] == 'false', flag

source = (base / 'src/io/neonguandan/game/MainActivity.java').read_text()
assert 'addJavascriptInterface' not in source, 'No generic JavaScript bridge permitted'
assert 'SCREEN_ORIENTATION_SENSOR_LANDSCAPE' in source
assert source.count('SCREEN_ORIENTATION_FULL_SENSOR') == 2, 'Default and auto must follow the sensor'
assert 'request.isForMainFrame(), request.getMethod()' in source
assert 'NavigationPolicy.route(url, view.getUrl(), mainFrame, method)' in source
rotation = source.split('void onConfigurationChanged(Configuration configuration) {', 1)[1].split('\n    }', 1)[0]
assert 'container.requestApplyInsets()' in rotation, 'Rotation must refresh cutout safe areas'
assert 'makeImmersive()' in rotation
assert 'loadUrl' not in rotation and 'new WebView' not in rotation, 'Rotation must retain the running WebView'
for guard in ('setAllowFileAccess(false)', 'setAllowContentAccess(false)', 'setBlockNetworkLoads(true)', 'setWebContentsDebuggingEnabled(false)', 'setMediaPlaybackRequiresUserGesture(true)'):
    assert guard in source, guard

assert 'ResourcePolicy.assetName(url, method)' in source, 'Use the tested exact resource allowlist'
assert 'getPath()' not in source and 'Uri.parse' not in source, 'Do not normalize resource URLs before allowlisting'
assert 'requestAudioFocus' not in source, 'Do not take audio focus before user audio opt-in'
pause = source.split('void onPause() {', 1)[1].split('    @Override protected void onResume()', 1)[0]
assert 'dispatchLifecycle(false, new ValueCallback<String>()' in pause, 'Run frontend audio pause before freezing WebView'
assert pause.index('void onReceiveValue') < pause.index('web.pauseTimers()'), 'Timer freeze must wait for JS callback'
assert 'web == pausedWeb && web != null && !resumed && generation == lifecycleGeneration' in pause, 'Ignore stale pause callbacks'
resume = source.split('void onResume() {', 1)[1].split('    @Override public void onWindowFocusChanged', 1)[0]
assert '++lifecycleGeneration' in resume and resume.index('web.resumeTimers()') < resume.index('dispatchLifecycle(')
destroy = source.split('void onDestroy() {', 1)[1]
assert '++lifecycleGeneration' in destroy, 'Destruction must invalidate outstanding pause callbacks'

asset_names = {'index.html', 'style.css', 'game.js', 'engine.js', 'audio.js', 'hand-layout.js'}
for filename, variable in (('prepare-assets.py', 'files'), ('verify-package.py', 'asset_names')):
    tree = ast.parse((base / filename).read_text())
    value = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == variable for target in node.targets))
    assert set(ast.literal_eval(value)) == asset_names, f'{filename}: exact offline assets required'
for filename in ('build.sh', 'verify-package.py'):
    assert 'guandan-1.2.0.apk' in (base / filename).read_text(), f'{filename}: stale artifact name'

harness = r'''package io.neonguandan.game;
public final class NavigationPolicyTest {
    private static int checks;
    private static void expect(String url, String current, boolean main, String method, NavigationPolicy.Action expected) {
        NavigationPolicy.Action result = NavigationPolicy.route(url, current, main, method);
        if (result != expected) throw new AssertionError(url + ": " + result + " != " + expected);
        checks++;
    }
    public static void main(String[] args) {
        String home = NavigationPolicy.HOME;
        String origin = NavigationPolicy.ORIGIN;
        String landscape = origin + "/ui/landscape";
        String auto = origin + "/ui/auto";
        expect(home, null, true, "GET", NavigationPolicy.Action.HOME);
        expect(landscape, home, true, "GET", NavigationPolicy.Action.LANDSCAPE);
        expect(auto, home, true, "GET", NavigationPolicy.Action.AUTO);
        // Commands are idempotent and must never become ordinary navigation.
        expect(landscape, home, true, "GET", NavigationPolicy.Action.LANDSCAPE);
        expect(auto, home, true, "GET", NavigationPolicy.Action.AUTO);
        String[] blocked = {
            null, "", "https://example.com/", "http://appassets.androidplatform.net/ui/landscape",
            origin + "/ui/landscape?mode=auto", origin + "/ui/landscape#fragment",
            origin + "/ui/landscape/", origin + "/ui/LANDSCAPE", origin + "/ui/%6candscape",
            origin + "/ui/../ui/landscape", origin + ":443/ui/landscape",
            "https://user@appassets.androidplatform.net/ui/landscape",
            "https://appassets.androidplatform.net.evil.example/ui/landscape",
            "https://APPASSETS.ANDROIDPLATFORM.NET/ui/landscape", origin + "/ui/portrait",
            "javascript:alert(1)", "file:///android_asset/www/index.html", "content://example/test",
            origin + "/assets/www/game.js", home + "?x=1", home + "#fragment"
        };
        for (String url : blocked) expect(url, home, true, "GET", NavigationPolicy.Action.BLOCKED);
        for (String url : new String[] {home, landscape, auto}) {
            expect(url, home, false, "GET", NavigationPolicy.Action.BLOCKED);
            expect(url, home, true, "POST", NavigationPolicy.Action.BLOCKED);
            expect(url, home, true, null, NavigationPolicy.Action.BLOCKED);
        }
        for (String url : new String[] {landscape, auto}) {
            expect(url, null, true, "GET", NavigationPolicy.Action.BLOCKED);
            expect(url, "https://example.com/", true, "GET", NavigationPolicy.Action.BLOCKED);
            expect(url, home + "#other", true, "GET", NavigationPolicy.Action.BLOCKED);
        }
        System.out.println("PASS: " + checks + " exact native-navigation allowlist checks");
        int resourceChecks = 0;
        String prefix = origin + "/assets/www/";
        for (String name : new String[] {"index.html", "style.css", "game.js", "engine.js", "audio.js", "hand-layout.js"}) {
            if (!name.equals(ResourcePolicy.assetName(prefix + name, "GET"))) throw new AssertionError("Missing asset: " + name);
            resourceChecks++;
            String[] aliases = {
                prefix + name + "?v=1", prefix + name + "#fragment", prefix + name + "/",
                prefix + name.toUpperCase(), prefix + "../www/" + name, prefix + "./" + name,
                prefix + "%" + Integer.toHexString(name.charAt(0)) + name.substring(1),
                prefix + name + "%00", prefix + "nested/" + name,
                "http://appassets.androidplatform.net/assets/www/" + name,
                "https://appassets.androidplatform.net:443/assets/www/" + name,
                "https://user@appassets.androidplatform.net/assets/www/" + name,
                "https://APPASSETS.ANDROIDPLATFORM.NET/assets/www/" + name,
                "https://appassets.androidplatform.net.evil.example/assets/www/" + name,
                "file:///android_asset/www/" + name, "content://appassets.androidplatform.net/assets/www/" + name
            };
            for (String url : aliases) {
                if (ResourcePolicy.assetName(url, "GET") != null) throw new AssertionError("Asset alias accepted: " + url);
                resourceChecks++;
            }
            for (String method : new String[] {null, "POST", "HEAD", "get"}) {
                if (ResourcePolicy.assetName(prefix + name, method) != null) throw new AssertionError("Asset method accepted: " + method);
                resourceChecks++;
            }
        }
        for (String url : new String[] {null, "", prefix, prefix + "music.mp3", prefix + "other.js", prefix + "signing.key", home + "?x=1", landscape, auto}) {
            if (ResourcePolicy.assetName(url, "GET") != null) throw new AssertionError("Unexpected resource accepted: " + url);
            resourceChecks++;
        }
        System.out.println("PASS: " + resourceChecks + " exact offline-resource allowlist checks");
    }
}
'''
java = os.environ.get('JAVA', 'java')
with tempfile.TemporaryDirectory(prefix='guandan-wrapper-test-') as temp:
    path = Path(temp)
    test = path / 'NavigationPolicyTest.java'
    test.write_text(harness)
    subprocess.run([java, 'com.sun.tools.javac.Main', '-source', '8', '-target', '8', '-d', temp,
                    str(base / 'src/io/neonguandan/game/NavigationPolicy.java'),
                    str(base / 'src/io/neonguandan/game/ResourcePolicy.java'), str(test)], check=True)
    subprocess.run([java, '-cp', temp, 'io.neonguandan.game.NavigationPolicyTest'], check=True)
print('PASS: release/rotation/audio-lifecycle/security source contracts (not native-device tests)')
