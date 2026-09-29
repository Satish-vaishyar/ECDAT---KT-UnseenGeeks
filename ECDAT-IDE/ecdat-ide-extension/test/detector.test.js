'use strict';
const { vscode } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { SAMPLES, activateEditor } = require('./helpers/fixtures');
const { CryptoDetector, severityRank, ALGORITHM_REGISTRY } = require('../out/cryptoDetector');
const { WorkspaceScanner } = require('../out/scanner');

const detector = new CryptoDetector();
const scan = (text, lang = 'python') => detector.scan(text, lang);
const byId = (findings, id) => findings.filter((f) => f.algorithmId === id);
const ids = (findings) => findings.map((f) => f.algorithmId);
const one = (findings, id) => {
  const matches = byId(findings, id);
  assert.strictEqual(matches.length, 1, `expected exactly one ${id}, got [${ids(findings)}]`);
  return matches[0];
};

const CATEGORIES = new Set(['Hash', 'Cipher', 'Mode', 'RNG', 'TLS', 'Asymmetric', 'PQ']);
const SEVERITIES = new Set(['broken', 'vulnerable', 'deprecated', 'info']);

function assertWellFormed(findings, text) {
  assert.ok(Array.isArray(findings));
  for (const f of findings) {
    assert.strictEqual(f.uri, '');
    assert.ok(Number.isInteger(f.line) && f.line >= 0, `bad line ${f.line}`);
    assert.ok(Number.isInteger(f.col) && f.col >= 0, `bad col ${f.col}`);
    assert.ok(f.length > 0, 'length must be positive');
    assert.ok(typeof f.algorithmId === 'string' && f.algorithmId.length > 0);
    assert.strictEqual(f.algorithmName, ALGORITHM_REGISTRY[f.algorithmId].id);
    assert.ok(CATEGORIES.has(f.algorithmCategory), `bad category ${f.algorithmCategory}`);
    assert.ok(SEVERITIES.has(f.severity), `bad severity ${f.severity}`);
    assert.ok(f.message && f.message.length > 0);
    assert.strictEqual(f.detectionMethod, 'regex-pattern');
    if (f.severity === 'broken' || f.severity === 'vulnerable') {
      assert.ok(f.remediationHint && f.remediationHint.length > 0,
        `${f.algorithmId} (${f.severity}) needs a remediation hint`);
    }
    if (text !== undefined) {
      assert.strictEqual(f.fileSnippet, text.split('\n')[f.line].trim());
    }
  }
}

test.beforeEach(() => {
  vscode.__reset();
});

test('severityRank maps all severities and defaults to 0', () => {
  assert.strictEqual(severityRank('broken'), 4);
  assert.strictEqual(severityRank('vulnerable'), 3);
  assert.strictEqual(severityRank('deprecated'), 2);
  assert.strictEqual(severityRank('info'), 1);
  assert.strictEqual(severityRank('unknown'), 0);
});

test('ALGORITHM_REGISTRY exposes spec metadata', () => {
  assert.strictEqual(ALGORITHM_REGISTRY.md5.category, 'Hash');
  assert.strictEqual(ALGORITHM_REGISTRY.md5.severity, 'broken');
  assert.ok(ALGORITHM_REGISTRY.md5.remediation.length > 0);
  assert.ok(ALGORITHM_REGISTRY.md5.description.length > 0);
  assert.strictEqual(ALGORITHM_REGISTRY.rsa_legacy.category, 'Asymmetric');
  assert.strictEqual(ALGORITHM_REGISTRY.cert_verify_disabled.severity, 'vulnerable');
  assert.strictEqual(ALGORITHM_REGISTRY.ml_kem_768.category, 'PQ');
  assert.strictEqual(ALGORITHM_REGISTRY.ml_kem_768.fips, 'FIPS 203');
});

test('scan: empty text yields no findings', () => {
  assert.deepStrictEqual(scan(''), []);
});

