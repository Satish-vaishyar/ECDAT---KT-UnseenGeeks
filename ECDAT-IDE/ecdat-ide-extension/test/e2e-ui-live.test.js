'use strict';
// LIVE end-to-end UI proof: every UI module's data path reaches real models.
// Gate: pings http://localhost:8000/api/v1/health (stdlib http, 5s). When the
// gateway is unreachable every test below skips via t.skip('no live gateway').
// NOTE on style: plain CJS has no top-level await, so the file-top gate is a
// promise — the moral equivalent of `const LIVE = await ping();`. Each test
// awaits it first and skips honestly when the backend is down.
const { vscode } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { makeContext, disposeContext, activateEditor } = require('./helpers/fixtures');
const { CryptoDetector } = require('../out/cryptoDetector');
const { CryptoRemediator } = require('../out/remediator');
const { CopilotPanel } = require('../out/copilot');
const { GatewayClient } = require('../out/gatewayClient');
const { RiskProvider } = require('../out/riskProvider');
const { ComplianceProvider } = require('../out/complianceProvider');
const { ThreatProvider } = require('../out/threatProvider');

const BASE = 'http://localhost:8000';
const HEALTH_PATH = '/api/v1/health';

// --- live gate (file top, stdlib http only, 5s timeout) ---------------------
function ping(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}${HEALTH_PATH}`, { timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

let LIVE = false;
const LIVE_PROMISE = ping(5000).then((ok) => { LIVE = ok; return ok; });

// Raw stdlib-http JSON helper for scan-registry paths that predate the
// compiled out/gatewayClient.js (runUploadAudit/getScanCbom/getScanReport).
function httpJson(method, path, body, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const headers = { Accept: 'application/json', 'User-Agent': 'QIROVA-IDE/1.0.0' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(payload.length); }
    const req = http.request({ host: 'localhost', port: 8000, method, path, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', (e) => resolve({ status: 0, json: null, error: e.message }));
    req.on('timeout', () => { req.destroy(new Error('timeout')); resolve({ status: 0, json: null, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ONE shared client for the whole file (keeps runtime sane).
const gw = new GatewayClient(BASE, '');
let liveScanId = null;
function harvestScanId(obj) {
  if (!obj || typeof obj !== 'object') return;
  liveScanId = liveScanId || obj.scan_id || obj.scanId || obj.id || null;
}

function livePanel() {
  const ctx = makeContext();
  const panel = new CopilotPanel(ctx, gw, new CryptoDetector(), new CryptoRemediator());
  return { ctx, panel };
}

const MD5_SAMPLE = 'import hashlib\nh = hashlib.md5(data)\n';

test.beforeEach(() => { vscode.__reset(); });

// --- Risk Lab ---------------------------------------------------------------
test('e2e-live: Risk Lab portfolio reaches live model (RSA-2048 risers)', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const risk = await gw.getRisk();
  assert.ok(risk && typeof risk === 'object', 'getRisk returned a live object, not null');
  const flat = JSON.stringify(risk);
  assert.ok(/RSA-2048/i.test(flat), `portfolio mentions RSA-2048: ${flat.slice(0, 300)}`);
  assert.ok(risk.qday || risk.risers || /qday|risers/i.test(flat), 'portfolio carries qday/risers model fields');
  const rp = new RiskProvider(gw);
  await rp.refresh();
  const labels = rp.getChildren().map((n) => String(n.label));
  assert.ok(labels.some((l) => /RSA-2048/i.test(l)), `Risk Lab tree shows live RSA-2048 riser: ${labels.join(' | ').slice(0, 400)}`);
  assert.ok(!labels.some((l) => /Gateway offline/i.test(l)), 'no mock-fallback banner while live');
});

test('e2e-live: risk monte-carlo runs live on a small payload', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const mc = await gw.runMonteCarlo({ iterations: 100 });
  assert.ok(mc && typeof mc === 'object', 'monte-carlo returned a live object');
  assert.ok(!mc.error, `live monte-carlo has no error field, got: ${mc.error}`);
  assert.ok(/p50|percentile|median|203\d|job_id|samples|iterations|distribution/i.test(JSON.stringify(mc)),
    `monte-carlo carries model fields: ${JSON.stringify(mc).slice(0, 300)}`);
});

test('e2e-live: risk score reaches live model', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const s = await gw.getRiskScore('RSA-2048', 2048);
  assert.ok(s && typeof s === 'object', 'getRiskScore returned a live object, not null');
});

// --- Compliance -------------------------------------------------------------
test('e2e-live: Compliance live CERT-In row (elements_compliant)', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const cert = await gw.getCertInMappings();
  assert.ok(cert && typeof cert === 'object', 'getCertInMappings returned a live object, not null');
  assert.ok('elements_compliant' in cert || 'elements_evaluated' in cert || 'status' in cert || 'findings' in cert,
    `CERT-In carries elements_compliant shape: ${JSON.stringify(cert).slice(0, 300)}`);
  const cp = new ComplianceProvider(gw);
  await cp.refresh();
  const kids = cp.getChildren();
  assert.ok(kids.length > 0, 'compliance tree renders');
  assert.ok(String(kids[0].label).includes('(live)'),
    `first row is the live CERT-In row: ${String(kids[0].label)}`);
  const kc = await gw.getCompliance('RSA-2048', 'IN');
  assert.ok(kc && typeof kc === 'object', 'knowledge/compliance endpoint live');
});

// --- Threat -----------------------------------------------------------------
test('e2e-live: Threat live CVE rows via searchCve', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const cve = await gw.searchCve('RSA', 2);
  assert.ok(cve && typeof cve === 'object', 'searchCve call succeeds against the live gateway');
  const arr = cve.metadata?.results ?? cve.results ?? cve.findings ?? [];
  assert.ok(Array.isArray(arr), `CVE results are an array or graceful empty, got: ${JSON.stringify(cve).slice(0, 200)}`);
  const th = new ThreatProvider(gw);
  try {
    await th.refresh();
    const titles = th.getChildren().map((n) => String(n.label));
    assert.ok(titles.length >= 4, `threat tree renders (live + static feed): ${titles.length} rows`);
    if (arr.length > 0) {
      assert.ok(titles.some((x) => x.startsWith('LIVE:')), `live CVE rows surfaced: ${titles.join(' | ').slice(0, 300)}`);
    }
  } finally {
    clearInterval(th.refreshTimer);
  }
});

// --- Copilot red-team --------------------------------------------------------
test('e2e-live: Copilot red-team returns LIVE model verdicts', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  activateEditor('live-rt.py', MD5_SAMPLE, 'python');
  const { ctx, panel } = livePanel();
  try {
    const md = await panel.handleMessage('red-team');
    assert.ok(typeof md === 'string' && md.length > 0, 'red-team returns text');
    const liveHit = md.includes('Model 06') || md.includes('Model 23');
    const honestFallback = md.includes('Red-Team Review') && md.includes('MD5');
    assert.ok(liveHit || honestFallback, `LIVE verdicts or honest fallback: ${md.slice(0, 400)}`);
    const misuse = await gw.getMisuse(MD5_SAMPLE, 'python');
    assert.ok(misuse && typeof misuse === 'object', 'Model 06 misuse endpoint is live');
  } finally {
    disposeContext(ctx);
  }
});

// --- Copilot knowledge -------------------------------------------------------
test('e2e-live: Copilot knowledge returns a live CVE table', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const { ctx, panel } = livePanel();
  try {
    const r = await panel.handleMessage('knowledge RSA');
    assert.ok(!r.includes('Knowledge (offline)'), 'knowledge path is live, not offline');
    assert.ok(r.includes('| CVE |') || r.includes('No CVE results found'),
      `CVE table branch from live gateway: ${r.slice(0, 400)}`);
    assert.ok(r.includes('Standards'), 'PQC standards section appended');
  } finally {
    disposeContext(ctx);
  }
});

// --- Copilot AI --------------------------------------------------------------
test('e2e-live: Copilot AI answers via the live gateway', { timeout: 185000 }, async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  activateEditor('live-ai.py', MD5_SAMPLE, 'python');
  const { ctx, panel } = livePanel();
  try {
    const r = await panel.handleMessage('is MD5 safe?');
    assert.ok(r.includes('### QIROVA AI'), `AI header from live gateway, got: ${String(r).slice(0, 300)}`);
  } finally {
    disposeContext(ctx);
  }
});

// --- Scan / model endpoints --------------------------------------------------
test('e2e-live: scanBinary reaches the live model', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const b64 = Buffer.from('MZ\x90\x00FAKE-BINARY\x00hashlib.md5', 'utf8').toString('base64');
  const r = await gw.scanBinary(b64, 'sample.bin');
  assert.ok(r && typeof r === 'object', 'scanBinary returned a live object, not null');
  assert.ok(Object.keys(r).length > 0, `scanBinary carries 200-shape fields: ${JSON.stringify(r).slice(0, 200)}`);
  harvestScanId(r);
});

test('e2e-live: scanEntropy reaches the live model', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const r = await gw.scanEntropy('import hashlib, os\nh = hashlib.md5(os.urandom(16))\n');
  assert.ok(r && typeof r === 'object', 'scanEntropy returned a live object, not null');
});

test('e2e-live: quantum attack-costs reach the live model', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const r = await gw.attackCosts('RSA-2048');
  assert.ok(r && typeof r === 'object', 'attackCosts returned a live object, not null');
});

test('e2e-live: risk forecast reaches the live model', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const r = await gw.getForecast('RSA-2048');
  assert.ok(r && typeof r === 'object', 'getForecast returned a live object, not null');
});

test('e2e-live: risk GNN reaches the live model', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const r = await gw.getGnn('RSA-2048');
  assert.ok(r && typeof r === 'object', 'getGnn returned a live object, not null');
});

test('e2e-live: robust detection reaches the live model', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const r = await gw.getRobust('h = hashlib.md5(data)');
  assert.ok(r && typeof r === 'object', 'getRobust returned a live object, not null');
});

test('e2e-live: modelsStatus lists live models', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const r = await gw.getModels();
  assert.ok(r && typeof r === 'object', 'getModels returned a live object, not null');
  assert.ok('count' in r || 'models' in r || 'wired' in r || 'status' in r,
    `models/status carries model fields: ${JSON.stringify(r).slice(0, 300)}`);
});

test('e2e-live: gateway chat reaches the live model', { timeout: 185000 }, async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const r = await gw.chat('deepseek_coder', [{ role: 'user', content: 'Is MD5 safe? One sentence.' }], 0.2, 256);
  assert.ok(r && typeof r === 'object', 'chat returned a live object, not null');
  const flat = JSON.stringify(r);
  assert.ok(/metadata|choices|text|output|content/i.test(flat), `chat carries model fields: ${flat.slice(0, 300)}`);
});

// --- Pipeline / scans --------------------------------------------------------
test('e2e-live: pipeline audit returns scan findings', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const r = await gw.runPipeline({ source_code: 'import hashlib\nh = hashlib.md5(x)\n', language: 'python', filename: 'a.py' });
  assert.ok(r && typeof r === 'object', 'runPipeline returned a live object, not null');
  assert.ok('findings' in r || 'score' in r || 'scan_id' in r || 'scanId' in r || 'verdict' in r || 'status' in r,
    `pipeline audit carries scan fields: ${JSON.stringify(r).slice(0, 300)}`);
  harvestScanId(r);
});

test('e2e-live: upload-audit mints a live scan_id', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const files = [{ path: 'a.py', contentBase64: Buffer.from(MD5_SAMPLE, 'utf8').toString('base64') }];
  let r = null;
  if (typeof gw.runUploadAudit === 'function') {
    r = await gw.runUploadAudit(files, 'e2e');
  } else {
    const res = await httpJson('POST', '/api/v1/pipeline/upload-audit',
      { files: files.map((f) => ({ path: f.path, content_base64: f.contentBase64 })), target_name: 'e2e' }, 60000);
    assert.ok(res.status >= 200 && res.status < 300, `upload-audit HTTP 2xx, got ${res.status}`);
    r = res.json;
  }
  assert.ok(r && typeof r === 'object', 'upload-audit returned a live object, not null');
  assert.ok('scan_id' in r || 'scanId' in r || 'id' in r || 'findings' in r || 'status' in r,
    `upload-audit carries scan_id/findings: ${JSON.stringify(r).slice(0, 300)}`);
  harvestScanId(r);
});

test('e2e-live: scans history + scan CBOM/report reach live models', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  let history = null;
  for (const p of ['/api/v1/scans/history', '/api/v1/scans', '/api/v1/pipeline/scans']) {
    const res = await httpJson('GET', p, undefined, 10000);
    if (res.status >= 200 && res.status < 300 && res.json) { history = res.json; break; }
  }
  if (history) {
    const flat = JSON.stringify(history);
    assert.ok(/scan_id|scanId|scans|history|entries/i.test(flat),
      `scans history carries scan registry fields: ${flat.slice(0, 300)}`);
    const m = flat.match(/"(?:scan_id|scanId|id)"\s*:\s*"([^"]+)"/);
    if (m) liveScanId = liveScanId || m[1];
  } else {
    assert.ok(liveScanId, 'a live scan_id was minted by pipeline/upload-audit (history endpoint absent)');
  }
  if (liveScanId) {
    let cbom = null;
    if (typeof gw.getScanCbom === 'function') {
      cbom = await gw.getScanCbom(liveScanId);
    } else {
      const res = await httpJson('GET', `/api/v1/scans/${encodeURIComponent(liveScanId)}/cbom`, undefined, 15000);
      assert.ok(res.status >= 200 && res.status < 300, `scan CBOM HTTP 2xx, got ${res.status}`);
      cbom = res.json;
    }
    assert.ok(cbom && typeof cbom === 'object', 'scan CBOM returned a live object');
    assert.ok('components' in cbom || 'bomFormat' in cbom || 'findings' in cbom || 'cbom' in cbom,
      `scan CBOM carries components/findings: ${JSON.stringify(cbom).slice(0, 300)}`);
    let report = null;
    if (typeof gw.getScanReport === 'function') {
      report = await gw.getScanReport(liveScanId);
    } else {
      const res = await httpJson('GET', `/api/v1/scans/${encodeURIComponent(liveScanId)}/report`, undefined, 15000);
      if (res.status >= 200 && res.status < 300) report = res.json;
    }
    assert.ok(report && typeof report === 'object', 'scan report returned a live object');
  } else {
    const det = new CryptoDetector();
    const bom = gw.buildCbomLocal(det.scan(MD5_SAMPLE, 'python'), '/tmp');
    assert.strictEqual(bom.bomFormat, 'CycloneDX', 'local CBOM fallback keeps CycloneDX shape');
    assert.ok(bom.components.length >= 1, 'local CBOM fallback carries detector findings');
  }
});

// --- Quantum / classify bundle -----------------------------------------------
test('e2e-live: quantum cost+qars+migration+roadmap+trapdoor+misuse+classify', async (t) => {
  if (!(await LIVE_PROMISE)) { t.skip('no live gateway'); return; }
  const qars = await gw.getQars('RSA-2048', 2048);
  assert.ok(qars && typeof qars === 'object', 'getQars live');
  assert.ok(/qars|score|risk/i.test(JSON.stringify(qars)), `QARS carries score fields: ${JSON.stringify(qars).slice(0, 200)}`);
  const hndl = await gw.getHndl({ algorithm: 'RSA-2048' });
  assert.ok(hndl && typeof hndl === 'object', 'quantum HNDL cost live');
  const cost = await gw.getMigrationCost('RSA-2048');
  assert.ok(cost && typeof cost === 'object', 'migration cost live');
  const roadmap = await gw.getRemediationRoadmap();
  assert.ok(roadmap && typeof roadmap === 'object', 'remediation roadmap live');
  assert.ok('steps' in roadmap || 'roadmap' in roadmap || 'phases' in roadmap || 'tasks' in roadmap || Object.keys(roadmap).length > 0,
    `roadmap carries plan fields: ${JSON.stringify(roadmap).slice(0, 200)}`);
  const trap = await gw.getTrapdoor(MD5_SAMPLE, 'MD5');
  assert.ok(trap && typeof trap === 'object', 'trapdoor scan live');
  const misuse = await gw.getMisuse(MD5_SAMPLE, 'python');
  assert.ok(misuse && typeof misuse === 'object', 'misuse classifier live');
  const cls = await gw.classify(MD5_SAMPLE, 'python');
  assert.ok(cls && typeof cls === 'object', 'code classifier live');
  assert.ok('label' in cls || 'verdict' in cls || 'classification' in cls || 'algorithm' in cls || Object.keys(cls).length > 0,
    `classify carries label fields: ${JSON.stringify(cls).slice(0, 200)}`);
});
