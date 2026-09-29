export type Severity = 'broken' | 'vulnerable' | 'deprecated' | 'info';

export interface CryptoFinding {
  uri: string;
  line: number;
  col: number;
  length: number;
  algorithmId: string;
  algorithmName: string;
  algorithmCategory: string;
  severity: Severity;
  message: string;
  remediationHint: string;
  detectionMethod: string;
  keySize?: number;
  curve?: string;
  fileSnippet: string;
  suppress?: boolean;
}

export interface AlgorithmSpec {
  id: string;
  category: string;
  severity: Severity;
  cves?: string[];
  remediation: string;
  fips?: string;
  description: string;
}

export const ALGORITHM_REGISTRY: Record<string, AlgorithmSpec> = {
  'md5':     { id: 'md5', category: 'Hash', severity: 'broken', cves: ['CVE-2004-2761'], remediation: 'BLAKE3 (or SHA3-256)', description: 'MD5: collisions & chosen-prefix attacks trivial since 2008. Never use for integrity.' },
  'sha1':    { id: 'sha1', category: 'Hash', severity: 'broken', cves: ['SHAttered-2017', 'CVE-2005-4900'], remediation: 'BLAKE3 (or SHA3-256)', description: 'SHA-1: collision-broken by SHAttered (2017, $110K). Deprecated everywhere.' },
  'md4':     { id: 'md4', category: 'Hash', severity: 'broken', remediation: 'BLAKE3', description: 'MD4 broken since 1995.' },
  'md2':     { id: 'md2', category: 'Hash', severity: 'broken', remediation: 'BLAKE3', description: 'MD2 broken.' },
  'des':     { id: 'des', category: 'Cipher', severity: 'broken', remediation: 'AES-256-GCM', description: '56-bit key; brute-forced in hours.' },
  '3des':    { id: '3des', category: 'Cipher', severity: 'broken', cves: ['Sweet32'], remediation: 'AES-256-GCM', description: '3DES: Sweet32 birthday attack on 64-bit block.' },
  'rc4':     { id: 'rc4', category: 'Cipher', severity: 'broken', cves: ['RFC 7465'], remediation: 'ChaCha20-Poly1305', description: 'RC4: prohibited by RFC 7465.' },
  'rc2':     { id: 'rc2', category: 'Cipher', severity: 'broken', remediation: 'AES-256-GCM', description: 'RC2 is obsolete.' },
  'blowfish_small': { id: 'blowfish_small', category: 'Cipher', severity: 'broken', remediation: 'AES-256-GCM', description: 'Blowfish: 64-bit block — Sweet32 applies.' },
  'ecb_mode': { id: 'ecb_mode', category: 'Mode', severity: 'broken', remediation: 'AES-GCM (or AES-SIV for nonce-misuse safety)', description: 'ECB leaks plaintext patterns. Always use an authenticated mode.' },
  'math_random': { id: 'math_random', category: 'RNG', severity: 'broken', remediation: 'crypto.randomBytes / secrets.token_bytes / Java SecureRandom', description: 'Non-CSPRNG used where CSPRNG required (HNDL risk).' },
  'cert_verify_disabled': { id: 'cert_verify_disabled', category: 'TLS', severity: 'vulnerable', remediation: 'verify=True + pinned CA bundle / system trust store', description: 'TLS certificate validation disabled — MitM possible (CWE-295).' },
  'rsa_legacy': { id: 'rsa_legacy', category: 'Asymmetric', severity: 'vulnerable', remediation: 'ML-KEM-768 + ECDSA-P384 hybrid', fips: 'FIPS 203', description: 'RSA vulnerable to Shor’s algorithm on a CRQC; P5 2033 horizon.' },
  'rsa_2048': { id: 'rsa_2048', category: 'Asymmetric', severity: 'deprecated', remediation: 'ML-KEM-768 + ECDSA-P384 hybrid', fips: 'FIPS 203', description: 'RSA-2048: disallowed by NIST after 2030 (SP 800-131A Rev. 2).' },
  'rsa_3072': { id: 'rsa_3072', category: 'Asymmetric', severity: 'deprecated', remediation: 'ML-KEM-768 + ECDSA-P384 hybrid', fips: 'FIPS 203', description: 'RSA-3072: acceptable through 2030; plan migration now.' },
  'rsa_4096': { id: 'rsa_4096', category: 'Asymmetric', severity: 'info', remediation: 'ML-KEM-1024 (FIPS 203) for long-term HNDL data.', fips: 'FIPS 203', description: 'RSA-4096 viable through ~2035 but already PQC-bounded.' },
  'ecdsa_p192': { id: 'ecdsa_p192', category: 'Asymmetric', severity: 'broken', remediation: 'ML-DSA-65 (Dilithium) or EdDSA-Ed448', fips: 'FIPS 204', description: 'P-192 below NIST minimum (SP 800-131A).' },
  'ecdsa_p224': { id: 'ecdsa_p224', category: 'Asymmetric', severity: 'broken', remediation: 'ML-DSA-65 (Dilithium)', fips: 'FIPS 204', description: 'P-224 below NIST minimum.' },
  'ecdsa_p256': { id: 'ecdsa_p256', category: 'Asymmetric', severity: 'deprecated', remediation: 'ML-DSA-65 (Dilithium) — interim EdDSA-Ed448', fips: 'FIPS 204', description: 'P-256: vulnerable to CRQC; CNSA 2.0 mandates P-384+ until 2030, then PQC.' },
  'ecdsa_p384': { id: 'ecdsa_p384', category: 'Asymmetric', severity: 'deprecated', remediation: 'ML-DSA-65 (Dilithium)', fips: 'FIPS 204', description: 'P-384: acceptable only until 2030 per CNSA 2.0.' },
  'ed25519': { id: 'ed25519', category: 'Asymmetric', severity: 'deprecated', remediation: 'ML-DSA-65 (Dilithium, FIPS 204) — interim Ed448', fips: 'FIPS 204', description: 'Ed25519: not part of NIST PQC, vulnerable to Shor. CNSA 2.0 disallows.' },
  'x25519':  { id: 'x25519', category: 'Asymmetric', severity: 'deprecated', remediation: 'ML-KEM-768 + X25519 hybrid', fips: 'FIPS 203', description: 'X25519 KEM: vulnerable to Shor. Use hybrid with ML-KEM-768.' },
  'dh_small': { id: 'dh_small', category: 'Asymmetric', severity: 'broken', remediation: 'ML-KEM-768 + X25519 hybrid (FIPS 203)', description: 'DH < 2048-bit: log-disc attack feasible.' },
  'dh_2048': { id: 'dh_2048', category: 'Asymmetric', severity: 'deprecated', remediation: 'ML-KEM-768 + X25519 hybrid', description: 'DH-2048: vulnerable to CRQC; migrate.' },
  'dh_3072': { id: 'dh_3072', category: 'Asymmetric', severity: 'deprecated', remediation: 'ML-KEM-768 + X25519 hybrid', description: 'DH-3072: acceptable transitional.' },
  'blake2':  { id: 'blake2', category: 'Hash', severity: 'info', remediation: 'Consider BLAKE3 (faster, modern).', description: 'BLAKE2: secure but BLAKE3 is recommended.' },
  'sha256':  { id: 'sha256', category: 'Hash', severity: 'info', remediation: 'Consider SHA3-256 / BLAKE3 for hash agility.', description: 'SHA-256: secure today; plan for agility.' },
  'sha384':  { id: 'sha384', category: 'Hash', severity: 'info', remediation: 'Consider SHA3-384 / BLAKE3.', description: 'SHA-384: secure today.' },
  'sha512':  { id: 'sha512', category: 'Hash', severity: 'info', remediation: 'Consider SHA3-512 / BLAKE3.', description: 'SHA-512: secure today.' },
  'sha3':    { id: 'sha3', category: 'Hash', severity: 'info', remediation: '', description: 'SHA-3: NIST-approved.' },
  'blake3':  { id: 'blake3', category: 'Hash', severity: 'info', remediation: '', description: 'BLAKE3: modern, fast, quantum-resistant-ish (Grover-bounded).' },
  'aes_gcm': { id: 'aes_gcm', category: 'Cipher', severity: 'info', remediation: '', description: 'AES-GCM: NIST-approved AEAD.' },
  'chacha20':{ id: 'chacha20', category: 'Cipher', severity: 'info', remediation: '', description: 'ChaCha20-Poly1305: modern AEAD.' },
  'ml_kem_768': { id: 'ml_kem_768', category: 'PQ', severity: 'info', remediation: '', fips: 'FIPS 203', description: 'ML-KEM-768 (Kyber): NIST standard for KEM.' },
  'ml_dsa_65': { id: 'ml_dsa_65', category: 'PQ', severity: 'info', remediation: '', fips: 'FIPS 204', description: 'ML-DSA-65 (Dilithium): NIST standard for signatures.' },
  'slh_dsa': { id: 'slh_dsa', category: 'PQ', severity: 'info', remediation: '', fips: 'FIPS 205', description: 'SLH-DSA (SPHINCS+): hash-based signatures.' }
};