test('scan: md5 finding has the full documented shape', () => {
  const text = 'import hashlib\nh = hashlib.md5(data)\n';
  const findings = scan(text);
  assertWellFormed(findings, text);
  const f = one(findings, 'md5');
  assert.strictEqual(f.uri, '');
  assert.strictEqual(f.line, 1);
  assert.strictEqual(f.col, 'h = hashlib.md5(data)'.indexOf('md5'));
  assert.strictEqual(f.length, 3);
  assert.strictEqual(f.algorithmId, 'md5');
  assert.strictEqual(f.algorithmName, 'md5');
  assert.strictEqual(f.algorithmCategory, 'Hash');
  assert.strictEqual(f.severity, 'broken');
  assert.strictEqual(f.message, ALGORITHM_REGISTRY.md5.description);
  assert.strictEqual(f.remediationHint, ALGORITHM_REGISTRY.md5.remediation);
  assert.strictEqual(f.detectionMethod, 'regex-pattern');
  assert.strictEqual(f.fileSnippet, 'h = hashlib.md5(data)');
  assert.strictEqual(f.keySize, undefined);
  assert.strictEqual(f.curve, undefined);
});

test('scan: exact line, col and length for findings across lines', () => {
  const text = ['import hashlib', 'h = hashlib.md5(data)', 'd = SHA-256'].join('\n');
  const findings = scan(text);
  assertWellFormed(findings, text);
  const md5 = one(findings, 'md5');
  assert.strictEqual(md5.line, 1);
  assert.strictEqual(md5.col, 'h = hashlib.md5(data)'.indexOf('md5'));
  assert.strictEqual(md5.length, 3);
  const sha = one(findings, 'sha256');
  assert.strictEqual(sha.line, 2);
  assert.strictEqual(sha.col, 'd = SHA-256'.indexOf('SHA-256'));
  assert.strictEqual(sha.length, 7);
});

