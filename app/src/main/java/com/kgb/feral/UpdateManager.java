package com.kgb.feral;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

// 공개 저장소에서 인증 없이 다운로드하고 서명 검증 후 적용한다.
public final class UpdateManager {
    private static final String SOURCE = PublicUpdates.ROOT + "stable.feral";
    private static final String CATALOG = PublicUpdates.ROOT + "catalog.json";
    private final java.util.function.Consumer<Runnable> saveThen;
    private final Runnable applySelected;
    private final Activity activity;
    private final UpdateCore core;
    private final int nativeCode;
    private final String nativeVersion, builtinVersion;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Runnable changed;
    private volatile String phase = "idle", message = "", pendingVersion = "";
    private volatile boolean busy, closed;

    public UpdateManager(Activity activity, UpdateCore core, int nativeCode, String nativeVersion, String builtinVersion, Runnable changed, java.util.function.Consumer<Runnable> saveThen, Runnable applySelected) {
        this.activity = activity;
        this.core = core;
        this.nativeCode = nativeCode;
        this.nativeVersion = nativeVersion;
        this.builtinVersion = builtinVersion;
        this.changed = changed;
        this.saveThen = saveThen; this.applySelected = applySelected;
        prefs = activity.getSharedPreferences("feral.updates", Context.MODE_PRIVATE);
        // Private-repository credentials are no longer needed or read.
        prefs.edit().remove("token").remove("iv").apply();
        pendingVersion = prefs.getString("pendingVersion", "");
    }

    public String status() {
        JSONObject result = new JSONObject();
        try {
            result.put("nativeVersion", nativeVersion).put("nativeCode", nativeCode)
                .put("runtimeCode", core.current()).put("pendingCode", core.pending())
                .put("blockedCode", core.blocked()).put("failureReason", core.failureReason())
                .put("pendingVersion", pendingVersion).put("phase", phase).put("message", message)
                .put("configured", true).put("publicUpdates", true).put("builtinVersion", builtinVersion).put("builtinCode", core.builtin()).put("automatic", prefs.getBoolean("automatic", true))
                .put("pinned", prefs.getBoolean("pinned", false)).put("lastCheck", prefs.getLong("lastCheck", 0)).put("busy", busy);
        } catch (JSONException ignored) { }
        return result.toString();
    }

    public void automatic() {
        if (prefs.getBoolean("automatic", true) && !prefs.getBoolean("pinned", false)) check(false);
    }
    public void setAutomatic(boolean enabled) {
        prefs.edit().putBoolean("automatic", enabled).putBoolean("pinned", false).apply();
        signal("idle", enabled ? "실행할 때 업데이트를 확인합니다." : "자동 확인을 껐습니다.");
    }
    public void recovered() { signal("recovered", "새 버전의 시작이 완료되지 않아 이전 게임과 저장으로 복구했습니다. 게임 버전 목록에서 다시 검증 후 실행할 수 있습니다."); }

