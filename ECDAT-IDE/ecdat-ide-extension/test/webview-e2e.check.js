'use strict';
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const { vscode } = require('D:/sih2/ecdat-ide-extension/test/helpers/setup');
const { makeContext, disposeContext } = require('D:/sih2/ecdat-ide-extension/test/helpers/fixtures');
const { CryptoDetector } = require('D:/sih2/ecdat-ide-extension/out/cryptoDetector');
const { CryptoRemediator } = require('D:/sih2/ecdat-ide-extension/out/remediator');
const { CopilotPanel } = require('D:/sih2/ecdat-ide-extension/out/copilot');

const ctx = makeContext();
const panel = new CopilotPanel(ctx, { ping: async () => false }, new CryptoDetector(), new CryptoRemediator());
const html = panel.getHtml();

const posted = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  beforeParse(window) {
    window.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) });
  },
});
const { document } = dom.window;
const q = (s, r) => (r || document).querySelector(s);
const qa = (s, r) => [...(r || document).querySelectorAll(s)];

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('ok -', name); }
  else { failures++; console.log('FAIL -', name, extra || ''); }
}

// 1) welcome rendered, input + send + quick buttons present
check('welcome', document.body.textContent.includes('QIROVA Copilot'));
check('quick buttons', qa('.quick-btn').length >= 6);
check('q-redteam button', qa('.quick-btn').some((b) => b.dataset.cmd === 'qred'));
check('no global leak / misclick styles', !!q('#input') && !!q('#send'));

// 2) send a chat, Thinking appears, chat posted out
q('#input').value = 'migrate';
q('#send').click();
check('thinking bubble', [...qa('.msg')].pop().textContent.includes('Thinking'));
check('chat posted', posted.length === 1 && posted[0].type === 'chat' && posted[0].text === 'migrate');

// 3) deliver a migrate response with hunks payload
const hunks = { file: 'C:/x/vuln.py', fileName: 'vuln.py', hunks: [
  { id: 'm0h0', algorithmId: 'md5', line: 4, oldLine: 'h = hashlib.md5(x)', newLine: 'h = hashlib.blake2b(x)', startChar: 4, endChar: 7, newText: 'blake2b', kind: 'fix', description: 'use blake2' },
  { id: 'm0h1', algorithmId: 'md5', line: 0, oldLine: '', newLine: 'import secrets', startChar: 0, endChar: 0, newText: 'import secrets\n', kind: 'import', description: 'Add import' },
]};
const payload = '<script type="application/json" class="qirova-hunks">' + JSON.stringify(hunks).replace(/</g, '\\u003c') + '</script>';
dom.window.dispatchMessage = null;
const evt = new dom.window.MessageEvent('message', { data: { type: 'response', response: '### PQC Migration Snippets\n\nReview below:\n' + payload } });
dom.window.dispatchEvent(evt);

check('mig box', qa('.mig').length === 1);
check('two hunk cards', qa('.hunk').length === 2);
check('accept-all button', qa('.mig-btn').some((b) => b.textContent === 'Accept All'));
check('red/green lines', qa('.old-line').length === 1 && qa('.new-line').length === 2);

// 4) Accept All posts all ids
posted.length = 0;
qa('.mig-btn').find((b) => b.textContent === 'Accept All').click();
check('applyHunks posted', posted.length === 1 && posted[0].type === 'applyHunks');
check('all ids sent', JSON.stringify(posted[0].ids) === JSON.stringify(['m0h0', 'm0h1']), JSON.stringify(posted[0].ids));

// 5) hunksApplied marks cards
dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'hunksApplied', file: 'C:/x/vuln.py', applied: ['m0h0'], skipped: [{ id: 'm0h1', reason: 'file changed' }] } }));
check('applied marked', qa('.hunk.applied').length === 1);
check('skip note', [...qa('.hunk-note')].some((n) => n.textContent.includes('file changed')));

// 6) scan-style markdown: stage table + blockquote render without errors
dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'response', response: '### Deep scan\n\n| | Stage |\n|---|---|\n| ok | Stage 1 |\n\n> note here' } }));
const tables = qa('table');
check('table rendered', tables.length >= 1 && tables[tables.length - 1].textContent.includes('Stage 1'));
check('blockquote rendered', qa('blockquote').length >= 1);

