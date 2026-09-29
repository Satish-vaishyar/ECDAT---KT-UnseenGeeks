'use strict';
// Unit tests for the QIROVA tree providers (findings / risk / compliance /
// threat) and the status bar manager. Exercises the COMPILED out/*.js modules
// under plain Node using the in-process `vscode` mock (test/helpers/setup.js).

const { vscode } = require('./helpers/setup');
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { EXT_ROOT, SAMPLES, makeContext, disposeContext, openSample, activateEditor } = require('./helpers/fixtures');

const { FindingsProvider, GroupNode, FindingNode } = require('../out/findingsProvider');
const { RiskProvider, RiskNode } = require('../out/riskProvider');
const { ComplianceProvider, ComplianceNode } = require('../out/complianceProvider');
const { ThreatProvider, ThreatNode } = require('../out/threatProvider');
const { StatusBarManager } = require('../out/statusBar');

const YEAR = new Date().getFullYear();
const REAL_FETCH = global.fetch;
const tick = () => new Promise((r) => setTimeout(r, 0));
const SEP = '\u2500'.repeat(17);
const EM = '\u2014';

const FILE_CMD = 'qirova.runMonteCarlo';
const WS_CMD = 'qirova.scanWorkspace';
const QDAY_CMD = 'qirova.showQday';
const BADGE_CMD = 'qirova.openConsole';

const itemBy = (cmd) => vscode.__findStatusBarItem((i) => i.command === cmd);
const labelsOf = (nodes) => nodes.map((n) => n.label);
const vdoc = (name, text, lang) =>
  new vscode.__TextDocument(vscode.Uri.file(`D:\\sih2\\.qirova-unit-tests\\${name}.py`), text, lang || 'python');
const scannedCount = (wsItem) => {
  const m = /across (\d+) scanned/.exec(wsItem.tooltip || '');
  assert.ok(m, `tooltip has scanned count: ${wsItem.tooltip}`);
  return Number(m[1]);
};

function mkFinding(over = {}) {
  return Object.assign({
    uri: '', line: 0, col: 0, length: 3, algorithmId: 'md5', algorithmName: 'md5',
    algorithmCategory: 'Hash', severity: 'broken', message: 'MD5 collisions are practical',
    remediationHint: 'BLAKE3 (or SHA3-256)', detectionMethod: 'regex-pattern',
    fileSnippet: 'h = md5(x)',
  }, over);
}

beforeEach(() => { vscode.__reset(); });
after(() => { global.fetch = REAL_FETCH; });

// ---------------------------------------------------------------------------
// A) out/findingsProvider.js
// ---------------------------------------------------------------------------

test('findings: empty tree renders single No findings group', () => {
  const p = new FindingsProvider(makeContext());
  const roots = p.getChildren();
  assert.strictEqual(roots.length, 1);
  const g = roots[0];
  assert.ok(g instanceof GroupNode);
  assert.strictEqual(g.label, 'No findings');
  assert.strictEqual(g.sevKey, 'clean');
  assert.strictEqual(g.description, '0 findings');
  assert.strictEqual(g.tooltip, 'Open a file to scan or run a workspace scan');
  assert.strictEqual(g.contextValue, 'group');
  assert.ok(g.iconPath instanceof vscode.ThemeIcon);
  assert.strictEqual(g.iconPath.id, 'shield');
  assert.strictEqual(p.getTreeItem(g), g);
  assert.deepStrictEqual(p.getChildren(g), []);
});

