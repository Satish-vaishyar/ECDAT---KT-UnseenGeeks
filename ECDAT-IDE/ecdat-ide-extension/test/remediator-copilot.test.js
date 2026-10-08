'use strict';
const { vscode } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { SAMPLES, makeContext, disposeContext, activateEditor } = require('./helpers/fixtures');
const { CryptoDetector } = require('../out/cryptoDetector');
const { CryptoRemediator, registerRemediator } = require('../out/remediator');
const { CopilotPanel, CopilotSidebarProvider, registerCopilot } = require('../out/copilot');

const TMP = path.join(__dirname, '.tmp-rem');
const rel = (...parts) => path.join(TMP, ...parts);
const ARROW = '\u2192';
const DASH = '\u2014';
const detector = new CryptoDetector();
const scan = (text, lang = 'python') => detector.scan(text, lang);
const one = (findings, id) => {
  const f = findings.find((x) => x.algorithmId === id);
  assert.ok(f, `expected a ${id} finding in [${findings.map((x) => x.algorithmId).join(', ')}]`);
  return f;
};

test.before(() => { fs.mkdirSync(TMP, { recursive: true }); });
test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
test.beforeEach(() => {
  vscode.__reset();
  vscode.__state._edits = [];
});

let synCounter = 0;
async function applySynthetic(finding, lang, text = 'AAAA') {
  const fsPath = rel(`syn-${synCounter++}.py`);
  const { doc } = activateEditor(fsPath, text, lang);
  const f = {
    uri: doc.uri.fsPath,
    line: 0, col: 0, length: text.length,
    algorithmId: 'x', message: 'msg', remediationHint: 'hint',
    fileSnippet: text,
    ...finding,
  };
  const editsBefore = vscode.__state._edits.length;
  await new CryptoRemediator().applyFix(f);
  return { doc, f, editsBefore };
}

async function expectFix(finding, lang, expectText, text = 'AAAA') {
  const { doc, f } = await applySynthetic(finding, lang, text);
  assert.strictEqual(doc.getText(), expectText, `fix for ${f.algorithmId} in ${lang}`);
  const msg = vscode.__allMessages().pop();
  assert.match(msg, /QIROVA: \w+ remediated at line \d+\./);
  assert.ok(msg.includes(f.algorithmId.toUpperCase()), msg);
  return { doc, f, msg };
}

async function expectNoFix(finding, lang, text = 'AAAA') {
  const { doc, f, editsBefore } = await applySynthetic(finding, lang, text);
  assert.strictEqual(doc.getText(), text, `expected no edit for ${f.algorithmId} in ${lang}`);
  const msg = vscode.__allMessages().pop();
  assert.match(msg, /No automatic remediation for/);
  assert.ok(msg.includes(f.algorithmId), msg);
  assert.strictEqual(vscode.__state._edits.length, editsBefore);
}

function makeGateway(overrides = {}) {
  return { ping: async () => false, runMonteCarlo: async () => ({ p50: 2038 }), ...overrides };
}

function newPanel(gateway = makeGateway()) {
  const ctx = makeContext();
  const copilot = new CopilotPanel(ctx, gateway, new CryptoDetector(), new CryptoRemediator());
  return { ctx, copilot };
}

async function chat(copilot, text) {
  await copilot.panel.webview.emit({ type: 'chat', text });
  const posted = copilot.panel.webview.posted;
  const last = posted[posted.length - 1];
  assert.strictEqual(last.type, 'response');
  assert.ok(typeof last.response === 'string' && last.response.length > 0);
  return last.response;
}

function makeView() {
  const listeners = [];
  const view = {
    webview: {
      html: '',
      options: {},
      posted: [],
      _listeners: listeners,
      onDidReceiveMessage(cb) {
        listeners.push(cb);
        return new vscode.Disposable(() => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        });
      },
      postMessage(m) { view.webview.posted.push(m); return Promise.resolve(true); },
      asWebviewUri: (u) => u,
    },
    shown: false,
    show() { this.shown = true; },
  };
  return view;
}

const NINE = [
  'import hashlib',
  'a = hashlib.md5(x)',
  'b = hashlib.sha1(x)',
  'c = RC4.new(k)',
  'd = RC2.new(k)',
  'e = md4(y)',
  'f = md2(z)',
  'g = DES.new(k)',
  'h = random.randint(0, 9)',
  'i = requests.get(u, verify=False)',
].join('\n');

const FOURTEEN = [
  'a = hashlib.md5(x)',
  'b = hashlib.sha1(x)',
  'c = RC4.new(k)',
  'd = RC2.new(k)',
  'e = md4(y)',
  'f = md2(z)',
  'g = DES.new(k)',
  'h = random.randint(0, 9)',
  'i = requests.get(u, verify=False)',
  'j = ssl.CERT_NONE',
  'context.check_hostname = False',
  'k1 = secp192r1',
  'k2 = P-224',
  'k3 = x25519',
].join('\n');

const RSA_DOC = [
  'h = hashlib.md5(x)',
  'r = requests.get(u, verify=False)',
  'k = RSA-2048',
].join('\n');

const CA_TEXT = [
  'import hashlib',
  'h = hashlib.md5(data)',
  'r = requests.get(u, verify=False)',
  'n = random.randint(0, 9)',
  'x = 1',
].join('\n');

test('setGateway stores the gateway', () => {
  const rem = new CryptoRemediator();
  const g = { ping: async () => true };
  rem.setGateway(g);
  assert.strictEqual(rem.gateway, g);
});

test('getMigrationSnippet returns the full snippet spec for a known lang/id', () => {
  const rem = new CryptoRemediator();
  const snip = rem.getMigrationSnippet({ algorithmId: 'md5' }, 'python');
  assert.ok(snip);
  assert.strictEqual(snip.algorithm, 'md5');
  assert.strictEqual(snip.language, 'python');
  assert.strictEqual(snip.before, 'hashlib.md5(data)');
  assert.strictEqual(snip.after, 'hashlib.blake2b(data, digest_size=32).hexdigest()');
  assert.strictEqual(snip.importStatement, 'import hashlib');
  assert.ok(snip.description.includes('BLAKE2b'));
});

test('getMigrationSnippet: unknown language and unknown id return null', () => {
  const rem = new CryptoRemediator();
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'md5' }, 'ruby'), null);
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'md5' }, 'plaintext'), null);
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'nope' }, 'python'), null);
});

test('getMigrationSnippet: detector id math_random misses the weak_random map key', () => {
  const rem = new CryptoRemediator();
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'math_random' }, 'python'), null);
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'math_random' }, 'javascript'), null);
  assert.ok(rem.getMigrationSnippet({ algorithmId: 'weak_random' }, 'python'));
  assert.ok(rem.getMigrationSnippet({ algorithmId: 'weak_random' }, 'javascript'));
  assert.ok(rem.getMigrationSnippet({ algorithmId: 'weak_random' }, 'java'));
  assert.ok(rem.getMigrationSnippet({ algorithmId: 'weak_random' }, 'csharp'));
});

test('getMigrationSnippet: per-language keys', () => {
  const rem = new CryptoRemediator();
  const expectKeys = {
    python: ['md5', 'sha1', 'des', 'ecb_mode', 'rsa_2048', 'weak_random', 'cert_verify_disabled'],
    javascript: ['md5', 'sha1', 'rsa_2048', 'weak_random'],
    java: ['des', 'ecb_mode', 'rsa_2048', 'weak_random', 'md5'],
    go: ['md5', 'rsa_2048'],
    csharp: ['des', 'weak_random'],
    rust: ['md5'],
  };
  for (const [lang, ids] of Object.entries(expectKeys)) {
    for (const id of ids) {
      assert.ok(rem.getMigrationSnippet({ algorithmId: id }, lang), `${lang}/${id} should exist`);
    }
  }
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'sha1' }, 'go'), null);
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'des' }, 'javascript'), null);
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'cert_verify_disabled' }, 'java'), null);
  assert.strictEqual(rem.getMigrationSnippet({ algorithmId: 'ecb_mode' }, 'rust'), null);
});

test('applyFix: opens and shows the document when there is no active editor', async () => {
  const fsPath = rel('openme.py');
  const text = 'h = hashlib.md5(x)\n';
  const doc = vscode.__openDocument(fsPath, text, 'python');
  const f = { ...one(scan(text, 'python'), 'md5'), uri: fsPath };
  await new CryptoRemediator().applyFix(f);
  assert.strictEqual(vscode.__state.openTextDocCalls.length, 1);
  assert.strictEqual(vscode.__state.openTextDocCalls[0].fsPath, doc.uri.fsPath);
  assert.strictEqual(vscode.__state.showTextDocCalls.length, 1);
  assert.strictEqual(vscode.__state.showTextDocCalls[0], doc);
  assert.strictEqual(vscode.window.activeTextEditor.document, doc);
  const out = doc.getText();
  assert.ok(!out.includes('hashlib.md5'), out);
  assert.ok(out.includes('hashlib.blake2b(data, digest_size=32).hexdigest()'), out);
  assert.match(vscode.__allMessages().pop(), /QIROVA: MD5 remediated at line 1\./);
});

test('applyFix: opens the finding document when the active editor is a different file', async () => {
  const fsPath = rel('target.py');
  const text = 'h = hashlib.md5(x)\n';
  const target = vscode.__openDocument(fsPath, text, 'python');
  const other = activateEditor(rel('other.py'), 'nothing here\n', 'python');
  const f = { ...one(scan(text, 'python'), 'md5'), uri: fsPath };
  await new CryptoRemediator().applyFix(f);
  assert.strictEqual(vscode.__state.showTextDocCalls.length, 1);
  assert.strictEqual(vscode.__state.showTextDocCalls[0], target);
  const out = target.getText();
  assert.ok(!out.includes('md5'), out);
  assert.ok(out.includes('hashlib.blake2b(data, digest_size=32).hexdigest()'), out);
  assert.strictEqual(other.doc.getText(), 'nothing here\n');
  assert.match(vscode.__allMessages().pop(), /QIROVA: MD5 remediated at line 1\./);
});

