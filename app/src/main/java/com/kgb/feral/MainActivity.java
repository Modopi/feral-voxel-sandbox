package com.kgb.feral;

import android.annotation.SuppressLint;
import android.app.*;
import android.os.*;
import android.view.*;
import android.webkit.*;
import java.io.*;
import java.util.*;
import org.json.*;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private WebView game;
    private UpdateCore core;
    private UpdateManager updates;
    private volatile File activeDirectory;
    private boolean bootstrapping, destroyed;
    private volatile String restore = "null";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable watchdog = () -> failTrial();

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        try {
            android.content.pm.PackageInfo pkg = getPackageManager().getPackageInfo(getPackageName(), 0);
            JSONObject bundled;
            try (InputStream in = getAssets().open("game-version.json")) {
                bundled = new JSONObject(new String(UpdateManager.read(in, 4096), "UTF-8"));
            }
            core = new UpdateCore(new File(getFilesDir(), "updates"), bundled.getInt("versionCode"), pkg.versionCode);
            boolean recovered = core.recover();
            if (recovered) restore = core.snapshot();
            updates = new UpdateManager(this, core, pkg.versionCode, pkg.versionName, bundled.getString("version"), this::notifyUpdates, this::saveThen, this::launchBootstrap);
            if (recovered) updates.recovered();
        } catch (Exception e) { fatal("업데이트 상태를 읽지 못했습니다. 앱을 다시 실행해 주세요."); return; }
        game = new WebView(this);
        game.setBackgroundColor(0xff193a2c);
        game.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = game.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        // 저장의 HTTPS 출처를 0.1/0.2와 동일하게 유지
        game.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!"https".equals(request.getUrl().getScheme()) || !HOST.equals(request.getUrl().getHost())
                        || !"GET".equals(request.getMethod())) return empty();
                String path = request.getUrl().getPath();
                try {
                    if ("/bootstrap".equals(path)) return response("text/html", new ByteArrayInputStream(bootstrapHtml().getBytes("UTF-8")));
                    if (path == null || !path.startsWith("/assets/")) return empty();
                    path = path.substring(8);
                    // 불완전한 업데이트에서 APK 파일을 섞어 반환하지 않는 버전 단위 로딩
                    File directory = activeDirectory;
                    UpdateCore.safeFile(directory == null ? getFilesDir() : directory, path);
                    InputStream in = directory == null ? getAssets().open(path) : new FileInputStream(UpdateCore.safeFile(directory, path));
                    String mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css"
                        : path.endsWith(".html") ? "text/html" : path.endsWith(".json") ? "application/json" : "application/octet-stream";
                    return response(mime, in);
                } catch (Exception e) { return empty(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost()) || !"https".equals(request.getUrl().getScheme());
            }
        });
        game.addJavascriptInterface(new NativeBridge(), "AndroidApp");
        android.widget.FrameLayout shell = new android.widget.FrameLayout(this);
        shell.addView(game);
        android.widget.Button versions = new android.widget.Button(this);
        versions.setText("게임 버전"); versions.setTextSize(10);
        android.widget.FrameLayout.LayoutParams button = new android.widget.FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        versions.setAlpha(0.8f); versions.setOnClickListener(v -> { if (!bootstrapping) updates.chooseVersions(); });
        shell.addView(versions, button);
        setContentView(shell);
        immersive();
        launchBootstrap();
    }

    private void saveThen(Runnable next) {
        if (bootstrapping || destroyed || core.trial()) return;
        game.evaluateJavascript("(function(){try{const n=window.FeralNative; const playing=window.FERAL&&window.FERAL.stats?window.FERAL.stats().running:undefined; if(n&&n.save&&playing!==false&&n.save()===false)return false;if(n&&n.pause)n.pause();return true}catch(e){return false}})()", result -> {
            if ("true".equals(result)) next.run();
            else new AlertDialog.Builder(this).setTitle("게임 전환 중단").setMessage("현재 게임을 저장하지 못했습니다.").setPositiveButton("닫기", null).show();
        });
    }

    private void launchBootstrap() {
        bootstrapping = true;
        handler.removeCallbacks(watchdog);
        game.loadUrl(ORIGIN + "/bootstrap");
    }
    private String bootstrapHtml() {
        // 게임과 독립된 시작 페이지에서 저장 백업·복원을 수행
        String data = restore.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        return "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'><body style='background:#193a2c;color:#e9f1df;font:18px sans-serif;padding:8%'>FERAL · 탐험 준비 중…<script>"
            + "try{const restore=" + data + ";if(restore){Object.keys(localStorage).filter(k=>k.startsWith('feral.')).forEach(k=>localStorage.removeItem(k));Object.entries(restore).forEach(([k,v])=>{if(k.startsWith('feral.'))localStorage.setItem(k,v)});}"
            + "const save={};Object.keys(localStorage).filter(k=>k.startsWith('feral.')).forEach(k=>save[k]=localStorage.getItem(k));AndroidApp.bootstrap(JSON.stringify(save));}"
            + "catch(e){document.body.textContent='저장 데이터를 준비하지 못했습니다. 앱을 다시 실행해 주세요.'}</script>";
    }
    private static WebResourceResponse response(String mime, InputStream in) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'");
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, in);
    }
    private static WebResourceResponse empty() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private void notifyUpdates() {
        if (game != null && !destroyed) game.evaluateJavascript("window.FeralUpdates && window.FeralUpdates.refresh()", null);
    }
    private void failTrial() {
        if (destroyed || core == null || !core.trial()) return;
        try {
            if (core.rollback()) restore = core.snapshot();
            updates.recovered();
            launchBootstrap();
        } catch (IOException e) { fatal("이전 버전으로 복구하지 못했습니다. 앱을 다시 실행해 주세요."); }
    }
    private void fatal(String message) { new AlertDialog.Builder(this).setTitle("FERAL").setMessage(message).setPositiveButton("닫기", (d, w) -> finish()).show(); }

    public final class NativeBridge {
        @JavascriptInterface public String platform() { return "Android"; }
        @JavascriptInterface public String updateStatus() { return updates.status(); }
        @JavascriptInterface public void configureUpdates() { runOnUiThread(() -> updates.configure()); }
        @JavascriptInterface public void chooseVersions() { runOnUiThread(() -> updates.chooseVersions()); }
        @JavascriptInterface public void checkUpdates() { updates.check(true); }
        @JavascriptInterface public void setAutoUpdates(boolean enabled) { updates.setAutomatic(enabled); }
        @JavascriptInterface public void applyUpdate() {
            runOnUiThread(() -> {
                if ((core.pending() == 0 || core.pending() == core.current()) || core.trial()) return;
                game.evaluateJavascript("window.FeralNative && window.FeralNative.pause()", result -> launchBootstrap());
            });
        }
        @JavascriptInterface public void bootstrap(String snapshot) {
            runOnUiThread(() -> {
                if (!bootstrapping || destroyed) return;
                try {
                    if (snapshot.length() > 8 * 1024 * 1024) throw new IOException("저장 크기 초과");
                    new JSONObject(snapshot);
                    core.restored();
                    boolean activated = core.beginTrial(snapshot);
                    String selectedSave = activated ? core.activationSnapshot() : null;
                    if (selectedSave != null) {
                        new JSONObject(selectedSave);
                        restore = selectedSave;
                        game.loadUrl(ORIGIN + "/bootstrap");
                        return;
                    }
                    activeDirectory = core.activeDirectory();
                    restore = "null";
                    bootstrapping = false;
                    game.loadUrl(ORIGIN + "/assets/index.html");
                    if (core.trial()) handler.postDelayed(watchdog, 45000);
                    updates.automatic();
                } catch (Exception e) {
                    if (core.trial()) failTrial();
                    else fatal("탐험을 시작하지 못했습니다. 다시 실행해 주세요.");
                }
            });
        }
        @JavascriptInterface public void runtimeHealthy(int code) {
            runOnUiThread(() -> {
                if (destroyed || bootstrapping) return;
                try { core.healthy(code); handler.removeCallbacks(watchdog); updates.automatic(); }
                catch (IOException e) { failTrial(); }
            });
        }
        @JavascriptInterface public void runtimeFailed() { runOnUiThread(() -> failTrial()); }
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) immersive(); }
    @Override protected void onPause() {
        handler.removeCallbacks(watchdog);
        if (game != null) { game.evaluateJavascript("window.FeralNative && window.FeralNative.pause()", null); game.onPause(); }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (game != null) { game.onResume(); if (core.trial() && !bootstrapping) handler.postDelayed(watchdog, 45000); }
    }
    @Override public void onBackPressed() { if (game != null) game.evaluateJavascript("window.FeralNative && window.FeralNative.back()", null); }
    @Override protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        if (updates != null) updates.close();
        if (game != null) { game.removeJavascriptInterface("AndroidApp"); game.destroy(); }
        super.onDestroy();
    }
}