test('findings: severity groups ordered, labeled and only for present severities', () => {
  const p = new FindingsProvider(makeContext());
  p.setWorkspace([
    mkFinding({ algorithmId: 'md5', severity: 'broken' }),
    mkFinding({ algorithmId: 'sha1', severity: 'broken' }),
    mkFinding({ algorithmId: 'rsa_legacy', severity: 'vulnerable' }),
    mkFinding({ algorithmId: 'rsa_2048', severity: 'deprecated' }),
    mkFinding({ algorithmId: 'sha256', severity: 'info' }),
  ]);
  const groups = p.getChildren();
  assert.deepStrictEqual(labelsOf(groups), ['BROKEN (2)', 'VULNERABLE (1)', 'DEPRECATED (1)', 'INFO (1)']);
  const icons = ['error', 'warning', 'alert', 'info'];
  const tips = [
    'Forbidden algorithms detected',
    'Quantum-vulnerable algorithms',
    'Will fail audit post-2030',
    'Acceptable today',
  ];
  groups.forEach((g, i) => {
    assert.ok(g.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual(g.iconPath.id, icons[i]);
    assert.strictEqual(g.tooltip, tips[i]);
    assert.strictEqual(g.contextValue, 'group');
    assert.ok(/^1?2? findings?$/.test(g.description));
  });
  assert.strictEqual(groups[0].description, '2 findings');
  assert.strictEqual(groups[1].description, '1 finding');

  const partial = new FindingsProvider(makeContext());
  partial.setWorkspace([
    mkFinding({ severity: 'broken' }),
    mkFinding({ algorithmId: 'rsa_legacy', severity: 'vulnerable' }),
  ]);
  assert.deepStrictEqual(labelsOf(partial.getChildren()), ['BROKEN (1)', 'VULNERABLE (1)']);
});

test('findings: group children filtered by severity; clean group empty', () => {
  const p = new FindingsProvider(makeContext());
  p.setWorkspace([
    mkFinding({ algorithmId: 'md5', severity: 'broken' }),
    mkFinding({ algorithmId: 'sha1', severity: 'broken' }),
    mkFinding({ algorithmId: 'rsa_legacy', severity: 'vulnerable' }),
  ]);
  const [broken, vuln] = p.getChildren();
  assert.strictEqual(broken.sevKey, 'broken');
  assert.strictEqual(vuln.sevKey, 'vulnerable');
  const brokenKids = p.getChildren(broken);
  assert.strictEqual(brokenKids.length, 2);
  for (const k of brokenKids) {
    assert.ok(k instanceof FindingNode);
    assert.strictEqual(k.contextValue, 'finding');
  }
  assert.strictEqual(p.getChildren(vuln).length, 1);
  assert.deepStrictEqual(p.getChildren(new GroupNode('No findings', '', 0, 'clean')), []);
});

test('findings: onDidChangeTreeData fires once per setFile/setWorkspace/refresh', () => {
  const p = new FindingsProvider(makeContext());
  let fires = 0;
  const sub = p.onDidChangeTreeData(() => { fires++; });
  p.setFile('a.py', []);
  assert.strictEqual(fires, 1);
  p.setWorkspace([]);
  assert.strictEqual(fires, 2);
  p.refresh();
  assert.strictEqual(fires, 3);
  sub.dispose();
  p.refresh();
  assert.strictEqual(fires, 3);
});

test('findings: merged() dedupes identical per-file/workspace findings and skips nulls', () => {
  const p = new FindingsProvider(makeContext());
  const base = { uri: 'C:/ws/src/a.py', line: 4, col: 0, algorithmId: 'md5', severity: 'broken' };
  p.setFile('a.py', [Object.assign({}, base)]);
  p.setWorkspace([
    null,
    Object.assign({}, base),
    { uri: 'C:/ws/src/b.py', line: 1, col: 2, algorithmId: 'sha1', severity: 'broken' },
  ]);
  const roots = p.getChildren();
  assert.deepStrictEqual(labelsOf(roots), ['BROKEN (2)']);
  assert.strictEqual(p.getChildren(roots[0]).length, 2);
});

test('findings: sparse finding (algorithmId+severity only) still renders', () => {
  const p = new FindingsProvider(makeContext());
  p.setWorkspace([{ algorithmId: 'md5', severity: 'broken' }]);
  const roots = p.getChildren();
  assert.deepStrictEqual(labelsOf(roots), ['BROKEN (1)']);
  const kids = p.getChildren(roots[0]);
  assert.strictEqual(kids.length, 1);
  assert.strictEqual(kids[0].label, 'MD5  Line 1');
  assert.ok(kids[0].tooltip.includes('Remediation:'));
  assert.ok(kids[0].tooltip.includes('File:'));
  assert.strictEqual(kids[0].description, '');
});

test('finding node: workspace-relative label, tooltip, jump command, severity icons', () => {
  vscode.__state.workspaceFolders.push({ uri: vscode.Uri.file('C:/ws'), name: 'ws', index: 0 });
  const f = mkFinding({ uri: 'C:/ws/src/a.py', line: 4, algorithmId: 'md5', algorithmName: 'md5' });
  const node = new FindingNode(f, makeContext());
  assert.strictEqual(node.label, `MD5  ${EM} src/a.py:5`);
  assert.ok(node.tooltip.includes('MD5 collisions are practical'));
  assert.ok(node.tooltip.includes('Remediation:'));
  assert.ok(node.tooltip.includes('File:'));
  assert.strictEqual(node.description, 'BLAKE3 (or SHA3-256)');
  assert.strictEqual(node.contextValue, 'finding');
  assert.strictEqual(node.command.command, 'qirova.findings.jumpTo');
  assert.strictEqual(node.command.arguments[0], f);
  assert.strictEqual(node.iconPath.id, 'error');

  const noUri = new FindingNode(mkFinding({ uri: '', line: 6 }), makeContext());
  assert.strictEqual(noUri.label, 'MD5  Line 7');

  const iconCases = [
    ['broken', 'error'],
    ['vulnerable', 'warning'],
    ['deprecated', 'alert'],
    ['info', 'info'],
    ['something-else', 'shield'],
  ];
  for (const [sev, icon] of iconCases) {
    const n = new FindingNode(mkFinding({ severity: sev }), makeContext());
    assert.strictEqual(n.iconPath.id, icon, `severity ${sev}`);
  }
});

test('group node: iconFor per sevKey and description pluralization', () => {
  const cases = [
    ['broken', 'error'],
    ['vulnerable', 'warning'],
    ['deprecated', 'alert'],
    ['info', 'info'],
    ['clean', 'shield'],
  ];
  for (const [sev, icon] of cases) {
    const g = new GroupNode('X', 'sub', 1, sev);
    assert.strictEqual(g.iconPath.id, icon, `sevKey ${sev}`);
    assert.strictEqual(g.description, '1 finding');
    assert.strictEqual(g.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  }
  assert.strictEqual(new GroupNode('Y', 'sub', 3, 'info').description, '3 findings');
  assert.strictEqual(new GroupNode('Z', 'sub', 0, 'clean').description, '0 findings');
});

test('findings: unknown severity maps into info group; FindingNode has no children', () => {
  const p = new FindingsProvider(makeContext());
  p.setWorkspace([mkFinding({ algorithmId: 'weird', severity: 'unknown-sev' })]);
  assert.deepStrictEqual(p.getChildren(), []);
  const infoGroup = new GroupNode('INFO (1)', 'Acceptable today', 1, 'info');
  const kids = p.getChildren(infoGroup);
  assert.strictEqual(kids.length, 1);
  assert.ok(kids[0] instanceof FindingNode);
  assert.deepStrictEqual(p.getChildren(kids[0]), []);
});

// ---------------------------------------------------------------------------
// B) out/riskProvider.js
// ---------------------------------------------------------------------------

test('risk: before first refresh shows Quantum Risk Lab header', () => {
  const p = new RiskProvider({ getRisk: async () => ({}) });
  const kids = p.getChildren();
  assert.strictEqual(kids.length, 1);
  assert.strictEqual(kids[0].label, 'Quantum Risk Lab');
  assert.strictEqual(kids[0].iconPath.id, 'shield');
  assert.strictEqual(p.getTreeItem(kids[0]), kids[0]);
});

test('risk: un-awaited refresh shows Connecting to gateway… while loading', async () => {
  const p = new RiskProvider({ getRisk: async () => ({}) });
  const pending = p.refresh();
  const kids = p.getChildren();
  assert.strictEqual(kids.length, 1);
  assert.strictEqual(kids[0].label, 'Connecting to gateway\u2026');
  assert.strictEqual(kids[0].iconPath.id, 'pulse');
  await pending;
  assert.notStrictEqual(p.getChildren()[0].label, 'Connecting to gateway\u2026');
});

test('risk: successful refresh renders qday rows, risers and action rows', async () => {
  const p = new RiskProvider({
    getRisk: async () => ({
      qday: { p5: 2030, p50: 2035, p95: 2045, probability: 0.5 },
      risers: [
        { name: 'RSA-2048', qars: 0.91, tier: 'CRITICAL' },
        { name: 'ECDSA-P256', qars: 'abc', tier: 'critical' },
        { name: 'AES-GCM', qars: 0.32, tier: '' },
        { qars: 0.5, tier: 'green' },
        null,
        { name: 'X', qars: 1, tier: 'RED' },
      ],
    }),
  });
  await p.refresh();
  const kids = p.getChildren();
  assert.deepStrictEqual(labelsOf(kids), [
    'Q-Day P5: 2030',
    'Q-Day P50: 2035',
    'Q-Day P95: 2045',
    'P(exposure by P50): 50%',
    SEP,
    'RSA-2048  QARS 0.91 [CRITICAL]',
    'ECDSA-P256  QARS n/a [CRITICAL]',
    'AES-GCM  QARS 0.32 [N/A]',
    'unknown  QARS 0.50 [GREEN]',
    'X  QARS 1.00 [RED]',
    SEP,
    '\u25b6 Run Monte Carlo',
    '\u2912 Export CBOM',
    'Show Q-Day',
  ]);
  assert.ok(!labelsOf(kids).some((l) => l.includes('Gateway offline')));
  const icons = ['flame', 'flame', 'warning', 'warning', undefined, 'flame', 'flame', 'pass', 'pass', 'warning', undefined, 'play', 'play', 'play'];
  kids.forEach((n, i) => {
    assert.strictEqual(n.contextValue, 'risk-item');
    if (icons[i] === undefined) assert.strictEqual(n.iconPath, undefined, `row ${i}`);
    else assert.strictEqual(n.iconPath.id, icons[i], `row ${i}`);
  });
  assert.deepStrictEqual(
    kids.slice(-3).map((n) => n.command.command),
    ['qirova.runMonteCarlo', 'qirova.exportCbom', 'qirova.showQday']
  );
  assert.strictEqual(kids[0].tooltip, 'Advent of CRQC (5% probability year)');
});

test('risk: gateway throwing falls back to mock scores with offline row', async () => {
  const p = new RiskProvider({ getRisk: async () => { throw new Error('ECONNREFUSED'); } });
  await p.refresh();
  const kids = p.getChildren();
  assert.strictEqual(kids[0].label, 'Gateway offline - showing mock risk data');
  assert.strictEqual(kids[0].tooltip, 'ECONNREFUSED');
  assert.strictEqual(kids[0].iconPath.id, 'warning');
  const labels = labelsOf(kids);
  assert.ok(labels.includes('Q-Day P50: 2038'));
  assert.ok(labels.includes('Q-Day P5: 2033'));
  assert.ok(labels.includes('RSA-2048  QARS 0.91 [CRITICAL]'));
  assert.ok(labels.includes('ML-KEM-768  QARS 0.05 [GREEN]'));
});

test('risk: non-Error rejection uses Gateway unreachable fallback message', async () => {
  const p = new RiskProvider({ getRisk: async () => { throw null; } });
  await p.refresh();
  const kids = p.getChildren();
  assert.strictEqual(kids[0].label, 'Gateway offline - showing mock risk data');
  assert.strictEqual(kids[0].tooltip, 'Gateway unreachable');
  assert.ok(labelsOf(kids).includes('Q-Day P50: 2038'));
});

test('risk: null gateway data hits the no-risk-data branch', async () => {
  const p = new RiskProvider({ getRisk: async () => null });
  await p.refresh();
  const kids = p.getChildren();
  assert.strictEqual(kids[0].label, 'Gateway offline - showing mock risk data');
  assert.strictEqual(kids[0].tooltip, 'Gateway returned no risk data');
  assert.ok(labelsOf(kids).includes('Q-Day P50: 2038'));
  assert.ok(labelsOf(kids).includes('P(exposure by P50): 71%'));
});

test('risk: missing qday, non-finite probability and non-array risers', async () => {
  const noQday = new RiskProvider({ getRisk: async () => ({}) });
  await noQday.refresh();
  assert.deepStrictEqual(labelsOf(noQday.getChildren()), [
    'Q-Day P5: \u2014',
    'Q-Day P50: \u2014',
    'Q-Day P95: \u2014',
    'P(exposure by P50): 0%',
    SEP,
    SEP,
    '\u25b6 Run Monte Carlo',
    '\u2912 Export CBOM',
    'Show Q-Day',
  ]);

  const badProb = new RiskProvider({ getRisk: async () => ({ qday: { probability: 'abc' }, risers: 'not-an-array' }) });
  await badProb.refresh();
  const labels = labelsOf(badProb.getChildren());
  assert.ok(labels.includes('P(exposure by P50): 0%'));
  assert.ok(labels.includes('Q-Day P5: \u2014'));
  assert.strictEqual(labels.filter((l) => l === SEP).length, 2, 'no riser rows');
});

test('risk: onDidChangeTreeData fires twice per refresh', async () => {
  const p = new RiskProvider({ getRisk: async () => ({}) });
  let fires = 0;
  const sub = p.onDidChangeTreeData(() => { fires++; });
  await p.refresh();
  assert.strictEqual(fires, 2);
  await p.refresh();
  assert.strictEqual(fires, 4);
  sub.dispose();
  await p.refresh();
  assert.strictEqual(fires, 4);
});

test('risk: RiskNode icon kinds and action command wiring', () => {
  const kinds = [
    ['critical', 'flame'],
    ['warn', 'warning'],
    ['ok', 'pass'],
    ['info', 'pulse'],
    ['header', 'shield'],
    ['action', 'play'],
  ];
  for (const [kind, icon] of kinds) {
    const n = new RiskNode('L', 'T', kind);
    assert.strictEqual(n.iconPath.id, icon, kind);
    assert.strictEqual(n.contextValue, 'risk-item');
    assert.strictEqual(n.tooltip, 'T');
    assert.strictEqual(n.command, undefined, kind);
  }
  const sep = new RiskNode('L', 'T', 'sep');
  assert.strictEqual(sep.iconPath, undefined);
  const cmd = { command: 'qirova.showQday', title: 'Show Q-Day' };
  const action = new RiskNode('L', 'T', 'action', cmd);
  assert.strictEqual(action.command, cmd);
});

test('risk: live forecast and gnn rows render for worst riser', async () => {
  const p = new RiskProvider({
    getRisk: async () => ({
      qday: { p5: 2030, p50: 2035, p95: 2045, probability: 0.5 },
      risers: [{ name: 'RSA-2048', qars: 0.91, tier: 'CRITICAL' }],
    }),
    getForecast: async (algorithm) => {
      assert.strictEqual(algorithm, 'RSA-2048');
      return { metadata: { forecast: [80, 84, 88], forecast_last: 88 } };
    },
    getGnn: async (algorithm) => {
      assert.strictEqual(algorithm, 'RSA-2048');
      return { metadata: { algorithm_id: 'RSA-2048', propagation_score: 91 } };
    },
  });
  await p.refresh();
  const kids = p.getChildren();
  const labels = labelsOf(kids);
  assert.deepStrictEqual(labels, [
    'Q-Day P5: 2030',
    'Q-Day P50: 2035',
    'Q-Day P95: 2045',
    'P(exposure by P50): 50%',
    SEP,
    'RSA-2048  QARS 0.91 [CRITICAL]',
    'Forecast RSA-2048 P30: 88',
    'GNN cascade: 91',
    SEP,
    '\u25b6 Run Monte Carlo',
    '\u2912 Export CBOM',
    'Show Q-Day',
  ]);
  assert.ok(!labels.some((l) => l.includes('Gateway offline')));
  const fc = kids[labels.indexOf('Forecast RSA-2048 P30: 88')];
  assert.strictEqual(fc.iconPath.id, 'warning');
  assert.strictEqual(fc.contextValue, 'risk-item');
  const gn = kids[labels.indexOf('GNN cascade: 91')];
  assert.strictEqual(gn.iconPath.id, 'pass');
  assert.strictEqual(gn.contextValue, 'risk-item');
  assert.deepStrictEqual(
    kids.slice(-3).map((n) => n.command.command),
    ['qirova.runMonteCarlo', 'qirova.exportCbom', 'qirova.showQday']
  );
});

// ---------------------------------------------------------------------------
// C) out/complianceProvider.js
// ---------------------------------------------------------------------------

test('compliance: seven frameworks are listed', () => {
  const p = new ComplianceProvider({});
  const kids = p.getChildren();
  assert.strictEqual(kids.length, 7);
  const labels = labelsOf(kids);
  assert.ok(labels.includes('NIST FIPS 203 (ML-KEM)'));
  assert.ok(labels.includes('CNSA 2.0 timeline'));
  assert.ok(labels.includes('CERT-In 8 elements'));
  assert.ok(labels.includes('DPDP \u00a78(4) \u20b9250cr cap'));
  assert.ok(labels.includes('BSI TR-02102'));
  assert.strictEqual(p.getTreeItem(kids[0]), kids[0]);
});

test('compliance: node props and per-state icons', () => {
  const expected = {
    'NIST FIPS 203 (ML-KEM)': { state: 'PARTIAL', icon: 'alert' },
    'NIST FIPS 204 (ML-DSA)': { state: 'GAP', icon: 'warning' },
    'CNSA 2.0 timeline': { state: 'AT RISK', icon: 'warning' },
    'CERT-In 8 elements': { state: '5/8', icon: 'pass' },
    'DPDP \u00a78(4) \u20b9250cr cap': { state: 'OPEN', icon: 'warning' },
    'NIST SP 800-131A Rev. 2': { state: 'PARTIAL', icon: 'alert' },
    'BSI TR-02102': { state: 'PARTIAL', icon: 'alert' },
  };
  const kids = new ComplianceProvider({}).getChildren();
  for (const n of kids) {
    const e = expected[n.label];
    assert.ok(e, `unexpected framework ${n.label}`);
    assert.strictEqual(n.description, e.state);
    assert.strictEqual(n.contextValue, 'compliance');
    assert.ok(n.tooltip.includes(`State: ${e.state}`), n.tooltip);
    assert.ok(n.tooltip.includes('Gap:'), n.tooltip);
    assert.strictEqual(n.iconPath.id, e.icon, n.label);
  }
  assert.strictEqual(kids[0].tooltip, 'State: PARTIAL\nGap: RSA-2048 still in prod');
});

test('compliance: unknown framework node falls through to pass icon', () => {
  const n = new ComplianceNode(undefined);
  assert.strictEqual(n.label, 'Unknown framework');
  assert.strictEqual(n.description, 'UNKNOWN');
  assert.strictEqual(n.contextValue, 'compliance');
  assert.ok(n.tooltip.includes('State: UNKNOWN'));
  assert.ok(n.tooltip.includes('Gap: n/a'));
  assert.strictEqual(n.iconPath.id, 'pass');
});

// ---------------------------------------------------------------------------
// D) out/threatProvider.js
// ---------------------------------------------------------------------------

test('threat: four threat items with descriptions, tooltips and icons', () => {
  const ctx = makeContext();
  try {
    const p = new ThreatProvider({}, ctx);
    assert.strictEqual(ctx.subscriptions.length, 1, 'interval disposer pushed');
    const kids = p.getChildren();
    assert.strictEqual(kids.length, 4);
    const labels = labelsOf(kids);
    assert.ok(labels.includes('CISA KEV: CVE-2024-3094 (XZ Utils)'));
    assert.ok(labels.includes('NVD: CVE-2025-31885 (OpenSSL AES-GCM nonce reuse)'));
    const sinces = ['2026-04-01', '2026-06-12', 'live', '2026-08-19'];
    kids.forEach((n, i) => {
      assert.strictEqual(n.contextValue, 'threat');
      assert.strictEqual(n.description, sinces[i]);
      assert.ok(n.tooltip.includes('Discovered:'), n.tooltip);
      assert.ok(n.tooltip.includes(sinces[i]), n.tooltip);
    });
    assert.strictEqual(kids[0].iconPath.id, 'flame');
    assert.strictEqual(kids[1].iconPath.id, 'flame');
    assert.strictEqual(kids[2].iconPath.id, 'eye');
    assert.strictEqual(kids[3].iconPath.id, 'eye');
    assert.strictEqual(p.getTreeItem(kids[0]), kids[0]);
  } finally {
    disposeContext(ctx);
  }
});

test('threat: ThreatNode defaults for empty and null items', () => {
  const empty = new ThreatNode({});
  assert.strictEqual(empty.label, 'Threat');
  assert.strictEqual(empty.description, '');
  assert.ok(empty.tooltip.includes('Discovered: unknown'));
  assert.strictEqual(empty.contextValue, 'threat');
  assert.strictEqual(empty.iconPath.id, 'eye');

  const nul = new ThreatNode(null);
  assert.strictEqual(nul.label, 'Threat');
  assert.strictEqual(nul.description, '');
  assert.ok(nul.tooltip.includes('Discovered: unknown'));
  assert.strictEqual(nul.contextValue, 'threat');
  assert.strictEqual(nul.iconPath.id, 'eye');
});

// ---------------------------------------------------------------------------
// E) out/statusBar.js
// ---------------------------------------------------------------------------

test('statusbar: constructor creates four wired items', () => {
  const m = new StatusBarManager();
  assert.strictEqual(vscode.__state.statusBarItems.length, 4);
  const file = itemBy(FILE_CMD);
  const ws = itemBy(WS_CMD);
  const qday = itemBy(QDAY_CMD);
  const badge = itemBy(BADGE_CMD);
  assert.ok(file && ws && qday && badge, 'all four items present');
  assert.strictEqual(file.command, 'qirova.runMonteCarlo');
  assert.strictEqual(ws.command, 'qirova.scanWorkspace');
  assert.strictEqual(qday.command, 'qirova.showQday');
  assert.strictEqual(badge.command, 'qirova.openConsole');
  assert.strictEqual(file.tooltip, 'Per-file PQC Readiness Score');
  assert.strictEqual(qday.tooltip, `Q-Day P50 (median CRQC horizon) ${EM} click for details`);
  assert.strictEqual(file._visible, false);
});

test('statusbar: start() shows score+qday items and MOCK badge', () => {
  const m = new StatusBarManager();
  m.start();
  const file = itemBy(FILE_CMD);
  const ws = itemBy(WS_CMD);
  const qday = itemBy(QDAY_CMD);
  const badge = itemBy(BADGE_CMD);
  assert.strictEqual(file._visible, true);
  assert.strictEqual(ws._visible, true);
  assert.strictEqual(qday._visible, true);
  const t = 2038 - YEAR;
  assert.strictEqual(qday.text, `Q-Day P50: 2038 (T-${t > 0 ? t : 'NOW'})`);
  assert.strictEqual(qday.backgroundColor.id, 'statusBarItem.warningBackground');
  assert.ok(qday.tooltip.includes('(mock)'));
  assert.strictEqual(badge._visible, true);
  assert.strictEqual(badge.text, 'MOCK');
  assert.strictEqual(badge.backgroundColor.id, 'statusBarItem.warningBackground');
  assert.strictEqual(badge.tooltip, `QIROVA gateway connection ${EM} click to open workbench`);
  m.dispose();
});

test('statusbar: config can hide score items and the qday item', () => {
  vscode.__setConfig('ecdat.statusBar.score', false);
  const a = new StatusBarManager();
  a.start();
  assert.strictEqual(itemBy(FILE_CMD)._visible, false);
  assert.strictEqual(itemBy(WS_CMD)._visible, false);
  assert.strictEqual(itemBy(QDAY_CMD)._visible, true);
  a.dispose();

  vscode.__setConfig('ecdat.statusBar.score', true);
  vscode.__setConfig('ecdat.statusBar.qday', false);
  const b = new StatusBarManager();
  b.start();
  assert.strictEqual(itemBy(FILE_CMD)._visible, true);
  assert.strictEqual(itemBy(WS_CMD)._visible, true);
  assert.strictEqual(itemBy(QDAY_CMD)._visible, false);
  b.dispose();
});

test('statusbar: setConnected(true) fetches p50 and applies severity bands', async () => {
  const m = new StatusBarManager();
  m.start();
  const calls = [];
  const cases = [
    { year: YEAR + 3, text: `Q-Day P50: ${YEAR + 3} (T-3)`, bg: 'statusBarItem.errorBackground', tip: `Q-Day P50: ${YEAR + 3} \u2014 3 years left \u2014 click for details` },
    { year: YEAR + 8, text: `Q-Day P50: ${YEAR + 8} (T-8)`, bg: 'statusBarItem.warningBackground', tip: `Q-Day P50: ${YEAR + 8} \u2014 8 years left \u2014 click for details` },
    { year: YEAR + 20, text: `Q-Day P50: ${YEAR + 20} (T-20)`, bg: 'statusBarItem.successBackground', tip: `Q-Day P50: ${YEAR + 20} \u2014 20 years left \u2014 click for details` },
    { year: YEAR, text: `Q-Day P50: ${YEAR} (T-NOW)`, bg: 'statusBarItem.errorBackground', tip: `Q-Day P50: ${YEAR} \u2014 CRITICAL: quantum threat imminent \u2014 click for details` },
  ];
  try {
    for (const c of cases) {
      global.fetch = async (url, opts) => {
        calls.push({ url, opts });
        return { ok: true, json: async () => ({ percentiles: { p50: c.year } }) };
      };
      m.setConnected(true);
      await tick();
      const qday = itemBy(QDAY_CMD);
      assert.strictEqual(qday.text, c.text);
      assert.strictEqual(qday.backgroundColor.id, c.bg);
      assert.strictEqual(qday.tooltip, c.tip);
    }
    assert.strictEqual(calls[0].url, 'http://localhost:8000/api/v1/risk/monte-carlo');
    assert.strictEqual(calls[0].opts.method, 'POST');
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { iterations: 10000 });
    const badge = itemBy(BADGE_CMD);
    assert.strictEqual(badge.text, 'LIVE');
    assert.strictEqual(badge.backgroundColor.id, 'statusBarItem.successBackground');
    assert.strictEqual(badge.tooltip, `QIROVA gateway connected ${EM} click to open workbench`);
  } finally {
    global.fetch = REAL_FETCH;
    m.dispose();
  }
});

test('statusbar: non-ok fetch response leaves qday text unchanged', async () => {
  const m = new StatusBarManager();
  m.start();
  const before = itemBy(QDAY_CMD).text;
  try {
    global.fetch = async () => ({ ok: false });
    m.setConnected(true);
    await tick();
    assert.strictEqual(itemBy(QDAY_CMD).text, before);
  } finally {
    global.fetch = REAL_FETCH;
    m.dispose();
  }
});

test('statusbar: fetch rejection falls back to mock qday', async () => {
  const m = new StatusBarManager();
  m.start();
  try {
    global.fetch = async () => { throw new Error('offline'); };
    m.setConnected(true);
    await tick();
    const qday = itemBy(QDAY_CMD);
    const t = 2038 - YEAR;
    assert.strictEqual(qday.text, `Q-Day P50: 2038 (T-${t > 0 ? t : 'NOW'})`);
    assert.strictEqual(qday.backgroundColor.id, 'statusBarItem.warningBackground');
    assert.strictEqual(qday.tooltip, `Q-Day P50: 2038 (mock) ${EM} click for details`);
  } finally {
    global.fetch = REAL_FETCH;
    m.dispose();
  }
});

test('statusbar: top-level p50 used when percentiles key is absent', async () => {
  const m = new StatusBarManager();
  m.start();
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ p50: YEAR + 10 }) });
    m.setConnected(true);
    await tick();
    const qday = itemBy(QDAY_CMD);
    assert.strictEqual(qday.text, `Q-Day P50: ${YEAR + 10} (T-10)`);
    assert.strictEqual(qday.backgroundColor.id, 'statusBarItem.warningBackground');
  } finally {
    global.fetch = REAL_FETCH;
    m.dispose();
  }
});

