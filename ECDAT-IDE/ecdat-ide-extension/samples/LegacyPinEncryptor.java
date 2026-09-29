
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

public class LegacyPinEncryptor {
    // Hardcoded weak 56-bit DES key
    private static final byte[] MASTER_PIN_KEY = new byte[] {
            (byte) 0x01, (byte) 0x23, (byte) 0x45, (byte) 0x67,
            (byte) 0x89, (byte) 0xAB, (byte) 0xCD, (byte) 0xEF
    };

    public static byte[] encryptCustomerPin(byte[] rawPin) throws Exception {
        SecretKeySpec keySpec = new SecretKeySpec(MASTER_PIN_KEY, "DES");
        // Insecure: DES with electronic codebook (ECB) mode
        Cipher cipher = Cipher.getInstance("DES/ECB/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, keySpec);
        return cipher.doFinal(rawPin);
    }
}
