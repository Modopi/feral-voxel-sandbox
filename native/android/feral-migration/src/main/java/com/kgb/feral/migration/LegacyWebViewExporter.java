package com.kgb.feral.migration;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.ViewGroup;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Loads a migration-only document at the same HTTPS origin as the previous
 * WebView. It reads localStorage and IndexedDB and streams a JSON export to a
 * private temporary file. It does not load game assets or change either store.
 */
final class LegacyWebViewExporter {
    interface Callback {
        void onComplete(String path, String error);
    }

    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String PATH = "/__feral_native_migration";
    private static final long MAX_BYTES = 512L * 1024L * 1024L;
    private static final String HTML = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script>\n"
        + "(async function(){\n"
        + "const sink=window.FeralMigrationSink; let chunk=0, pending='';\n"
        + "function write(s){pending+=s;if(pending.length>=65536){sink.append(chunk++,pending);pending='';}}\n"
        + "function q(v){return JSON.stringify(v);}\n"
        + "function fail(e){try{sink.fail(String(e&&e.message||e||'migration_failed'));}catch(_){}}\n"
        + "async function existingDb(){\n"
        + " if(!window.indexedDB)return null;\n"
        + " if(typeof indexedDB.databases==='function'){const names=await indexedDB.databases();if(!names.some(x=>x.name==='feral-vault'))return null;}\n"
        + " return await new Promise((resolve,reject)=>{let created=false;const request=indexedDB.open('feral-vault',1);\n"
        + "  request.onupgradeneeded=()=>{created=true;request.transaction.abort();};\n"
        + "  request.onerror=()=>{if(created)resolve(null);else reject(request.error||new Error('vault_open_failed'));};\n"
        + "  request.onsuccess=()=>{if(created){request.result.close();resolve(null);}else resolve(request.result);};\n"
        + " });\n"
        + "}\n"
        + "async function run(){\n"
        + " if(!sink.begin())throw new Error('export_file_unavailable');\n"
        + " const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('feral.'))keys.push(k);}\n"
        + " keys.sort();write('{\"localStorage\":{');\n"
        + " for(let i=0;i<keys.length;i++){if(i)write(',');const k=keys[i];write(q(k)+':'+q(localStorage.getItem(k)));}\n"
        + " write('},\"vault\":{\"available\":');\n"
        + " const db=await existingDb();\n"
        + " if(!db){write('false,\"rows\":[]}}');}\n"
        + " else{write('true,\"rows\":[');if(!db.objectStoreNames.contains('keys')){db.close();write(']}}');}\n"
        + " else{await new Promise((resolve,reject)=>{let first=true;const tx=db.transaction('keys','readonly');const request=tx.objectStore('keys').openCursor();\n"
        + "  request.onerror=()=>reject(request.error||new Error('vault_read_failed'));\n"
        + "  request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;try{if(!first)write(',');first=false;write(q(cursor.value));cursor.continue();}catch(e){reject(e);}};\n"
        + "  tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('vault_read_failed'));\n"
        + " });db.close();write(']}}');}}\n"
        + " if(pending.length)sink.append(chunk++,pending);sink.complete(chunk);\n"
        + "}\n"
        + "run().catch(fail);\n"
        + "})();\n"
        + "</script></body></html>";

    private final Activity activity;
    private final File outputDirectory;
    private final Callback callback;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean complete = new AtomicBoolean(false);
    private WebView webView;
    private Sink sink;
    private File partFile;
    private File finalFile;
    private FileOutputStream output;
    private String sinkError;
    private long bytes;
    private int nextChunk;
    private boolean begun;

    LegacyWebViewExporter(Activity activity, File outputDirectory, Callback callback) {
        this.activity = activity;
        this.outputDirectory = outputDirectory;
        this.callback = callback;
    }

