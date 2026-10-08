'use strict';
// setup must be required FIRST: it installs the in-process `vscode` mock.
const { vscode } = require('./helpers/setup');
const { EXT_ROOT, SAMPLES, makeContext, disposeContext, activateEditor } = require('./helpers/fixtures');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ext = require('../out/extension');
const { CryptoDetector } = require('../out/cryptoDetector');
const { GatewayClient } = require('../out/gatewayClient');

const TMP = path.join(EXT_ROOT, 'test', '.tmp-int');
const DEAD = 'http://127.0.0.1:1';
const UUID_RE = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (...segs) => path.join(TMP, ...segs);
function infoMsg(re) {
  return vscode.__state.messages.some((m) => m.level === 'info' && (typeof re === 'string' ? m.message.includes(re) : re.test(m.message)));
}
function warnMsg(re) {
  return vscode.__state.messages.some((m) => m.level === 'warn' && (typeof re === 'string' ? m.message.includes(re) : re.test(m.message)));
}
function expectedSeverity(s) {
  if (s === 'broken' || s === 'vulnerable') return 1;
  if (s === 'deprecated') return 0;
  if (s === 'info') return 2;
  return 3;
}

// --- shared extension lifecycle -------------------------------------------

let ctx = undefined;

function teardown() {
  try { ext.deactivate(); } catch { /* ignore */ }
  if (ctx) { disposeContext(ctx); ctx = undefined; }
  for (const panel of [...vscode.__state.webviewPanels]) {
    try { panel.dispose(); } catch { /* ignore */ }
  }
}

async function activateExt(pre, ctxOverrides) {
  teardown();
  vscode.__reset();
  vscode.__state._edits = [];
  vscode.__setConfig('ecdat.gateway.autoConnect', false);
  vscode.__setConfig('ecdat.gateway.url', DEAD);
  if (pre) pre();
  ctx = makeContext(ctxOverrides);
  ctx.globalState._m.set('qirova.welcomed', true);
  await ext.activate(ctx);
  return ctx;
}

// The mock's __fireDidSaveTextDocument wraps the payload as { document }, while
// the extension — like the real VS Code API — expects the raw TextDocument on
// didSave. Passing the wrapper makes the async scanDocument reject (unhandled),
// so once scan.onSave is enabled the registered listeners are driven directly
// with the document the real API would deliver.
function fireSave(doc) {
  for (const l of [...vscode.__state.didSaveDocListeners]) l(doc);
}

beforeEach(async () => { await activateExt(); });
afterEach(() => { teardown(); vscode.__state.quickPickResponse = undefined; });

// --- live gateway HTTP server ---------------------------------------------

let server = null;
let port = 0;
const sockets = new Set();
const seenHeaders = [];
const flags = { hangHealth: false, failRisk: false, rawRisk: false, failMonte: false, failCost: false };

function reply(res, code, body) {
  const isText = typeof body === 'string';
  res.writeHead(code, { 'Content-Type': isText ? 'text/plain' : 'application/json' });
  res.end(isText ? body : JSON.stringify(body));
}