test('statusbar: non-numeric p50 is ignored', async () => {
  const m = new StatusBarManager();
  m.start();
  const before = itemBy(QDAY_CMD).text;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ percentiles: { p50: 'soon' } }) });
    m.setConnected(true);
    await tick();
    assert.strictEqual(itemBy(QDAY_CMD).text, before);
  } finally {
    global.fetch = REAL_FETCH;
    m.dispose();
  }
});

test('statusbar: later failing fetch reuses the cached p50 year', async () => {
  const m = new StatusBarManager();
  m.start();
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ percentiles: { p50: YEAR + 6 } }) });
    m.setConnected(true);
    await tick();
    assert.strictEqual(itemBy(QDAY_CMD).text, `Q-Day P50: ${YEAR + 6} (T-6)`);

    global.fetch = async () => { throw new Error('offline'); };
    m.setConnected(true);
    await tick();
    let qday = itemBy(QDAY_CMD);
    assert.strictEqual(qday.text, `Q-Day P50: ${YEAR + 6} (T-6)`, 'cached year, not 2038');
    assert.strictEqual(qday.backgroundColor.id, 'statusBarItem.warningBackground');
    assert.ok(qday.tooltip.includes('(mock)'));
    assert.ok(!qday.text.includes('2038'));

    global.fetch = async () => ({ ok: true, json: async () => ({ percentiles: { p50: YEAR } }) });
    m.setConnected(true);
    await tick();
    assert.strictEqual(itemBy(QDAY_CMD).text, `Q-Day P50: ${YEAR} (T-NOW)`);

    global.fetch = async () => { throw new Error('offline'); };
    m.setConnected(true);
    await tick();
    qday = itemBy(QDAY_CMD);
    assert.strictEqual(qday.text, `Q-Day P50: ${YEAR} (T-NOW)`, 'mock fallback uses cached NOW year');
    assert.ok(qday.tooltip.includes('(mock)'));
  } finally {
    global.fetch = REAL_FETCH;
    m.dispose();
  }
});