    void start() {
        main.post(() -> {
            if (complete.get()) return;
            try {
                if (!outputDirectory.isDirectory() && !outputDirectory.mkdirs()) throw new IOException("migration_directory_unavailable");
                partFile = File.createTempFile("legacy-export-", ".json.part", outputDirectory);
                finalFile = new File(outputDirectory, "legacy-export-" + System.currentTimeMillis() + ".json");
                webView = new WebView(activity);
                webView.setVisibility(WebView.INVISIBLE);
                webView.setAlpha(0f);
                webView.setImportantForAccessibility(android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                WebSettings settings = webView.getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setDomStorageEnabled(true);
                settings.setAllowFileAccess(false);
                settings.setAllowContentAccess(false);
                settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
                sink = new Sink();
                webView.addJavascriptInterface(sink, "FeralMigrationSink");
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        if (!ORIGIN.equals(request.getUrl().getScheme() + "://" + request.getUrl().getHost()) ||
                            !PATH.equals(request.getUrl().getPath()) || !"GET".equals(request.getMethod())) return emptyResponse();
                        return pageResponse();
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        return !HOST.equals(request.getUrl().getHost()) || !"https".equals(request.getUrl().getScheme());
                    }

                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                        if (request.isForMainFrame()) finish(null, "migration_document_unavailable");
                    }

                    @Override
                    public void onPageStarted(WebView view, String url, Bitmap favicon) {
                        if (!url.startsWith(ORIGIN + PATH)) finish(null, "unexpected_migration_origin");
                    }
                });
                // A one-pixel invisible view keeps WebView lifecycle and IndexedDB
                // active while the game view remains visible and receives input.
                activity.addContentView(webView, new ViewGroup.LayoutParams(1, 1));
                main.postDelayed(() -> finish(null, "migration_timeout"), 60000);
                webView.loadUrl(ORIGIN + PATH);
            } catch (Exception error) {
                finish(null, error.getMessage() == null ? "migration_start_failed" : error.getMessage());
            }
        });
    }

    void cancel() {
        main.post(() -> finish(null, "migration_cancelled"));
    }

    private WebResourceResponse pageResponse() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; img-src 'none'; style-src 'none'");
        return new WebResourceResponse("text/html", "UTF-8", 200, "OK", headers,
            new ByteArrayInputStream(HTML.getBytes(StandardCharsets.UTF_8)));
    }

    private static WebResourceResponse emptyResponse() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0]));
    }

    private final class Sink {
        @android.webkit.JavascriptInterface
        public synchronized boolean begin() {
            if (begun || complete.get()) return false;
            try {
                output = new FileOutputStream(partFile, false);
                begun = true;
                return true;
            } catch (IOException error) {
                sinkError = "export_file_unavailable";
                main.post(() -> finish(null, "export_file_unavailable"));
                return false;
            }
        }

        @android.webkit.JavascriptInterface
        public synchronized void append(int sequence, String value) {
            if (!begun || complete.get()) return;
            if (sinkError != null) return;
            try {
                if (sequence != nextChunk++) throw new IOException("export_chunk_order_invalid");
                byte[] data = value.getBytes(StandardCharsets.UTF_8);
                bytes += data.length;
                if (bytes > MAX_BYTES) throw new IOException("legacy_export_too_large");
                output.write(data);
            } catch (Exception error) {
                sinkError = error.getMessage() == null ? "export_write_failed" : error.getMessage();
                main.post(() -> finish(null, error.getMessage() == null ? "export_write_failed" : error.getMessage()));
            }
        }

        @android.webkit.JavascriptInterface
        public synchronized void complete(int chunks) {
            if (!begun || complete.get()) return;
            if (sinkError != null) {
                final String error = sinkError;
                main.post(() -> finish(null, error));
                return;
            }
            if (chunks != nextChunk) {
                main.post(() -> finish(null, "export_chunk_count_invalid"));
                return;
            }
            try {
                output.flush();
                FileDescriptor descriptor = output.getFD();
                descriptor.sync();
                output.close();
                output = null;
                if (!partFile.renameTo(finalFile)) throw new IOException("export_commit_failed");
                main.post(() -> finish(finalFile.getAbsolutePath(), ""));
            } catch (Exception error) {
                main.post(() -> finish(null, error.getMessage() == null ? "export_commit_failed" : error.getMessage()));
            }
        }

        @android.webkit.JavascriptInterface
        public void fail(String error) {
            main.post(() -> finish(null, error == null || error.isEmpty() ? "legacy_export_failed" : error));
        }
    }

    private void finish(String path, String error) {
        if (!complete.compareAndSet(false, true)) return;
        try {
            if (output != null) output.close();
        } catch (IOException ignored) { }
        output = null;
        if (path == null && partFile != null) partFile.delete();
        if (webView != null) {
            webView.removeJavascriptInterface("FeralMigrationSink");
            webView.stopLoading();
            if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        callback.onComplete(path, error);
    }
}
