package com.kgb.feral.migration;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import org.godotengine.godot.Godot;
import org.godotengine.godot.plugin.GodotPlugin;
import org.godotengine.godot.plugin.SignalInfo;
import org.godotengine.godot.plugin.UsedByGodot;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Signed native APK check and user-confirmed Android package installer handoff. */
public final class FeralUpdatesPlugin extends GodotPlugin {
    private static final String UPDATES_ROOT = "https://raw.githubusercontent.com/Modopi/feral-voxel-sandbox/updates/";
    private static final String PACKAGE = "com.kgb.feral";
    private static final String TRUSTED_SIGNER_SHA256 = "80ec9e5082918a64397ecea43ed75fc2fd48c63ac26401dc7d946259b9ee35ed";
    private static final int MAX_MANIFEST_ENVELOPE = 12 * 1024 * 1024;
    private static final int MAX_MANIFEST = 64 * 1024;
    private static final long MAX_APK_BYTES = 256L * 1024L * 1024L;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean busy;
    private volatile JSONObject latestManifest;
    private volatile JSONObject latestApk;
    private volatile File verifiedApk;
    private volatile String latestVersion;
    private volatile String latestNativeVersion;
    private volatile int latestNativeCode;

    public FeralUpdatesPlugin(Godot godot) {
        super(godot);
    }

    @Override
    public String getPluginName() {
        return "FeralUpdates";
    }

    @Override
    public Set<SignalInfo> getPluginSignals() {
        Set<SignalInfo> signals = new HashSet<>();
        signals.add(new SignalInfo("checked", String.class, String.class));
        signals.add(new SignalInfo("download_progress", Integer.class, Integer.class));
        signals.add(new SignalInfo("downloaded", String.class, String.class));
        signals.add(new SignalInfo("installer_result", String.class, String.class));
        return signals;
    }

    /** Fetch and verify the public stable manifest. Does not download or install an APK. */
    @UsedByGodot
    public void check_latest() {
        if (!beginWork()) { emitSignal("checked", "", "busy"); return; }
        worker.execute(() -> {
            try {
                JSONObject envelope = new JSONObject(new String(download(UPDATES_ROOT + "stable.feral", MAX_MANIFEST_ENVELOPE), "UTF-8"));
                byte[] manifestBytes = Base64.getDecoder().decode(envelope.getString("manifest"));
                byte[] signature = Base64.getDecoder().decode(envelope.getString("signature"));
                if (manifestBytes.length == 0 || manifestBytes.length > MAX_MANIFEST) throw new UpdateException("manifest_too_large");
                verifyManifest(manifestBytes, signature, readAsset("update-public.der", 4096));
                JSONObject manifest = new JSONObject(new String(manifestBytes, "UTF-8"));
                validateManifest(manifest);

                long currentCode = installedVersionCode();
                JSONObject apk = manifest.getJSONObject("nativeApk");
                String apkUrl = apk.getString("url");
                String nativeVersion = manifest.getString("nativeVersion");
                int nativeCode = manifest.getInt("nativeCode");
                validateApkMetadata(apk, manifest.getString("version"), nativeVersion, nativeCode);

                latestManifest = manifest;
                latestApk = apk;
                latestVersion = manifest.getString("version");
                latestNativeVersion = nativeVersion;
                latestNativeCode = nativeCode;
                verifiedApk = null;

                JSONObject result = new JSONObject();
                result.put("gameVersion", latestVersion)
                    .put("gameCode", manifest.getInt("versionCode"))
                    .put("nativeVersion", nativeVersion)
                    .put("nativeCode", nativeCode)
                    .put("currentNativeCode", currentCode)
                    .put("apkUrl", apkUrl)
                    .put("apkSha256", apk.getString("sha256"))
                    .put("apkBytes", apk.getLong("bytes"))
                    .put("packageName", apk.getString("packageName"))
                    .put("signerSha256", apk.getString("signerSha256"))
                    .put("available", nativeCode > currentCode);
                emitSignal("checked", result.toString(), "");
            } catch (Exception error) {
                latestManifest = null;
                latestApk = null;
                emitSignal("checked", "", error instanceof UpdateException ? error.getMessage() : safeNetworkError(error));
            } finally { busy = false; }
        });
    }