const DETECTION_CASES = [
  { name: 'md5 hash', text: 'hashlib.md5(data)', lang: 'python', id: 'md5', sev: 'broken', cat: 'Hash' },
  { name: 'sha1 hash', text: 'hashlib.sha1(data)', lang: 'python', id: 'sha1', sev: 'broken', cat: 'Hash' },
  { name: 'sha-1 hyphen form', text: 'digest = SHA-1(bytes)', lang: 'python', id: 'sha1', sev: 'broken', cat: 'Hash' },
  { name: 'md4 hash', text: 'md4(data)', lang: 'python', id: 'md4', sev: 'broken', cat: 'Hash' },
  { name: 'md2 hash', text: 'md2(data)', lang: 'python', id: 'md2', sev: 'broken', cat: 'Hash' },
  { name: 'des cipher', text: 'DES.Create()', lang: 'csharp', id: 'des', sev: 'broken', cat: 'Cipher' },
  { name: '3des cipher', text: 'TripleDES.Create()', lang: 'csharp', id: '3des', sev: 'broken', cat: 'Cipher' },
  { name: 'rc4 cipher', text: 'RC4.new(key)', lang: 'python', id: 'rc4', sev: 'broken', cat: 'Cipher' },
  { name: 'rc2 cipher', text: 'RC2.new(key)', lang: 'python', id: 'rc2', sev: 'broken', cat: 'Cipher' },
  { name: 'blowfish cipher', text: 'Blowfish.create()', lang: 'java', id: 'blowfish_small', sev: 'broken', cat: 'Cipher' },
  { name: 'ecb java getInstance', text: 'Cipher.getInstance("AES/ECB/PKCS5Padding")', lang: 'java', id: 'ecb_mode', sev: 'broken', cat: 'Mode' },
  { name: 'ecb java instance with padding chain', text: 'Cipher.getInstance("AES/ECB/PKCS5Padding/NoPadding")', lang: 'java', id: 'ecb_mode', sev: 'broken', cat: 'Mode' },
  { name: 'ecb js encrypt call', text: 'stream.encrypt(payload, ECB)', lang: 'javascript', id: 'ecb_mode', sev: 'broken', cat: 'Mode' },
  { name: 'ecb modes.ECB member', text: 'opts.mode = modes.ECB', lang: 'javascript', id: 'ecb_mode', sev: 'broken', cat: 'Mode' },
  { name: 'ecb CipherMode.ECB enum', text: 'CipherMode.ECB.configure()', lang: 'java', id: 'ecb_mode', sev: 'broken', cat: 'Mode' },
  { name: 'ecb string literal', text: 'cipher = "DES/ECB/PKCS5Padding"', lang: 'python', id: 'ecb_mode', sev: 'broken', cat: 'Mode' },
  { name: 'rng Math.random', text: 'n = Math.random()', lang: 'javascript', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng random.randint', text: 'random.randint(0, 9)', lang: 'python', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng random.choice', text: 'random.choice(pool)', lang: 'python', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng random.shuffle', text: 'random.shuffle(items)', lang: 'python', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng java.util.Random', text: 'java.util.Random rng', lang: 'java', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng new Random()', text: 'new Random()', lang: 'java', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng rand()', text: 'seed = rand()', lang: 'c', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng srand(', text: 'srand(42)', lang: 'c', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng drand48(', text: 'drand48()', lang: 'c', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'rng rand_r()', text: 'rand_r()', lang: 'c', id: 'math_random', sev: 'broken', cat: 'RNG' },
  { name: 'curve secp192r1', text: 'secp192r1', lang: 'python', id: 'ecdsa_p192', sev: 'broken', cat: 'Asymmetric', curve: 'secp192r1' },
  { name: 'curve P-224', text: 'P-224', lang: 'python', id: 'ecdsa_p224', sev: 'broken', cat: 'Asymmetric', curve: 'P-224' },
  { name: 'curve secp256r1', text: 'secp256r1', lang: 'python', id: 'ecdsa_p256', sev: 'deprecated', cat: 'Asymmetric', curve: 'secp256r1' },
  { name: 'curve secp384r1', text: 'secp384r1', lang: 'python', id: 'ecdsa_p384', sev: 'deprecated', cat: 'Asymmetric', curve: 'secp384r1' },
  { name: 'curve ed25519', text: 'ed25519', lang: 'python', id: 'ed25519', sev: 'deprecated', cat: 'Asymmetric' },
  { name: 'curve EDDSA', text: 'EDDSA', lang: 'java', id: 'ed25519', sev: 'deprecated', cat: 'Asymmetric' },
  { name: 'curve x25519', text: 'x25519', lang: 'python', id: 'x25519', sev: 'deprecated', cat: 'Asymmetric' },
  { name: 'sha256', text: 'd = SHA-256', lang: 'python', id: 'sha256', sev: 'info', cat: 'Hash' },
  { name: 'sha384', text: 'd = SHA-384', lang: 'python', id: 'sha384', sev: 'info', cat: 'Hash' },
  { name: 'sha512', text: 'd = SHA-512', lang: 'python', id: 'sha512', sev: 'info', cat: 'Hash' },
  { name: 'sha3', text: 'd = SHA3-256', lang: 'python', id: 'sha3', sev: 'info', cat: 'Hash' },
  { name: 'blake2', text: 'd = BLAKE2', lang: 'python', id: 'blake2', sev: 'info', cat: 'Hash' },
  { name: 'blake3', text: 'd = BLAKE3', lang: 'python', id: 'blake3', sev: 'info', cat: 'Hash' },
  { name: 'aes-gcm', text: 'k = AES-GCM', lang: 'python', id: 'aes_gcm', sev: 'info', cat: 'Cipher' },
  { name: 'chacha20-poly1305', text: 'k = ChaCha20-Poly1305', lang: 'python', id: 'chacha20', sev: 'info', cat: 'Cipher' },
  { name: 'ml-kem-768', text: 'kem = ML-KEM-768', lang: 'python', id: 'ml_kem_768', sev: 'info', cat: 'PQ' },
  { name: 'kyber768 alias', text: 'kem = Kyber768', lang: 'python', id: 'ml_kem_768', sev: 'info', cat: 'PQ' },
  { name: 'ml-dsa-65', text: 'sig = ML-DSA-65', lang: 'python', id: 'ml_dsa_65', sev: 'info', cat: 'PQ' },
  { name: 'dilithium5 alias', text: 'sig = Dilithium5', lang: 'python', id: 'ml_dsa_65', sev: 'info', cat: 'PQ' },
  { name: 'slh-dsa', text: 'sig = SLH-DSA', lang: 'python', id: 'slh_dsa', sev: 'info', cat: 'PQ' },
  { name: 'sphincs+ alias', text: 'sig = SPHINCS+', lang: 'python', id: 'slh_dsa', sev: 'info', cat: 'PQ' },
  { name: 'tls verify=False', text: 'requests.get(url, verify=False)', lang: 'python', id: 'cert_verify_disabled', sev: 'vulnerable', cat: 'TLS' },
  { name: 'tls CERT_NONE', text: 'ssl.CERT_NONE', lang: 'python', id: 'cert_verify_disabled', sev: 'vulnerable', cat: 'TLS' },
  { name: 'tls check_hostname=False', text: 'context.check_hostname = False', lang: 'python', id: 'cert_verify_disabled', sev: 'vulnerable', cat: 'TLS' },
  { name: 'tls _ssl unverified context', text: 'ctx = _ssl._create_unverified_context()', lang: 'python', id: 'cert_verify_disabled', sev: 'vulnerable', cat: 'TLS' },
  { name: 'tls unverified https context', text: 'ctx = ssl._create_unverified_https_context()', lang: 'python', id: 'cert_verify_disabled', sev: 'vulnerable', cat: 'TLS' },
];

for (const c of DETECTION_CASES) {
  test(`scan detects ${c.name}`, () => {
    const findings = scan(c.text, c.lang);
    assertWellFormed(findings, c.text);
    const f = one(findings, c.id);
    assert.strictEqual(f.severity, c.sev);
    assert.strictEqual(f.algorithmCategory, c.cat);
    assert.strictEqual(f.line, 0);
    assert.ok(f.col >= 0);
    if (c.curve !== undefined) assert.strictEqual(f.curve, c.curve);
    else assert.strictEqual(f.curve, undefined);
  });
}

test('scan: info findings with empty registry remediation get a fallback hint', () => {
  const f = one(scan('d = SHA3-256'), 'sha3');
  assert.strictEqual(f.remediationHint, 'No migration needed.');
});

test('scan: dedupes overlapping same-category matches on one line', () => {
  const text = 'Cipher.getInstance("DES/ECB/PKCS5Padding")';
  const findings = scan(text, 'java');
  assertWellFormed(findings, text);
  const seen = new Set();
  for (const f of findings) {
    const key = `${f.line}:${f.col}:${f.algorithmCategory}`;
    assert.ok(!seen.has(key), `duplicate finding ${key}`);
    seen.add(key);
  }
  assert.strictEqual(byId(findings, 'ecb_mode').length, 1);
  assert.strictEqual(byId(findings, 'des').length, 1);
  assert.strictEqual(one(findings, 'ecb_mode').severity, 'broken');
  assert.strictEqual(one(findings, 'des').severity, 'broken');
});

test('scan: identical id:line:col matches from different patterns collapse to one', () => {
  const findings = scan('Cipher.getInstance("AES/ECB/PKCS5Padding/NoPadding")', 'java');
  assert.strictEqual(findings.length, 1);
  const f = one(findings, 'ecb_mode');
  assert.strictEqual(f.line, 0);
  assert.strictEqual(f.col, 0);
  assert.ok(f.length > 0);
});

test('scan: ecdat-ignore-line in a JS comment suppresses the finding', () => {
  const findings = scan('// ecdat-ignore-line: legacy\n// md5(x)', 'javascript');
  assert.ok(!byId(findings, 'md5').length, 'md5 should be suppressed');
  assertWellFormed(findings);
});

test('scan: ecdat-ignore-next-line in a JS comment suppresses the finding', () => {
  const findings = scan('// ecdat-ignore-next-line\n// md5(y)', 'javascript');
  assert.ok(!byId(findings, 'md5').length, 'md5 should be suppressed');
});

test('scan: python hash-comment window suppresses a commented-out match', () => {
  const text = '# ecdat-ignore-line: trusted\n' + ' '.repeat(9) + '# md5(y)';
  const findings = scan(text);
  assert.ok(!byId(findings, 'md5').length, 'md5 should be suppressed');
});

test('scan: directive without a comment marker in the 12-char window does not suppress', () => {
  const findings = scan('ecdat-ignore-line md5(x)', 'javascript');
  const f = one(findings, 'md5');
  assert.strictEqual(f.severity, 'broken');
  assert.strictEqual(f.line, 0);
});

test('scan: directive outside the 200-char window does not suppress', () => {
  const text = '// ecdat-ignore-line\n' + 'a'.repeat(210) + '\n// md5(y)';
  const findings = scan(text, 'javascript');
  assert.ok(byId(findings, 'md5').length, 'md5 should still be reported');
});

test('scan: ordinary previous-line hash comment does not suppress', () => {
  const text = '# ecdat-ignore-line: trusted\nx = md5(y)';
  const f = one(scan(text), 'md5');
  assert.strictEqual(f.line, 1);
});

test('scan: match at index 0 skips the suppression check', () => {
  const f = one(scan('md5(x)'), 'md5');
  assert.strictEqual(f.line, 0);
  assert.strictEqual(f.col, 0);
});

test('scan: ignoredLine fixture does not suppress (directive not in the 12-char window)', () => {
  const findings = scan(SAMPLES.ignoredLine);
  assert.strictEqual(byId(findings, 'md5').length, 3);
  assert.deepStrictEqual(findings.map((f) => f.line), [0, 1, 2]);
  assertWellFormed(findings, SAMPLES.ignoredLine);
});

test('scan: RSA key sizes are graded by the dynamic matrix', () => {
  const text = 'a RSA-1024 b\nRSA-2048\nRSA-3072\nRSA-4096';
  const findings = scan(text);
  assertWellFormed(findings, text);
  assert.deepStrictEqual(ids(findings), ['rsa_legacy', 'rsa_2048', 'rsa_3072', 'rsa_4096']);
  assert.deepStrictEqual(findings.map((f) => f.severity), ['broken', 'vulnerable', 'deprecated', 'info']);
  assert.deepStrictEqual(findings.map((f) => f.keySize), [1024, 2048, 3072, 4096]);
  const legacy = findings[0];
  assert.strictEqual(legacy.algorithmCategory, 'Asymmetric');
  assert.ok(legacy.remediationHint.length > 0);
});

test('scan: DH key sizes are graded by the dh matrix', () => {
  const text = 'DH-512 DH-768\nDH-1024 DH-1536\nDH-2048\nDH-3072';
  const findings = scan(text);
  assertWellFormed(findings, text);
  assert.deepStrictEqual(ids(findings), ['dh_small', 'dh_small', 'dh_small', 'dh_small', 'dh_2048', 'dh_3072']);
  assert.deepStrictEqual(findings.map((f) => f.severity), ['broken', 'broken', 'broken', 'broken', 'vulnerable', 'deprecated']);
  assert.deepStrictEqual(findings.map((f) => f.keySize), [512, 768, 1024, 1536, 2048, 3072]);
});

test('scan: rsa_legacy regrades from generate_private_key key_size within 220 chars', () => {
  const cases = [
    ['RSA-1024 generate_private_key(public_exponent=65537, key_size=2048)', 'vulnerable', 2048],
    ['RSA-1024 generate_private_key(public_exponent=65537, key_size=4096)', 'deprecated', 4096],
    ['RSA-1024 generate_private_key(public_exponent=65537, key_size=1024)', 'broken', 1024],
    ['RSA-1024 generate_private_key(public_exponent=65537)', 'broken', 1024],
  ];
  for (const [text, sev, ks] of cases) {
    const f = one(scan(text), 'rsa_legacy');
    assert.strictEqual(f.severity, sev, text);
    assert.strictEqual(f.keySize, ks, text);
  }
});

test('scan: findings are sorted broken > vulnerable > deprecated > info', () => {
  const text = 'h = md5(x)\nr = requests.get(u, verify=False)\nk = RSA-3072\nd = SHA-256';
  const findings = scan(text);
  assertWellFormed(findings, text);
  assert.deepStrictEqual(findings.map((f) => f.severity), ['broken', 'vulnerable', 'deprecated', 'info']);
  assert.deepStrictEqual(ids(findings), ['md5', 'cert_verify_disabled', 'rsa_3072', 'sha256']);
});

test('computeFileScore: empty finding list is 100 and clean', () => {
  assert.deepStrictEqual(detector.computeFileScore([]), { score: 100, worst: 'clean' });
});

test('computeFileScore: penalty is severityRank * 10 and worst tracks max severity', () => {
  assert.deepStrictEqual(detector.computeFileScore([{ severity: 'broken' }]), { score: 60, worst: 'broken' });
  assert.deepStrictEqual(detector.computeFileScore([{ severity: 'info' }]), { score: 90, worst: 'info' });
  assert.deepStrictEqual(detector.computeFileScore([{ severity: 'deprecated' }]), { score: 80, worst: 'deprecated' });
  assert.deepStrictEqual(
    detector.computeFileScore([{ severity: 'broken' }, { severity: 'broken' }]),
    { score: 20, worst: 'broken' }
  );
  assert.deepStrictEqual(
    detector.computeFileScore([{ severity: 'info' }, { severity: 'vulnerable' }]),
    { score: 60, worst: 'vulnerable' }
  );
});

test('computeFileScore: clamps at 0 for heavy findings', () => {
  const heavy = Array.from({ length: 4 }, () => ({ severity: 'broken' }));
  assert.deepStrictEqual(detector.computeFileScore(heavy), { score: 0, worst: 'broken' });
});

test('computeFileScore: derived from real sample scans', () => {
  assert.deepStrictEqual(detector.computeFileScore(scan(SAMPLES.pythonVulnerable)), { score: 0, worst: 'broken' });
  assert.deepStrictEqual(detector.computeFileScore(scan(SAMPLES.pythonClean)), { score: 100, worst: 'clean' });
});

test('scan: pythonVulnerable and pythonClean samples', () => {
  const vuln = scan(SAMPLES.pythonVulnerable);
  assertWellFormed(vuln, SAMPLES.pythonVulnerable);
  assert.deepStrictEqual(ids(vuln), ['md5', 'math_random', 'cert_verify_disabled']);
  assert.deepStrictEqual(scan(SAMPLES.pythonClean), []);
});

test('scan: sha256/sha3/blake2 patterns are uppercase-only', () => {
  assert.deepStrictEqual(scan('hashlib.sha256(d)').map((f) => f.algorithmId), []);
  assert.deepStrictEqual(scan('hashlib.sha3_256(d)').map((f) => f.algorithmId), []);
  assert.deepStrictEqual(scan('hashlib.blake2b(d)').map((f) => f.algorithmId), []);
  assert.strictEqual(one(scan('d = SHA-256'), 'sha256').severity, 'info');
  assert.strictEqual(one(scan('hashlib.sha1(d)'), 'sha1').severity, 'broken');
});

test('scan: multi-language vulnerable samples', () => {
  assert.deepStrictEqual(ids(scan(SAMPLES.jsVulnerable, 'javascript')), ['md5', 'math_random']);
  assert.deepStrictEqual(ids(scan(SAMPLES.javaVulnerable, 'java')), ['ecb_mode', 'math_random', 'math_random', 'md5']);
  assert.deepStrictEqual(ids(scan(SAMPLES.goVulnerable, 'go')), ['md5', 'md5']);
  assert.deepStrictEqual(ids(scan(SAMPLES.csharpVulnerable, 'csharp')), ['des', 'math_random']);
  assert.deepStrictEqual(ids(scan(SAMPLES.rustVulnerable, 'rust')), ['md5']);
});

test('scan: content from an activated editor fixture is scanned', () => {
  const { ed } = activateEditor(path.join(TMP, 'editor.py'), SAMPLES.pythonVulnerable, 'python');
  assert.strictEqual(vscode.window.activeTextEditor, ed);
  const text = ed.document.getText();
  const findings = scan(text, 'python');
  assertWellFormed(findings, text);
  assert.deepStrictEqual(ids(findings), ['md5', 'math_random', 'cert_verify_disabled']);
});

const TMP = path.join(__dirname, '.tmp');
const rel = (...parts) => path.join(TMP, ...parts);

test.before(() => {
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(rel('tests'), { recursive: true });
  fs.mkdirSync(rel('fixtures'), { recursive: true });
  fs.mkdirSync(rel('dir.py'), { recursive: true });
  fs.writeFileSync(rel('app.py'), 'import hashlib\nh = hashlib.md5(x)\n');
  fs.writeFileSync(rel('alt.PY'), 'hashlib.md5(y)\n');
  fs.writeFileSync(rel('foo.test.js'), 'const n = Math.random();\n');
  fs.writeFileSync(rel('tests', 'bar.py'), 'x = ssl.CERT_NONE\n');
  fs.writeFileSync(rel('fixtures', 'fix.py'), 'hashlib.md5(a)\n');
  fs.writeFileSync(rel('notes.txt'), 'requests.get(u, verify=False)\n');
  fs.writeFileSync(rel('noext'), 'hashlib.md5(z)\n');
  fs.writeFileSync(rel('big.py'), 'hashlib.md5(big)\n' + 'z'.repeat(2_000_000));
  fs.writeFileSync(rel('poison.py'), 'hashlib.md5(p)\n');
  fs.writeFileSync(rel('broken.py'), 'hashlib.md5(b)\n');
  fs.writeFileSync(rel('vuln.py'), 'x = ssl.CERT_NONE\n');
  fs.writeFileSync(rel('dep.py'), 'k = RSA-3072\n');
  fs.writeFileSync(rel('info.py'), 'd = SHA-256\n');
});

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function useTmpWorkspace() {
  vscode.__state.workspaceFolders.push({ uri: vscode.Uri.file(TMP), name: '.tmp' });
}

function setFiles(...rels) {
  for (const r of rels) vscode.__state.findFilesResult.push(vscode.Uri.file(path.join(TMP, r)));
}

function newScanner() {
  return new WorkspaceScanner(new CryptoDetector(), null);
}

test('scanWorkspace: default run keeps only non-test, supported, small files', async () => {
  useTmpWorkspace();
  setFiles('app.py', 'alt.PY', 'foo.test.js', 'tests/bar.py', 'fixtures/fix.py', 'notes.txt', 'noext', 'big.py');
  const findings = await newScanner().scanWorkspace();
  assert.strictEqual(findings.length, 2, JSON.stringify(findings.map((f) => f.uri)));
  assert.deepStrictEqual(findings.map((f) => f.uri).sort(), [rel('alt.PY'), rel('app.py')].sort());
  for (const f of findings) {
    assert.strictEqual(f.algorithmId, 'md5');
    assert.strictEqual(f.severity, 'broken');
    assert.ok(f.uri.endsWith('.py') || f.uri.endsWith('.PY'));
  }
  assert.strictEqual(vscode.__state.findFilesCalls.length, 1);
  const call = vscode.__state.findFilesCalls[0];
  assert.ok(call.include.includes('py'));
  assert.ok(call.include.includes('ts'));
  assert.ok(call.exclude.includes('node_modules'));
  assert.strictEqual(call.maxResults, 2000);
});

test('scanWorkspace: includeTests=true pulls in test and fixture paths', async () => {
  useTmpWorkspace();
  vscode.__setConfig('ecdat.scan.includeTests', true);
  setFiles('app.py', 'foo.test.js', 'tests/bar.py', 'fixtures/fix.py');
  const findings = await newScanner().scanWorkspace();
  assert.strictEqual(findings.length, 4);
  assert.deepStrictEqual(findings.map((f) => path.basename(f.uri)), ['app.py', 'foo.test.js', 'fix.py', 'bar.py']);
  assert.deepStrictEqual(findings.map((f) => f.severity), ['broken', 'broken', 'broken', 'vulnerable']);
});

test('scanWorkspace: unsupported and extension-less files are skipped before opening', async () => {
  useTmpWorkspace();
  setFiles('notes.txt', 'noext');
  const findings = await newScanner().scanWorkspace();
  assert.deepStrictEqual(findings, []);
  assert.strictEqual(vscode.__state.openTextDocCalls.length, 0);
});

test('scanWorkspace: files over 2,000,000 chars are skipped', async () => {
  useTmpWorkspace();
  setFiles('big.py');
  const findings = await newScanner().scanWorkspace();
  assert.deepStrictEqual(findings, []);
  assert.strictEqual(vscode.__state.openTextDocCalls.length, 1);
});

test('scanWorkspace: documents that throw on read are skipped via catch', async () => {
  useTmpWorkspace();
  const doc = vscode.__openDocument(rel('poison.py'), '', 'python');
  doc.getText = () => { throw new Error('unreadable document'); };
  setFiles('poison.py');
  const findings = await newScanner().scanWorkspace();
  assert.deepStrictEqual(findings, []);
  assert.strictEqual(vscode.__state.openTextDocCalls.length, 1);
});

test('scanWorkspace: directory entries are tolerated without crashing', async () => {
  useTmpWorkspace();
  setFiles('dir.py');
  const findings = await newScanner().scanWorkspace();
  assert.deepStrictEqual(findings, []);
});

test('scanWorkspace: findings are sorted by severity across files', async () => {
  useTmpWorkspace();
  setFiles('info.py', 'dep.py', 'vuln.py', 'broken.py');
  const findings = await newScanner().scanWorkspace();
  assert.deepStrictEqual(findings.map((f) => f.severity), ['broken', 'vulnerable', 'deprecated', 'info']);
  assert.deepStrictEqual(
    findings.map((f) => path.basename(f.uri)),
    ['broken.py', 'vuln.py', 'dep.py', 'info.py']
  );
});

test('scanWorkspace: uppercase .PY extension is processed', async () => {
  useTmpWorkspace();
  setFiles('alt.PY');
  const findings = await newScanner().scanWorkspace();
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].algorithmId, 'md5');
  assert.strictEqual(findings[0].uri, rel('alt.PY'));
});