test('statusbar: setConnected(false) returns badge to MOCK', async () => {
  const m = new StatusBarManager();
  m.start();
  m.setConnected(false);
  await tick();
  const badge = itemBy(BADGE_CMD);
  assert.strictEqual(badge.text, 'MOCK');
  assert.strictEqual(badge.backgroundColor.id, 'statusBarItem.warningBackground');
  assert.strictEqual(badge.tooltip, `QIROVA gateway unreachable ${EM} running in MOCK mode`);
  const qday = itemBy(QDAY_CMD);
  assert.ok(qday.tooltip.includes('(mock)'));
  assert.strictEqual(qday.backgroundColor.id, 'statusBarItem.warningBackground');
  m.dispose();
});

test('statusbar: non-file scheme documents report PQC - no file', () => {
  const m = new StatusBarManager();
  const doc = new vscode.__TextDocument(vscode.Uri.parse('untitled:1'), 'md5', 'python');
  m.updateFileScore(doc);
  assert.strictEqual(itemBy(FILE_CMD).text, 'PQC - no file');
  m.dispose();
});

test('statusbar: file and workspace scores after scanning two files', () => {
  const m = new StatusBarManager();
  const cleanDoc = vdoc('alpha', SAMPLES.pythonClean);
  const weakDoc = vdoc('beta', 'h = hashlib.md5(data)');
  m.updateFileScore(cleanDoc);
  assert.strictEqual(itemBy(FILE_CMD).text, 'PQC 100/100');
  assert.strictEqual(itemBy(FILE_CMD).color.id, 'charts.green');
  assert.ok(itemBy(FILE_CMD).tooltip.includes('PQC Readiness:'));
  assert.ok(itemBy(FILE_CMD).tooltip.includes('worst: CLEAN'));
  assert.ok(itemBy(FILE_CMD).tooltip.includes('0 findings'));

  m.updateFileScore(weakDoc);
  const file = itemBy(FILE_CMD);
  assert.strictEqual(file.text, 'PQC 60/100');
  assert.strictEqual(file.color.id, 'charts.yellow');
  assert.ok(file.tooltip.includes('PQC Readiness:'));
  assert.ok(file.tooltip.includes('worst: MD5'));
  assert.ok(file.tooltip.includes('finding'));

  const scoreA = 100;
  const scoreB = 60;
  const ws = itemBy(WS_CMD);
  assert.strictEqual(ws.text, `WS ${Math.round((scoreA + scoreB) / 2)}/100`);
  assert.ok(ws.tooltip.includes(`Workspace avg: ${Math.round((scoreA + scoreB) / 2)}/100`));
  assert.ok(ws.tooltip.includes('across 2 scanned file(s)'));
  m.dispose();
});