test('applyFix: matching active editor applies the edit and reports it', async () => {
  const text = 'h = hashlib.md5(data)';
  const { doc } = activateEditor(rel('match.py'), text, 'python');
  const f = { ...one(scan(text, 'python'), 'md5'), uri: doc.uri.fsPath };
  await new CryptoRemediator().applyFix(f);
  assert.strictEqual(vscode.__state.showTextDocCalls.length, 0);
  assert.strictEqual(vscode.__state._edits.length, 1);
  assert.strictEqual(vscode.__state._edits[0].ops.length, 1);
  const out = doc.getText();
  assert.ok(!out.includes('md5'), out);
  assert.ok(out.includes('hashlib.blake2b(data, digest_size=32).hexdigest()'), out);
  const msg = vscode.__allMessages().pop();
  assert.match(msg, /QIROVA: \w+ remediated at line \d+\./);
  assert.ok(msg.startsWith('QIROVA: MD5 remediated at line 1.'), msg);
});

test('applyFix: no computable fix reports No automatic remediation and edits nothing', async () => {
  const text = 'k = RSA-4096';
  const { doc } = activateEditor(rel('nofix.py'), text, 'python');
  const f = { ...one(scan(text, 'python'), 'rsa_4096'), uri: doc.uri.fsPath };
  await new CryptoRemediator().applyFix(f);
  assert.strictEqual(doc.getText(), text);
  assert.strictEqual(vscode.__state._edits.length, 0);
  const msg = vscode.__allMessages().pop();
  assert.match(msg, /No automatic remediation for/);
  assert.ok(msg.includes('rsa_4096'), msg);
  assert.ok(msg.includes(f.remediationHint), msg);
});

test('computeFix: cert_verify_disabled picks the replacement from the file snippet', async () => {
  await expectFix(
    { algorithmId: 'cert_verify_disabled', fileSnippet: 'ctx = ssl.CERT_NONE' },
    'python', 'CERT_REQUIRED'
  );
  await expectFix(
    { algorithmId: 'cert_verify_disabled', fileSnippet: 'context.check_hostname = False' },
    'python', 'check_hostname=True'
  );
  await expectFix(
    { algorithmId: 'cert_verify_disabled', fileSnippet: 'r = requests.get(u, verify=False)' },
    'python', 'verify=True'
  );
});

test('computeFix: MIGRATION_SNIPPETS replacement is the first line of snippet.after', async () => {
  await expectFix({ algorithmId: 'md5' }, 'python', 'hashlib.blake2b(data, digest_size=32).hexdigest()');
  await expectFix({ algorithmId: 'sha1' }, 'python', 'hashlib.sha256(data)');
  await expectFix({ algorithmId: 'des' }, 'python', 'AES.new(key, AES.MODE_GCM)');
  await expectFix({ algorithmId: 'ecb_mode' }, 'python', 'AES.MODE_GCM');
  await expectFix({ algorithmId: 'rsa_2048' }, 'python', '# PQC: Use ML-KEM-768 (Kyber) for key exchange');
  await expectFix({ algorithmId: 'md5' }, 'javascript', 'crypto.createHash("blake2b512")');
  await expectFix({ algorithmId: 'weak_random' }, 'javascript', 'crypto.randomBytes(32).toString("hex")');
  await expectFix({ algorithmId: 'des' }, 'java', 'Cipher.getInstance("AES/GCM/NoPadding")');
  await expectFix({ algorithmId: 'md5' }, 'go', 'crypto/blake2b');
  await expectFix({ algorithmId: 'des' }, 'csharp', 'Aes.Create()');
  await expectFix({ algorithmId: 'md5' }, 'rust', 'blake3::hash');
});

test('computeFix: fallbacks when the language has no snippet', async () => {
  await expectFix({ algorithmId: 'md5' }, 'ruby', 'blake2b');
  await expectFix({ algorithmId: 'sha1' }, 'ruby', 'sha256');
  await expectFix({ algorithmId: 'rc4' }, 'ruby', 'chacha20');
  await expectFix({ algorithmId: 'des' }, 'ruby', 'AES-256');
  await expectFix({ algorithmId: '3des' }, 'ruby', 'AES-256');
  await expectFix({ algorithmId: 'md4' }, 'ruby', 'blake2b');
  await expectFix({ algorithmId: 'md2' }, 'ruby', 'blake2b');
  await expectFix({ algorithmId: 'rc2' }, 'ruby', 'AES-256');
  await expectFix({ algorithmId: 'blowfish_small' }, 'ruby', 'AES-256');
});

test('computeFix: math_random resolves per language', async () => {
  await expectFix({ algorithmId: 'math_random' }, 'python', 'secrets.token_bytes');
  await expectFix({ algorithmId: 'math_random' }, 'javascript', 'crypto.randomBytes');
  await expectFix({ algorithmId: 'math_random' }, 'typescript', 'crypto.randomBytes');
  await expectFix({ algorithmId: 'math_random' }, 'java', 'SecureRandom');
  await expectFix({ algorithmId: 'math_random' }, 'go', 'rand.Read');
  await expectFix({ algorithmId: 'math_random' }, 'csharp', 'RandomNumberGenerator.GetBytes');
  await expectNoFix({ algorithmId: 'math_random' }, 'rust');
});

test('computeFix: ecb_mode rewrites ECB to GCM inside the file snippet', async () => {
  await expectFix(
    { algorithmId: 'ecb_mode', fileSnippet: 'opts.mode = "DES/ECB/PKCS5Padding"' },
    'javascript', 'opts.mode = "DES/GCM/PKCS5Padding"'
  );
  await expectFix(
    { algorithmId: 'ecb_mode', fileSnippet: 'c = "AES/ECB/PKCS5Padding"' },
    'ruby', 'c = "AES/GCM/PKCS5Padding"'
  );
});

test('computeFix: curve and key-exchange migrations', async () => {
  await expectFix({ algorithmId: 'ecdsa_p256' }, 'python', 'Ed448');
  await expectFix({ algorithmId: 'ecdsa_p224' }, 'python', 'Ed448');
  await expectFix({ algorithmId: 'ecdsa_p192' }, 'python', 'Ed448');
  await expectFix({ algorithmId: 'ed25519' }, 'python', 'ml_dsa65');
  await expectFix({ algorithmId: 'ecdsa_p384' }, 'python', 'ml_dsa65');
  await expectFix({ algorithmId: 'x25519' }, 'python', 'ml_kem768+x25519');
});

test('computeFix: RSA fallbacks use ml_kem768+x25519 when no snippet exists', async () => {
  await expectFix({ algorithmId: 'rsa_legacy' }, 'csharp', 'ml_kem768+x25519');
  await expectFix({ algorithmId: 'rsa_2048' }, 'csharp', 'ml_kem768+x25519');
  await expectFix({ algorithmId: 'rsa_3072' }, 'csharp', 'ml_kem768+x25519');
});

test('computeFix: DH fallbacks use ml_kem768+x25519', async () => {
  await expectFix({ algorithmId: 'dh_small' }, 'python', 'ml_kem768+x25519');
  await expectFix({ algorithmId: 'dh_2048' }, 'python', 'ml_kem768+x25519');
  await expectFix({ algorithmId: 'dh_3072' }, 'python', 'ml_kem768+x25519');
});

test('computeFix: unknown algorithms have no fix', async () => {
  await expectNoFix({ algorithmId: 'rsa_4096' }, 'python');
  await expectNoFix({ algorithmId: 'sha256' }, 'python');
  await expectNoFix({ algorithmId: 'aes_gcm' }, 'python');
  await expectNoFix({ algorithmId: 'ml_kem_768' }, 'python');
});

test('remediateActiveFile: no active editor warns', async () => {
  await new CryptoRemediator().remediateActiveFile();
  assert.deepStrictEqual(vscode.__state.messages.map((m) => [m.level, m.message]), [
    ['warn', 'QIROVA: No active editor.'],
  ]);
});

test('remediateActiveFile: clean document reports no findings', async () => {
  activateEditor(rel('clean.py'), SAMPLES.pythonClean, 'python');
  await new CryptoRemediator().remediateActiveFile();
  assert.deepStrictEqual(vscode.__state.messages.map((m) => [m.level, m.message]), [
    ['info', 'QIROVA: No findings to remediate.'],
  ]);
  assert.strictEqual(vscode.__state._edits.length, 0);
});

test('remediateActiveFile: pythonVulnerable fixes everything in one edit call', async () => {
  const { doc } = activateEditor(rel('vuln.py'), SAMPLES.pythonVulnerable, 'python');
  const score = detector.computeFileScore(scan(doc.getText(), 'python'));
  assert.strictEqual(score.score, 0);
  await new CryptoRemediator().remediateActiveFile();
  assert.strictEqual(vscode.__state._edits.length, 1, 'all fixes must be in a single edit() call');
  assert.strictEqual(vscode.__state._edits[0].ops.length, 3);
  const out = doc.getText();
  assert.ok(!out.includes('hashlib.md5'), out);
  assert.ok(out.includes('hashlib.blake2b(data, digest_size=32).hexdigest()'), out);
  assert.ok(!out.includes('verify=False'), out);
  assert.ok(out.includes('verify=True'), out);
  const msg = vscode.__allMessages().pop();
  assert.match(msg, /QIROVA: \d+ fix(?:es)? applied/);
  assert.ok(msg.startsWith('QIROVA: 3 fixes applied'), msg);
});

