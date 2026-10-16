import com.kgb.feral.UpdateCore;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;

public final class UpdateCoreCheck {
    private static int count;
    private static void ok(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
        count++; System.out.println("PASS " + label);
    }
    private static void rejects(Checked action, String label) throws Exception {
        boolean failed = false;
        try { action.run(); } catch (Exception expected) { failed = true; }
        ok(failed, label);
    }
    interface Checked { void run() throws Exception; }
    static class Pack {
        final Map<String,String> hashes = new HashMap<>();
        final byte[] bytes;
        final int expanded;
        Pack(Map<String,String> files) throws Exception {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            int size = 0;
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                for (Map.Entry<String,String> e : files.entrySet()) {
                    byte[] data = e.getValue().getBytes("UTF-8");
                    size += data.length;
                    hashes.put(e.getKey(), UpdateCore.sha256(data));
                    zip.putNextEntry(new ZipEntry(e.getKey())); zip.write(data); zip.closeEntry();
                }
            }
            bytes = out.toByteArray(); expanded = size;
        }
        void stage(UpdateCore core, int code) throws Exception { core.stage(code, bytes, hashes, expanded, UpdateCore.sha256(bytes)); }
    }
    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("feral-updater-").toFile();
        UpdateCore core = new UpdateCore(root, 205);
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        byte[] manifest = "signed metadata".getBytes("UTF-8");
        Signature signer = Signature.getInstance("SHA256withRSA"); signer.initSign(pair.getPrivate()); signer.update(manifest);
        byte[] signature = signer.sign();
        UpdateCore.verifySignature(manifest, signature, pair.getPublic().getEncoded());
        ok(true, "valid RSA signature accepted");
        manifest[0] ^= 1;
        rejects(() -> UpdateCore.verifySignature(manifest, signature, pair.getPublic().getEncoded()), "changed metadata rejected");
        rejects(() -> UpdateCore.checkVersion(206, 207, 205, 205, 0), "native requirement enforced");
        rejects(() -> UpdateCore.checkVersion(204, 205, 205, 205, 0), "downgrade rejected");
        rejects(() -> UpdateCore.checkVersion(206, 205, 205, 205, 206), "failed version rejected");
        Pack good = new Pack(new LinkedHashMap<String,String>() {{ put("index.html", "<h1>206</h1>"); put("main.js", "ok()"); put("version.js", "206"); }});
        good.stage(core, 206);
        ok(core.pending() == 206 && core.current() == 205, "download never activates running code");
        ok(core.beginTrial("{\"feral.world.v1\":\"preserved\"}"), "new version enters trial");
        ok(core.current() == 206 && core.trial(), "trial activation persisted");
        ok(core.activeDirectory().isDirectory(), "complete version directory selected");
        UpdateCore restarted = new UpdateCore(root, 205);
        ok(restarted.recover() && restarted.current() == 205, "unacknowledged process exit rolls back");
        ok(restarted.snapshot().contains("preserved"), "pre-update save backup preserved");
        ok(new UpdateCore(root, 205).recover(), "interrupted save restoration retried");
        restarted.restored();
        rejects(() -> good.stage(restarted, 206), "failed package cannot loop on every launch");
        good.stage(restarted, 207); restarted.beginTrial("{\"feral.settings\":\"old\"}"); restarted.healthy(207);
        UpdateCore healthy = new UpdateCore(root, 205);
        ok(!healthy.recover() && healthy.current() == 207, "acknowledged version survives restart");
        rejects(() -> healthy.healthy(206), "incorrect runtime acknowledgement rejected");
        good.stage(healthy, 208); healthy.beginTrial("{\"feral.world.v1\":\"207-save\"}");
        ok(healthy.rollback() && healthy.current() == 207, "rollback chooses last healthy downloaded version");
        healthy.restored();
        Pack traversal = new Pack(new LinkedHashMap<String,String>() {{ put("index.html", "ok"); put("main.js", "ok"); put("version.js", "209"); put("../escaped", "bad"); }});
        rejects(() -> traversal.stage(healthy, 209), "zip traversal rejected");
        ok(!new File(root, "escaped").exists() && healthy.current() == 207, "bad extraction leaves active version intact");
        Map<String,String> mismatch = new HashMap<>(good.hashes); mismatch.put("main.js", "00");
        rejects(() -> healthy.stage(209, good.bytes, mismatch, good.expanded, UpdateCore.sha256(good.bytes)), "per-file corruption rejected");
        rejects(() -> healthy.stage(209, good.bytes, good.hashes, good.expanded - 1, UpdateCore.sha256(good.bytes)), "expanded-byte budget enforced");
        rejects(() -> healthy.stage(209, good.bytes, good.hashes, good.expanded, "00"), "archive corruption rejected");
        Map<String,String> missing = new HashMap<>(good.hashes); missing.put("missing.css", "00");
        rejects(() -> healthy.stage(209, good.bytes, missing, good.expanded, UpdateCore.sha256(good.bytes)), "missing file rejected");
        rejects(() -> UpdateCore.safeFile(root, "../bad"), "relative escape rejected");
        rejects(() -> UpdateCore.safeFile(root, "/absolute"), "absolute path rejected");
        rejects(() -> UpdateCore.safeFile(root, "a\\b"), "Windows separator rejected");
        rejects(() -> UpdateCore.safeFile(root, "a//b"), "empty path component rejected");
        ok(new UpdateCore(root, 210).current() == 210, "newer installed APK supersedes old game bundle");
        System.out.println("Native updater checks: " + count);
    }
}
