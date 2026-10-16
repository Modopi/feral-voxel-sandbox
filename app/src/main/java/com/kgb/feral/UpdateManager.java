package com.kgb.feral;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.net.Uri;
import android.security.keystore.*;
import android.text.InputType;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

// 토큰은 JavaScript에 전달하지 않으며 API 호스트에만 전송
public final class UpdateManager {
    private static final String SOURCE = "https://api.github.com/repos/Modopi/feral-voxel-sandbox/contents/stable.feral?ref=updates";
    private static final String CATALOG = "https://api.github.com/repos/Modopi/feral-voxel-sandbox/contents/catalog.json?ref=updates";
    private final java.util.function.Consumer<Runnable> saveThen;
    private final Runnable applySelected;
    private static final String KEY_ALIAS = "feral.github.readonly";
    private final Activity activity;
    private final UpdateCore core;
    private final int nativeCode;
    private final String nativeVersion;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Runnable changed;
    private volatile String phase = "idle", message = "", pendingVersion = "";
    private volatile boolean busy, closed;

    public UpdateManager(Activity activity, UpdateCore core, int nativeCode, String nativeVersion, Runnable changed, java.util.function.Consumer<Runnable> saveThen, Runnable applySelected) {
        this.activity = activity;
        this.core = core;
        this.nativeCode = nativeCode;
        this.nativeVersion = nativeVersion;
        this.changed = changed;
        this.saveThen = saveThen; this.applySelected = applySelected;
        prefs = activity.getSharedPreferences("feral.updates", Context.MODE_PRIVATE);
        pendingVersion = prefs.getString("pendingVersion", "");
    }

    public String status() {
        JSONObject result = new JSONObject();
        try {
            result.put("nativeVersion", nativeVersion).put("nativeCode", nativeCode)
                .put("runtimeCode", core.current()).put("pendingCode", core.pending())
                .put("pendingVersion", pendingVersion).put("phase", phase).put("message", message)
                .put("configured", prefs.contains("token")).put("automatic", prefs.getBoolean("automatic", true))
                .put("pinned", prefs.getBoolean("pinned", false)).put("lastCheck", prefs.getLong("lastCheck", 0)).put("busy", busy);
        } catch (JSONException ignored) { }
        return result.toString();
    }

    public void automatic() {
        if (prefs.getBoolean("automatic", true) && !prefs.getBoolean("pinned", false) && prefs.contains("token")) check(false);
    }
    public void setAutomatic(boolean enabled) {
        prefs.edit().putBoolean("automatic", enabled).putBoolean("pinned", false).apply();
        signal("idle", enabled ? "실행할 때 업데이트를 확인합니다." : "자동 확인을 껐습니다.");
    }
    public void recovered() { signal("recovered", "새 버전을 시작하지 못해 이전 버전과 저장으로 복구했습니다."); }

