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
        File multiRoot = Files.createTempDirectory("feral-selection-").toFile();
        UpdateCore multi = new UpdateCore(multiRoot, 301);
        rejects(() -> good.stage(multi, 205), "automatic downgrade still rejected");
        UpdateCore.checkSelection(205, 205, 301, 301, 0);
        multi.stage(205, good.bytes, good.hashes, good.expanded, UpdateCore.sha256(good.bytes), true);
        ok(multi.pending() == 205, "explicit older selection prepared");
        multi.beginTrial("{\"feral.world.v1\":\"301-save\"}");
        ok(multi.current() == 205 && "{}".equals(multi.activationSnapshot()), "older game starts with independent empty saves");
        multi.healthy(205);
        UpdateCore reopened = new UpdateCore(multiRoot, 301);
        ok(reopened.current() == 205 && reopened.activeDirectory().isDirectory(), "explicit old selection survives native restart");
        reopened.selectBuiltin(); reopened.beginTrial("{\"feral.world.v1\":\"205-save\"}");
        ok(reopened.current() == 301 && reopened.activeDirectory() == null, "bundled game can be selected offline");
        ok(reopened.activationSnapshot().contains("301-save"), "return restores original version saves");
        reopened.healthy(301);
        reopened.stage(205, good.bytes, good.hashes, good.expanded, UpdateCore.sha256(good.bytes), true);
        reopened.beginTrial("{\"feral.world.v1\":\"301-updated\"}");
        ok(reopened.activationSnapshot().contains("205-save"), "old game retains its own progress");
        ok(reopened.rollback() && reopened.current() == 301 && reopened.snapshot().contains("301-updated"), "failed older selection rolls back both code and save");
        rejects(() -> UpdateCore.checkSelection(400, 302, 301, 301, 0), "manual selection cannot bypass minimum native");
        File distinctRoot = Files.createTempDirectory("feral-native-game-").toFile();
        UpdateCore distinct = new UpdateCore(distinctRoot, 501, 302);
        ok(distinct.current() == 501 && distinct.builtin() == 501, "APK 302 boots bundled game 501");
        distinct.healthy(501);
        rejects(() -> distinct.healthy(302), "APK code cannot acknowledge a different game code");
        distinct.stage(205, good.bytes, good.hashes, good.expanded, UpdateCore.sha256(good.bytes), true);
        distinct.beginTrial("{\"feral.world.v1\":\"501-save\"}");distinct.healthy(205);
        UpdateCore resumed = new UpdateCore(distinctRoot, 501, 302);
        ok(resumed.current() == 205, "pinned older game survives restart when native and game differ");
        resumed.selectBuiltin();resumed.beginTrial("{\"feral.world.v1\":\"205-save\"}");
        ok(resumed.current()==501 && resumed.activeDirectory()==null, "offline switch returns bundled 501 rather than APK 302");
        ok(resumed.activationSnapshot().contains("501-save"), "bundled game snapshot uses game code");
        resumed.healthy(501);
        UpdateCore.checkSelection(502,302,302,501,0);
        ok(true,"new APK satisfies public game's minimum native version");
        rejects(()->UpdateCore.checkSelection(502,302,301,301,0),"old APK is correctly incompatible");
        ok(new UpdateCore(distinctRoot,502,303).current()==502,"next APK upgrade selects its distinct bundled game");
        File retryRoot = Files.createTempDirectory("feral-retry-").toFile();
        UpdateCore retry = new UpdateCore(retryRoot, 501, 303);
        good.stage(retry, 600); retry.beginTrial("{\"feral.world.v1\":\"before-600\"}");
        retry.trialPaused(true);
        UpdateCore interrupted = new UpdateCore(retryRoot, 501, 303);
        ok(interrupted.recover() && interrupted.blocked() == 600 && "interrupted".equals(interrupted.failureReason()), "background process exit records interrupted start and rolls back");
        interrupted.restored();
        rejects(() -> interrupted.stage(600, good.bytes, good.hashes, good.expanded, "corrupt", true, true), "retry still rejects corrupt package");
        ok(interrupted.blocked() == 600 && interrupted.pending() == 0, "failed retry verification preserves block and healthy game");
        rejects(() -> interrupted.stage(600, good.bytes, good.hashes, good.expanded, UpdateCore.sha256(good.bytes), false, true), "automatic updates cannot request retry bypass");
        rejects(() -> UpdateCore.checkSelection(600, 304, 303, 501, 600, true), "retry cannot bypass minimum native requirement");
        UpdateCore.checkSelection(600, 302, 303, 501, 600, true);
        interrupted.stage(600, good.bytes, good.hashes, good.expanded, UpdateCore.sha256(good.bytes), true, true);
        ok(interrupted.pending() == 600 && interrupted.blocked() == 600, "verified manual retry prepares without dropping automatic block");
        UpdateCore retried = new UpdateCore(retryRoot, 501, 303);
        ok(retried.beginTrial("{\"feral.world.v1\":\"current-501\"}") && retried.current() == 600, "explicit retry survives process exit before activation");
        retried.activationSnapshot();
        retried.rollback("timeout");
        ok(retried.current() == 501 && retried.blocked() == 600 && retried.snapshot().contains("current-501"), "second failure restores current save and blocks another automatic attempt");
        retried.restored();
        rejects(() -> good.stage(retried, 600), "failed retry never causes automatic launch loop");
        retried.stage(600, good.bytes, good.hashes, good.expanded, UpdateCore.sha256(good.bytes), true, true);
        retried.beginTrial("{\"feral.world.v1\":\"still-safe\"}");retried.healthy(600);
        ok(!retried.trial() && retried.blocked() == 0 && retried.current() == 600, "healthy retry commits and clears failed marker");
        retried.selectBuiltin(); retried.beginTrial("{\"feral.world.v1\":\"600-progress\"}"); retried.rollback();
        ok(retried.blocked() == 501 && retried.current() == 600, "failed bundled trial blocks its game code rather than zero");
        retried.restored(); retried.selectBuiltin(true); retried.beginTrial("{}"); retried.healthy(501);
        ok(retried.current() == 501 && retried.blocked() == 0, "bundled failed version can also be retried offline");
        System.out.println("Native updater checks: " + count);
    }
}