test('statusbar: score color bands green/yellow/red', () => {
  const m = new StatusBarManager();
  const green = vdoc('green', SAMPLES.pythonClean);
  m.updateFileScore(green);
  assert.strictEqual(itemBy(FILE_CMD).text, 'PQC 100/100');
  assert.strictEqual(itemBy(FILE_CMD).color.id, 'charts.green');

  const yellow = vdoc('yellow', 'h = hashlib.md5(data)');
  m.updateFileScore(yellow);
  assert.strictEqual(itemBy(FILE_CMD).text, 'PQC 60/100');
  assert.strictEqual(itemBy(FILE_CMD).color.id, 'charts.yellow');

  const red = vdoc('red', SAMPLES.pythonVulnerable);
  m.updateFileScore(red);
  const file = itemBy(FILE_CMD);
  assert.match(file.text, /^PQC \d+\/100$/);
  assert.strictEqual(file.color.id, 'charts.red');
  assert.ok(file.tooltip.includes('worst:'), file.tooltip);
  assert.ok(file.tooltip.includes('findings'));
  m.dispose();
});

test('statusbar: cache hits, version bumps and stale entry expiry', () => {
  const m = new StatusBarManager();
  const doc = vdoc('cached', 'h = hashlib.md5(data)');
  m.updateFileScore(doc);
  const file = itemBy(FILE_CMD);
  assert.strictEqual(file.text, 'PQC 60/100');

  doc._text = SAMPLES.pythonClean;
  m.updateFileScore(doc);
  assert.strictEqual(file.text, 'PQC 60/100', 'same fsPath+version served from cache');

  doc.version = 2;
  m.updateFileScore(doc);
  assert.strictEqual(file.text, 'PQC 100/100', 'version bump rescans');

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 31000;
    doc._text = 'h = hashlib.md5(data)';
    m.updateFileScore(doc);
    assert.strictEqual(file.text, 'PQC 60/100', 'expired cache entry rescanned');
  } finally {
    Date.now = realNow;
    m.dispose();
  }
});