    public synchronized void check(boolean manual) {
        if (busy || closed) return;
        if (!prefs.contains("token")) { signal("setup", "GitHub 연결 후 자동 업데이트를 사용할 수 있습니다."); return; }
        if (core.pending() != 0 && core.pending() != core.current()) { signal("ready", "새 버전이 준비됐습니다. 다음 실행에 적용합니다."); return; }
        // 비정상 종료 복구 중인 버전과 새 패키지 준비 작업의 겹침 방지
        if (core.trial()) return;
        if (!manual && System.currentTimeMillis() - prefs.getLong("lastCheck", 0) < 900000) return;
        busy = true;
        signal("checking", "새 버전을 확인합니다…");
        worker.execute(() -> {
            try {
                String token = readToken();
                byte[] raw = download(SOURCE, token, 12 * 1024 * 1024);
                JSONObject envelope = new JSONObject(new String(raw, "UTF-8"));
                byte[] manifestBytes = Base64.getDecoder().decode(envelope.getString("manifest"));
                byte[] signature = Base64.getDecoder().decode(envelope.getString("signature"));
                if (manifestBytes.length > 65536) throw new IOException("업데이트 정보가 너무 큽니다.");
                byte[] publicKey;
                try (InputStream in = activity.getAssets().open("update-public.der")) { publicKey = read(in, 4096); }
                UpdateCore.verifySignature(manifestBytes, signature, publicKey);
                JSONObject manifest = new JSONObject(new String(manifestBytes, "UTF-8"));
                int code = manifest.getInt("versionCode"), minNative = manifest.getInt("minNativeCode");
                String version = manifest.getString("version");
                if (manifest.getInt("format") != 1 || !"stable".equals(manifest.getString("channel"))
                        || !version.matches("[0-9]+\\.[0-9]+\\.[0-9]+") || minNative < 205
                        || minNative > code || manifest.getInt("saveSchema") < 1)
                    throw new IOException("지원하지 않는 업데이트 형식입니다.");
                prefs.edit().putLong("lastCheck", System.currentTimeMillis()).apply();
                if (code <= core.current()) { signal("current", "최신 버전입니다."); return; }
                if (minNative > nativeCode) { signal("native", version + " 버전은 새 APK 설치가 필요합니다."); return; }
                UpdateCore.checkVersion(code, minNative, nativeCode, core.current(), core.blocked());
                signal("downloading", version + " 업데이트 파일을 검증합니다…");
                byte[] archive = Base64.getDecoder().decode(envelope.getString("archive"));
                if (archive.length != manifest.getInt("archiveBytes")) throw new IOException("업데이트 크기가 일치하지 않습니다.");
                JSONObject files = manifest.getJSONObject("files");
                Map<String, String> hashes = new HashMap<>();
                Iterator<String> keys = files.keys();
                while (keys.hasNext()) { String path = keys.next(); hashes.put(path, files.getString(path)); }
                core.stage(code, archive, hashes, manifest.getInt("expandedBytes"), manifest.getString("archiveSha256"));
                pendingVersion = version;
                prefs.edit().putString("pendingVersion", version).apply();
                signal("ready", version + " 준비 완료 · 다음 실행에 적용합니다.");
            } catch (Exception e) {
                // 응답·토큰·주소 등 자격 증명이 포함될 수 있는 원문 로그의 노출 방지
                String detail = e instanceof UnknownHostException || e instanceof SocketTimeoutException
                    || e instanceof javax.net.ssl.SSLException ? "인터넷에 연결하지 못했습니다. 현재 버전으로 계속 플레이할 수 있습니다."
                    : e instanceof IOException ? e.getMessage() : "서명 또는 업데이트 파일을 확인할 수 없습니다.";
                signal("error", detail == null ? "연결하지 못했습니다. 현재 버전으로 계속 플레이할 수 있습니다." : detail);
            } finally { busy = false; notifyChanged(); }
        });
    }

