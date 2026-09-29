"""
Generates a realistic x86-64 PE binary executable test artifact containing
quantum-vulnerable cryptographic algorithms, hardcoded keys, and constants.

Artifacts produced:
- data/demo_test_suite/vulnerable_crypto_app.exe
- data/demo_test_suite/vulnerable_crypto_app.bin
"""
import os
import struct
import math
from pathlib import Path

def generate_realistic_crypto_binary() -> bytes:
    # -----------------------------------------------------------------------
    # 1. Cryptographic Payloads & Constants
    # -----------------------------------------------------------------------
    # Embedded 2048-bit RSA Private Key PEM block (CWE-798 Hardcoded Credential)
    rsa_privkey_pem = (
        b"-----BEGIN RSA PRIVATE KEY-----\n"
        b"MIIEowIBAAKCAQEAz8qF12VjK7rX8y9z0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5E\n"
        b"6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F3G4H5I6J7K\n"
        b"8L9M0N1O2P3Q4R5S6T7U8V9W0X1Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q\n"
        b"0R1S2T3U4V5W6X7Y8Z9A0B1C2D3E4F5G6H7I8J9K0L1M2N3O4P5Q6R7S8T9U0V1W\n"
        b"2X3Y4Z5A6B7C8D9E0F1G2H3I4J5K6L7M8N9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C\n"
        b"4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F3G4H5I\n"
        b"IDAQABAoIBAQC7V9X0Y1Z2A3B4C5D6E7F8G9H0I1J2K3L4M5N6O7P8Q9R0S1T2U3\n"
        b"V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5\n"
        b"B6C7D8E9F0G1H2I3J4K5L6M7N8O9P0Q1R2S3T4U5V6W7X8Y9Z0A1B2C3D4E5F6G7\n"
        b"H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2W3X4Y5Z6A7B8C9D0E1F2G3H4I5J6K7L8M9\n"
        b"-----END RSA PRIVATE KEY-----\n"
    )

    # ASN.1 OIDs (NIST & PKCS#1 standards)
    oid_rsa = bytes([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01])  # 1.2.840.113549.1.1.1 (RSA)
    oid_ec_p256 = bytes([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])        # 1.2.840.10045.2.1 (EC Public Key)
    oid_sha256 = bytes([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01])

    # AES S-box 16-byte pattern
    aes_sbox = bytes([0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76])

    # MD5 IV 16-byte initial state
    md5_iv = bytes([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10])

    # SHA-1 IV
    sha1_iv = bytes([0x67, 0x45, 0x23, 0x01, 0xef, 0xcd, 0xab, 0x89, 0x98, 0xba, 0xdc, 0xfe, 0x10, 0x32, 0x54, 0x76])

    # String identifiers and API references
    crypto_strings = (
        b"ADVAPI32.dll\x00"
        b"CryptAcquireContextA\x00"
        b"CryptGenKey\x00"
        b"CryptExportKey\x00"
        b"CryptDecrypt\x00"
        b"rsaenh.dll\x00"
        b"bcrypt.dll\x00"
        b"crypt32.dll\x00"
        b"RSA_public_encrypt\x00"
        b"RSA_generate_key_ex\x00"
        b"ECDSA_do_sign\x00"
        b"ECDH_compute_key\x00"
        b"Diffie-Hellman\x00"
        b"DES_set_key\x00"
        b"DES_ede3_cbc_encrypt\x00"
        b"MD5_Update\x00"
        b"SHA256_Update\x00"
        b"OpenSSL 1.1.1k  25 Mar 2021\x00"
        b"secp256r1\x00"
        b"BEGIN CERTIFICATE\x00"
        b"PUBLIC KEY\x00"
    )

    # -----------------------------------------------------------------------
    # 2. Section Payloads (aligned to 512 bytes)
    # -----------------------------------------------------------------------
    # .text section: simulated x86_64 code instructions
    code_prologue = bytes([
        0x55,                         # push rbp
        0x48, 0x89, 0xe5,             # mov rbp, rsp
        0x48, 0x83, 0xec, 0x40,       # sub rsp, 64
        0x48, 0x8d, 0x0d, 0x20, 0x00, 0x00, 0x00, # lea rcx, [rip + 0x20]
        0xe8, 0x10, 0x00, 0x00, 0x00, # call func
        0x48, 0x83, 0xc4, 0x40,       # add rsp, 64
        0x5d,                         # pop rbp
        0xc3                          # ret
    ])
    # Fill .text to 1024 bytes (0x400)
    text_data = (code_prologue * 32).ljust(0x400, b"\x90")

    # .rdata section: constants, strings, OIDs, and RSA private key
    rdata_raw = (
        oid_rsa + b"\x00" +
        oid_ec_p256 + b"\x00" +
        oid_sha256 + b"\x00" +
        aes_sbox +
        md5_iv +
        sha1_iv +
        b"\x30\x82\x02\x5c" +  # ASN.1 DER SEQUENCE tag
        crypto_strings +
        rsa_privkey_pem
    )
    # Align .rdata to 0x800 bytes (2048 bytes)
    rdata_data = rdata_raw.ljust(0x800, b"\x00")

    # .data section: high entropy pseudo-random payload (simulated encrypted database key)
    # Using LCG to produce high Shannon entropy (> 5.5)
    high_entropy_bytes = bytearray(512)
    state = 0x12345678
    for i in range(512):
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        high_entropy_bytes[i] = (state >> 16) & 0xFF
    data_data = bytes(high_entropy_bytes).ljust(0x400, b"\x00")

    # -----------------------------------------------------------------------
    # 3. PE32+ (x64) Header Assembly
    # -----------------------------------------------------------------------
    file_align = 0x200
    sec_align = 0x1000

    # DOS Header
    dos_header = bytearray(64)
    dos_header[0:2] = b"MZ"
    struct.pack_into("<H", dos_header, 0x3C, 0x80)  # e_lfanew = 0x80

    # DOS Stub
    dos_stub = b"This legacy crypto app requires PQC remediation.\r\r\n$\x00\x00\x00\x00\x00\x00\x00"
    dos_stub = dos_stub.ljust(64, b"\x00")

    # PE Signature
    pe_sig = b"PE\x00\x00"

    # COFF File Header
    # Machine=0x8664 (x64), NumSections=3, TimeDateStamp=1680000000, SizeOfOptionalHeader=240, Characteristics=0x0022
    coff_header = struct.pack("<HHIIIHH", 0x8664, 3, 1680000000, 0, 0, 240, 0x0022)

    # Optional Header (PE32+)
    opt_header = bytearray(240)
    struct.pack_into("<H", opt_header, 0, 0x020B)        # Magic: PE32+
    opt_header[2] = 14                                  # MajorLinkerVersion
    opt_header[3] = 0                                   # MinorLinkerVersion
    struct.pack_into("<I", opt_header, 4, len(text_data))  # SizeOfCode
    struct.pack_into("<I", opt_header, 8, len(rdata_data)) # SizeOfInitializedData
    struct.pack_into("<I", opt_header, 12, 0)           # SizeOfUninitializedData
    struct.pack_into("<I", opt_header, 16, 0x1000)      # AddressOfEntryPoint (.text RVA)
    struct.pack_into("<I", opt_header, 20, 0x1000)      # BaseOfCode
    struct.pack_into("<Q", opt_header, 24, 0x140000000) # ImageBase
    struct.pack_into("<I", opt_header, 32, sec_align)   # SectionAlignment
    struct.pack_into("<I", opt_header, 36, file_align)  # FileAlignment
    struct.pack_into("<H", opt_header, 40, 6)           # MajorOperatingSystemVersion
    struct.pack_into("<H", opt_header, 42, 0)           # MinorOperatingSystemVersion
    struct.pack_into("<I", opt_header, 56, 0x4000)      # SizeOfImage
    struct.pack_into("<I", opt_header, 60, file_align)  # SizeOfHeaders
    struct.pack_into("<H", opt_header, 68, 3)           # Subsystem: Windows CUI
    struct.pack_into("<H", opt_header, 70, 0x8160)      # DllCharacteristics (DYNAMIC_BASE | NX_COMPAT | TERMINAL_SERVER_AWARE)
    struct.pack_into("<Q", opt_header, 72, 0x100000)    # SizeOfStackReserve
    struct.pack_into("<Q", opt_header, 80, 0x1000)      # SizeOfStackCommit
    struct.pack_into("<Q", opt_header, 88, 0x100000)    # SizeOfHeapReserve
    struct.pack_into("<Q", opt_header, 96, 0x1000)      # SizeOfHeapCommit
    struct.pack_into("<I", opt_header, 108, 16)         # NumberOfRvaAndSizes

    # Section Headers (40 bytes each)
    # 1. .text
    sec_text = struct.pack(
        "<8sIIIIIIHHI",
        b".text\x00\x00\x00",
        len(text_data),   # VirtualSize
        0x1000,           # VirtualAddress
        len(text_data),   # SizeOfRawData
        0x200,            # PointerToRawData
        0, 0, 0, 0,
        0x60000020        # IMAGE_SCN_CNT_CODE | IMAGE_SCN_MEM_EXECUTE | IMAGE_SCN_MEM_READ
    )

    # 2. .rdata
    sec_rdata = struct.pack(
        "<8sIIIIIIHHI",
        b".rdata\x00\x00",
        len(rdata_data),  # VirtualSize
        0x2000,           # VirtualAddress
        len(rdata_data),  # SizeOfRawData
        0x200 + len(text_data),  # PointerToRawData (0x600)
        0, 0, 0, 0,
        0x40000040        # IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ
    )

    # 3. .data
    sec_data = struct.pack(
        "<8sIIIIIIHHI",
        b".data\x00\x00\x00",
        len(data_data),   # VirtualSize
        0x3000,           # VirtualAddress
        len(data_data),   # SizeOfRawData
        0x200 + len(text_data) + len(rdata_data),  # PointerToRawData (0xE00)
        0, 0, 0, 0,
        0xC0000040        # IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ | IMAGE_SCN_MEM_WRITE
    )

    # Assemble headers and pad to 0x200
    headers = dos_header + dos_stub + pe_sig + coff_header + opt_header + sec_text + sec_rdata + sec_data
    headers_padded = headers.ljust(file_align, b"\x00")

    # Complete PE binary
    pe_binary = headers_padded + text_data + rdata_data + data_data
    return pe_binary

def main():
    binary_bytes = generate_realistic_crypto_binary()
    
    out_dir = Path("data/demo_test_suite")
    out_dir.mkdir(parents=True, exist_ok=True)
    
    exe_path = out_dir / "vulnerable_crypto_app.exe"
    bin_path = out_dir / "vulnerable_crypto_app.bin"
    
    with open(exe_path, "wb") as f:
        f.write(binary_bytes)
    with open(bin_path, "wb") as f:
        f.write(binary_bytes)
        
    print(f"Generated realistic test binary:")
    print(f"  EXE: {exe_path} ({len(binary_bytes):,} bytes)")
    print(f"  BIN: {bin_path} ({len(binary_bytes):,} bytes)")
    print(f"Contains: PE32+ header, .text code section, .rdata with RSA-2048 key, OIDs, DES/3DES, MD5, AES, .data high-entropy block.")

if __name__ == "__main__":
    main()