    /** Download, hash, inspect package and test signer. Leaves installation to `open_installer()`. */
    @UsedByGodot
    public void download_latest_apk() {
        if (!beginWork()) { emitSignal("downloaded", "", "busy"); return; }
        worker.execute(() -> {
            File temporary = null;
            try {
                final JSONObject apk = latestApk;
                final JSONObject manifest = latestManifest;
                if (apk == null || manifest == null) throw new UpdateException("check_latest_first");
                if (latestNativeCode <= installedVersionCode()) throw new UpdateException("already_current");

                long expectedBytes = apk.getLong("bytes");
                String expectedHash = apk.getString("sha256");
                String url = apk.getString("url");
                File directory = new File(getActivity().getCacheDir(), "feral-updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new UpdateException("cache_unavailable");
                File destination = new File(directory, latestNativeCode + ".apk");
                temporary = File.createTempFile("native-update-", ".part", directory);
                downloadApk(url, expectedBytes, expectedHash, temporary);
                verifyApk(temporary, apk, latestNativeVersion, latestNativeCode);
                try {
                    Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } catch (java.nio.file.AtomicMoveNotSupportedException unsupported) {
                    Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
                }
                temporary = null;
                verifiedApk = destination;
                emitSignal("downloaded", destination.getAbsolutePath(), "");
            } catch (Exception error) {
                emitSignal("downloaded", "", error instanceof UpdateException ? error.getMessage() : safeNetworkError(error));
            } finally {
                if (temporary != null) temporary.delete();
                busy = false;
            }
        });
    }

    /** Opens Android package installation UI only when the native UI calls this method. */
    @UsedByGodot
    public void open_installer() {
        runOnHostThread(() -> {
            try {
                final Activity activity = getActivity();
                final File apk = verifiedApk;
                final JSONObject metadata = latestApk;
                if (activity == null || apk == null || metadata == null || !apk.isFile()) throw new UpdateException("verified_apk_missing");
                // The app may have been updated by another installer after this
                // APK was downloaded. Never hand Android a stale/equal-version
                // package based only on the earlier download-time check.
                if (latestNativeCode <= installedVersionCode()) {
                    verifiedApk = null;
                    throw new UpdateException("already_current");
                }
                if (!sha256(apk).equals(metadata.getString("sha256"))) throw new UpdateException("apk_hash_mismatch");
                verifyApk(apk, metadata, latestNativeVersion, latestNativeCode);
                if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                    emitSignal("installer_result", "permission_required", "");
                    return;
                }
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".feralupdates.provider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                emitSignal("installer_result", "opened", "");
            } catch (Exception error) {
                emitSignal("installer_result", "", error instanceof UpdateException ? error.getMessage() : "installer_unavailable");
            }
        });
    }

    /** Opens Android's per-app install-source settings after a user asks to continue there. */
    @UsedByGodot
    public void open_install_permission_settings() {
        runOnHostThread(() -> {
            try {
                Activity activity = getActivity();
                if (activity == null) throw new UpdateException("activity_unavailable");
                if (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls()) {
                    emitSignal("installer_result", "permission_granted", "");
                    return;
                }
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(settings);
                emitSignal("installer_result", "permission_settings_opened", "");
            } catch (Exception error) {
                emitSignal("installer_result", "", "permission_settings_unavailable");
            }
        });
    }

    @Override
    public void onMainDestroy() {
        worker.shutdownNow();
        super.onMainDestroy();
    }

    private synchronized boolean beginWork() {
        if (busy) return false;
        busy = true;
        return true;
    }

    private void validateManifest(JSONObject manifest) throws Exception {
        int gameCode = manifest.getInt("versionCode");
        int minNativeCode = manifest.getInt("minNativeCode");
        String gameVersion = manifest.getString("version");
        String nativeVersion = manifest.getString("nativeVersion");
        int nativeCode = manifest.getInt("nativeCode");
        if (manifest.getInt("format") != 1 || !"stable".equals(manifest.getString("channel")) ||
            !gameVersion.matches("[0-9]+\\.[0-9]+\\.[0-9]+") ||
            !nativeVersion.matches("[0-9]+\\.[0-9]+\\.[0-9]+") ||
            gameCode < 1 || minNativeCode < 205 || minNativeCode > nativeCode || nativeCode < 1 ||
            manifest.getInt("saveSchema") < 1) throw new UpdateException("unsupported_signed_manifest");
    }