    public synchronized void chooseVersions() {
        if (busy || closed || core.trial()) return;
        busy = true;
        worker.execute(() -> {
            String warning = "";
            try {
                if (prefs.contains("token")) {
                    String json = new String(download(CATALOG, readToken(), 512 * 1024), "UTF-8");
                    JSONObject parsed = new JSONObject(json);
                    if (parsed.getInt("format") != 1 || parsed.getJSONArray("versions").length() > 500)
                        throw new IOException("지원하지 않는 버전 목록입니다.");
                    prefs.edit().putString("catalog", json).apply();
                } else warning = "GitHub 연결 후 배포 버전을 조회할 수 있습니다.";
            } catch (Exception e) { warning = "목록을 새로 받지 못했습니다. 저장된 목록을 표시합니다."; }
            final String note = warning;
            activity.runOnUiThread(() -> {
                busy = false;
                if (!closed) showVersions(note);
            });
        });
    }
    private void showVersions(String note) {
        try {
            JSONArray source = new JSONObject(prefs.getString("catalog", "{\"versions\":[]}")).getJSONArray("versions");
            ArrayList<JSONObject> rows = new ArrayList<>();
            rows.add(new JSONObject().put("version", nativeVersion).put("versionCode", nativeCode)
                .put("minNativeCode", nativeCode).put("branch", "앱 동봉 · 오프라인"));
            for (int i = source.length() - 1; i >= 0; i--) {
                JSONObject row = source.getJSONObject(i);
                if (row.getInt("versionCode") != nativeCode) rows.add(row);
            }
            String[] labels = new String[rows.size()];
            for (int i = 0; i < rows.size(); i++) {
                JSONObject row = rows.get(i);
                labels[i] = row.getString("version") + " · " + row.optString("branch", "기록")
                    + " · #" + row.getInt("versionCode")
                    + (row.getInt("versionCode") == core.current() ? " [실행 중]" : "")
                    + (row.getInt("minNativeCode") > nativeCode ? " [새 APK 필요]" : "");
            }
            new AlertDialog.Builder(activity).setTitle("게임 버전 선택 · 앱 " + nativeVersion)
                .setItems(labels, (dialog, index) -> {
                    JSONObject row = rows.get(index);
                    try {
                        UpdateCore.checkSelection(row.getInt("versionCode"), row.getInt("minNativeCode"), nativeCode, core.current(), core.blocked());
                        new AlertDialog.Builder(activity).setTitle("이 게임으로 전환할까요?")
                            .setMessage("현재 게임을 저장하고 재시작합니다. 버전별 저장은 분리되며, 처음 선택한 버전은 새 저장으로 시작합니다. 앱 버전은 " + nativeVersion + "로 유지됩니다.")
                            .setNegativeButton("취소", null).setPositiveButton("저장 후 전환", (d,w) -> saveThen.accept(() -> selectVersion(row))).show();
                    } catch (Exception e) { signal("error", e.getMessage()); Toast.makeText(activity, e.getMessage(), Toast.LENGTH_LONG).show(); }
                }).setNegativeButton("닫기", null)
                .setNeutralButton("GitHub 연결", (d,w) -> configure()).show();
            if (!note.isEmpty()) Toast.makeText(activity, note, Toast.LENGTH_LONG).show();
        } catch (Exception e) { signal("error", "버전 목록을 읽지 못했습니다."); }
    }
    private synchronized void selectVersion(JSONObject row) {
        if (busy || closed || core.trial()) return;
        busy = true;
        signal("downloading", "선택한 게임을 검증합니다…");
        worker.execute(() -> {
            try {
                int code = row.getInt("versionCode");
                if (code == nativeCode) core.selectBuiltin();
                else {
                    String path = row.getString("path");
                    if (!path.matches("(?:versions/[0-9]+\\.[0-9]+\\.[0-9]+|builds/[0-9]+)\\.feral")) throw new IOException("잘못된 패키지 경로입니다.");
                    String address = "https://api.github.com/repos/Modopi/feral-voxel-sandbox/contents/" + path + "?ref=updates";
                    JSONObject envelope = new JSONObject(new String(download(address, readToken(), 12 * 1024 * 1024), "UTF-8"));
                    byte[] raw = Base64.getDecoder().decode(envelope.getString("manifest"));
                    if (raw.length > 65536) throw new IOException("업데이트 정보가 너무 큽니다.");
                    byte[] publicKey;
                    try (InputStream in = activity.getAssets().open("update-public.der")) { publicKey = read(in, 4096); }
                    UpdateCore.verifySignature(raw, Base64.getDecoder().decode(envelope.getString("signature")), publicKey);
                    JSONObject manifest = new JSONObject(new String(raw, "UTF-8"));
                    if (manifest.getInt("format") != 1 || manifest.getInt("versionCode") != code
                        || !manifest.getString("version").equals(row.getString("version"))
                        || !"stable".equals(manifest.getString("channel")) || manifest.getInt("saveSchema") < 1)
                        throw new IOException("선택한 게임과 서명된 정보가 다릅니다.");
                    UpdateCore.checkSelection(code, manifest.getInt("minNativeCode"), nativeCode, core.current(), core.blocked());
                    byte[] archive = Base64.getDecoder().decode(envelope.getString("archive"));
                    if (archive.length != manifest.getInt("archiveBytes")) throw new IOException("업데이트 크기가 다릅니다.");
                    JSONObject files = manifest.getJSONObject("files");
                    Map<String,String> hashes = new HashMap<>();
                    Iterator<String> keys = files.keys();
                    while (keys.hasNext()) { String key = keys.next(); hashes.put(key, files.getString(key)); }
                    core.stage(code, archive, hashes, manifest.getInt("expandedBytes"), manifest.getString("archiveSha256"), true);
                }
                pendingVersion = row.getString("version");
                prefs.edit().putBoolean("pinned", true).putString("pendingVersion", pendingVersion).apply();
                signal("ready", pendingVersion + " 선택 완료 · 재시작합니다.");
                activity.runOnUiThread(() -> { if (!closed) applySelected.run(); });
            } catch (Exception e) { signal("error", "선택한 게임을 준비하지 못했습니다. 연결·호환성·패키지를 확인하세요."); }
            finally { busy = false; notifyChanged(); }
        });
    }