test('remediateActiveFile: unfixable findings are reported as Manual', async () => {
  const text = 'h = hashlib.md5(x)\nd = SHA-256';
  const { doc } = activateEditor(rel('mixed.py'), text, 'python');
  assert.deepStrictEqual(scan(text, 'python').map((f) => f.algorithmId), ['md5', 'sha256']);
  await new CryptoRemediator().remediateActiveFile();
  assert.strictEqual(vscode.__state._edits.length, 1);
  const out = doc.getText();
  assert.ok(!out.includes('md5'), out);
  assert.ok(out.includes('SHA-256'), out);
  const msg = vscode.__allMessages().pop();
  assert.match(msg, /QIROVA: \d+ fix(?:es)? applied/);
  assert.ok(msg.includes('QIROVA: 1 fix applied'), msg);
  assert.ok(msg.includes('Manual: 1'), msg);
});

test('suppressFinding: appends a qirova-ignore-line comment on the finding line', async () => {
  const text = 'h = hashlib.md5(data)';
  const { doc } = activateEditor(rel('sup.py'), text, 'python');
  const f = one(scan(text, 'python'), 'md5');
  await new CryptoRemediator().suppressFinding(f);
  assert.strictEqual(
    doc.getText(),
    `${text}  // qirova-ignore-line: ${f.algorithmId} - ${f.message}`
  );
  assert.strictEqual(vscode.__state._edits.length, 1);
  assert.strictEqual(vscode.__state._edits[0].ops[0].range.start.line, f.line);
});

test('suppressFinding: no active editor does not throw', async () => {
  await new CryptoRemediator().suppressFinding({ algorithmId: 'md5', message: 'boom', line: 0 });
  assert.strictEqual(vscode.__state._edits.length, 0);
  assert.strictEqual(vscode.__state.messages.length, 0);
});

test('registerRemediator: pushes eight disposables and registers all providers', () => {
  const ctx = makeContext();
  try {
    registerRemediator(ctx, new CryptoRemediator(), detector);
    assert.strictEqual(ctx.subscriptions.length, 8);
    for (const d of ctx.subscriptions) assert.strictEqual(typeof d.dispose, 'function');
    assert.strictEqual(vscode.__state.codeActionProviders.length, 1);
    assert.strictEqual(vscode.__state.completionProviders.length, 1);
    assert.strictEqual(vscode.__state.inlineProviders.length, 1);
    const ca = vscode.__state.codeActionProviders[0];
    assert.strictEqual(typeof ca.provider.provideCodeActions, 'function');
    assert.ok(ca.metadata.providedCodeActionKinds.includes(vscode.CodeActionKind.QuickFix));
    assert.ok(ca.metadata.providedCodeActionKinds.includes(vscode.CodeActionKind.Refactor));
    const cp = vscode.__state.completionProviders[0];
    assert.strictEqual(typeof cp.provider.provideCompletionItems, 'function');
    assert.deepStrictEqual(cp.trigger, ['.']);
    const ip = vscode.__state.inlineProviders[0];
    assert.strictEqual(typeof ip.provider.provideInlineCompletionItems, 'function');
    assert.strictEqual(vscode.__state.codeLensProviders.length, 1);
    const lp = vscode.__state.codeLensProviders[0];
    assert.strictEqual(typeof lp.provider.provideCodeLenses, 'function');
  } finally {
    disposeContext(ctx);
  }
  assert.strictEqual(vscode.__state.codeActionProviders.length, 0);
  assert.strictEqual(vscode.__state.completionProviders.length, 0);
  assert.strictEqual(vscode.__state.inlineProviders.length, 0);
  assert.strictEqual(vscode.__state.codeLensProviders.length, 0);
});

function caSetup() {
  const ctx = makeContext();
  registerRemediator(ctx, new CryptoRemediator(), detector);
  const ca = vscode.__state.codeActionProviders[0].provider;
  const cp = vscode.__state.completionProviders[0].provider;
  const { doc } = activateEditor(rel('ca.py'), CA_TEXT, 'python');
  return { ctx, ca, cp, doc };
}

test('provideCodeActions: QuickFix and Refactor actions on a finding line', () => {
  const { ctx, ca, doc } = caSetup();
  try {
    const findings = scan(CA_TEXT, 'python');
    const md5 = one(findings, 'md5');
    const actions = ca.provideCodeActions(doc, doc.lineAt(md5.line).range, { diagnostics: [] }, {});
    assert.strictEqual(actions.length, 2);

    const qf = actions.find((a) => a.kind === vscode.CodeActionKind.QuickFix);
    assert.ok(qf, 'expected a QuickFix action');
    assert.strictEqual(qf.title, `QIROVA: Migrate MD5 ${ARROW} ${md5.remediationHint}`);
    assert.strictEqual(qf.isPreferred, true);
    assert.deepStrictEqual(qf.diagnostics, []);
    assert.ok(qf.edit instanceof vscode.WorkspaceEdit);
    assert.strictEqual(qf.edit.entries().length, 1);
    assert.strictEqual(qf.edit.entries()[0].uri, doc.uri);
    const edits = qf.edit.get(doc.uri);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].range.start.line, md5.line);
    assert.strictEqual(edits[0].range.start.character, md5.col);
    assert.strictEqual(edits[0].range.end.character, md5.col + md5.length);
    assert.strictEqual(edits[0].newText, 'hashlib.blake2b(data, digest_size=32).hexdigest()');

    const rf = actions.find((a) => a.kind === vscode.CodeActionKind.Refactor);
    assert.ok(rf, 'expected a Refactor action');
    assert.strictEqual(rf.title, 'QIROVA: Insert full MD5 migration snippet');
    assert.strictEqual(rf.edit, undefined);
    assert.strictEqual(rf.command.command, 'qirova.insertMigrationSnippet');
    assert.strictEqual(rf.command.title, 'Insert Migration Snippet');
    assert.deepStrictEqual(rf.command.arguments[0], md5);
    assert.deepStrictEqual(rf.command.arguments[1], doc.uri);

    const cert = one(findings, 'cert_verify_disabled');
    const certActions = ca.provideCodeActions(doc, doc.lineAt(cert.line).range, { diagnostics: [] }, {});
    assert.strictEqual(certActions.length, 2);
    assert.ok(certActions.some((a) =>
      a.title === `QIROVA: Migrate CERT_VERIFY_DISABLED ${ARROW} ${cert.remediationHint}`));
  } finally {
    disposeContext(ctx);
  }
});

test('provideCodeActions: a line with no findings returns an empty array', () => {
  const { ctx, ca, doc } = caSetup();
  try {
    assert.deepStrictEqual(ca.provideCodeActions(doc, doc.lineAt(4).range, { diagnostics: [] }, {}), []);
    assert.deepStrictEqual(ca.provideCodeActions(doc, doc.lineAt(0).range, { diagnostics: [] }, {}), []);
  } finally {
    disposeContext(ctx);
  }
});

test('provideCodeActions: only QuickFix filters out Refactor actions', () => {
  const { ctx, ca, doc } = caSetup();
  try {
    const md5 = one(scan(CA_TEXT, 'python'), 'md5');
    const actions = ca.provideCodeActions(doc, doc.lineAt(md5.line).range, {
      diagnostics: [], only: vscode.CodeActionKind.QuickFix,
    }, {});
    assert.strictEqual(actions.length, 1);
    for (const a of actions) assert.strictEqual(a.kind, vscode.CodeActionKind.QuickFix);
    assert.strictEqual(actions[0].title, `QIROVA: Migrate MD5 ${ARROW} ${md5.remediationHint}`);

    const rnd = one(scan(CA_TEXT, 'python'), 'math_random');
    const rndActions = ca.provideCodeActions(doc, doc.lineAt(rnd.line).range, {
      diagnostics: [], only: vscode.CodeActionKind.QuickFix,
    }, {});
    assert.strictEqual(rndActions.length, 1);
    assert.strictEqual(rndActions[0].kind, vscode.CodeActionKind.QuickFix);
  } finally {
    disposeContext(ctx);
  }
});

test('provideCodeActions: only Refactor filters out QuickFix actions', () => {
  const { ctx, ca, doc } = caSetup();
  try {
    const md5 = one(scan(CA_TEXT, 'python'), 'md5');
    const actions = ca.provideCodeActions(doc, doc.lineAt(md5.line).range, {
      diagnostics: [], only: vscode.CodeActionKind.Refactor,
    }, {});
    assert.strictEqual(actions.length, 1);
    for (const a of actions) assert.strictEqual(a.kind, vscode.CodeActionKind.Refactor);
    assert.strictEqual(actions[0].title, 'QIROVA: Insert full MD5 migration snippet');

    const rnd = one(scan(CA_TEXT, 'python'), 'math_random');
    const rndActions = ca.provideCodeActions(doc, doc.lineAt(rnd.line).range, {
      diagnostics: [], only: vscode.CodeActionKind.Refactor,
    }, {});
    assert.deepStrictEqual(rndActions, [], 'math_random has a fix but no snippet in python');
  } finally {
    disposeContext(ctx);
  }
});