before(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  server = http.createServer((req, res) => {
    req.resume();
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    seenHeaders.push({ path: p, authorization: req.headers.authorization });
    if (p === '/healthz') {
      if (flags.hangHealth) return; // never respond
      return reply(res, 200, { status: 'healthy', service: 'ecdat-gateway' });
    }
    if (p === '/api/v1/health') {
      if (flags.hangHealth) return; // never respond
      return reply(res, 200, { status: 'ok' });
    }
    if (p === '/api/v1/risk/score') {
      if (flags.failRisk) return reply(res, 500, { error: 'boom' });
      if (flags.rawRisk) return reply(res, 200, 'not json');
      return reply(res, 200, { qday: { p5: 2031, p50: 2036, p95: 2044, probability: 0.6 }, risers: [{ name: 'RSA-2048', qars: 0.9, tier: 'CRITICAL' }] });
    }
    if (p === '/api/v1/risk/portfolio') {
      if (flags.failRisk) return reply(res, 500, { error: 'boom' });
      if (flags.rawRisk) return reply(res, 200, 'not json');
      return reply(res, 200, { qday: { p5: 2031, p50: 2036, p95: 2044, probability: 0.6 }, worst: 'RSA-2048', risers: [{ name: 'RSA-2048', qars: 0.9, tier: 'CRITICAL' }] });
    }
    if (p === '/api/v1/risk/monte-carlo') {
      if (flags.failMonte) return reply(res, 500, { error: 'boom' });
      return reply(res, 200, { percentiles: { p5: 2034, p50: 2039, p95: 2047 }, n: 100000 });
    }
    if (p.startsWith('/api/v1/migration/cost/')) {
      if (flags.failCost) return reply(res, 500, { error: 'boom' });
      return reply(res, 200, { person_months: { expected_p50: 6 }, findings: [{ recommendation: 'Migrate to ML-KEM-768. Est. Cost: 6 person-months.' }], metadata: { migration_cost: { costs: { inr: { formatted: 'Rs 6 person-months' } } } } });
    }
    if (p === '/api/v1/pipeline/audit') return reply(res, 200, { score: 42 });
    if (p === '/api/v1/ai/chat') return reply(res, 200, { model: 'deepseek_coder', metadata: { text: 'stubbed', backend: 'stub' } });
    if (p === '/api/v1/models/status') return reply(res, 200, { count: 29, wired: 29, models: [] });
    if (p === '/api/v1/system/resources') return reply(res, 200, { cpu: 0.5 });
    if (p === '/api/v1/remediation/roadmap') return reply(res, 200, { steps: [] });
    if (p === '/api/v1/classify') return reply(res, 200, { label: 'x' });
    if (p === '/api/v1/quantum/qars') return reply(res, 200, { algorithm: 'RSA-2048', qars_score: 92 });
    if (p === '/api/v1/quantum/hndl') return reply(res, 200, { algorithm: 'RSA-2048', risk_level: 'CRITICAL' });
    if (p === '/api/v1/pipeline/compat' || p === '/api/v1/compliance/cert-in' ||
        p === '/api/v1/knowledge/vuln') return reply(res, 200, {});
    return reply(res, 404, { error: 'not found' });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

after(async () => {
  if (server) {
    const closed = new Promise((resolve) => server.close(() => resolve()));
    for (const s of [...sockets]) { try { s.destroy(); } catch { /* ignore */ } }
    await closed;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

const liveUrl = () => `http://127.0.0.1:${port}`;

// ===========================================================================
// A) Full activation
// ===========================================================================

test('A: full activation registers trees, webview, diagnostics, commands, status bar', async () => {
  const state = vscode.__state;
  assert.strictEqual(state.treeProviders.has('qirova.findings'), true);
  assert.strictEqual(state.treeProviders.has('qirova.risk'), true);
  assert.strictEqual(state.treeProviders.has('qirova.compliance'), true);
  assert.strictEqual(state.treeProviders.has('qirova.threat'), true);

  const copilot = state.webviewViewProviders.get('qirova.copilotView');
  assert.ok(copilot, 'copilot webview view registered');
  assert.strictEqual(copilot.options.webviewOptions.retainContextWhenHidden, true);

  assert.ok(state.diagnosticCollections.some((c) => c.name === 'qirova'), 'qirova diagnostic collection');

  const commands = [
    'qirova.openConsole', 'qirova.scanActiveFile', 'qirova.scanWorkspace',
    'qirova.runMonteCarlo', 'qirova.exportCbom', 'qirova.showQday',
    'qirova.remediateAll', 'qirova.applyTheme', 'qirova.refreshFindings',
    'qirova.redTeamChat', 'qirova.openWalkthrough', 'qirova.findings.remediate',
    'qirova.findings.jumpTo', 'qirova.findings.suppress', 'qirova.openCopilot',
    'qirova.insertMigrationSnippet', 'qirova.welcome.done',
  ];
  for (const id of commands) assert.ok(state.commands.has(id), `command registered: ${id}`);

  assert.ok(state.codeActionProviders.length >= 1, 'code action provider');
  assert.ok(state.completionProviders.length >= 1, 'completion provider');

  assert.ok(state.statusBarItems.length >= 4, 'at least 4 status bar items');
  const badge = vscode.__findStatusBarItem((i) => i.text === 'MOCK');
  assert.ok(badge, 'MOCK badge with autoConnect=false');
  const qday = vscode.__findStatusBarItem((i) => i.command === 'qirova.showQday');
  assert.match(qday.text, /Q-Day P50: 20\d\d/);
  const fileScore = vscode.__findStatusBarItem((i) => i.command === 'qirova.runMonteCarlo');
  const wsScore = vscode.__findStatusBarItem((i) => i.command === 'qirova.scanWorkspace');
  assert.strictEqual(fileScore._visible, true, 'file score visible');
  assert.strictEqual(wsScore._visible, true, 'workspace score visible');

  assert.doesNotThrow(() => { ext.deactivate(); }, 'deactivate must not throw');
  assert.doesNotThrow(() => { disposeContext(ctx); }, 'disposeContext must not throw');
});

// ===========================================================================
// B) Scan pipeline
// ===========================================================================

function openVulnerable(name = 'app.py') {
  const fsPath = tmp(name);
  fs.writeFileSync(fsPath, SAMPLES.pythonVulnerable, 'utf8');
  const { doc, ed } = activateEditor(fsPath, SAMPLES.pythonVulnerable, 'python');
  return { fsPath, doc, ed };
}

test('B1: scanActiveFile produces QIROVA diagnostics with severities', async () => {
  const { fsPath, doc } = openVulnerable();
  await vscode.__executeRegistered('qirova.scanActiveFile');
  const coll = vscode.__state.diagnosticCollections[0];
  const diags = coll.get(vscode.Uri.file(fsPath));
  assert.ok(diags && diags.length >= 3, 'diagnostics present');
  const findings = new CryptoDetector().scan(SAMPLES.pythonVulnerable, 'python');
  for (const d of diags) {
    assert.strictEqual(d.source, 'QIROVA');
    assert.strictEqual(typeof d.code, 'string');
    assert.ok(d.code.length > 0, 'code is algorithmId string');
    assert.ok(d.message.includes('→ Suggested:'), 'message has suggestion');
    assert.ok([0, 1, 2].includes(d.severity), `severity in {0,1,2}, got ${d.severity}`);
    const f = findings.find((x) =>
      x.line === d.range.start.line &&
      x.col === d.range.start.character &&
      x.length === d.range.end.character - d.range.start.character);
    assert.ok(f, 'diagnostic maps back to a finding');
    assert.strictEqual(d.severity, expectedSeverity(f.severity), `severity for ${f.algorithmId}/${f.severity}`);
  }
  assert.ok(diags.some((d) => d.code === 'md5' && d.severity === 1));
  assert.ok(diags.some((d) => d.code === 'cert_verify_disabled' && d.severity === 1));
  assert.ok(coll.get(vscode.Uri.file(fsPath)).length >= 3 && doc.getText().includes('md5'));
});

test('B2: findings tree exposes groups and finding nodes', async () => {
  openVulnerable();
  const provider = vscode.__state.treeProviders.get('qirova.findings');
  const groups = provider.getChildren(undefined);
  assert.ok(groups.length >= 2, `group nodes, got ${groups.length}`);
  for (const g of groups) assert.strictEqual(g.contextValue, 'group');
  const broken = groups.find((g) => g.sevKey === 'broken') || groups[0];
  const kids = provider.getChildren(broken);
  assert.ok(kids.length >= 1, 'finding nodes under group');
  assert.strictEqual(kids[0].contextValue, 'finding');
  assert.ok(typeof kids[0].label === 'string' && kids[0].label.length > 0);
  assert.ok(kids[0].command && kids[0].command.command === 'qirova.findings.jumpTo');
});

test('B3: file score status bar item shows PQC n/100', async () => {
  openVulnerable();
  await vscode.__executeRegistered('qirova.scanActiveFile');
  const item = vscode.__findStatusBarItem((i) => /^PQC \d+\/100$/.test(i.text));
  assert.ok(item, `file score item text, got: ${vscode.__state.statusBarItems.map((i) => i.text).join(' | ')}`);
  assert.strictEqual(item._visible, true);
});

test('B4: edit triggers debounced rescan; disabling scan.onEdit stops it', async () => {
  const { fsPath, doc } = openVulnerable();
  await vscode.__executeRegistered('qirova.scanActiveFile');
  const coll = vscode.__state.diagnosticCollections[0];
  const uri = vscode.Uri.file(fsPath);
  const before = coll.get(uri).length;

  doc._text += '\n# md5 hash\n';
  doc.version++;
  vscode.__fireDidChangeTextDocument(doc);
  await sleep(450);
  const afterEdit = coll.get(uri);
  assert.ok(afterEdit.length > before, `debounced edit refreshed diagnostics (${before} -> ${afterEdit.length})`);
  assert.ok(afterEdit.some((d) => d.code === 'md5' && d.range.start.line >= 9), 'new md5 diagnostic on appended line');

  vscode.__setConfig('ecdat.scan.onEdit', false);
  doc._text += '\n# md5 more\n';
  doc.version++;
  vscode.__fireDidChangeTextDocument(doc);
  await sleep(450);
  assert.strictEqual(coll.get(uri).length, afterEdit.length, 'no rescan while scan.onEdit=false');
});

test('B5: save rescans immediately when scan.onSave=true', async () => {
  const { fsPath, doc } = openVulnerable();
  await vscode.__executeRegistered('qirova.scanActiveFile');
  const coll = vscode.__state.diagnosticCollections[0];
  const uri = vscode.Uri.file(fsPath);
  const before = coll.get(uri).length;

  doc._text += '\n# sha1 digest\n';
  doc.version++;

  // Mock helper fires { document } instead of the document itself; with
  // scan.onSave still at its default (false) the listener short-circuits.
  vscode.__fireDidSaveTextDocument(doc);
  assert.strictEqual(coll.get(uri).length, before, 'no rescan while scan.onSave=false');

  vscode.__setConfig('ecdat.scan.onSave', true);
  fireSave(doc);
  await sleep(10);
  const afterSave = coll.get(uri);
  assert.ok(afterSave.length > before, 'save scan ran without debounce');
  assert.ok(afterSave.some((d) => d.code === 'sha1'), 'sha1 diagnostic from saved line');
});

test('B6: non-file scheme is skipped by scanActiveFile', async () => {
  const udoc = new vscode.__TextDocument(vscode.Uri.parse('untitled:1'), 'h = hashlib.md5(data)', 'python');
  const ed = new vscode.__TextEditor(udoc, vscode.__state);
  vscode.__setActiveTextEditor(ed);
  await vscode.__executeRegistered('qirova.scanActiveFile');
  assert.strictEqual(vscode.__state.diagnosticCollections[0].get(udoc.uri), undefined, 'no diagnostics for untitled scheme');
});

test('B7: documents above 5000 lines are skipped', async () => {
  const fsPath = tmp('huge.py');
  const big = 'x\n'.repeat(5000) + 'h = hashlib.md5(d)';
  const { doc } = activateEditor(fsPath, big, 'python');
  assert.ok(doc.lineCount > 5000, `lineCount ${doc.lineCount}`);
  await vscode.__executeRegistered('qirova.scanActiveFile');
  assert.strictEqual(vscode.__state.diagnosticCollections[0].get(vscode.Uri.file(fsPath)), undefined, 'scan skipped for huge doc');
});

test('B8: scanActiveFile without an editor warns', async () => {
  vscode.__setActiveTextEditor(undefined);
  await vscode.__executeRegistered('qirova.scanActiveFile');
  const matches = vscode.__allMessages().filter((m) => /No active editor/.test(m));
  assert.strictEqual(matches.length, 1, 'exactly one no-active-editor warning');
  openVulnerable(); // restore an editor
  assert.ok(vscode.__state.activeTextEditor);
});

test('B: severity mapping broken/vulnerable->Error, deprecated->Warning, info->Information', async () => {
  const fsPath = tmp('sev.py');
  const text = ['h = hashlib.md5(d)', 'k = RSA3072', 'i = SHA256', 'x = RSA.generate(2048)'].join('\n');
  fs.writeFileSync(fsPath, text, 'utf8');
  activateEditor(fsPath, text, 'python');
  await vscode.__executeRegistered('qirova.scanActiveFile');
  const diags = vscode.__state.diagnosticCollections[0].get(vscode.Uri.file(fsPath)) || [];
  const byCode = (code) => diags.find((d) => d.code === code);
  assert.strictEqual(diags.length, 4, `one diagnostic per finding, got ${diags.length}`);
  assert.strictEqual(byCode('md5').severity, vscode.DiagnosticSeverity.Error, 'broken -> Error');
  assert.strictEqual(byCode('rsa_2048').severity, vscode.DiagnosticSeverity.Error, 'vulnerable -> Error');
  assert.strictEqual(byCode('rsa_3072').severity, vscode.DiagnosticSeverity.Warning, 'deprecated -> Warning');
  assert.strictEqual(byCode('sha256').severity, vscode.DiagnosticSeverity.Information, 'info -> Information');
});

// ===========================================================================
// C) Commands
// ===========================================================================

test('C: qirova.refreshFindings announces refresh', async () => {
  await vscode.__executeRegistered('qirova.refreshFindings');
  assert.ok(infoMsg('QIROVA: Findings refreshed.'));
});

test('C: qirova.applyTheme sets QIROVA Secure theme', async () => {
  await vscode.__executeRegistered('qirova.applyTheme');
  assert.ok(vscode.__state.configUpdateCalls.some((c) => c.full === 'workbench.colorTheme' && c.value === 'QIROVA Secure'), 'config update call');
  assert.ok(infoMsg('QIROVA Secure theme applied.'));
});

test('C: qirova.findings.jumpTo reveals the target, and tolerates missing uri', async () => {
  const jumpPath = tmp('jump.py');
  const showBefore = vscode.__state.showTextDocCalls.length;
  await vscode.__executeRegistered('qirova.findings.jumpTo', { uri: jumpPath, line: 2, col: 1, length: 4 });
  const ed = vscode.__state.activeTextEditor;
  assert.ok(ed, 'active editor after jump');
  assert.strictEqual(ed.document.uri.fsPath, jumpPath);
  assert.strictEqual(ed.document, vscode.__findDocument(jumpPath), 'active doc is the shown doc');
  assert.strictEqual(ed.revealCalls.length, 1, 'revealRange called once');
  assert.strictEqual(vscode.__state.showTextDocCalls.length, showBefore + 1);

  await vscode.__executeRegistered('qirova.findings.jumpTo', { uri: undefined });
  assert.strictEqual(vscode.__state.showTextDocCalls.length, showBefore + 1, 'no extra showTextDocument for missing uri');
});

test('C: qirova.findings.suppress appends an ignore comment', async () => {
  const { fsPath, doc } = openVulnerable();
  await vscode.__executeRegistered('qirova.findings.suppress', { uri: fsPath, line: 4, algorithmId: 'md5', message: 'MD5 broken' });
  const lines = doc.getText().split('\n');
  assert.ok(lines[4].includes('qirova-ignore-line: md5'), `line 4: ${lines[4]}`);
  assert.ok(doc.getText().includes('qirova-ignore-line:'));
});

test('C: qirova.findings.remediate fixes cert_verify_disabled', async () => {
  const { fsPath, doc } = openVulnerable();
  const finding = new CryptoDetector().scan(SAMPLES.pythonVulnerable, 'python')
    .find((f) => f.algorithmId === 'cert_verify_disabled');
  assert.ok(finding, 'finding exists');
  finding.uri = fsPath;
  await vscode.__executeRegistered('qirova.findings.remediate', finding);
  const text = doc.getText();
  assert.ok(text.includes('verify=True'), 'verify=True inserted');
  assert.ok(!text.includes('verify=False'), 'verify=False removed');
  assert.ok(vscode.__state.messages.some((m) => m.level === 'info' && /CERT_VERIFY_DISABLED remediated at line/.test(m.message)), 'remediation info message');
});

test('C: qirova.remediateAll applies every automatic fix', async () => {
  const { doc } = openVulnerable();
  await vscode.__executeRegistered('qirova.remediateAll');
  const text = doc.getText();
  assert.ok(vscode.__state.messages.some((m) => /QIROVA: \d+ fixes? applied/.test(m.message)), 'fix count message');
  assert.ok(!text.includes('hashlib.md5'), 'hashlib.md5 replaced');
  assert.ok(text.includes('hashlib.blake2b(data, digest_size=32).hexdigest()'), 'md5 snippet first line used');
  assert.ok(!text.includes('verify=False'), 'verify=False gone');
  assert.ok(text.includes('verify=True'), 'verify=True present');

  const det = new CryptoDetector();
  const after = det.scan(text, 'python');
  const before = det.scan(SAMPLES.pythonVulnerable, 'python');
  const broken = (list) => list.filter((f) => f.severity === 'broken').length;
  assert.ok(broken(after) < broken(before), `fewer broken findings after remediation (${broken(before)} -> ${broken(after)})`);
  assert.strictEqual(after.length, 0, `all findings remediated, remaining: ${after.map((f) => f.algorithmId).join(',')}`);
});

test('C: qirova.runMonteCarlo returns an error object when gateway is dead', async () => {
  const r = await vscode.__executeRegistered('qirova.runMonteCarlo');
  assert.ok(r && typeof r === 'object');
  assert.strictEqual(typeof r.error, 'string');
});

test('C: qirova.redTeamChat opens the built-in chat', async () => {
  await vscode.__executeRegistered('qirova.redTeamChat');
  assert.ok(vscode.__state.executed.some((e) => e.id === 'workbench.action.chat.open'), 'chat command executed');
});

test('C: qirova.openWalkthrough opens the welcome walkthrough', async () => {
  await vscode.__executeRegistered('qirova.openWalkthrough');
  const call = vscode.__state.executed.find((e) => e.id === 'workbench.action.openWalkthrough');
  assert.ok(call, 'walkthrough command executed');
  assert.ok(String(call.args[0]).includes('qirova.welcome'), `walkthrough arg: ${call.args[0]}`);
});

test('C: qirova.insertMigrationSnippet quick-pick branches', async () => {
  const fsPath = tmp('snip.py');
  fs.writeFileSync(fsPath, SAMPLES.pythonVulnerable, 'utf8');
  const md5 = new CryptoDetector().scan(SAMPLES.pythonVulnerable, 'python').find((f) => f.algorithmId === 'md5');
  md5.uri = fsPath;
  const SNIPPET = 'hashlib.blake2b(data, digest_size=32).hexdigest()';
  const fresh = () => {
    const { doc, ed } = activateEditor(fsPath, SAMPLES.pythonVulnerable, 'python');
    ed.selection = new vscode.Selection(4, 0, 4, 0);
    ed.selections = [ed.selection];
    return doc;
  };

  // quick pick dismissed -> no edit
  let doc = fresh();
  vscode.__state.quickPickResponse = undefined;
  const original = doc.getText();
  await vscode.__executeRegistered('qirova.insertMigrationSnippet', md5);
  assert.strictEqual(doc.getText(), original, 'no edit when quick pick is dismissed');

  // full migration code
  doc = fresh();
  vscode.__state.quickPickResponse = { label: 'Insert full migration code' };
  await vscode.__executeRegistered('qirova.insertMigrationSnippet', md5);
  assert.ok(doc.getText().includes(SNIPPET), 'full snippet inserted');

  // import + usage
  doc = fresh();
  vscode.__state.quickPickResponse = { label: 'Insert import + usage' };
  await vscode.__executeRegistered('qirova.insertMigrationSnippet', md5);
  const lines = doc.getText().split('\n');
  assert.strictEqual(lines[0], 'import hashlib', `import at top, got: ${JSON.stringify(lines.slice(0, 3))}`);
  assert.ok(doc.getText().includes(SNIPPET), 'usage inserted at cursor');

  // cancel
  doc = fresh();
  vscode.__state.quickPickResponse = { label: 'Cancel' };
  const before = doc.getText();
  await vscode.__executeRegistered('qirova.insertMigrationSnippet', md5);
  assert.strictEqual(doc.getText(), before, 'no edit on cancel');

  // no snippet for this algorithm
  vscode.__state.quickPickResponse = undefined;
  const msgCount = vscode.__allMessages().length;
  await vscode.__executeRegistered('qirova.insertMigrationSnippet', { algorithmId: 'rsa_4096', uri: fsPath });
  const warnings = vscode.__allMessages().slice(msgCount).filter((m) => /No migration snippet available/.test(m));
  assert.strictEqual(warnings.length, 1, 'warning for missing snippet');
});

test('C: qirova.exportCbom warns when no workspace is open', async () => {
  await vscode.__executeRegistered('qirova.exportCbom');
  assert.ok(warnMsg('No workspace open.'));
});

test('C: qirova.exportCbom writes a CycloneDX CBOM into the workspace', async () => {
  const wsDir = tmp('ws');
  fs.mkdirSync(wsDir, { recursive: true });
  const vulnPath = path.join(wsDir, 'app.py');
  fs.writeFileSync(vulnPath, SAMPLES.pythonVulnerable, 'utf8');
  vscode.__state.workspaceFolders.push({ uri: vscode.Uri.file(wsDir), name: 'ws', index: 0 });
  vscode.__state.findFilesResult.push(vscode.Uri.file(vulnPath));

  await vscode.__executeRegistered('qirova.exportCbom');
  const outPath = path.join(wsDir, 'qirova-cbom.json');
  assert.ok(vscode.__state.writtenFiles.includes(outPath), `writtenFiles: ${vscode.__state.writtenFiles.join(', ')}`);
  assert.ok(fs.existsSync(outPath), 'cbom file exists on disk');
  const bom = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(bom.bomFormat, 'CycloneDX');
  assert.strictEqual(bom.specVersion, '1.7');
  assert.ok(Array.isArray(bom.components) && bom.components.length >= 1, 'components present');
  assert.ok(bom.components[0].evidence[0].line >= 1, 'evidence line is 1-based');
  assert.match(bom.serialNumber, UUID_RE);
  assert.strictEqual(bom.metadata.tools[0].vendor, 'QIROVA');
  assert.ok(infoMsg('CBOM written:'), 'written message');
});

test('C: qirova.scanWorkspace aggregates workspace findings into the tree', async () => {
  const wsDir = tmp('ws-scan');
  fs.mkdirSync(wsDir, { recursive: true });
  const vulnPath = path.join(wsDir, 'lib.py');
  fs.writeFileSync(vulnPath, SAMPLES.pythonVulnerable, 'utf8');
  vscode.__state.workspaceFolders.push({ uri: vscode.Uri.file(wsDir), name: 'ws', index: 0 });
  vscode.__state.findFilesResult.push(vscode.Uri.file(vulnPath));

  await vscode.__executeRegistered('qirova.scanWorkspace');
  const provider = vscode.__state.treeProviders.get('qirova.findings');
  const groups = provider.getChildren(undefined);
  const broken = groups.find((g) => g.sevKey === 'broken');
  assert.ok(broken, 'broken group from workspace scan');
  const kids = provider.getChildren(broken);
  assert.ok(kids.length >= 1, 'finding nodes from workspace scan');
  assert.ok(kids[0].label.includes('lib.py'), `label points at workspace file: ${kids[0].label}`);
});

test('C: qirova.openConsole creates/reveals the workbench panel and handles messages', async () => {
  const state = vscode.__state;
  await vscode.__executeRegistered('qirova.openConsole');
  assert.strictEqual(state.webviewPanels.length, 1, 'one panel');
  const panel = state.webviewPanels[0];
  assert.strictEqual(panel.viewType, 'qirova.console');
  assert.strictEqual(panel.title, 'QIROVA Security Workbench');
  const html = panel.webview.html;
  assert.ok(html.includes('window.QIROVA_GATEWAY_URL='), 'gateway url injected');
  assert.ok(html.includes('ecdat-bridge'), 'bridge script referenced');
  assert.ok(html.includes('QIROVA'), 'frontend bundle loaded');

  await vscode.__executeRegistered('qirova.openConsole');
  assert.ok(panel._revealed >= 1, 'second open reveals same panel');
  assert.strictEqual(state.webviewPanels.length, 1, 'still one panel');

  await panel.webview.emit({ type: 'ecdat.cmd', command: 'qirova.refreshFindings' });
  assert.ok(state.executed.some((e) => e.id === 'qirova.refreshFindings'), 'forwarded command executed');

  let mark = panel.webview.posted.length;
  await panel.webview.emit({ type: 'ecdat.backend.ping' });
  let status = panel.webview.posted.slice(mark).find((m) => m.type === 'ecdat.backend.status');
  assert.ok(status, 'status message posted');
  assert.strictEqual(status.live, false, 'dead gateway reported as offline');
  assert.strictEqual(status.url, DEAD);

  await panel.webview.emit({ type: 'ecdat.backend.urlChanged', url: DEAD, apiKey: 'k' });
  assert.ok(state.configUpdateCalls.some((c) => c.full === 'ecdat.gateway.url' && c.value === DEAD), 'gateway url persisted');
  assert.ok(state.configUpdateCalls.some((c) => c.full === 'ecdat.gateway.apiKey' && c.value === 'k'), 'api key persisted');
  status = panel.webview.posted[panel.webview.posted.length - 1];
  assert.strictEqual(status.type, 'ecdat.backend.status');
  assert.strictEqual(status.url, DEAD, 'status url reflects the new base url');
  assert.strictEqual(status.live, false);
});

test('C: qirova.openConsole degrades when the frontend bundle is missing', async () => {
  const extPath = tmp('no-frontend');
  fs.mkdirSync(extPath, { recursive: true });
  await activateExt(null, { extensionPath: extPath });
  await vscode.__executeRegistered('qirova.openConsole');
  assert.strictEqual(vscode.__state.webviewPanels.length, 1, 'panel still created');
  const html = vscode.__state.webviewPanels[0].webview.html;
  assert.ok(html.includes('Frontend bundle missing'), 'fallback html served');
  assert.ok(html.includes('index.html'), 'fallback points at the expected path');
});

test('C: qirova.openConsole launch path spawns the gateway terminal', { timeout: 9000 }, async () => {
  await vscode.__executeRegistered('qirova.openConsole');
  const panel = vscode.__state.webviewPanels[0];
  const before = vscode.__state.terminals.length;
  await panel.webview.emit({ type: 'ecdat.backend.launch' });
  assert.strictEqual(vscode.__state.terminals.length, before + 1, 'terminal created');
  const term = vscode.__state.terminals[vscode.__state.terminals.length - 1];
  assert.strictEqual(term.name, 'QIROVA Gateway');
  assert.strictEqual(term.sent[0].text, 'python -X utf8 -m gateway.main');
  assert.ok(term.shown >= 1, 'terminal shown');
  const status = panel.webview.posted[panel.webview.posted.length - 1];
  assert.strictEqual(status.type, 'ecdat.backend.status');
  assert.strictEqual(status.live, false, 'gateway still unreachable after launch attempt');
});

// ===========================================================================
// D) Live gateway integration
// ===========================================================================

test('D: GatewayClient connectivity, base url round-trip and auth header', async () => {
  const gc = new GatewayClient(liveUrl(), 'test-key');
  assert.strictEqual(await gc.ping(), true, 'ping live');
  assert.strictEqual(gc.isConnected(), true);

  const dead = new GatewayClient(DEAD, '');
  assert.strictEqual(await dead.ping(), false, 'ping dead');
  assert.strictEqual(dead.isConnected(), false);

  gc.setBaseUrl(`${liveUrl()}///`);
  assert.strictEqual(gc.getBaseUrl(), liveUrl(), 'trailing slashes stripped');
  assert.strictEqual(await gc.ping(), true, 'ping still works after setBaseUrl');

  gc.setApiKey('my-secret');
  await gc.getRisk();
  const seen = seenHeaders.filter((h) => h.path === '/api/v1/risk/portfolio').pop();
  assert.strictEqual(seen.authorization, 'Bearer my-secret', 'authorization header sent');
});

test('D: GatewayClient normalizes localhost to 127.0.0.1 (IPv6 flake guard)', () => {
  const gc = new GatewayClient('http://localhost:8000///', '');
  assert.strictEqual(gc.getBaseUrl(), 'http://127.0.0.1:8000');
  gc.setBaseUrl('http://LOCALHOST:8000/api/');
  assert.strictEqual(gc.getBaseUrl(), 'http://127.0.0.1:8000/api');
  gc.setBaseUrl('http://127.0.0.1:8000');
  assert.strictEqual(gc.getBaseUrl(), 'http://127.0.0.1:8000');
});

test('D: GatewayClient rejects unusable base urls instead of throwing', async () => {
  const gc = new GatewayClient('::::not-a-url', '');
  assert.strictEqual(await gc.ping(), false, 'bad url -> ping false');
  assert.strictEqual(gc.isConnected(), false);
});

test('D: GatewayClient endpoint sweep returns objects', async () => {
  const gc = new GatewayClient(liveUrl(), 'test-key');
  const risk = await gc.getRisk();
  assert.ok(risk && typeof risk === 'object');
  assert.strictEqual(risk.qday.p50, 2036);
  assert.strictEqual(risk.risers[0].tier, 'CRITICAL');

  const mc = await gc.runMonteCarlo();
  assert.deepStrictEqual(mc.percentiles, { p5: 2034, p50: 2039, p95: 2047 });

  const pipeline = await gc.runPipeline({ source_code: 'x' });
  assert.strictEqual(pipeline.score, 42);

  const cost = await gc.getMigrationCost('rsa_2048');
  assert.strictEqual(cost.person_months.expected_p50, 6);

  assert.deepStrictEqual(await gc.getSystemResources(), { cpu: 0.5 });
  assert.deepStrictEqual(await gc.getRemediationRoadmap(), { steps: [] });
  assert.deepStrictEqual(await gc.getCertInMappings(), {});
  const qars = await gc.getQars('RSA-2048', 2048);
  assert.strictEqual(qars.algorithm, 'RSA-2048');
  const hndl = await gc.getHndl({ algorithm: 'RSA-2048' });
  assert.ok(hndl.risk_level, 'hndl returns a risk level');
  assert.deepStrictEqual(await gc.classify('hashlib.md5(x)', 'python'), { label: 'x' });
  assert.deepStrictEqual(await gc.searchCve('RSA'), {});
  assert.deepStrictEqual(await gc.runCompat(['RSA-2048']), []);
  const chat = await gc.chat('deepseek_coder', [{ role: 'user', content: 'hi' }]);
  assert.strictEqual(chat.metadata.backend, 'stub');
  const models = await gc.getModels();
  assert.strictEqual(models.wired, 29);
});

test('D: GatewayClient.getMigrationSuggestions uses the cost endpoint', async () => {
  const gc = new GatewayClient(liveUrl(), '');
  const findings = [{ algorithmId: 'md5', message: 'm', remediationHint: 'BLAKE3', language: 'python' }];
  const suggestions = await gc.getMigrationSuggestions(findings);
  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].algorithm, 'MD5');
  assert.strictEqual(suggestions[0].target, 'BLAKE3');
  assert.match(suggestions[0].notes, /person-months/);

  flags.failCost = true;
  try {
    const degraded = await gc.getMigrationSuggestions(findings);
    assert.strictEqual(degraded.length, 1, 'suggestion still produced');
    assert.strictEqual(degraded[0].notes, undefined, 'no notes when cost endpoint fails');
  } finally {
    flags.failCost = false;
  }
});

test('D: GatewayClient error paths (HTTP 500, non-JSON body)', async () => {
  const gc = new GatewayClient(liveUrl(), '');
  flags.failRisk = true;
  flags.failMonte = true;
  try {
    assert.strictEqual(await gc.getRisk(), null, 'getRisk swallows 500');
    const mc = await gc.runMonteCarlo();
    assert.ok(mc && typeof mc.error === 'string', 'monte carlo reports error');
    assert.match(mc.error, /HTTP 500/);
  } finally {
    flags.failRisk = false;
    flags.failMonte = false;
  }
  flags.rawRisk = true;
  try {
    assert.deepStrictEqual(await gc.getRisk(), { raw: 'not json' }, 'non-JSON body wrapped as raw');
  } finally {
    flags.rawRisk = false;
  }
});

test('D: GatewayClient ping times out against a hanging endpoint', { timeout: 15000 }, async () => {
  flags.hangHealth = true;
  try {
    const gc = new GatewayClient(liveUrl(), '');
    assert.strictEqual(await gc.ping(), false, 'timeout yields false');
    assert.strictEqual(gc.isConnected(), false);
  } finally {
    flags.hangHealth = false;
  }
});

test('D: GatewayClient.buildCbomLocal builds a CycloneDX document', async () => {
  const gc = new GatewayClient(liveUrl(), '');
  const root = 'C:/ws';
  const findings = [
    {
      algorithmName: 'md5', algorithmCategory: 'Hash', severity: 'broken',
      message: 'MD5 broken', remediationHint: 'BLAKE3', keySize: 2048,
      uri: root + '/src/a.py', line: 0, col: 1, fileSnippet: 'hashlib.md5(d)',
    },
    {
      algorithmName: 'rsa_2048', algorithmCategory: 'Asymmetric', severity: 'deprecated',
      message: 'RSA-2048 deprecated', remediationHint: 'ML-KEM-768', keySize: undefined,
      uri: root + '/b.py', line: 4, col: 0, fileSnippet: 'RSA.generate(2048)',
    },
  ];
  const bom = gc.buildCbomLocal(findings, root);
  assert.strictEqual(bom.bomFormat, 'CycloneDX');
  assert.strictEqual(bom.specVersion, '1.7');
  assert.match(bom.serialNumber, UUID_RE);
  assert.strictEqual(bom.version, 1);
  assert.deepStrictEqual(bom.metadata.tools[0], { vendor: 'QIROVA', name: 'qirova-ide', version: '1.0.0' });
  assert.strictEqual(bom.metadata.component.type, 'application');
  assert.strictEqual(bom.components.length, 2);

  const c0 = bom.components[0];
  assert.strictEqual(c0.type, 'cryptographic-asset');
  assert.strictEqual(c0.name, 'MD5');
  assert.strictEqual(c0.category, 'Hash');
  assert.strictEqual(c0.severity, 'broken');
  assert.strictEqual(c0.description, 'MD5 broken');
  assert.strictEqual(c0.suggestedMigration, 'BLAKE3');
  assert.strictEqual(c0.keySize, 2048);
  assert.strictEqual(c0.filePath, '/src/a.py', 'rootPath stripped from filePath');
  assert.deepStrictEqual(c0.evidence[0], {
    type: 'source-location', file: root + '/src/a.py', line: 1, column: 2, snippet: 'hashlib.md5(d)',
  });

  const c1 = bom.components[1];
  assert.strictEqual(c1.name, 'RSA_2048');
  assert.strictEqual(c1.keySize, undefined, 'undefined keySize passes through');
  assert.strictEqual(c1.filePath, '/b.py');
  assert.strictEqual(c1.evidence[0].line, 5);
});

test('D: live gateway flips the status bar to LIVE with a fresh Q-Day', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ percentiles: { p50: new Date().getFullYear() + 3 } }) });
    await activateExt(() => {
      vscode.__setConfig('ecdat.gateway.url', liveUrl());
      vscode.__setConfig('ecdat.gateway.autoConnect', true);
    });
    await sleep(150);

    const badge = vscode.__findStatusBarItem((i) => i.text === 'LIVE');
    assert.ok(badge, `LIVE badge, texts: ${vscode.__state.statusBarItems.map((i) => i.text).join(' | ')}`);
    assert.strictEqual(badge._visible, true);
    assert.strictEqual(badge.backgroundColor.id, 'statusBarItem.successBackground');

    const qday = vscode.__findStatusBarItem((i) => i.command === 'qirova.showQday');
    assert.match(qday.text, /Q-Day P50: 20\d\d \(T-3\)/, `qday text: ${qday.text}`);
    assert.strictEqual(qday.backgroundColor.id, 'statusBarItem.errorBackground', 'yearsLeft<=5 -> error background');
  } finally {
    global.fetch = originalFetch;
  }
});