interface Pattern {
  id: keyof typeof ALGORITHM_REGISTRY;
  re: RegExp;
  group?: number;
  lengthGroup?: number;
  dynamicKeyCheck?: (m: RegExpMatchArray) => { severity?: Severity; keySize?: number };
  contextCheck?: (text: string, idx: number) => boolean;
}

export function severityRank(s: Severity): number {
  switch (s) { case 'broken': return 4; case 'vulnerable': return 3; case 'deprecated': return 2; case 'info': return 1; default: return 0; }
}

export class CryptoDetector {
  private patterns: Pattern[];

  constructor() {
    this.patterns = [
      { id: 'md5',     re: /\b(?:md5|MD5)\b/g },
      { id: 'md4',     re: /\b(?:md4|MD4)\b/g },
      { id: 'md2',     re: /\b(?:md2|MD2)\b/g },
      { id: 'sha1',    re: /\b(?:sha-?1|SHA-?1|SHA1)\b/g },
      { id: 'rc4',     re: /\b(?:rc4|RC4|ARCFOUR|arcfour)\b/g },
      { id: 'rc2',     re: /\b(?:rc2|RC2)\b/g },
      { id: 'des',     re: /\b(?:DES|des|"DES"|'DES'|Cipher\.DES|DESede)\b/g },
      { id: '3des',    re: /\b(?:3DES|TripleDES|DESede|TRIPLE_DES)\b/g },
      { id: 'blowfish_small', re: /\b(?:Blowfish|"Blowfish")\b/g },
      { id: 'ecb_mode', re: /(AES|"AES"|'AES')\s*\/\s*(?:NoPadding|None)\s*\/\s*(?:NoPadding|None)\s*\/\s*ECB/gi },
      { id: 'ecb_mode', re: /\.(?:encrypt|decrypt)\s*\([^)]*(ECB|ECB-NoPadding)/g },
      { id: 'ecb_mode', re: /Cipher\.getInstance\s*\(\s*["'](?:AES|DES)["']\s*\/\s*["']?ECB/gi },
      { id: 'ecb_mode', re: /Cipher\.getInstance\s*\(\s*["'](?:AES|DES)\/(?:ECB|NoPadding|PKCS5Padding)\/(?:NoPadding|PKCS5Padding)\/[^)]*["']/gi },
      { id: 'ecb_mode', re: /Cipher\.getInstance\s*\(\s*["']?(?:AES|DES)\s*\/\s*["']?ECB/gi },
      { id: 'ecb_mode', re: /["'](?:AES|DES)\/(?:ECB|PadModeECB|PKCS5)(?:\/[^"']*)?["']/gi },
      { id: 'ecb_mode', re: /\bmodes\.ECB\b/g },
      { id: 'ecb_mode', re: /\bCipherMode\.ECB\b/g },
      { id: 'ecb_mode', re: /\bnew\s+BlockCipherAdapter\s*\(\s*["']?(?:AES|DES)\b[^,)]*,\s*["']?ECB/gi },
      { id: 'math_random', re: /Math\.random\s*\(\s*\)/g },
      { id: 'math_random', re: /\brandom\.randint\s*\(|\brandom\.choice\s*\(|\brandom\.shuffle\s*\(/g },
      { id: 'math_random', re: /java\.util\.Random\b/g },
      { id: 'math_random', re: /new\s+Random\s*\(\s*\)/g },
      { id: 'math_random', re: /\brand\s*\(\s*\)/g },
      { id: 'math_random', re: /\bsrand\s*\(/g },
      { id: 'math_random', re: /\bdrand48\s*\(/g },
      { id: 'math_random', re: /\brand_r\s*\(\s*\)/g },
      { id: 'ecdsa_p192', re: /\b(?:secp192r1|P-?192|prime192v1)\b/gi },
      { id: 'ecdsa_p224', re: /\b(?:secp224r1|P-?224|prime224v1)\b/gi },
      { id: 'ecdsa_p256', re: /\b(?:secp256r1|P-?256|prime256v1)\b/gi },
      { id: 'ed25519', re: /\b(?:ed25519|Ed25519|EDDSA)\b/g },
      { id: 'x25519',  re: /\b(?:x25519|X25519)\b/g },
      { id: 'rsa_legacy', re: /\bRSA[\s_-]?(?:512|768|1024)\b/g },
      { id: 'rsa_legacy', re: /generateprime\s*\(\s*\d+\s*,\s*(?:512|768|1024)\s*\)/g },
      { id: 'rsa_legacy', re: /RSA[\s._-]?generate[\s._-]?\(?\s*?(?:512|768|1024)/g },
      { id: 'rsa_2048', re: /\bRSA[\s._-]?2048\b|generateprime\s*\(\s*\d+\s*,\s*2048\s*\)/g },
      { id: 'rsa_2048', re: /RSA[\s._-]?generate[\s._-]?\(?\s*?2048/g },
      { id: 'rsa_3072', re: /\bRSA[\s._-]?3072\b|generateprime\s*\(\s*\d+\s*,\s*3072\s*\)/g },
      { id: 'rsa_3072', re: /RSA[\s._-]?generate[\s._-]?\(?\s*?3072/g },
      { id: 'rsa_4096', re: /\bRSA[\s._-]?4096\b|generateprime\s*\(\s*\d+\s*,\s*4096\s*\)/g },
      { id: 'rsa_4096', re: /RSA[\s._-]?generate[\s._-]?\(?\s*?4096/g },
      { id: 'ecdsa_p384', re: /\b(?:secp384r1|P-?384|prime384v1)\b/gi },
      { id: 'dh_small', re: /\bDH[\s_-]?(?:512|768|1024|1536)\b|modp\s*\(?(?:512|768|1024|1536)\)?/g },
      { id: 'dh_2048', re: /\bDH[\s_-]?2048\b|modp\s*\(?2048\)?/g },
      { id: 'dh_3072', re: /\bDH[\s_-]?3072\b|modp\s*\(?3072\)?/g },
      { id: 'sha256', re: /\bSHA-?256\b/g },
      { id: 'sha384', re: /\bSHA-?384\b/g },
      { id: 'sha512', re: /\bSHA-?512\b/g },
      { id: 'sha3',   re: /\bSHA3-?\d+\b/g },
      { id: 'blake2', re: /\bBLAKE2\b/g },
      { id: 'blake3', re: /\bBLAKE3\b/g },
      { id: 'aes_gcm', re: /\bAES[\s_-]?GCM\b|AES_GCM|AESGCM|\/GCM\//g },
      { id: 'chacha20', re: /\bChaCha20[\s_-]?Poly1305\b/g },
      { id: 'ml_kem_768', re: /\bML-KEM-?(?:512|768|1024)|Kyber(?:512|768|1024)/gi },
      { id: 'ml_dsa_65', re: /\bML-DSA-?(?:44|65|87)|Dilithium(?:2|3|5)/gi },
      { id: 'slh_dsa', re: /\bSLH-DSA|SPHINCS\+/g },
      { id: 'cert_verify_disabled', re: /\bverify\s*=\s*False\b/g },
      { id: 'cert_verify_disabled', re: /\bCERT_NONE\b/g },
      { id: 'cert_verify_disabled', re: /\bcheck_hostname\s*=\s*False\b/g },
      { id: 'cert_verify_disabled', re: /\b_ssl\s*\.\s*_create_unverified_context\b|ssl\s*\.\s*_create_unverified_https_context\b/g }
    ];
  }

  scan(text: string, languageId: string): CryptoFinding[] {
    const findings: CryptoFinding[] = [];
    const seen = new Set<string>();
    for (const p of this.patterns) {
      const re = new RegExp(p.re.source, p.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const idx = m.index;
        if (idx > 0) {
          const before = text.slice(Math.max(0, idx - 200), idx);
          if (/\/\/|^\s*#|^\s*\*|\/\*/.test(before.slice(-12)) && /\becdat-ignore-(?:next-line|line)\b/i.test(before)) {
            continue;
          }
        }
        const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
        const lineEnd = text.indexOf('\n', idx);
        const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
        const lineNo = text.slice(0, idx).split('\n').length - 1;
        const col = idx - lineStart;

        let id = String(p.id);
        let spec = ALGORITHM_REGISTRY[id];

        // Dynamic RSA/DH key-size upgrade
        let overrideSeverity: Severity | undefined;
        let keySize: number | undefined;
        if (id === 'rsa_legacy' || id === 'rsa_2048' || id === 'rsa_3072' || id === 'rsa_4096') {
          const keyMatch = /(\d{3,5})/.exec(m[0]);
          if (keyMatch) {
            keySize = parseInt(keyMatch[1], 10);
            if (keySize < 2048) overrideSeverity = 'broken';
            else if (keySize < 3072) overrideSeverity = 'vulnerable';
            else if (keySize < 4096) overrideSeverity = 'deprecated';
            else overrideSeverity = 'info';
          }
        }
        if (id === 'dh_small' || id === 'dh_2048' || id === 'dh_3072') {
          const keyMatch = /(\d{3,5})/.exec(m[0]);
          if (keyMatch) {
            keySize = parseInt(keyMatch[1], 10);
            if (keySize < 2048) overrideSeverity = 'broken';
            else if (keySize < 3072) overrideSeverity = 'vulnerable';
            else overrideSeverity = 'deprecated';
          }
        }

        // Crypto-API signpost: detect "from cryptography.hazmat.primitives.asymmetric import rsa, padding" etc.
        if (id === 'rsa_legacy' && /generate_private_key\s*\(\s*public_exponent\s*=/.test(text.slice(idx, idx + 220))) {
          const ksMatch = /key_size\s*=\s*(\d+)/.exec(text.slice(idx, idx + 220));
          if (ksMatch) {
            keySize = parseInt(ksMatch[1], 10);
            if (keySize < 2048) overrideSeverity = 'broken';
            else if (keySize < 3072) overrideSeverity = 'vulnerable';
            else overrideSeverity = 'deprecated';
          }
        }

        const finalSeverity = overrideSeverity ?? spec.severity;
        const hashKey = `${id}:${lineNo}:${col}`;
        if (seen.has(hashKey)) continue;
        seen.add(hashKey);

        findings.push({
          uri: '',
          line: lineNo,
          col,
          length: m[0].length,
          algorithmId: id,
          algorithmName: spec.id,
          algorithmCategory: spec.category,
          severity: finalSeverity,
          message: spec.description,
          remediationHint: spec.remediation || 'No migration needed.',
          detectionMethod: 'regex-pattern',
          keySize,
          fileSnippet: lineText.trim(),
          curve: id.startsWith('ecdsa') ? m[0] : undefined
        });

        if (m[0].length === 0) re.lastIndex++;
      }
    }

    // Suppress duplicates from generic patterns when specific pattern matched on same line
    const filtered: CryptoFinding[] = [];
    findings.sort((a, b) => a.line - b.line || a.col - b.col);
    for (const f of findings) {
      const isDup = filtered.some(prev =>
        prev.line === f.line &&
        (prev.col === f.col || Math.abs(prev.col - f.col) < prev.length) &&
        prev.algorithmCategory === f.algorithmCategory);
      if (!isDup) filtered.push(f);
    }
    return filtered.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }

  computeFileScore(findings: CryptoFinding[]): { score: number; worst: Severity | 'clean' } {
    if (!findings.length) return { score: 100, worst: 'clean' };
    let worst: Severity = 'info';
    let penalty = 0;
    for (const f of findings) {
      if (severityRank(f.severity) > severityRank(worst)) worst = f.severity;
      penalty += severityRank(f.severity) * 10;
    }
    const score = Math.max(0, Math.min(100, 100 - penalty));
    return { score, worst };
  }
}
function _legacy_severityRankRemoved(s: Severity): number {
  return severityRank(s);
}

