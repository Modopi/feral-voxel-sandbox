package com.kgb.feral;

import java.io.*;
import java.net.*;
import javax.net.ssl.HttpsURLConnection;

/** Public, credential-free update transport. Signed packages are checked separately by UpdateCore. */
public final class PublicUpdates {
    public static final String ROOT = "https://raw.githubusercontent.com/Modopi/feral-voxel-sandbox/updates/";
    public interface ConnectionFactory { HttpsURLConnection open(URL url) throws Exception; }
    public static String address(String path) throws IOException {
        if (!path.matches("(?:stable\\.feral|catalog\\.json|versions/[0-9]+\\.[0-9]+\\.[0-9]+\\.feral|builds/[0-9]+\\.feral)"))
            throw new IOException("잘못된 공개 업데이트 경로입니다.");
        return ROOT + path;
    }
    public static byte[] download(String address, int limit) throws Exception {
        return download(address, limit, url -> (HttpsURLConnection) url.openConnection());
    }
    public static byte[] download(String address, int limit, ConnectionFactory factory) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects < 5; redirects++) {
            if (!"https".equals(url.getProtocol()) || !"raw.githubusercontent.com".equals(url.getHost())
                    || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)
                    || !url.getPath().startsWith("/Modopi/feral-voxel-sandbox/updates/"))
                throw new IOException("허용하지 않은 공개 업데이트 주소입니다.");
            // Validate the path again after redirects, before opening a connection.
            address(url.getPath().substring("/Modopi/feral-voxel-sandbox/updates/".length()));
            HttpsURLConnection conn = factory.open(url);
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(12000); conn.setReadTimeout(20000);
            conn.setRequestProperty("Accept", "application/octet-stream");
            conn.setRequestProperty("User-Agent", "FERAL-Public-Updater/1");
            conn.setRequestProperty("Cache-Control", "no-cache");
            try {
                int status = conn.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = conn.getHeaderField("Location");
                    if (location == null) throw new IOException("업데이트 이동 주소가 없습니다.");
                    url = new URL(url, location); continue;
                }
                if (status == 403 || status == 429) throw new IOException("공개 업데이트 요청이 일시 제한됐습니다. 잠시 뒤 다시 확인하세요.");
                if (status == 404) throw new IOException("아직 게시되지 않았거나 찾을 수 없는 게임 버전입니다.");
                if (status != 200) throw new IOException("공개 업데이트 서버에 연결하지 못했습니다. 잠시 뒤 다시 확인하세요.");
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
}