// 7) new theme tokens + bigger buttons in generated CSS
const styleText = qa('style').map((s) => s.textContent).join('\n');
check('vscode theme vars', styleText.includes('var(--vscode-button-background') && styleText.includes('var(--vscode-diffEditor-removedTextBackground'));
check('bigger quick buttons', styleText.includes('padding:6px 14px'));
check('readable code size', styleText.includes('font-size:12.5px'));

// 8) rich q-day card renders percentiles + bands
dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'response', response: '### Q-Day Monte Carlo (live)\n\n| Estimate | Value |\n|---|---|\n| **P50** | **2038** |\n| CI 95% | 2034 - 2045 |\n| Simulations | 100000 |' } }));
const lastTable = qa('table').pop();
check('qday table', lastTable.textContent.includes('2038') && lastTable.textContent.includes('2034 - 2045'));

// 9) no void: no 3+ <br> runs anywhere after table responses
const html2 = qa('.msg').map((m) => m.innerHTML).join('');
const runs = html2.match(/(<br>){3,}/g) || [];
check('no void gaps', runs.length === 0, runs.length + ' runs found');

// 10) black output cards separate prompt from output
const bodies = qa('.msg-body.assistant');
check('assistant card', bodies.length >= 1);
const userBodies = qa('.msg-body.user');
check('user distinct', userBodies.length >= 1);

// 11) animations present
const css = qa('style').map((s) => s.textContent).join('\n');
check('enter animation', css.includes('@keyframes qirova-in') && css.includes('prefers-reduced-motion'));
check('transitions', css.includes('transition:background-color'));

// 12) quantum circuit cards render collapsed with svg
const circuits = { file: 'redteam', fileName: 'Quantum circuits', circuits: [
  { id: 'c0', title: 'RSA-15 \u00b7 Shor (8 qubits)', svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' },
]};
const cPayload = '<script type="application/json" class="qirova-circuits">' + JSON.stringify(circuits).replace(/</g, '\\u003c') + '</script>';
dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'response', response: '### Quantum red-team campaign (LIVE)\n\n' + cPayload } }));
const qcBoxes = qa('.qc');
check('circuit box appears', qcBoxes.length === 1, qcBoxes.length + ' boxes');
const qcBox = qcBoxes[qcBoxes.length - 1];
check('circuit header', !!qcBox && qcBox.textContent.includes('Quantum circuit'), qcBox && qcBox.textContent.slice(0, 80));
check('circuit title', !!qcBox && qcBox.textContent.includes('RSA-15'), qcBox && qcBox.textContent.slice(0, 80));
const qcDet = qcBox && qcBox.querySelector('details.qc-details');
check('details collapsed', !!qcDet && qcDet.open === false);
check('summary label', !!qcDet && qcDet.querySelector('summary') && qcDet.querySelector('summary').textContent.includes('Show circuit'));
check('svg node present', !!qcBox && !!qcBox.querySelector('.qc-svg svg'));
check('circuit css', styleText.includes('.qc-svg') && styleText.includes('background:#ffffff') && styleText.includes('.qc-svg svg'));

// 13) single-column pseudo-tables render as lists, real tables stay tables
dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'response', response: 'Sources:\n\n| Knowledge Sources |\n| NVD (18K+ CVEs) |\n| CISA KEV |\n\n| A | B |\n|---|---|\n| 1 | 2 |' } }));
const lists = qa('ul');
check('single-col list', lists.length >= 1 && lists[lists.length - 1].textContent.includes('CISA KEV'));
const realTables = qa('table');
check('multi-col stays table', realTables.length >= 1);

// 14) ragged table: leading single-cell row becomes a caption, short rows padded
dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'response', response: '| Knowledge Sources |\n| NVD | CERT-In |\n| GitHub | CISA |' } }));
const caps = qa('.tbl-cap');
check('caption rendered', caps.length >= 1 && caps[caps.length - 1].textContent.includes('Knowledge Sources'));
const capTable = qa('table').pop();
const capCells = qa('td', capTable).length;
check('rows padded even', capCells % 2 === 0 && capCells >= 4, capCells + ' cells');

disposeContext(ctx);
console.log(failures === 0 ? 'WEBVIEW E2E PASS' : 'WEBVIEW E2E FAIL: ' + failures);
process.exit(failures === 0 ? 0 : 1);
