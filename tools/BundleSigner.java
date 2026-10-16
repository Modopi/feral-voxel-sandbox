import java.io.*;
import java.nio.file.*;
import java.security.*;

// 기존 APK 시험 키를 사용하는 초기 비공개 배포용 서명 도구
public final class BundleSigner {
    public static void main(String[] args) throws Exception {
        KeyStore store = KeyStore.getInstance(new File(args[0]), args[1].toCharArray());
        if (args[2].equals("public")) {
            Files.write(Paths.get(args[3]), store.getCertificate("feral").getPublicKey().getEncoded());
        } else {
            Signature signer = Signature.getInstance("SHA256withRSA");
            signer.initSign((PrivateKey) store.getKey("feral", args[1].toCharArray()));
            signer.update(Files.readAllBytes(Paths.get(args[3])));
            Files.write(Paths.get(args[4]), signer.sign());
        }
    }
}