    private static byte[] download(String address, String token, int limit) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects < 5; redirects++) {
            if (!"https".equals(url.getProtocol()) || !Arrays.asList("api.github.com", "raw.githubusercontent.com",
                    "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com").contains(url.getHost()))
                throw new IOException("허용하지 않은 업데이트 주소입니다.");
            HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("Accept", "application/vnd.github.raw+json");
            conn.setRequestProperty("User-Agent", "FERAL-Updater/1");
            conn.setRequestProperty("Cache-Control", "no-cache");
            if ("api.github.com".equals(url.getHost())) conn.setRequestProperty("Authorization", "Bearer " + token);
            try {
                int status = conn.getResponseCode();
                if (status >= 300 && status < 400) { url = new URL(url, conn.getHeaderField("Location")); continue; }
                if (status == 401 || status == 403) throw new IOException("GitHub 읽기 권한 또는 토큰 만료를 확인해 주세요.");
                if (status == 404) throw new IOException("배포 채널이 없거나 저장소 읽기 권한이 없습니다.");
                if (status != 200) throw new IOException("GitHub에 연결하지 못했습니다. 잠시 뒤 다시 확인해 주세요.");
                if (conn.getContentLengthLong() > limit) throw new IOException("업데이트 다운로드 크기 제한 초과");
                try (InputStream in = conn.getInputStream()) { return read(in, limit); }
            } finally { conn.disconnect(); }
        }
        throw new IOException("업데이트 주소 이동 횟수 초과");
    }
    public static byte[] read(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int n; (n = in.read(buffer)) != -1;) {
            if (out.size() + n > limit) throw new IOException("파일 크기 제한 초과");
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }

    public void configure() {
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * activity.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad / 2, pad, pad / 2);
        TextView help = new TextView(activity);
        help.setText("Modopi/feral-voxel-sandbox 저장소에만 Contents: Read 권한을 준 fine-grained 토큰을 입력하세요.\n토큰은 이 기기에 암호화하여 저장하며 게임 코드에는 전달하지 않습니다.\n빈 값으로 연결하면 기존 연결을 해제합니다.");
        EditText input = new EditText(activity);
        input.setSingleLine(true);
        input.setHint(prefs.contains("token") ? "새 토큰 입력 / 비워 두면 연결 해제" : "github_pat_…");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(help);
        layout.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("비공개 GitHub 업데이트")
            .setView(layout).setNegativeButton("취소", null)
            .setNeutralButton("토큰 만들기", (d, w) -> activity.startActivity(new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://github.com/settings/personal-access-tokens/new"))))
            .setPositiveButton("연결", null).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            if (busy) { input.setError("업데이트 확인이 끝난 뒤 변경해 주세요."); return; }
            String token = input.getText().toString().trim();
            if (token.isEmpty()) {
                prefs.edit().remove("token").remove("iv").remove("lastCheck").apply();
                signal("setup", "GitHub 연결을 해제했습니다."); dialog.dismiss(); return;
            }
            if (!token.matches("[A-Za-z0-9_]{20,255}")) { input.setError("토큰 형식을 확인해 주세요."); return; }
            try {
                writeToken(token);
                prefs.edit().remove("lastCheck").apply();
                input.setText(""); dialog.dismiss(); check(true);
            } catch (Exception e) { input.setError("기기 보안 저장소에 저장하지 못했습니다."); }
        }));
        dialog.show();
        dialog.getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE,
            android.view.WindowManager.LayoutParams.FLAG_SECURE);
    }

    private javax.crypto.SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (javax.crypto.SecretKey) store.getKey(KEY_ALIAS, null);
    }
    private void writeToken(String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
        boolean saved = prefs.edit().putString("token", Base64.getEncoder().encodeToString(cipher.doFinal(token.getBytes("UTF-8"))))
            .putString("iv", Base64.getEncoder().encodeToString(cipher.getIV())).commit();
        if (!saved) throw new IOException("토큰을 저장하지 못했습니다.");
    }
    private String readToken() throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, Base64.getDecoder().decode(prefs.getString("iv", ""))));
        return new String(cipher.doFinal(Base64.getDecoder().decode(prefs.getString("token", ""))), "UTF-8");
    }
    private void signal(String phase, String message) { this.phase = phase; this.message = message; notifyChanged(); }
    private void notifyChanged() { if (!closed) activity.runOnUiThread(changed); }
    public void close() { closed = true; worker.shutdownNow(); }
}