test('provideCompletionItems: md5 line yields a snippet completion', () => {
  const { ctx, cp, doc } = caSetup();
  try {
    const items = cp.provideCompletionItems(doc, new vscode.Position(1, 0));
    const item = items.find((i) => i.label === 'qirova:md5');
    assert.ok(item, `labels were ${items.map((i) => i.label).join(', ')}`);
    const snip = new CryptoRemediator().getMigrationSnippet({ algorithmId: 'md5' }, 'python');
    assert.ok(item.insertText instanceof vscode.SnippetString);
    assert.strictEqual(item.insertText.value, snip.after);
    assert.ok(item.detail.startsWith('QIROVA Migration:'), item.detail);
    assert.ok(item.documentation.value.includes(snip.description));
    assert.ok(item.documentation.value.includes('```python'));
  } finally {
    disposeContext(ctx);
  }
});

test('provideCompletionItems: keyword line maps only ids with python snippets', () => {
  const { ctx, cp } = caSetup();
  try {
    const { doc } = activateEditor(rel('kw.py'), '# md5 sha1 des ecb rsa random x25519', 'python');
    const items = cp.provideCompletionItems(doc, new vscode.Position(0, 0));
    assert.deepStrictEqual(items.map((i) => i.label), [
      'qirova:md5', 'qirova:sha1', 'qirova:des', 'qirova:ecb',
    ]);
    for (const absent of ['qirova:rsa', 'qirova:random', 'qirova:x25519']) {
      assert.ok(!items.some((i) => i.label === absent), `${absent} should be absent`);
    }
    const ecb = items.find((i) => i.label === 'qirova:ecb');
    assert.strictEqual(ecb.detail, `QIROVA Migration: ecb ${ARROW} ecb_mode`);
    assert.ok(ecb.insertText instanceof vscode.SnippetString);
  } finally {
    disposeContext(ctx);
  }
});

test('provideCompletionItems: line without keywords returns an empty array', () => {
  const { ctx, cp } = caSetup();
  try {
    const { doc } = activateEditor(rel('nokey.py'), 'x = 1', 'python');
    assert.deepStrictEqual(cp.provideCompletionItems(doc, new vscode.Position(0, 0)), []);
  } finally {
    disposeContext(ctx);
  }
});

