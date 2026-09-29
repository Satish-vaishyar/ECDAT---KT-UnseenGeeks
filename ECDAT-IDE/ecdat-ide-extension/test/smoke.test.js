'use strict';
const { vscode } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert');

test('mock: core constructs', () => {
  assert.ok(new vscode.Position(1, 2));
  assert.ok(new vscode.Range(0, 0, 1, 1));
  assert.strictEqual(vscode.TreeItemCollapsibleState.Collapsed, 1);
  assert.ok(vscode.CodeActionKind.QuickFix.contains(vscode.CodeActionKind.QuickFix));
  const u = vscode.Uri.file('C:\\tmp\\x.py');
  assert.strictEqual(u.scheme, 'file');
});

test('compiled cryptoDetector loads and scans', () => {
  const { CryptoDetector } = require('../out/cryptoDetector');
  const d = new CryptoDetector();
  const f = d.scan('h = hashlib.md5(data)\nkey = RSA.generate(2048)', 'python');
  assert.ok(f.some(x => x.algorithmId === 'md5'));
  assert.ok(f.some(x => x.algorithmId === 'rsa_2048'));
});

test('compiled extension activates', async () => {
  const ext = require('../out/extension');
  vscode.__reset();
  vscode.__setConfig('ecdat.gateway.autoConnect', false);
  const ctx = {
    subscriptions: [],
    extensionUri: vscode.Uri.file('D:\\sih2\\ecdat-ide-extension'),
    extensionPath: 'D:\\sih2\\ecdat-ide-extension',
    extension: { id: 'QIROVA.qirova-ide' },
    globalState: { _m: new Map(), get(k, d) { return this._m.has(k) ? this._m.get(k) : d; }, async update(k, v) { this._m.set(k, v); } },
    workspaceState: { _m: new Map(), get(k, d) { return this._m.has(k) ? this._m.get(k) : d; }, async update(k, v) { this._m.set(k, v); } },
    globalStorageUri: vscode.Uri.file('C:\\tmp\\qirova-store'),
    storageUri: vscode.Uri.file('C:\\tmp\\qirova-store2'),
    asAbsolutePath: (p) => 'D:\\sih2\\ecdat-ide-extension\\' + p,
  };
  await ext.activate(ctx);
  assert.ok(vscode.__state.commands.has('qirova.scanActiveFile'), 'scanActiveFile registered');
  assert.ok(vscode.__state.treeProviders.has('qirova.findings'));
  assert.ok(vscode.__state.webviewViewProviders.has('qirova.copilotView'), 'copilot webview registered');
  assert.ok(vscode.__state.diagnosticCollections.length >= 1);
  assert.ok(vscode.__state.statusBarItems.length >= 4, 'status bar items');
  const badge = vscode.__state.statusBarItems.find(i => i.text === 'MOCK' || i.text === 'LIVE');
  assert.ok(badge, 'mode badge set');
  ext.deactivate();
  for (const d of ctx.subscriptions) { try { d.dispose && d.dispose(); } catch {} }
});