    private void validateApkMetadata(JSONObject apk, String gameVersion, String nativeVersion, int nativeCode) throws Exception {
        long bytes = apk.getLong("bytes");
        String hash = apk.getString("sha256").toLowerCase(Locale.ROOT);
        String packageName = apk.getString("packageName");
        String signer = apk.getString("signerSha256").toLowerCase(Locale.ROOT);
        if (bytes < 1 || bytes > MAX_APK_BYTES || !hash.matches("[0-9a-f]{64}") ||
            !PACKAGE.equals(packageName) || !PACKAGE.equals(getActivity().getPackageName()) ||
            !TRUSTED_SIGNER_SHA256.equals(signer)) throw new UpdateException("invalid_signed_apk_metadata");
        URL url = new URL(apk.getString("url"));
        String expectedPath = "/Modopi/feral-voxel-sandbox/releases/download/v" + gameVersion + "/Feral-" + nativeVersion + "-android.apk";
        if (!"https".equals(url.getProtocol()) || !"github.com".equals(url.getHost()) ||
            url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443) ||
            !expectedPath.equals(url.getPath()) || url.getQuery() != null || url.getRef() != null)
            throw new UpdateException("untrusted_apk_url");
        if (nativeCode <= 0) throw new UpdateException("invalid_native_code");
    }

    private long installedVersionCode() throws Exception {
        Activity activity = getActivity();
        PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private void verifyApk(File file, JSONObject metadata, String nativeVersion, int nativeCode) throws Exception {
        final Activity activity = getActivity();
        PackageManager packages = activity.getPackageManager();
        PackageInfo candidate;
        PackageInfo installed;
        if (Build.VERSION.SDK_INT >= 28) {
            candidate = packages.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
            installed = packages.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        } else {
            candidate = packages.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNATURES);
            installed = packages.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES);
        }
        if (candidate == null || candidate.applicationInfo == null || !PACKAGE.equals(candidate.packageName) ||
            !PACKAGE.equals(metadata.getString("packageName")) ||
            !nativeVersion.equals(candidate.versionName) ||
            (Build.VERSION.SDK_INT >= 28 ? candidate.getLongVersionCode() : candidate.versionCode) != nativeCode)
            throw new UpdateException("apk_package_or_version_mismatch");
        final android.content.pm.Signature[] candidateSigners;
        final android.content.pm.Signature[] installedSigners;
        if (Build.VERSION.SDK_INT >= 28) {
            if (candidate.signingInfo == null || installed.signingInfo == null) throw new UpdateException("apk_signer_unavailable");
            candidateSigners = candidate.signingInfo.getApkContentsSigners();
            installedSigners = installed.signingInfo.getApkContentsSigners();
        } else {
            candidateSigners = candidate.signatures;
            installedSigners = installed.signatures;
        }
        if (candidateSigners == null || candidateSigners.length != 1 || installedSigners == null || installedSigners.length != 1)
            throw new UpdateException("apk_signer_count_mismatch");
        byte[] certificateBytes = candidateSigners[0].toByteArray();
        String signerHash = sha256(certificateBytes);
        if (!TRUSTED_SIGNER_SHA256.equals(signerHash) || !metadata.getString("signerSha256").equalsIgnoreCase(signerHash) ||
            !TRUSTED_SIGNER_SHA256.equals(sha256(installedSigners[0].toByteArray())))
            throw new UpdateException("apk_signer_mismatch");
        Certificate cert = CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(certificateBytes));
        PublicKey trusted = loadPublicKey();
        if (!Arrays.equals(cert.getPublicKey().getEncoded(), trusted.getEncoded())) throw new UpdateException("apk_test_key_mismatch");
    }

    private void downloadApk(String address, long expectedBytes, String expectedHash, File destination) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects < 6; redirects++) {
            validateDownloadUrl(url, redirects == 0);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
            connection.setRequestProperty("User-Agent", "FERAL-Native-Updater/1");
            connection.setRequestProperty("Cache-Control", "no-cache");
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new UpdateException("apk_redirect_missing");
                    url = new URL(url, location);
                    continue;
                }
                if (status == 403 || status == 429) throw new UpdateException("apk_download_limited");
                if (status == 404) throw new UpdateException("apk_not_published");
                if (status != 200) throw new UpdateException("apk_download_failed");
                long contentLength = connection.getContentLengthLong();
                if (contentLength >= 0 && contentLength != expectedBytes) throw new UpdateException("apk_size_mismatch");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long written = 0;
                byte[] buffer = new byte[64 * 1024];
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                    for (int n; (n = input.read(buffer)) != -1;) {
                        written += n;
                        if (written > expectedBytes || written > MAX_APK_BYTES) throw new UpdateException("apk_size_limit");
                        digest.update(buffer, 0, n);
                        output.write(buffer, 0, n);
                        emitSignal("download_progress", (int) Math.min(written, Integer.MAX_VALUE), (int) expectedBytes);
                    }
                    output.flush();
                    output.getFD().sync();
                }
                if (written != expectedBytes || !hex(digest.digest()).equalsIgnoreCase(expectedHash))
                    throw new UpdateException("apk_hash_mismatch");
                return;
            } finally { connection.disconnect(); }
        }
        throw new UpdateException("apk_redirect_limit");
    }

    private void validateDownloadUrl(URL url, boolean initial) throws Exception {
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null ||
            (url.getPort() != -1 && url.getPort() != 443)) throw new UpdateException("untrusted_apk_redirect");
        if (initial) {
            if (!"github.com".equals(url.getHost()) || !url.getPath().startsWith("/Modopi/feral-voxel-sandbox/releases/download/"))
                throw new UpdateException("untrusted_apk_url");
        } else {
            String host = url.getHost();
            String path = url.getPath();
            boolean trustedReleaseCdn = ("release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host)) &&
                (path.startsWith("/github-production-release-asset/") || path.startsWith("/github-production-release-asset-"));
            boolean trustedGithub = "github.com".equals(host) && path.startsWith("/Modopi/feral-voxel-sandbox/releases/download/");
            if (!trustedReleaseCdn && !trustedGithub) throw new UpdateException("untrusted_apk_redirect");
        }
    }

    private static void verifyManifest(byte[] raw, byte[] signature, byte[] encodedKey) throws Exception {
        PublicKey key = java.security.KeyFactory.getInstance("RSA").generatePublic(new java.security.spec.X509EncodedKeySpec(encodedKey));
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(key);
        verifier.update(raw);
        if (!verifier.verify(signature)) throw new UpdateException("manifest_signature_mismatch");
    }

    private PublicKey loadPublicKey() throws Exception {
        return java.security.KeyFactory.getInstance("RSA").generatePublic(
            new java.security.spec.X509EncodedKeySpec(readAsset("update-public.der", 4096)));
    }

    private byte[] readAsset(String name, int limit) throws Exception {
        try (InputStream input = getActivity().getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            for (int n; (n = input.read(buffer)) != -1;) {
                if (output.size() + n > limit) throw new UpdateException("public_key_too_large");
                output.write(buffer, 0, n);
            }
            return output.toByteArray();
        }
    }

    private static byte[] download(String address, int limit) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects < 5; redirects++) {
            if (!"https".equals(url.getProtocol()) || !"raw.githubusercontent.com".equals(url.getHost()) ||
                url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443) ||
                !url.getPath().startsWith("/Modopi/feral-voxel-sandbox/updates/"))
                throw new UpdateException("untrusted_manifest_url");
            String path = url.getPath().substring("/Modopi/feral-voxel-sandbox/updates/".length());
            if (!"stable.feral".equals(path)) throw new UpdateException("untrusted_manifest_path");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setRequestProperty("User-Agent", "FERAL-Public-Updater/1");
            connection.setRequestProperty("Cache-Control", "no-cache");
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new UpdateException("manifest_redirect_missing");
                    url = new URL(url, location);
                    continue;
                }
                if (status == 403 || status == 429) throw new UpdateException("public_update_limited");
                if (status == 404) throw new UpdateException("manifest_not_found");
                if (status != 200) throw new UpdateException("manifest_download_failed");
                if (connection.getContentLengthLong() > limit) throw new UpdateException("manifest_too_large");
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    for (int n; (n = input.read(buffer)) != -1;) {
                        if (output.size() + n > limit) throw new UpdateException("manifest_too_large");
                        output.write(buffer, 0, n);
                    }
                    return output.toByteArray();
                }
            } finally { connection.disconnect(); }
        }
        throw new UpdateException("manifest_redirect_limit");
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            for (int n; (n = input.read(buffer)) != -1;) digest.update(buffer, 0, n);
        }
        return hex(digest.digest());
    }

    private static String sha256(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format(Locale.ROOT, "%02x", item & 255));
        return value.toString();
    }

    private static String safeNetworkError(Exception error) {
        if (error instanceof java.net.UnknownHostException || error instanceof java.net.SocketTimeoutException ||
            error instanceof javax.net.ssl.SSLException) return "network_unavailable";
        return "update_verification_failed";
    }

    private static final class UpdateException extends Exception {
        UpdateException(String message) { super(message); }
    }
}