test('provideCompletionItems: a language without snippets yields nothing', () => {
  const { ctx, cp } = caSetup();
  try {
    const { doc } = activateEditor(rel('nokey.rb'), 'md5(x) sha1(y)', 'ruby');
    assert.deepStrictEqual(cp.provideCompletionItems(doc, new vscode.Position(0, 0)), []);
    const js = activateEditor(rel('js.js'), 'crypto.createHash("md5")', 'javascript').doc;
    const items = cp.provideCompletionItems(js, new vscode.Position(0, 0));
    assert.deepStrictEqual(items.map((i) => i.label), ['qirova:md5']);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel.show: creates the panel once with html and icon', () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    assert.strictEqual(vscode.__state.webviewPanels.length, 1);
    const p = vscode.__state.webviewPanels[0];
    assert.strictEqual(p.viewType, 'qirova.copilot');
    assert.strictEqual(p.title, 'QIROVA Copilot');
    assert.ok(p.webview.html.length > 0);
    assert.ok(p.webview.html.includes('acquireVsCodeApi'));
    assert.ok(p.webview.html.includes('renderMd'));
    assert.ok(p.webview.html.includes('quick-btn'));
    assert.strictEqual(p.webview.options.enableScripts, true);
    assert.ok(p.iconPath instanceof vscode.Uri);
    assert.ok(p.iconPath.path.endsWith('ecdat-icon.svg'), p.iconPath.path);

    copilot.show();
    assert.strictEqual(vscode.__state.webviewPanels.length, 1);
    assert.strictEqual(p._revealed, 1);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel.show: disposing the panel lets show() create a fresh one', () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const first = copilot.panel;
    first.dispose();
    assert.strictEqual(copilot.panel, undefined);
    assert.strictEqual(vscode.__state.webviewPanels.length, 0);
    copilot.show();
    assert.strictEqual(vscode.__state.webviewPanels.length, 1);
    assert.notStrictEqual(copilot.panel, first);
    assert.strictEqual(copilot.panel._revealed, 0);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: unknown prompt gets the welcome message', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const r = await chat(copilot, 'hello world');
    assert.ok(r.startsWith('### QIROVA Copilot'), r);
    for (const bullet of ['migrate', 'score', 'red-team', 'q-day', 'cbom', 'scan']) {
      assert.ok(r.includes(`- **${bullet}**`), `missing bullet ${bullet}`);
    }
    const r2 = await chat(copilot, 'what is 2+2');
    assert.ok(r2.startsWith('### QIROVA Copilot'), r2);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: live AI answers free text when gateway supports chat', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    chat: async () => ({ metadata: { text: 'use ML-KEM', backend: 'simulation_fallback' } })
  });
  try {
    copilot.show();
    const r = await chat(copilot, 'is DES ok?');
    assert.ok(r.startsWith('### QIROVA AI (`deepseek_coder`)'), r);
    assert.ok(r.includes('use ML-KEM'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: AI failure degrades to welcome', async () => {
  const { ctx, copilot } = newPanel({ ping: async () => true, chat: async () => null });
  try {
    copilot.show();
    const r = await chat(copilot, 'explain diffie hellman');
    assert.ok(r.startsWith('### QIROVA Copilot'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: no active editor responses', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    assert.ok((await chat(copilot, 'migrate')).includes('### No file open'));
    assert.strictEqual(await chat(copilot, 'score'), 'Open a file first.');
    assert.strictEqual(await chat(copilot, 'scan'), 'Open a file first.');
    assert.strictEqual(await chat(copilot, 'cbom'), 'No crypto findings to export.');
    assert.strictEqual(await chat(copilot, 'red-team'), 'No crypto weaknesses detected.');
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: active clean javascript document', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const { doc } = activateEditor(rel('clean.js'), 'let x = 1;', 'javascript');
    assert.deepStrictEqual(scan(doc.getText(), 'javascript'), []);

    const mig = await chat(copilot, 'migrate');
    assert.ok(mig.includes('### No crypto usage detected'), mig);
    assert.ok(mig.includes('no cryptographic patterns'), mig);

    assert.strictEqual(await chat(copilot, 'red-team'), 'No crypto weaknesses detected.');
    assert.strictEqual(await chat(copilot, 'cbom'), 'No crypto findings to export.');

    const scanResp = await chat(copilot, 'scan');
    assert.ok(scanResp.includes(`### Scan Complete ${DASH} Score: 100/100`), scanResp);
    assert.ok(scanResp.includes('No crypto issues found.'), scanResp);

    const scoreResp = await chat(copilot, 'score');
    assert.ok(scoreResp.includes('### PQC Readiness'), scoreResp);
    assert.ok(scoreResp.includes('**100/100**'), scoreResp);
    assert.ok(scoreResp.includes('| Findings | 0 |'), scoreResp);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: migrate on pythonVulnerable renders snippets', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const { doc } = activateEditor(rel('pv.py'), SAMPLES.pythonVulnerable, 'python');
    const findings = scan(doc.getText(), 'python');
    assert.deepStrictEqual(findings.map((f) => f.algorithmId),
      ['md5', 'math_random', 'cert_verify_disabled']);

    const r = await chat(copilot, 'migrate');
    assert.ok(r.includes('### PQC Migration Snippets'), r);
    assert.ok(r.includes(`**MD5** ${ARROW} `), r);
    assert.ok(r.includes(`**CERT_VERIFY_DISABLED** ${ARROW} `), r);
    assert.ok(r.includes('Import:'), r);
    assert.ok(r.includes('Migration code:'), r);
    assert.ok(r.includes('```'), r);
    assert.ok(r.includes('hashlib.blake2b(data, digest_size=32).hexdigest()'), r);
    assert.ok(r.includes('Replace with: **'), r);
    assert.ok(!r.includes('more findings.'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: migrate appends AI migration from coding model when live', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    chat: async () => ({ metadata: { text: '```diff\n- md5\n+ sha256\n```\n- [x] one\n- [x] two\n- [x] three', backend: 'nvidia' } }),
  });
  try {
    copilot.show();
    activateEditor(rel('mig.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'migrate');
    assert.ok(r.includes('### PQC Migration Snippets'), r);
    assert.ok(r.includes('### AI migration (LIVE)'), r);
    assert.ok(!r.includes('deepseek_coder'), 'no model name in header');
    assert.ok(r.includes('- md5'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: migrate includes the python RSA-2048 PQC snippet', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const { doc } = activateEditor(rel('rsa.py'), RSA_DOC, 'python');
    const findings = scan(doc.getText(), 'python');
    assert.deepStrictEqual(findings.map((f) => f.algorithmId),
      ['md5', 'cert_verify_disabled', 'rsa_2048']);

    const r = await chat(copilot, 'migrate');
    assert.ok(r.includes('### PQC Migration Snippets'), r);
    assert.ok(r.includes(`**RSA_2048** ${ARROW} `), r);
    assert.ok(r.includes('from oqs import KeyEncapsulation'), r);
    assert.ok(r.includes('Import:'), r);
    assert.ok(r.includes('Migration code:'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: migrate truncates past 8 findings', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    activateEditor(rel('nine.py'), NINE, 'python');
    const findings = scan(NINE, 'python');
    assert.strictEqual(findings.length, 9);

    const r = await chat(copilot, 'migrate');
    assert.ok(r.includes('### PQC Migration Snippets'), r);
    assert.ok(r.includes(`> ${findings.length - 8} more findings.`), r);
    assert.strictEqual(r.split('---\n\n').length - 1, 8);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: score matches the detector score', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const { doc } = activateEditor(rel('score.py'), SAMPLES.pythonVulnerable, 'python');
    const { score, worst } = detector.computeFileScore(scan(doc.getText(), 'python'));
    const r = await chat(copilot, 'score');
    assert.ok(r.includes('### PQC Readiness'), r);
    assert.ok(r.includes(`**${score}/100**`), r);
    assert.ok(r.includes(`| Worst | ${worst} |`), r);
    assert.ok(r.includes('| Findings | 3 |'), r);
    assert.ok(r.includes('| Metric | Value |'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: score appends live model scoring when gateway serves it', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    scanSource: async () => ({ metadata: { model01_probability: 0.78, model01_label: 'HIGH' } }),
    getRiskScore: async () => ({ metadata: { qars_score: 92, tier: 'CRITICAL' } }),
  });
  try {
    copilot.show();
    activateEditor(rel('score2.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'score');
    assert.ok(r.includes('### PQC Readiness'), r);
    assert.ok(r.includes('### Model scoring (LIVE)'), r);
    assert.ok(r.includes('Model 01 AST-CryptoNet'), r);
    assert.ok(r.includes('0.78'), r);
    assert.ok(r.includes('Model 25 QARS'), r);
    assert.ok(r.includes('92'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: red-team table renders and caps at 12 rows', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    activateEditor(rel('pv2.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'red-team');
    assert.ok(r.includes('### Red-Team Review'), r);
    assert.ok(r.includes('| Algorithm | Vulnerability | Fix | Line |'), r);
    assert.ok(r.includes('| MD5 | '), r);

    activateEditor(rel('fourteen.py'), FOURTEEN, 'python');
    const findings = scan(FOURTEEN, 'python');
    assert.strictEqual(findings.length, 14);
    const r2 = await chat(copilot, 'red-team');
    assert.ok(r2.includes('### Red-Team Review'), r2);
    const rows = r2.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Algorithm'));
    assert.strictEqual(rows.length, 12, r2);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: red-team prepends live model verdicts when gateway serves them', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    getMisuse: async () => ({ findings: [{ algorithm: 'BROKEN_ALGORITHM', status: 'INSECURE', confidence: 0.91, recommendation: 'Review and replace.' }] }),
    getTrapdoor: async () => ({ findings: [] }),
  });
  try {
    copilot.show();
    activateEditor(rel('pv3.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'red-team');
    assert.ok(r.includes('### Model verdicts (LIVE)'), r);
    assert.ok(r.includes('Model 06 MisuseDetector'), r);
    assert.ok(r.includes('Model 23 Trapdoor'), r);
    assert.ok(r.includes('### Red-Team Review'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: cbom lists findings with the active filename', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    activateEditor(rel('cbom_sample.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'cbom');
    assert.ok(r.includes('### CycloneDX CBOM'), r);
    assert.ok(r.includes('| Algorithm | File | Line | Risk |'), r);
    assert.ok(r.includes('cbom_sample.py'), r);
    assert.ok(r.includes('| MD5 | cbom_sample.py | 5 | broken |'), r);
    assert.ok(r.includes('QIROVA: Export CBOM (CycloneDX)'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: scan renders one row per finding', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    activateEditor(rel('scanme.py'), FOURTEEN, 'python');
    const findings = scan(FOURTEEN, 'python');
    const { score } = detector.computeFileScore(findings);
    const r = await chat(copilot, 'scan');
    assert.ok(r.includes(`### Scan Complete ${DASH} Score: ${score}/100`), r);
    const rows = r.split('\n').filter((l) => /^\| \d+ \| /.test(l));
    assert.strictEqual(rows.length, findings.length, r);
    assert.ok(r.includes('| 1 | MD5 | 1 | broken |'), r);
    assert.ok(r.includes(`| ${findings.length} | X25519 | 14 | deprecated |`), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: scan covers the whole workspace top to bottom', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const f1 = rel('ws1.py');
    const f2 = rel('ws2.py');
    fs.writeFileSync(f1, 'import hashlib\nh = hashlib.md5(x)\n');
    fs.writeFileSync(f2, 'x = 1\n');
    vscode.__state.workspaceFolders.push({ uri: vscode.Uri.file(TMP), name: 'ws' });
    vscode.__state.findFilesResult.push(vscode.Uri.file(f1), vscode.Uri.file(f2));
    const r = await chat(copilot, 'scan');
    assert.ok(r.includes('### Workspace scan'), r);
    assert.ok(r.includes('| File | Findings | Score | Worst |'), r);
    assert.ok(r.includes('ws1.py'), r);
    assert.ok(r.includes('ws2.py'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: scan appends live pipeline section when gateway serves it', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    runPipeline: async () => ({ scan_id: 's1', total_findings: 2, quantum_risk: 'HIGH' }),
  });
  try {
    copilot.show();
    activateEditor(rel('pv4.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'scan');
    assert.ok(r.includes('### Deep scan (29 models, LIVE)'), r);
    assert.ok(r.includes('s1'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: greetings get an identity answer, not model JSON', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    for (const g of ['hi', 'who are you', 'thanks']) {
      const r = await chat(copilot, g);
      assert.ok(!r.includes('level_1_family'), `no taxonomy dump for ${g}: ${r.slice(0, 120)}`);
    }
    const r = await chat(copilot, 'hi');
    assert.ok(r.includes('QIROVA Copilot'), r);
    const r2 = await chat(copilot, 'hello world');
    assert.ok(r2.startsWith('### QIROVA Copilot'), 'hello world still shows welcome');
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: greetings bypass live streaming AI (regression)', async () => {
  // Live path: gateway WITH chatStream must still answer greetings locally,
  // never stream model output for them.
  const seen = [];
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    chat: async () => { throw new Error('must not be called for greetings'); },
    chatStream: async (model, messages, onDelta) => {
      seen.push('stream-called');
      onDelta('STREAMED-AI');
      return 'STREAMED-AI';
    },
  });
  try {
    copilot.show();
    const r = await chat(copilot, 'hi');
    assert.deepStrictEqual(seen, [], 'streaming must not fire for greetings');
    assert.ok(r.includes("Hi! I'm QIROVA Copilot"), r);
    assert.ok(!r.includes('STREAMED-AI'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: deep scan renders website-like metrics and model evidence', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    runPipeline: async () => ({
      scan_id: 's9', total_findings: 1, quantum_risk: 'HIGH',
      severity_counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
      model_evidence_count: 3, duration_ms: 12000,
      model_intelligence: {
        robustness: { probabilities: [0.11], labels: [0] },
        model_08: { level_2_algorithm: 'SHA1_MD5', confidence: 0.99 },
      },
      migration_cost: { person_months: { expected_p50: 4.5 }, recommended_replacement: 'ML-KEM-768' },
    }),
  });
  try {
    copilot.show();
    activateEditor(rel('pv5.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'scan');
    assert.ok(r.includes('| Metric | Value |'), r);
    assert.ok(r.includes('### Model evidence'), r);
    assert.ok(r.includes('robustness'), r);
    assert.ok(r.includes('SHA1_MD5'), r);
    assert.ok(r.includes('4.5 person-months'), r);
    assert.ok(r.includes('### Models in progress'), r);
    assert.ok(r.includes('Stage 1'), r);
    assert.ok(r.includes('Stage 5'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: migrate embeds review hunks with old/new lines', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    activateEditor(rel('mig1.py'), 'import hashlib\nh = hashlib.md5(x)\n', 'python');
    const r = await chat(copilot, 'migrate');
    assert.ok(r.includes('### PQC Migration Snippets'), r.slice(0, 120));
    const m = r.match(/<script type="application\/json" class="qirova-hunks">(.+?)<\/script>/);
    assert.ok(m, 'hunks payload embedded');
    const data = JSON.parse(m[1]);
    assert.ok(Array.isArray(data.hunks) && data.hunks.length >= 1, 'at least one hunk');
    const fix = data.hunks.find((h) => h.kind === 'fix' && h.algorithmId === 'md5');
    assert.ok(fix, JSON.stringify(data.hunks.map((h) => h.algorithmId)));
    assert.ok(fix.oldLine.includes('md5'), fix.oldLine);
    assert.ok(fix.newLine.includes('blake2b'), fix.newLine);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel applyMigrationHunks: accept-all applies every hunk, unknown ids skipped', async () => {
  const { ctx, copilot } = newPanel();
  const ws = vscode.workspace;
  const origApply = ws.applyEdit;
  ws.applyEdit = async (edit) => {
    for (const entry of edit.entries()) {
      const target = vscode.__state.docRegistry.find((dd) => dd.uri.fsPath === entry.uri.fsPath);
      assert.ok(target, 'target doc found for ' + entry.uri.fsPath);
      target._applyEdits(entry.edits.map((e) => ({ range: e.range, newText: e.newText })));
    }
    return true;
  };
  try {
    copilot.show();
    const fp = rel('mig2.py');
    fs.writeFileSync(fp, 'import hashlib\nh = hashlib.md5(x)\n');
    activateEditor(fp, 'import hashlib\nh = hashlib.md5(x)\n', 'python');
    const r = await chat(copilot, 'migrate');
    const data = JSON.parse(r.match(/<script type="application\/json" class="qirova-hunks">(.+?)<\/script>/)[1]);
    const ids = data.hunks.map((h) => h.id);
    const res = await copilot.applyMigrationHunks(fp, [...ids, 'nope']);
    assert.deepStrictEqual([...res.applied].sort(), [...ids].sort());
    assert.ok(res.skipped.some((s) => s.id === 'nope'), JSON.stringify(res.skipped));
    const doc = vscode.__findDocument(fp);
    assert.ok(doc.getText().includes('blake2b'), doc.getText());
  } finally {
    ws.applyEdit = origApply;
    disposeContext(ctx);
  }
});

test('CopilotPanel applyMigrationHunks: stale file content skips the hunk', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const fp = rel('mig3.py');
    fs.writeFileSync(fp, 'import hashlib\nh = hashlib.md5(x)\n');
    activateEditor(fp, 'import hashlib\nh = hashlib.md5(x)\n', 'python');
    const r = await chat(copilot, 'migrate');
    const data = JSON.parse(r.match(/<script type="application\/json" class="qirova-hunks">(.+?)<\/script>/)[1]);
    const fix = data.hunks.find((h) => h.kind === 'fix');
    assert.ok(fix, 'fix hunk present');
    const doc = vscode.__findDocument(fp);
    doc._applyEdits([{ range: new vscode.Range(1, 0, 1, 20), newText: '# edited by user' }]);
    const res = await copilot.applyMigrationHunks(fp, [fix.id]);
    assert.deepStrictEqual(res.applied, []);
    assert.ok(res.skipped.some((s) => s.reason === 'file changed since review'), JSON.stringify(res.skipped));
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel webview: migrate review cards, Accept All and applied-state wiring present', async () => {
  const { ctx, copilot } = newPanel();
  try {
    const html = copilot.getHtml();
    for (const needle of ['wireMigrationCards', 'qirova-hunks', 'Accept All', 'Reject All', 'applyHunks',
      'hunksApplied', 'old-line', 'new-line', 'markHunkApplied', 'markHunkRejected']) {
      assert.ok(html.includes(needle), 'webview html contains ' + needle);
    }
  } finally {
    disposeContext(ctx);
  }
});

test('MigrationInlineProvider: ghost fix on vulnerable line, nothing on clean line', async () => {
  const ctx = makeContext();
  try {
    registerRemediator(ctx, new CryptoRemediator(), detector);
    assert.strictEqual(vscode.__state.inlineProviders.length, 1);
    const provider = vscode.__state.inlineProviders[0].provider;
    const doc = vscode.__openDocument(rel('inline1.py'), 'import hashlib\nh = hashlib.md5(x)\n', 'python');
    const items = await provider.provideInlineCompletionItems(doc, new vscode.Position(1, 3));
    assert.ok(Array.isArray(items) && items.length === 1, 'one ghost item');
    assert.ok(String(items[0].insertText).includes('blake2b'), items[0].insertText);
    const clean = await provider.provideInlineCompletionItems(doc, new vscode.Position(0, 0));
    assert.deepStrictEqual(clean, []);
  } finally {
    disposeContext(ctx);
  }
});

test('CryptoRemediator.previewMigrationHunk: jumps to line and triggers inline suggest', async () => {
  const ctx = makeContext();
  try {
    const fp = rel('inline2.py');
    fs.writeFileSync(fp, 'import hashlib\nh = hashlib.md5(x)\n');
    const rem = new CryptoRemediator();
    const ok = await rem.previewMigrationHunk(fp, 1, 4);
    assert.strictEqual(ok, true);
    const ed = vscode.window.activeTextEditor;
    assert.strictEqual(ed.selection.active.line, 1);
    assert.ok(vscode.__state.executed.some((e) => e.id === 'editor.action.inlineSuggest.trigger'),
      JSON.stringify(vscode.__state.executed.map((e) => e.id)));
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: migrate auto-previews first hunk in editor', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const fp = rel('inline3.py');
    fs.writeFileSync(fp, 'import hashlib\nh = hashlib.md5(x)\n');
    activateEditor(fp, 'import hashlib\nh = hashlib.md5(x)\n', 'python');
    await chat(copilot, 'migrate');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(vscode.__state.executed.some((e) => e.id === 'editor.action.inlineSuggest.trigger'),
      'inline suggest triggered after migrate');
  } finally {
    disposeContext(ctx);
  }
});

test('MigrationReviewManager: migrate shows editor lenses + decorations, accept/reject work', async () => {
  const { ctx, copilot } = newPanel();
  const ws = vscode.workspace;
  const origApply = ws.applyEdit;
  ws.applyEdit = async (edit) => {
    for (const entry of edit.entries()) {
      const target = vscode.__state.docRegistry.find((dd) => dd.uri.fsPath === entry.uri.fsPath);
      assert.ok(target, 'target doc found');
      target._applyEdits(entry.edits.map((e) => ({ range: e.range, newText: e.newText })));
    }
    return true;
  };
  try {
    copilot.show();
    const fp = rel('lens1.py');
    fs.writeFileSync(fp, 'import hashlib\nh = hashlib.md5(x)\n');
    activateEditor(fp, 'import hashlib\nh = hashlib.md5(x)\n', 'python');
    await chat(copilot, 'migrate');
    await new Promise((r) => setTimeout(r, 40));
    const review = copilot.remediator.review;
    const hunks = review.hunksFor(fp);
    assert.ok(hunks.length >= 1, 'review pending');
    assert.ok(vscode.__state.decorationTypes.length >= 1, 'decorations created');
    const doc = vscode.__findDocument(fp);
    const lenses = await review.provideCodeLenses(doc);
    const titles = lenses.map((l) => l.command.title);
    assert.ok(titles.some((t) => t.startsWith('Accept All')), titles.join(','));
    assert.ok(titles.includes('Accept') && titles.includes('Reject'), titles.join(','));
    const fix = hunks.find((h) => h.kind === 'fix');
    assert.ok(fix, 'fix hunk present');
    assert.strictEqual(await review.accept(fp, fix.id), true);
    assert.ok(doc.getText().includes('blake2b'), doc.getText());
    assert.strictEqual(await review.accept(fp, fix.id), false, 'double accept is a no-op');
    const other = review.hunksFor(fp)[0];
    if (other) {
      const before = doc.getText();
      review.reject(fp, other.id);
      assert.strictEqual(doc.getText(), before, 'reject changes nothing');
      assert.strictEqual(review.hunksFor(fp).length, hunks.length - 2);
    }
  } finally {
    ws.applyEdit = origApply;
    disposeContext(ctx);
  }
});

test('MigrationReviewManager.acceptAll: applies every hunk in one edit', async () => {
  const { ctx, copilot } = newPanel();
  const ws = vscode.workspace;
  const origApply = ws.applyEdit;
  let editCount = 0;
  ws.applyEdit = async (edit) => {
    editCount++;
    for (const entry of edit.entries()) {
      const target = vscode.__state.docRegistry.find((dd) => dd.uri.fsPath === entry.uri.fsPath);
      target._applyEdits(entry.edits.map((e) => ({ range: e.range, newText: e.newText })));
    }
    return true;
  };
  try {
    copilot.show();
    const fp = rel('lens2.py');
    fs.writeFileSync(fp, 'import hashlib\nh = hashlib.md5(x)\n');
    activateEditor(fp, 'import hashlib\nh = hashlib.md5(x)\n', 'python');
    await chat(copilot, 'migrate');
    await new Promise((r) => setTimeout(r, 40));
    const review = copilot.remediator.review;
    const n = await review.acceptAll(fp);
    assert.ok(n >= 1, 'applied ' + n);
    assert.strictEqual(editCount, 1, 'single WorkspaceEdit');
    assert.strictEqual(review.hunksFor(fp).length, 0, 'pending cleared');
  } finally {
    ws.applyEdit = origApply;
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: partial audit renders deadline banner', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    runPipeline: async () => ({
      scan_id: 'p1', total_findings: 1, quantum_risk: 'MEDIUM', partial: true,
      severity_counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
      model_evidence_count: 7, duration_ms: 480000, model_intelligence: {},
    }),
  });
  try {
    copilot.show();
    activateEditor(rel('pv7.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'scan');
    assert.ok(r.includes('### Deep scan (29 models, LIVE)'), r.slice(0, 200));
    assert.ok(r.includes('Partial audit'), r.slice(0, 800));
    assert.ok(r.includes('ECDAT_AUDIT_DEADLINE_S'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: qred shows hardware estimate without spending', async () => {
  const seen = [];
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    getHardwareStatus: async () => ({ metadata: { token_configured: false, rate_per_minute_usd: 96, note: 'no token', backends: [] } }),
    estimateHardware: async (p) => {
      seen.push(p);
      return { metadata: { items: [{ target: 'RSA-15', qubits: 8, fits_hardware: true, estimate: { cost_usd: 49.61 } }], total_estimated_usd: 49.61 } };
    },
    runHardware: async () => { throw new Error('must not spend from chat'); },
  });
  try {
    copilot.show();
    const r = await chat(copilot, 'qred');
    assert.ok(r.includes('Real-QPU red team'), r.slice(0, 200));
    assert.ok(r.includes('RSA-15'), r);
    assert.ok(r.includes('Nothing is spent'), r);
    assert.strictEqual(seen.length, 1);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: qred ends with Red-Team Review like simulated red-team', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    getHardwareStatus: async () => ({ metadata: { token_configured: false, note: 'no token', backends: [] } }),
    estimateHardware: async () => ({ metadata: { items: [], total_estimated_usd: 0 } }),
  });
  try {
    copilot.show();
    activateEditor(rel('qred1.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'qred');
    assert.ok(r.includes('Real-QPU red team'), r.slice(0, 200));
    assert.ok(r.includes('### Red-Team Review'), r.slice(-800));
    assert.ok(r.includes('| Algorithm | Vulnerability | Fix | Line |'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: qred without findings has no review section', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    getHardwareStatus: async () => ({ metadata: {} }),
    estimateHardware: async () => ({ metadata: { items: [] } }),
  });
  try {
    copilot.show();
    activateEditor(rel('qred2.py'), SAMPLES.pythonClean, 'python');
    const r = await chat(copilot, 'qred');
    assert.ok(!r.includes('### Red-Team Review'), r.slice(-400));
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: red-team appends live quantum campaign section', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    runRedTeam: async () => ({
      metadata: {
        campaign: {
          phase1: [{ algorithm: 'RSA-15', attack: "Shor's", broken: true }],
          phase3: [{ algorithm: 'RSA-2048', break_year: 2040, status: 'AT_RISK' }],
          summary: { total_attacks: 19, broken_count: 4, resistant_count: 4, total_cost_usd: 0 },
        },
      },
    }),
  });
  try {
    copilot.show();
    activateEditor(rel('rt1.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'red-team');
    assert.ok(r.includes('### Quantum red-team campaign (LIVE)'), r.slice(0, 300));
    assert.ok(r.includes('RSA-15'), r);
    assert.ok(r.includes('2040'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: red-team embeds qirova-circuits payload when circuit_svg present', async () => {
  const phase1 = [];
  for (let i = 0; i < 7; i++) {
    phase1.push({ algorithm: 'RSA-15', attack: "Shor's", broken: true, num_qubits: 8, circuit_svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' });
  }
  phase1.push({ algorithm: 'AES-4', attack: 'Grover', broken: false, num_qubits: 4, circuit_svg: null, circuit_omitted: 'too large' });
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    runRedTeam: async () => ({
      metadata: {
        campaign: {
          phase1,
          phase3: [],
          summary: { total_attacks: 8, broken_count: 7, resistant_count: 1, total_cost_usd: 0 },
        },
      },
    }),
  });
  try {
    copilot.show();
    activateEditor(rel('rt-circ.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'red-team');
    assert.ok(r.includes('### Quantum red-team campaign (LIVE)'), r.slice(0, 300));
    const m = r.match(/<script type="application\/json" class="qirova-circuits">(.+?)<\/script>/);
    assert.ok(m, 'circuits payload embedded');
    assert.ok(!m[1].includes('<svg'), 'raw < must be escaped as \\u003c');
    assert.ok(m[1].includes('\\u003c'), 'escaped < present');
    const data = JSON.parse(m[1]);
    assert.strictEqual(data.file, 'redteam');
    assert.strictEqual(data.fileName, 'Quantum circuits');
    assert.ok(Array.isArray(data.circuits), 'circuits array');
    assert.strictEqual(data.circuits.length, 6, 'capped at 6, got ' + data.circuits.length);
    assert.deepStrictEqual(data.circuits.map((c) => c.id), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
    assert.ok(data.circuits[0].svg.startsWith('<svg'), data.circuits[0].svg.slice(0, 20));
    assert.ok(data.circuits[0].title.includes('RSA-15'), data.circuits[0].title);
    assert.ok(data.circuits[0].title.includes('8 qubits'), data.circuits[0].title);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: red-team omits qirova-circuits payload when all circuit_svg null', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    runRedTeam: async () => ({
      metadata: {
        campaign: {
          phase1: [{ algorithm: 'RSA-15', attack: "Shor's", broken: true, num_qubits: 8, circuit_svg: null, circuit_omitted: 'too large' }],
          phase3: [],
          summary: { total_attacks: 1, broken_count: 1, resistant_count: 0, total_cost_usd: 0 },
        },
      },
    }),
  });
  try {
    copilot.show();
    activateEditor(rel('rt-nocirc.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'red-team');
    assert.ok(r.includes('### Quantum red-team campaign (LIVE)'), r.slice(0, 300));
    assert.ok(!r.includes('qirova-circuits'), r.slice(0, 500));
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: qred embeds qirova-circuits payload for hardware estimates with circuit_svg', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    getHardwareStatus: async () => ({ metadata: { token_configured: false, rate_per_minute_usd: 96, note: 'no token', backends: [] } }),
    estimateHardware: async () => ({
      metadata: {
        items: [{ target: 'RSA-15', qubits: 8, fits_hardware: true, estimate: { cost_usd: 49.61 }, circuit_svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>' }],
        total_estimated_usd: 49.61,
      },
    }),
  });
  try {
    copilot.show();
    const r = await chat(copilot, 'qred');
    assert.ok(r.includes('Real-QPU red team'), r.slice(0, 200));
    const m = r.match(/<script type="application\/json" class="qirova-circuits">(.+?)<\/script>/);
    assert.ok(m, 'circuits payload embedded');
    const data = JSON.parse(m[1]);
    assert.strictEqual(data.fileName, 'Quantum circuits');
    assert.strictEqual(data.circuits.length, 1);
    assert.ok(data.circuits[0].svg.startsWith('<svg'), data.circuits[0].svg.slice(0, 20));
    assert.ok(data.circuits[0].title.includes('RSA-15'), data.circuits[0].title);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: red-team without campaign backend stays local-only', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    activateEditor(rel('rt2.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'red-team');
    assert.ok(!r.includes('Quantum red-team campaign'), r.slice(0, 300));
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel onProgress: sidebar-style flow emits chunks without a shown panel', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    runPipeline: async () => ({ scan_id: 'sink1', total_findings: 0, quantum_risk: 'NONE' }),
  });
  try {
    // NOTE: no copilot.show() — like the sidebar provider, there is no live panel.
    const chunks = [];
    copilot.onProgress = (delta) => chunks.push(delta);
    activateEditor(rel('sink1.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await copilot.handleMessage('scan');
    assert.ok(r.includes('### Deep scan (29 models, LIVE)'), r.slice(0, 200));
    const all = chunks.join('\n');
    assert.ok(all.includes('Scan started'), 'ack chunk fanned out: ' + all.slice(0, 120));
    assert.ok(all.includes('Models in progress'), 'stage plan fanned out');
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: scan never hangs on slow workspace crawl, posts progress first', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    runPipeline: async () => ({ scan_id: 'slow1', total_findings: 0, quantum_risk: 'NONE' }),
  });
  const ws = vscode.workspace;
  const origFind = ws.findFiles;
  ws.findFiles = () => new Promise((resolve) => setTimeout(() => resolve([]), 200));
  try {
    copilot.show();
    activateEditor(rel('pv6.py'), SAMPLES.pythonVulnerable, 'python');
    const view = copilot.panel;
    await view.webview.emit({ type: 'chat', text: 'scan' });
    const posted = view.webview.posted;
    const chunks = posted.filter((m) => m.type === 'responseChunk').map((m) => m.delta).join('\n');
    assert.ok(chunks.includes('Scan started'), 'ack chunk posted first: ' + chunks.slice(0, 120));
    assert.ok(chunks.includes('Models in progress'), 'stage plan posted before audit completes');
    const last = posted[posted.length - 1];
    assert.strictEqual(last.type, 'response');
    assert.ok(last.response.includes('### Deep scan (29 models, LIVE)'), last.response.slice(0, 200));
    assert.ok(last.response.includes('slow1'), last.response.slice(0, 400));
  } finally {
    ws.findFiles = origFind;
    disposeContext(ctx);
  }
});

const ROUTING = [
  ['migrate', '### No file open'],
  ['move the file', '### No file open'],
  ['replace the cipher', '### No file open'],
  ['switch algorithms', '### No file open'],
  ['score my file', 'Open a file first.'],
  ['grade this code', 'Open a file first.'],
  ['readiness report', 'Open a file first.'],
  ['red-team review', 'No crypto weaknesses detected.'],
  ['redteam review', 'No crypto weaknesses detected.'],
  ['red-team', 'No crypto weaknesses detected.'],
  ['attack surface', 'No crypto weaknesses detected.'],
  ['bleichenbacher', 'No crypto weaknesses detected.'],
  ['padding oracle', 'No crypto weaknesses detected.'],
  ['fuzz the parser', 'No crypto weaknesses detected.'],
  ['monte carlo', '### Q-Day Monte Carlo (mock)'],
  ['q-day', '### Q-Day Monte Carlo (mock)'],
  ['qday', '### Q-Day Monte Carlo (mock)'],
  ['quantum threat', '### Q-Day Monte Carlo (mock)'],
  ['cbom', 'No crypto findings to export.'],
  ['cyclonedx', 'No crypto findings to export.'],
  ['export the findings', 'No crypto findings to export.'],
  ['scan', 'Open a file first.'],
];

test('CopilotPanel routing: every keyword lands on its branch', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    for (const [prompt, expected] of ROUTING) {
      const r = await chat(copilot, prompt);
      assert.ok(r.includes(expected), `prompt "${prompt}" -> ${JSON.stringify(r.slice(0, 80))}`);
    }
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel routing: if-chain order decides ties', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const migrationScore = await chat(copilot, 'score the migration');
    assert.strictEqual(migrationScore, 'Open a file first.',
      'score branch wins: "migration" does not match /migrate/');

    const replaceScore = await chat(copilot, 'replace the score');
    assert.strictEqual(replaceScore, '### No file open\n\nOpen a file with crypto code first.',
      'migrate branch is checked before score');

    const quantumScan = await chat(copilot, 'quantum scan');
    assert.ok(quantumScan.includes('### Q-Day Monte Carlo (mock)'), quantumScan);

    assert.strictEqual(await chat(copilot, 'red team review'), copilot.getWelcome(),
      'space-separated "red team" does not match /red-?team/ and falls through to welcome');
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: q-day renders full nestedMonte Carlo card', async () => {
  const { ctx, copilot } = newPanel(makeGateway({
    ping: async () => true,
    runMonteCarlo: async () => ({
      model: 'monte_carlo', model_id: '26', quantum_risk: 'HIGH',
      metadata: {
        iterations: 100000,
        qday: {
          p5_year: 2033.5, p25_year: 2035.9, p50_year: 2037.9, p75_year: 2040.3, p95_year: 2044.9,
          ci50: [2035.9, 2040.3], ci80: [2034.3, 2043.1], ci95: [2033.5, 2044.9],
          mean_t_years: 12.4, median_t_years: 11.9, std_t_years: 3.5,
          simulation_count: 100000, seed: 42, base_year: 2026,
          analytical_p50_year: 2038.0, analytical_crosscheck_pass: true,
          parameter_version: 'qrd-lognormal-gri2025-v1',
        },
      },
    }),
  }));
  try {
    copilot.show();
    const r = await chat(copilot, 'q-day');
    for (const needle of ['| P25 | 2036 |', '| **P50** | **2038** |', '| P75 | 2040 |',
      'crosscheck pass', '| CI 50% | 2036 - 2040 |', '| CI 95% | 2034 - 2045 |',
      'Mean horizon', '12.4 yrs', '| Simulations | 100000 |', '| Seed | 42 |',
      '| Base year | 2026 |', 'qrd-lognormal']) {
      assert.ok(r.includes(needle), 'missing: ' + needle + '\n' + r.slice(0, 600));
    }
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: q-day mock gateway response', async () => {
  const { ctx, copilot } = newPanel(makeGateway());
  try {
    copilot.show();
    const r = await chat(copilot, 'q-day');
    assert.ok(r.includes('Q-Day Monte Carlo (mock)'), r);
    assert.ok(r.includes('**P50** | **2038**'), r);
    assert.ok(r.includes('P(exposure by 2038): **71%**'), r);
    assert.ok(r.includes('| P95 | 2046 |'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: q-day live gateway response', async () => {
  const { ctx, copilot } = newPanel(makeGateway({
    ping: async () => true,
    runMonteCarlo: async () => ({ p50: 2041, samples: 100000 }),
  }));
  try {
    copilot.show();
    const r = await chat(copilot, 'monte carlo');
    assert.ok(r.includes('Q-Day Monte Carlo (live)'), r);
    assert.ok(r.includes('2041'), r);
    assert.ok(r.includes('| Simulations | 100000 |'), r);
    assert.ok(!r.includes('```'), 'no raw JSON dump');
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: q-day gateway error is surfaced', async () => {
  const { ctx, copilot } = newPanel(makeGateway({
    ping: async () => true,
    runMonteCarlo: async () => { throw new Error('boom'); },
  }));
  try {
    copilot.show();
    const r = await chat(copilot, 'quantum');
    assert.ok(r.includes('> Error: boom'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotSidebarProvider: resolveWebviewView wires scripts, html and chat', async () => {
  const ctx = makeContext();
  try {
    const sidebar = new CopilotSidebarProvider(ctx, makeGateway(), new CryptoDetector(), new CryptoRemediator());
    const view = makeView();
    assert.doesNotThrow(() => sidebar.reveal());

    sidebar.resolveWebviewView(view);
    assert.strictEqual(view.webview.options.enableScripts, true);
    assert.ok(view.webview.html.length > 0);
    assert.ok(view.webview.html.includes('acquireVsCodeApi'));

    await view.webview._listeners[0]({ type: 'chat', text: 'hello world' });
    const posted = view.webview.posted;
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(posted[0].type, 'response');
    assert.ok(posted[0].response.startsWith('### QIROVA Copilot'), posted[0].response);

    sidebar.reveal();
    assert.strictEqual(view.shown, true);
  } finally {
    disposeContext(ctx);
  }
});

test('registerCopilot: registers the view provider and the openCopilot command', () => {
  const ctx = makeContext();
  try {
    registerCopilot(ctx, makeGateway(), new CryptoDetector(), new CryptoRemediator());
    const entry = vscode.__state.webviewViewProviders.get('qirova.copilotView');
    assert.ok(entry, 'qirova.copilotView provider missing');
    assert.strictEqual(entry.options.webviewOptions.retainContextWhenHidden, true);
    assert.strictEqual(typeof entry.provider.resolveWebviewView, 'function');
    assert.ok(vscode.__state.commands.has('qirova.openCopilot'));
    assert.strictEqual(typeof vscode.__getRegisteredCommand('qirova.openCopilot'), 'function');
    assert.strictEqual(ctx.subscriptions.length, 3);
    for (const d of ctx.subscriptions) assert.strictEqual(typeof d.dispose, 'function');
  } finally {
    disposeContext(ctx);
  }
  assert.ok(!vscode.__state.commands.has('qirova.openCopilot'), 'command must be a subscription');
  assert.ok(!vscode.__state.webviewViewProviders.has('qirova.copilotView'));
});

test('registerCopilot: autoOpen focuses the sidebar after the startup timer',
  { timeout: 5000 }, async () => {
    const ctx = makeContext();
    try {
      registerCopilot(ctx, makeGateway(), new CryptoDetector(), new CryptoRemediator());
      const entry = vscode.__state.webviewViewProviders.get('qirova.copilotView');
      const view = makeView();
      entry.provider.resolveWebviewView(view);
      assert.strictEqual(view.shown, false);

      await new Promise((r) => setTimeout(r, 1700));

      assert.ok(
        vscode.__state.executed.some((e) => e.id === 'qirova.copilotView.focus'),
        `executed: ${JSON.stringify(vscode.__state.executed)}`
      );
      assert.strictEqual(view.shown, true);
      assert.strictEqual(vscode.__state.webviewPanels.length, 0,
        'sidebar path must not open a panel');
    } finally {
      disposeContext(ctx);
    }
  });

test('registerCopilot: openCopilot falls back to the copilot panel when focus fails', async () => {
  const ctx = makeContext();
  try {
    registerCopilot(ctx, makeGateway(), new CryptoDetector(), new CryptoRemediator());
    vscode.__state.throwOnUnregistered.add('qirova.copilotView.focus');
    try {
      await vscode.__executeRegistered('qirova.openCopilot');
    } finally {
      vscode.__state.throwOnUnregistered.delete('qirova.copilotView.focus');
    }
    assert.ok(vscode.__state.webviewPanels.length >= 1,
      'fallback must open the copilot editor panel');
    const p = vscode.__state.webviewPanels[0];
    assert.strictEqual(p.viewType, 'qirova.copilot');
    assert.ok(vscode.__state.executed.some((e) => e.id === 'qirova.copilotView.focus'));
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: knowledge returns a CVE table when the gateway serves results', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    searchCve: async () => ({ metadata: { results: [{ cve_id: 'CVE-2024-0001', description: 'd', cvss: 9.8 }] } }),
  });
  try {
    copilot.show();
    const r = await chat(copilot, 'knowledge CVE-2024-0001');
    assert.ok(r.includes('CVE-2024-0001'), r);
    assert.ok(r.includes('| CVE |'), r);
    assert.ok(r.includes('Standards'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: knowledge offline returns fallback text (not welcome)', async () => {
  const { ctx, copilot } = newPanel();
  try {
    copilot.show();
    const r = await chat(copilot, 'knowledge rsa');
    assert.ok(!r.startsWith('### QIROVA Copilot'), r);
    assert.ok(r.toLowerCase().includes('knowledge'), r);
    assert.ok(r.includes('Standards'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: knowledge fan-out renders CDKG + RAG sections', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    searchCve: async () => ({ metadata: { results: [] } }),
    getCdkg: async () => ({ metadata: { migration_hint: 'RSA -> ML-KEM' } }),
    getRag: async () => ({ metadata: { documents: [{ text: 'doc1' }] } }),
    getHybrid: async () => null,
    getVector: async () => null,
    getTrust: async () => null,
    getTemporal: async () => null,
    getCryptoApi: async () => null,
  });
  try {
    copilot.show();
    const r = await chat(copilot, 'knowledge rsa');
    assert.ok(r.includes('### Knowledge graph (CDKG)'), r);
    assert.ok(r.includes('RSA -> ML-KEM'), r);
    assert.ok(r.includes('### RAG'), r);
    assert.ok(r.includes('doc1'), r);
    assert.ok(r.includes('Standards'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('CopilotPanel chat: red-team includes Model 04 + Model 05 rows', async () => {
  const { ctx, copilot } = newPanel({
    ping: async () => true,
    getMisuse: async () => ({ findings: [] }),
    getTrapdoor: async () => ({ findings: [] }),
    classify: async () => ({ metadata: { model_output: { level_1_family: 'HASH', level_2_algorithm: 'MD5', level_3_quantum_risk: 'HIGH' } } }),
    getRobust: async () => ({ metadata: { adversarial_probability: 0.12 } }),
  });
  try {
    copilot.show();
    activateEditor(rel('rt-live.py'), SAMPLES.pythonVulnerable, 'python');
    const r = await chat(copilot, 'red-team');
    assert.ok(r.includes('### Model verdicts (LIVE)'), r);
    assert.ok(r.includes('Model 04'), r);
    assert.ok(r.includes('HASH'), r);
    assert.ok(r.includes('MD5'), r);
    assert.ok(r.includes('HIGH'), r);
    assert.ok(r.includes('Model 05'), r);
    assert.ok(r.includes('0.12'), r);
  } finally {
    disposeContext(ctx);
  }
});

test('registerCopilot: autoOpen=false schedules no focus timer', { timeout: 5000 }, async () => {
  const ctx = makeContext();
  try {
    vscode.__setConfig('ecdat.copilot.autoOpen', false);
    registerCopilot(ctx, makeGateway(), new CryptoDetector(), new CryptoRemediator());
    assert.strictEqual(ctx.subscriptions.length, 2);

    await new Promise((r) => setTimeout(r, 1700));

    assert.ok(!vscode.__state.executed.some((e) => e.id === 'qirova.copilotView.focus'),
      `executed: ${JSON.stringify(vscode.__state.executed)}`);
  } finally {
    disposeContext(ctx);
  }
});
