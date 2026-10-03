package io.neonguandan.game;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Offline-only host. No permissions, network access, JS bridge or remote navigation. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/assets/www/index.html";
    private WebView web;
    private boolean resumed;
    private AlertDialog exitDialog;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(0xff081c22);
        // Respect display cutouts in either orientation, including Android 15 edge-to-edge.
        container.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                int left = 0, top = 0, right = 0, bottom = 0;
                if (Build.VERSION.SDK_INT >= 28) {
                    DisplayCutout cutout = insets.getDisplayCutout();
                    if (cutout != null) {
                        left = cutout.getSafeInsetLeft(); top = cutout.getSafeInsetTop();
                        right = cutout.getSafeInsetRight(); bottom = cutout.getSafeInsetBottom();
                    }
                }
                view.setPadding(left, top, right, bottom);
                return insets;
            }
        });
        web = new WebView(this);
        web.setBackgroundColor(0xff081c22);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl(), request.getMethod());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return serveAsset(Uri.parse(url), "GET");
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOME.equals(request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !HOME.equals(url);
            }
            @Override public void onPageFinished(WebView view, String url) {
                dispatchLifecycle(resumed && hasWindowFocus() && (exitDialog == null || !exitDialog.isShowing()));
            }
        });
        container.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(container);
        makeImmersive();
        web.loadUrl(HOME);
    }

    private WebResourceResponse serveAsset(Uri uri, String method) {
        String path = uri.getPath();
        if ("GET".equals(method) && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                && uri.getPort() == -1 && uri.getUserInfo() == null && uri.getQuery() == null) {
            String name = path == null ? "" : path.substring(path.lastIndexOf('/') + 1);
            if (("/assets/www/" + name).equals(path) && (name.equals("index.html") || name.equals("game.js")
                    || name.equals("engine.js") || name.equals("style.css"))) {
                String mime = name.endsWith(".js") ? "application/javascript" : name.endsWith(".css") ? "text/css" : "text/html";
                Map<String, String> headers = new HashMap<String, String>();
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Cache-Control", "no-cache");
                try { return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open("www/" + name)); }
                catch (IOException ignored) { }
            }
        }
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
                new ByteArrayInputStream("Offline resource unavailable".getBytes(StandardCharsets.UTF_8)));
    }

    private void makeImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    private void dispatchLifecycle(boolean active) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('guandan-" + (active ? "resume" : "pause") + "'))", null);
    }

    @Override protected void onPause() {
        resumed = false;
        dispatchLifecycle(false);
        if (web != null) { web.onPause(); web.pauseTimers(); }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (web != null) { web.resumeTimers(); web.onResume(); }
        makeImmersive();
        dispatchLifecycle(hasWindowFocus() && (exitDialog == null || !exitDialog.isShowing()));
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) makeImmersive();
        dispatchLifecycle(focused && resumed && (exitDialog == null || !exitDialog.isShowing()));
    }
    @Override public void onBackPressed() {
        if (exitDialog != null && exitDialog.isShowing()) return;
        dispatchLifecycle(false);
        exitDialog = new AlertDialog.Builder(this).setTitle("退出星曜掼蛋？")
                .setMessage("牌局进度保存在此设备，下次打开可继续。")
                .setNegativeButton("继续游戏", null)
                .setPositiveButton("退出", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) { finish(); }
                }).create();
        exitDialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
            @Override public void onDismiss(DialogInterface dialog) {
                if (!isFinishing()) { makeImmersive(); dispatchLifecycle(resumed && hasWindowFocus()); }
            }
        });
        exitDialog.show();
    }
    @Override protected void onDestroy() {
        if (exitDialog != null) { exitDialog.setOnDismissListener(null); exitDialog.dismiss(); exitDialog = null; }
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
