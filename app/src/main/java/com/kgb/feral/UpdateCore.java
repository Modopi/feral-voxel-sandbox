package com.kgb.feral;

import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;
import java.util.zip.*;

// Android 외부에서도 검증 가능한 패키지 검증·적용 상태 관리
public final class UpdateCore {
    public static final int MAX_ARCHIVE = 8 * 1024 * 1024;
    public static final int MAX_EXPANDED = 32 * 1024 * 1024;
    public static final int MAX_FILES = 128;
    private final File root;
    private final int builtin;
    private final Properties state = new Properties();

    public UpdateCore(File root, int builtin) throws IOException {
        this.root = root;
        this.builtin = builtin;
        Files.createDirectories(root.toPath());
        File f = new File(root, "state.properties");
        if (f.isFile()) try (InputStream in = new FileInputStream(f)) { state.load(in); }
        // 새 네이티브 설치 시에만 동봉 버전을 기본값으로 선택
        int previousNative = number("native");
        if (previousNative != builtin) {
            if (number("active") <= builtin && number("trial") == 0) state.setProperty("active", "0");
            if (number("pending") <= builtin) state.setProperty("pending", "0");
            state.setProperty("native", Integer.toString(builtin));
            save();
        }
    }

    public static void verifySignature(byte[] manifest, byte[] signature, byte[] publicKey) throws GeneralSecurityException {
        PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(publicKey));
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(key);
        verifier.update(manifest);
        if (!verifier.verify(signature)) throw new SignatureException("업데이트 서명이 일치하지 않습니다.");
    }

    public static String sha256(byte[] bytes) throws GeneralSecurityException {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder s = new StringBuilder();
        for (byte b : digest) s.append(String.format(Locale.ROOT, "%02x", b & 255));
        return s.toString();
    }

    public static void checkVersion(int code, int minNative, int nativeCode, int current, int blocked) throws IOException {
        if (minNative > nativeCode) throw new IOException("새 APK 설치가 필요한 버전입니다.");
        if (code <= current) throw new IOException("이미 설치한 버전입니다.");
        if (code == blocked) throw new IOException("시작에 실패한 버전입니다. 다음 릴리스를 기다려 주세요.");
    }

    // 자동 업데이트의 단조 증가와 분리한 명시적 버전 선택 계약
    public static void checkSelection(int code, int minNative, int nativeCode, int current, int blocked) throws IOException {
        if (code < 205 || minNative < 205 || minNative > nativeCode) throw new IOException("이 게임은 새 APK가 필요합니다.");
        if (code == current) throw new IOException("현재 실행 중인 게임입니다.");
        if (code == blocked) throw new IOException("시작에 실패한 빌드입니다. 수정 버전을 선택하세요.");
    }
    public synchronized void selectBuiltin() throws IOException {
        if (trial()) throw new IOException("시작 검증 중입니다.");
        checkSelection(builtin, builtin, builtin, current(), blocked());
        state.setProperty("pending", Integer.toString(builtin));
        state.setProperty("pendingManual", "1");
        save();
    }
    public synchronized String activationSnapshot() throws IOException {
        if (number("isolateTrial") != 1 || !trial()) return null;
        state.setProperty("isolateTrial", "0"); save();
        File f = new File(root, "saves/" + current() + ".json");
        return f.isFile() ? new String(Files.readAllBytes(f.toPath()), "UTF-8") : "{}";
    }
    public static File safeFile(File base, String path) throws IOException {
        if (path == null || path.isEmpty() || path.startsWith("/") || path.contains("\\")
                || path.contains(":") || path.contains("\u0000")) throw new IOException("잘못된 파일 경로입니다.");
        for (String p : path.split("/", -1)) if (p.isEmpty() || p.equals(".") || p.equals(".."))
            throw new IOException("잘못된 파일 경로입니다.");
        File result = new File(base, path).getCanonicalFile();
        if (!result.toPath().startsWith(base.getCanonicalFile().toPath())) throw new IOException("경로 범위를 벗어났습니다.");
        return result;
    }

    // 서명된 목록과 ZIP의 파일 집합·내용 모두 일치한 경우에만 준비 완료 처리
    public synchronized void stage(int code, byte[] archive, Map<String, String> hashes,
                                   int expandedBytes, String archiveHash) throws Exception {
        stage(code, archive, hashes, expandedBytes, archiveHash, false);
    }
    public synchronized void stage(int code, byte[] archive, Map<String, String> hashes,
                                   int expandedBytes, String archiveHash, boolean manual) throws Exception {
        if (trial()) throw new IOException("시작 검증 중에는 버전을 준비할 수 없습니다.");
        if (manual) checkSelection(code, 205, builtin, current(), blocked());
        else checkVersion(code, 0, builtin, current(), blocked());
        if (archive.length > MAX_ARCHIVE || !sha256(archive).equals(archiveHash)
                || expandedBytes < 1 || expandedBytes > MAX_EXPANDED
                || hashes.size() > MAX_FILES || !hashes.containsKey("index.html")
                || !hashes.containsKey("main.js") || !hashes.containsKey("version.js"))
            throw new IOException("업데이트 파일 검증에 실패했습니다.");
        File staging = new File(root, "staging");
        remove(staging);
        Files.createDirectories(staging.toPath());
        Set<String> seen = new HashSet<>();
        int total = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            for (ZipEntry e; (e = zip.getNextEntry()) != null;) {
                String path = e.getName();
                File target = safeFile(staging, path);
                if (e.isDirectory() || !hashes.containsKey(path) || !seen.add(path))
                    throw new IOException("업데이트 파일 목록이 일치하지 않습니다.");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                for (int n; (n = zip.read(buffer)) != -1;) {
                    total += n;
                    if (total > expandedBytes || total > MAX_EXPANDED) throw new IOException("업데이트 크기 제한 초과");
                    bytes.write(buffer, 0, n);
                }
                byte[] contents = bytes.toByteArray();
                if (!sha256(contents).equals(hashes.get(path))) throw new IOException("업데이트 파일이 손상되었습니다.");
                Files.createDirectories(target.getParentFile().toPath());
                atomicWrite(target, contents);
            }
            if (total != expandedBytes || !seen.equals(hashes.keySet())) throw new IOException("업데이트 파일이 누락되었습니다.");
            File destination = versionDir(code);
            if (destination.exists()) {
                for (Map.Entry<String,String> e : hashes.entrySet()) {
                    File f = safeFile(destination, e.getKey());
                    if (!f.isFile() || !sha256(Files.readAllBytes(f.toPath())).equals(e.getValue()))
                        throw new IOException("같은 버전 번호의 다른 내용은 설치할 수 없습니다.");
                }
                remove(staging);
            } else {
                Files.createDirectories(destination.getParentFile().toPath());
                move(staging, destination);
            }
            state.setProperty("pendingManual", manual ? "1" : "0");
            state.setProperty("pending", Integer.toString(code));
            save();
        } catch (Exception e) { remove(staging); throw e; }
    }

    public synchronized boolean recover() throws IOException {
        if (number("restore") == 1) return true;
        if (number("trial") != 0) return rollback();
        if (number("active") != 0 && !new File(versionDir(number("active")), "index.html").isFile())
            return rollback();
        return false;
    }

    public synchronized boolean beginTrial(String snapshot) throws IOException {
        int pending = number("pending");
        boolean manual = number("pendingManual") == 1;
        if (pending == 0 || pending == current() || (!manual && pending <= current()) || pending == number("blocked")) return false;
        if (pending != builtin && !new File(versionDir(pending), "index.html").isFile()) throw new IOException("준비된 버전이 없습니다.");
        // 저장 스냅샷을 먼저 영속화한 후 활성 버전 포인터를 원자적으로 전환
        atomicWrite(new File(root, "save-backup.json"), snapshot.getBytes("UTF-8"));
        atomicWrite(new File(root, "saves/" + current() + ".json"), snapshot.getBytes("UTF-8"));
        state.setProperty("isolateTrial", manual ? "1" : "0");
        state.setProperty("previous", Integer.toString(number("active")));
        state.setProperty("active", pending == builtin ? "0" : Integer.toString(pending));
        state.setProperty("trial", Integer.toString(pending));
        state.setProperty("pending", "0");
        save();
        return true;
    }

    public synchronized void healthy(int code) throws IOException {
        if (code != current()) throw new IOException("실행 버전이 일치하지 않습니다.");
        if (number("trial") == code) {
            state.setProperty("trial", "0");
            save();
            // 성공 판정 후 이전 버전 한 개와 다음 업데이트만 유지
            File versions = new File(root, "versions");
            File[] files = versions.listFiles();
            if (files != null) for (File f : files) {
                String name = f.getName();
                if (!name.equals(state.getProperty("active")) && !name.equals(state.getProperty("previous"))
                        && !name.equals(state.getProperty("pending"))) remove(f);
            }
        }
    }

    public synchronized boolean rollback() throws IOException {
        int failed = number("active");
        int previous = number("previous");
        if (previous != 0 && !new File(versionDir(previous), "index.html").isFile()) previous = 0;
        state.setProperty("active", Integer.toString(previous));
        state.setProperty("blocked", Integer.toString(failed));
        state.setProperty("trial", "0");
        state.setProperty("pending", "0");
        state.setProperty("restore", new File(root, "save-backup.json").isFile() ? "1" : "0");
        save();
        return new File(root, "save-backup.json").isFile();
    }

    public synchronized void restored() throws IOException {
        if (number("restore") != 0) { state.setProperty("restore", "0"); save(); }
    }

    public synchronized String snapshot() throws IOException {
        File f = new File(root, "save-backup.json");
        return f.isFile() ? new String(Files.readAllBytes(f.toPath()), "UTF-8") : "null";
    }
    public synchronized int current() { return number("active") == 0 ? builtin : number("active"); }
    public synchronized int pending() { return number("pending"); }
    public synchronized int blocked() { return number("blocked"); }
    public synchronized boolean trial() { return number("trial") != 0; }
    public synchronized File activeDirectory() { return number("active") != 0 ? versionDir(number("active")) : null; }
    private File versionDir(int code) { return new File(root, "versions/" + code); }
    private int number(String key) { try { return Integer.parseInt(state.getProperty(key, "0")); } catch (NumberFormatException e) { return 0; } }
    private void save() throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        state.store(bytes, "FERAL update journal");
        atomicWrite(new File(root, "state.properties"), bytes.toByteArray());
    }
    public static void atomicWrite(File target, byte[] bytes) throws IOException {
        Files.createDirectories(target.getParentFile().toPath());
        File temp = new File(target.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) { out.write(bytes); out.getFD().sync(); }
        move(temp, target);
    }
    private static void move(File from, File to) throws IOException {
        try { Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
        catch (AtomicMoveNotSupportedException e) { Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING); }
    }
    private static void remove(File file) throws IOException {
        if (!file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("업데이트 폴더를 읽을 수 없습니다.");
            for (File child : children) remove(child);
        }
        Files.delete(file.toPath());
    }
}
