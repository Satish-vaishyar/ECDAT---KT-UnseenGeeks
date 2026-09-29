'use strict';
// Shared fixtures: a full mock ExtensionContext, sample vulnerable sources,
// and helpers for driving the mock VS Code API from tests.

const path = require('path');
const { vscode } = require('./setup');

const EXT_ROOT = path.resolve(__dirname, '..', '..');

function makeContext(overrides = {}) {
  const store = () => {
    const m = new Map();
    return {
      _m: m,
      get: (k, d) => (m.has(k) ? m.get(k) : d),
      update: async (k, v) => { m.set(k, v); return undefined; },
      keys: () => [...m.keys()],
    };
  };
  const ctx = {
    subscriptions: [],
    extensionUri: vscode.Uri.file(EXT_ROOT),
    extensionPath: EXT_ROOT,
    extension: { id: 'QIROVA.qirova-ide', isActive: true },
    globalState: store(),
    workspaceState: store(),
    globalStorageUri: vscode.Uri.file(path.join(EXT_ROOT, '.test-storage', 'global')),
    storageUri: vscode.Uri.file(path.join(EXT_ROOT, '.test-storage', 'workspace')),
    secrets: { get: async () => undefined, store: async () => undefined, delete: async () => undefined },
    asAbsolutePath: (p) => path.join(EXT_ROOT, p),
    environment: { globalStorageHome: vscode.Uri.file(path.join(EXT_ROOT, '.test-storage')), machineId: 'test', sessionId: 'test', language: 'en', appName: 'QIROVA-Test', isTelemetryEnabled: false },
    ...overrides,
  };
  return ctx;
}

function disposeContext(ctx) {
  for (const d of [...ctx.subscriptions].reverse()) {
    try { d && d.dispose && d.dispose(); } catch { /* ignore */ }
  }
  ctx.subscriptions.length = 0;
}

const SAMPLES = {
  pythonVulnerable: [
    'import hashlib, os, random, ssl, requests',
    'from cryptography.hazmat.primitives.asymmetric import rsa',
    '',
    'def weak():',
    '    h = hashlib.md5(os.urandom(16)).hexdigest()',
    '    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)',
    '    secret = random.randint(0, 255)',
    '    r = requests.post("https://x", verify=False)',
    '    return h, key, secret, r',
  ].join('\n'),

  pythonClean: [
    'import hashlib',
    'def strong():',
    '    return hashlib.sha256(b"data").hexdigest()',
  ].join('\n'),

  jsVulnerable: [
    "const crypto = require('crypto');",
    'const h = crypto.createHash("md5").update("x").digest("hex");',
    'const k = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });',
    'const n = Math.random();',
  ].join('\n'),

  javaVulnerable: [
    'import javax.crypto.Cipher;',
    'public class Weak {',
    '  void run() throws Exception {',
    '    Cipher c = Cipher.getInstance("AES/ECB/PKCS5Padding");',
    '    java.util.Random r = new java.util.Random();',
    '    java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");',
    '  }',
    '}',
  ].join('\n'),

  goVulnerable: [
    'package main',
    'import ("crypto/md5"; "crypto/rsa"; "math/rand")',
    'func main() {',
    '  _ = md5.Sum([]byte("x"))',
    '  _ = rsa.GenerateKey(rand.Reader, 2048)',
    '  _ = rand.Intn(10)',
    '}',
  ].join('\n'),

  csharpVulnerable: [
    'using System.Security.Cryptography;',
    'class P {',
    '  void Run() {',
    '    var d = DES.Create();',
    '    var r = new Random();',
    '  }',
    '}',
  ].join('\n'),

  rustVulnerable: [
    'fn main() {',
    '  let h = md5::compute(b"x");',
    '  let n = rand::random::<u32>();',
    '}',
  ].join('\n'),

  ignoredLine: [
    '# ecdat-ignore-line: md5 - false positive',
    '# md5 is fine here because of the ignore above',
    'h = hashlib.md5(data)',
  ].join('\n'),
};

function openSample(name, fsPath, languageId) {
  const doc = vscode.__openDocument(fsPath, SAMPLES[name], languageId);
  return doc;
}

function activateEditor(fsPath, text, languageId) {
  const doc = vscode.__openDocument(fsPath, text, languageId);
  const ed = new vscode.__TextEditor(doc, vscode.__state);
  vscode.__setActiveTextEditor(ed);
  return { doc, ed };
}

module.exports = { EXT_ROOT, SAMPLES, makeContext, disposeContext, openSample, activateEditor };
