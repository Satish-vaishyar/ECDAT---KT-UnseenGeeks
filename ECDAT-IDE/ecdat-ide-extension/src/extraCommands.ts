import * as vscode from 'vscode';
import { GatewayClient } from './gatewayClient';
import { CryptoDetector } from './cryptoDetector';

const DEMO_SUITE_FILES = [
  '01_vulnerable_rsa_server.py',
  '03_payment_gateway_insecure_tls.py',
  '04_false_alarm_auth_logger.py',
  '05_quantum_resilient_argon2.py',
  'LegacyPinEncryptor.java',
  'weak_crypto_demo.py',
  'weak_crypto_demo.js'
];

function severityRank(s: string): number {
  switch (s) {
    case 'broken': return 4;
    case 'vulnerable': return 3;
    case 'deprecated': return 2;
    case 'info': return 1;
    default: return 0;
  }
}

function activeEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

export function registerExtraCommands(
  context: vscode.ExtensionContext,
  gateway: GatewayClient,
  detector: CryptoDetector
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('qirova.scanBinary', async () => {
      const ed = activeEditor();
      if (!ed) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
      try {
        const bytes = await vscode.workspace.fs.readFile(ed.document.uri);
        const b64 = Buffer.from(bytes).toString('base64');
        const fileName = ed.document.fileName.split(/[/\\]/).pop() || 'upload.bin';
        const res = await gateway.scanBinary(b64, fileName);
        if (!res) { vscode.window.showWarningMessage('QIROVA: Binary scan offline — gateway unreachable.'); return; }
        const cls = res.findings?.[0]?.algorithm ?? res.model ?? 'UNKNOWN';
        const conf = res.confidence ?? res.findings?.[0]?.confidence ?? 'n/a';
        vscode.window.showInformationMessage(`QIROVA: Binary scan — ${cls} (confidence ${conf}).`);
      } catch {
        vscode.window.showWarningMessage('QIROVA: Binary scan failed.');
      }
    }),

    vscode.commands.registerCommand('qirova.checkEntropy', async () => {
      const ed = activeEditor();
      if (!ed) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
      try {
        const res = await gateway.scanEntropy(ed.document.getText());
        if (!res) { vscode.window.showWarningMessage('QIROVA: Entropy scan offline — gateway unreachable.'); return; }
        const label = res.findings?.[0]?.algorithm ?? res.model ?? 'UNKNOWN';
        const risk = res.quantum_risk ?? res.findings?.[0]?.quantum_risk ?? 'NONE';
        if (risk === 'HIGH' || risk === 'CRITICAL') {
          vscode.window.showWarningMessage(`QIROVA: Entropy scan — ${label} (risk ${risk}). Possible hardcoded secret — rotate & vault.`);
        } else {
          vscode.window.showInformationMessage(`QIROVA: Entropy scan — ${label}. Entropy within normal range.`);
        }
      } catch {
        vscode.window.showWarningMessage('QIROVA: Entropy scan failed.');
      }
    }),

    vscode.commands.registerCommand('qirova.trapdoorScan', async () => {
      const ed = activeEditor();
      if (!ed) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
      try {
        const res = await gateway.getTrapdoor(ed.document.getText());
        if (!res) { vscode.window.showWarningMessage('QIROVA: Trapdoor scan offline — gateway unreachable.'); return; }
        const hits: any[] = res.findings ?? [];
        if (hits.length) {
          const list = hits.slice(0, 5).map(h => `${h.id ?? 'TRAP-?'}: ${h.algorithm ?? h.title ?? 'match'}`).join('; ');
          const more = hits.length > 5 ? ` (+${hits.length - 5} more)` : '';
          vscode.window.showWarningMessage(`QIROVA: Trapdoor IOCs found (${hits.length}) — ${list}${more}.`);
        } else {
          vscode.window.showInformationMessage('QIROVA: No trapdoor IOCs — file looks clean.');
        }
      } catch {
        vscode.window.showWarningMessage('QIROVA: Trapdoor scan failed.');
      }
    }),

    vscode.commands.registerCommand('qirova.attackCost', async () => {
      const ed = activeEditor();
      if (!ed) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
      try {
        const findings = detector.scan(ed.document.getText(), ed.document.languageId);
        if (!findings.length) { vscode.window.showInformationMessage('QIROVA: No crypto findings — nothing to price.'); return; }
        const worst = [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
        const algo = worst.algorithmId || worst.algorithmName || 'unknown';
        const res = await gateway.attackCosts(algo);
        if (!res) { vscode.window.showWarningMessage('QIROVA: Attack-cost lookup offline — gateway unreachable.'); return; }
        vscode.window.showInformationMessage(`QIROVA: ${algo.toUpperCase()} attack cost — risk ${res.quantum_risk ?? 'n/a'} (confidence ${res.confidence ?? 'n/a'}).`);
      } catch {
        vscode.window.showWarningMessage('QIROVA: Attack-cost lookup failed.');
      }
    }),

    vscode.commands.registerCommand('qirova.modelsStatus', async () => {
      try {
        const res = await gateway.getModels();
        if (!res) { vscode.window.showWarningMessage('QIROVA: Models status offline — gateway unreachable.'); return; }
        const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(res, null, 2), language: 'json' });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch {
        vscode.window.showWarningMessage('QIROVA: Models status unavailable.');
      }
    }),

    vscode.commands.registerCommand('qirova.remediationRoadmap', async () => {
      try {
        const res = await gateway.getRemediationRoadmap();
        const phases: any[] = res?.phases ?? [];
        if (!phases.length) { vscode.window.showWarningMessage('QIROVA: Remediation roadmap offline — gateway unreachable.'); return; }
        const summary = phases.map((p: any) => `Phase ${p.phase}: ${p.name} (${p.duration_weeks}w)`).join(' • ');
        vscode.window.showInformationMessage(`QIROVA roadmap: ${summary}.`);
      } catch {
        vscode.window.showWarningMessage('QIROVA: Remediation roadmap unavailable.');
      }
    }),

    vscode.commands.registerCommand('qirova.loadDemoSuite', async () => {
      try {
        const pick = await vscode.window.showQuickPick(DEMO_SUITE_FILES, { placeHolder: 'QIROVA: Choose a demo file to open' });
        if (!pick) return;
        const uri = vscode.Uri.joinPath(context.extensionUri, 'samples', pick);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch {
        vscode.window.showWarningMessage('QIROVA: Demo file not found.');
      }
    }),

    vscode.commands.registerCommand('qirova.pipelineScan', async () => {
      try {
        const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
        const ed0 = activeEditor();
        if (!ed0 && !hasWorkspace) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
        const options = !hasWorkspace ? ['Active file'] : (ed0 ? ['Active file', 'Workspace folder'] : ['Workspace folder']);
        const scope = options.length === 1 ? options[0] : await vscode.window.showQuickPick(options, { placeHolder: 'QIROVA: Pipeline scan scope' });
        if (!scope) return;

        const showResults = async (res: any): Promise<void> => {
          if (!res) { await vscode.window.showErrorMessage('QIROVA: backend unreachable (is the gateway LIVE?)'); return; }
          const scanId = String(res.scan_id ?? res.scanId ?? res.id ?? 'n/a');
          const total = res.total_findings ?? res.findings?.length ?? 0;
          const risk = res.quantum_risk ?? res.risk ?? 'n/a';
          const choice = await vscode.window.showInformationMessage(`QIROVA: Scan ${scanId}: ${total} findings, risk ${risk}`, 'Open CBOM', 'Open Report', 'Save CBOM');
          if (!choice) return;
          try {
            if (choice === 'Open CBOM') {
              const cbom = await gateway.getScanCbom(scanId);
              if (!cbom) { await vscode.window.showErrorMessage('QIROVA: backend unreachable (is the gateway LIVE?)'); return; }
              const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(cbom, null, 2), language: 'json' });
              await vscode.window.showTextDocument(doc, { preview: false });
            } else if (choice === 'Open Report') {
              const rep = await gateway.getScanReport(scanId);
              if (!rep) { await vscode.window.showErrorMessage('QIROVA: backend unreachable (is the gateway LIVE?)'); return; }
              const md = typeof rep === 'string' ? rep : (typeof rep.raw === 'string' ? rep.raw : JSON.stringify(rep, null, 2));
              const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
              await vscode.window.showTextDocument(doc, { preview: false });
            } else if (choice === 'Save CBOM') {
              if (!vscode.workspace.workspaceFolders?.length) { vscode.window.showWarningMessage('QIROVA: No workspace folder to save CBOM.'); return; }
              const cbom2 = await gateway.getScanCbom(scanId);
              if (!cbom2) { await vscode.window.showErrorMessage('QIROVA: backend unreachable (is the gateway LIVE?)'); return; }
              const root = vscode.workspace.workspaceFolders[0].uri;
              const dest = vscode.Uri.joinPath(root, 'qirova-cbom.json');
              await vscode.workspace.fs.writeFile(dest, Buffer.from(JSON.stringify(cbom2, null, 2), 'utf-8'));
              vscode.window.showInformationMessage('QIROVA: CBOM saved to qirova-cbom.json.');
            }
          } catch {
            vscode.window.showWarningMessage('QIROVA: Pipeline scan failed.');
          }
        };

        if (scope === 'Active file') {
          const ed = activeEditor();
          if (!ed) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
          let text = ed.document.getText();
          if (Buffer.byteLength(text, 'utf-8') > 200 * 1024) { text = text.slice(0, 200 * 1024); }
          const targetName = ed.document.fileName.split(/[/\\]/).pop() || 'input_code.py';
          const language = ed.document.languageId || 'python';
          const stages = ['Discover', 'Classify', 'Remediate', 'Intel', 'Assemble'];
          const res = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'QIROVA: 29-Model Pipeline Scan',
            cancellable: false
          }, async (progress) => {
            const pending = (gateway.runPipeline as any)({ source_code: text, target_name: targetName, language, enable_remediation: true });
            for (const stage of stages) {
              progress.report({ increment: 20, message: stage });
            }
            return await pending;
          });
          await showResults(res);
          return;
        }

        // Workspace folder scope
        if (!vscode.workspace.workspaceFolders?.length) { vscode.window.showWarningMessage('QIROVA: No workspace folder open.'); return; }
        const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'out', 'vendor']);
        const allowedExts = new Set(['py', 'js', 'jsx', 'ts', 'tsx', 'java', 'go', 'cs', 'cpp', 'c', 'rs']);
        const found = await vscode.workspace.findFiles('**/*.{py,js,jsx,ts,tsx,java,go,cs,cpp,c,rs}', null, 100);
        const picked: { path: string; contentBase64: string }[] = [];
        for (const uri of found) {
          if (picked.length >= 20) break;
          const rel = vscode.workspace.asRelativePath(uri);
          const parts = rel.split(/[/\\]/);
          if (parts.some(p => skipDirs.has(p))) continue;
          const ext = (rel.split('.').pop() || '').toLowerCase();
          if (!allowedExts.has(ext)) continue;
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size > 100 * 1024) continue;
            const bytes = await vscode.workspace.fs.readFile(uri);
            if (bytes.length > 100 * 1024) continue;
            picked.push({ path: rel.replace(/\\/g, '/'), contentBase64: Buffer.from(bytes).toString('base64') });
          } catch {
            continue;
          }
          if (picked.length >= 20) break;
        }
        if (!picked.length) { vscode.window.showWarningMessage('QIROVA: No scannable files found.'); return; }
        const wsTarget = vscode.workspace.workspaceFolders[0].name || 'uploaded_asset';
        const stages = ['Discover', 'Classify', 'Remediate', 'Intel', 'Assemble'];
        const wres = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'QIROVA: 29-Model Pipeline Scan',
          cancellable: false
        }, async (progress) => {
          const pending = gateway.runUploadAudit(picked, wsTarget);
          for (const stage of stages) {
            progress.report({ increment: 20, message: stage });
          }
          return await pending;
        });
        await showResults(wres);
      } catch {
        vscode.window.showWarningMessage('QIROVA: Pipeline scan failed.');
      }
    })
  );
}