test('statusbar: scanning a new version drops the older cache key for that path', () => {
  const m = new StatusBarManager();
  const doc = vdoc('versions', 'h = hashlib.md5(data)');
  m.updateFileScore(doc);
  const ws = itemBy(WS_CMD);
  const countV1 = scannedCount(ws);
  assert.strictEqual(itemBy(FILE_CMD).text, 'PQC 60/100');

  doc.version = 2;
  doc._text = SAMPLES.pythonClean;
  m.updateFileScore(doc);
  assert.strictEqual(itemBy(FILE_CMD).text, 'PQC 100/100');
  assert.strictEqual(scannedCount(ws), countV1, 'older version key removed for same fsPath');
  m.dispose();
});

test('statusbar: showQdayDetail routes each message response to a command', async () => {
  const m = new StatusBarManager();

  vscode.__state.messageResponse = 'Run Simulation';
  m.showQdayDetail();
  await tick();
  assert.ok(vscode.__state.executed.some((e) => e.id === 'qirova.runMonteCarlo'));
  assert.ok(!vscode.__state.executed.some((e) => e.id === 'qirova.openConsole'));
  assert.ok(vscode.__allMessages().some((s) => s.startsWith('Q-Day P50 (median expectation)')));

  vscode.__state.messageResponse = 'Open Workbench';
  m.showQdayDetail();
  await tick();
  assert.ok(vscode.__state.executed.some((e) => e.id === 'qirova.openConsole'));

  vscode.__state.messageResponse = undefined;
  vscode.__state.executed.length = 0;
  m.showQdayDetail();
  await tick();
  assert.strictEqual(vscode.__state.executed.length, 0);
  m.dispose();
});

test('statusbar: dispose removes all four items', () => {
  const m = new StatusBarManager();
  assert.strictEqual(vscode.__state.statusBarItems.length, 4);
  m.dispose();
  assert.strictEqual(vscode.__state.statusBarItems.length, 0);
});