    public synchronized void check(boolean manual) {
        if (busy || closed) return;
        if (core.pending() != 0 && core.pending() != core.current()) { signal("ready", "새 버전이 준비됐습니다. 다음 실행에 적용합니다."); return; }
        // 비정상 종료 복구 중인 버전과 새 패키지 준비 작업의 겹침 방지
        if (core.trial()) return;
        if (!manual && System.currentTimeMillis() - prefs.getLong("lastCheck", 0) < 900000) return;
        busy = true;
        signal("checking", "새 버전을 확인합니다…");
        worker.execute(() -> {
            try {
                byte[] raw = PublicUpdates.download(SOURCE, 12 * 1024 * 1024);
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

    public synchronized void chooseVersions() { chooseVersions(false); }
    public synchronized void chooseVersions(boolean retryFailed) {
        if (busy || closed || core.trial()) return;
        busy = true;
        worker.execute(() -> {
            String warning = "";
            try {
                {
                    String json = new String(PublicUpdates.download(CATALOG, 512 * 1024), "UTF-8");
                    JSONObject parsed = new JSONObject(json);
                    if (parsed.getInt("format") != 1 || parsed.getJSONArray("versions").length() > 500)
                        throw new IOException("지원하지 않는 버전 목록입니다.");
                    prefs.edit().putString("catalog", json).apply();
                }
            } catch (Exception e) { warning = "목록을 새로 받지 못했습니다. 저장된 목록을 표시합니다."; }
            final String note = warning;
            activity.runOnUiThread(() -> {
                busy = false;
                if (!closed) showVersions(note, retryFailed);
            });
        });
    }
    private void showVersions(String note, boolean retryFailed) {
        try {
            JSONArray source = new JSONObject(prefs.getString("catalog", "{\"versions\":[]}")).getJSONArray("versions");
            ArrayList<JSONObject> rows = new ArrayList<>();
            rows.add(new JSONObject().put("version", builtinVersion).put("versionCode", core.builtin())
                .put("minNativeCode", nativeCode).put("branch", "앱 동봉 · 오프라인"));
            for (int i = source.length() - 1; i >= 0; i--) {
                JSONObject row = source.getJSONObject(i);
                if (row.getInt("versionCode") != core.builtin()) rows.add(row);
            }
            if (retryFailed) {
                for (JSONObject row : rows) if (row.getInt("versionCode") == core.blocked()) {
                    confirmSelection(row); return;
                }
                Toast.makeText(activity, "재시도할 버전을 목록에서 선택하세요.", Toast.LENGTH_LONG).show();
            }
            String[] labels = new String[rows.size()];
            for (int i = 0; i < rows.size(); i++) {
                JSONObject row = rows.get(i);
                labels[i] = row.getString("version") + " · " + row.optString("branch", "기록")
                    + " · #" + row.getInt("versionCode")
                    + (row.getInt("versionCode") == core.current() ? " [실행 중]" : "")
                    + (row.getInt("versionCode") == core.blocked() ? ("interrupted".equals(core.failureReason()) ? " [시작 중단 · 재시도]" : " [실행 실패 · 재시도]") : "")
                    + (row.getInt("minNativeCode") > nativeCode ? " [새 APK 필요]" : "");
            }
            new AlertDialog.Builder(activity).setTitle("게임 버전 선택 · 앱 " + nativeVersion)
                .setItems(labels, (dialog, index) -> {
                    confirmSelection(rows.get(index));
                }).setNegativeButton("닫기", null)
                .setNeutralButton("공개 업데이트 안내", (d,w) -> configure()).show();
            if (!note.isEmpty()) Toast.makeText(activity, note, Toast.LENGTH_LONG).show();
        } catch (Exception e) { signal("error", "버전 목록을 읽지 못했습니다."); }
    }
    private void confirmSelection(JSONObject row) {
        try {
            boolean retry = row.getInt("versionCode") == core.blocked();
            UpdateCore.checkSelection(row.getInt("versionCode"), row.getInt("minNativeCode"), nativeCode, core.current(), core.blocked(), retry);
            new AlertDialog.Builder(activity).setTitle(retry ? "이 버전을 다시 실행할까요?" : "이 게임으로 전환할까요?")
                .setMessage(retry
                    ? "현재 게임을 저장한 뒤 패키지의 서명과 파일을 다시 검증합니다. 시작 중 앱을 닫았거나 오류가 났던 버전도 재시도할 수 있습니다. 다시 실패하면 현재 게임과 저장으로 복구합니다. 버전별 저장은 분리됩니다."
                    : "현재 게임을 저장하고 재시작합니다. 버전별 저장은 분리되며, 처음 선택한 버전은 새 저장으로 시작합니다. 앱 버전은 " + nativeVersion + "로 유지됩니다.")
                .setNegativeButton("취소", null).setPositiveButton(retry ? "다시 검증 후 실행" : "저장 후 전환", (d,w) -> saveThen.accept(() -> selectVersion(row, retry))).show();
        } catch (Exception e) { signal("error", e.getMessage()); Toast.makeText(activity, e.getMessage(), Toast.LENGTH_LONG).show(); }
    }
    private synchronized void selectVersion(JSONObject row, boolean retry) {
        if (busy || closed || core.trial()) return;
        busy = true;
        signal("downloading", "선택한 게임을 검증합니다…");
        worker.execute(() -> {
            try {
                int code = row.getInt("versionCode");
                if (code == core.builtin()) core.selectBuiltin(retry);
                else {
                    String path = row.getString("path");
                    if (!path.matches("(?:versions/[0-9]+\\.[0-9]+\\.[0-9]+|builds/[0-9]+)\\.feral")) throw new IOException("잘못된 패키지 경로입니다.");
                    String address = PublicUpdates.address(path);
                    JSONObject envelope = new JSONObject(new String(PublicUpdates.download(address, 12 * 1024 * 1024), "UTF-8"));
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
                    UpdateCore.checkSelection(code, manifest.getInt("minNativeCode"), nativeCode, core.current(), core.blocked(), retry);
                    byte[] archive = Base64.getDecoder().decode(envelope.getString("archive"));
                    if (archive.length != manifest.getInt("archiveBytes")) throw new IOException("업데이트 크기가 다릅니다.");
                    JSONObject files = manifest.getJSONObject("files");
                    Map<String,String> hashes = new HashMap<>();
                    Iterator<String> keys = files.keys();
                    while (keys.hasNext()) { String key = keys.next(); hashes.put(key, files.getString(key)); }
                    core.stage(code, archive, hashes, manifest.getInt("expandedBytes"), manifest.getString("archiveSha256"), true, retry);
                }
                pendingVersion = row.getString("version");
                prefs.edit().putBoolean("pinned", true).putString("pendingVersion", pendingVersion).apply();
                signal("ready", pendingVersion + " 선택 완료 · 재시작합니다.");
                activity.runOnUiThread(() -> { if (!closed) applySelected.run(); });
            } catch (Exception e) { signal("error", "선택한 게임을 준비하지 못했습니다. 현재 게임과 저장은 유지됩니다. 연결·호환성·패키지를 확인하고 버전 목록에서 다시 시도하세요."); }
            finally { busy = false; notifyChanged(); }
        });
    }

    public static byte[] read(InputStream in, int limit) throws IOException {
        return PublicUpdates.read(in, limit);
    }
    // Keep the bridge entry point so older game bundles can open public update help.
    public void configure() {
        new AlertDialog.Builder(activity).setTitle("공개 GitHub 업데이트")
            .setMessage("이 저장소는 공개되어 있어 로그인이나 토큰 없이 업데이트와 게임 버전 목록을 받을 수 있습니다.\n\n앱 " + nativeVersion + " · 동봉 게임 " + builtinVersion + "\n버전을 선택하면 현재 게임을 저장하고 재시작합니다. 버전별 저장은 분리됩니다.")
            .setNegativeButton("닫기", null).setPositiveButton("지금 확인", (d,w) -> check(true)).show();
    }

    private void signal(String phase, String message) { this.phase = phase; this.message = message; notifyChanged(); }
    private void notifyChanged() { if (!closed) activity.runOnUiThread(changed); }
    public void close() { closed = true; worker.shutdownNow(); }
}
