import * as vscode from 'vscode';
import { CryptoDetector, CryptoFinding } from './cryptoDetector';
import { FindingsProvider } from './findingsProvider';
import { RiskProvider } from './riskProvider';
import { ComplianceProvider } from './complianceProvider';
import { ThreatProvider } from './threatProvider';
import { StatusBarManager } from './statusBar';
import { GatewayClient } from './gatewayClient';
import { ConsolePanel } from './consolePanel';
import { CryptoRemediator, registerRemediator } from './remediator';
import { WorkspaceScanner } from './scanner';
import { registerCopilot, registerChatParticipant } from './copilot';
import { registerExtraCommands } from './extraCommands';

let detector: CryptoDetector;
let findingsProvider: FindingsProvider;
let riskProvider: RiskProvider;
let complianceProvider: ComplianceProvider;
let threatProvider: ThreatProvider;
let statusBar: StatusBarManager;
let gateway: GatewayClient;
let consolePanel: ConsolePanel | undefined;
let remediator: CryptoRemediator;
let scanner: WorkspaceScanner;
let diagnosticCollection: vscode.DiagnosticCollection;
let editScanTimer: ReturnType<typeof setTimeout> | undefined;
let gatewayProbeTimer: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('ecdat');
  const gatewayUrl = cfg.get<string>('gateway.url', 'http://localhost:8000');
  const apiKey = cfg.get<string>('gateway.apiKey', '');
  const autoConnect = cfg.get<boolean>('gateway.autoConnect', true);

  gateway = new GatewayClient(gatewayUrl, apiKey);
  detector = new CryptoDetector();
  remediator = new CryptoRemediator();
  findingsProvider = new FindingsProvider(context);
  riskProvider = new RiskProvider(gateway);
  complianceProvider = new ComplianceProvider(gateway);
  threatProvider = new ThreatProvider(gateway, context);
  statusBar = new StatusBarManager();
  scanner = new WorkspaceScanner(detector, gateway);
  consolePanel = new ConsolePanel(context, gateway);

  diagnosticCollection = vscode.languages.createDiagnosticCollection('qirova');
  context.subscriptions.push(diagnosticCollection);

  vscode.window.registerTreeDataProvider('qirova.findings', findingsProvider);
  vscode.window.registerTreeDataProvider('qirova.risk', riskProvider);
  vscode.window.registerTreeDataProvider('qirova.compliance', complianceProvider);
  vscode.window.registerTreeDataProvider('qirova.threat', threatProvider);

  // qirova.copilotView is contributed unconditionally in package.json, so its
  // WebviewViewProvider must be registered unconditionally too (registering a
  // TreeDataProvider for it would be wrong — it renders a webview chat UI).
  try {
    registerCopilot(context, gateway, detector, remediator);
  } catch (e: any) {
    console.warn('QIROVA: Copilot sidebar failed to register:', e?.message ?? e);
  }
  if (cfg.get<boolean>('copilot.enabled', true) !== false) {
    try {
      registerChatParticipant(context, gateway, detector, remediator);
    } catch (e: any) {
      console.warn('QIROVA: Chat participant failed to register:', e?.message ?? e);
    }
  }

  registerRemediator(context, remediator, detector);
  registerExtraCommands(context, gateway, detector);

  remediator.setGateway(gateway);

  context.subscriptions.push(
    vscode.commands.registerCommand('qirova.insertMigrationSnippet', async (finding: CryptoFinding, uri: vscode.Uri) => {
      const snippet = remediator.getMigrationSnippet(finding, vscode.window.activeTextEditor?.document.languageId || 'python');
      if (!snippet) {
        vscode.window.showWarningMessage('QIROVA: No migration snippet available for this algorithm.');
        return;
      }
      const useSnippet = await vscode.window.showQuickPick([
        { label: 'Insert full migration code', description: snippet.after },
        { label: 'Insert import + usage', description: `${snippet.importStatement}\n${snippet.after}` },
        { label: 'Cancel', description: 'Do nothing' }
      ], { placeHolder: `QIROVA: Choose how to insert ${snippet.algorithm} migration` });
      if (!useSnippet || useSnippet.label === 'Cancel') return;
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const pos = ed.selection.active;
      if (useSnippet.label === 'Insert import + usage') {
        await ed.edit(b => {
          const topLine = new vscode.Position(0, 0);
          b.insert(topLine, snippet.importStatement + '\n');
          b.insert(pos, '\n' + snippet.after + '\n');
        });
      } else {
        await ed.edit(b => b.insert(pos, '\n' + snippet.after + '\n'));
      }
      vscode.window.showInformationMessage(`QIROVA: ${snippet.algorithm.toUpperCase()} migration snippet inserted.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('qirova.openConsole', () => consolePanel!.open()),
    vscode.commands.registerCommand('qirova.scanActiveFile', () => scanActive()),
    vscode.commands.registerCommand('qirova.scanWorkspace', () => scanner.scanWorkspace().then(r => findingsProvider.setWorkspace(r))),
    vscode.commands.registerCommand('qirova.runMonteCarlo', () => gateway.runMonteCarlo()),
    vscode.commands.registerCommand('qirova.exportCbom', () => exportCbom()),
    vscode.commands.registerCommand('qirova.showQday', () => statusBar.showQdayDetail()),
    vscode.commands.registerCommand('qirova.remediateAll', () => remediator.remediateActiveFile()),
    vscode.commands.registerCommand('qirova.hardwareRedTeam', async () => {
      try {
        const gw: any = gateway;
        if (typeof gw.getHardwareStatus !== 'function' || !(await gw.ping())) {
          vscode.window.showWarningMessage('QIROVA: Backend gateway unreachable.');
          return;
        }
        const st = await gw.getHardwareStatus().catch(() => null);
        if (st && st.metadata && !st.metadata.token_configured) {
          vscode.window.showWarningMessage('QIROVA: IBM_QUANTUM_TOKEN not set. Real-QPU runs are disabled; use red-team (simulation).');
          return;
        }
        const pick = await vscode.window.showQuickPick([
          { label: 'Small: RSA-15 + AES-4', detail: 'Fits hardware, cheapest', targets: ['RSA-15', 'AES-4'] },
          { label: 'Standard: engine defaults', detail: 'All default phase-1 targets', targets: undefined },
          { label: 'Cancel', detail: 'Do nothing', targets: undefined },
        ], { placeHolder: 'QIROVA: Choose real-QPU targets (costs real money)' });
        if (!pick || pick.label === 'Cancel') return;
        const est = await gw.estimateHardware({ targets: pick.targets, shots: 256 }).catch(() => null);
        const items = (est && est.metadata && est.metadata.items) || [];
        if (!items.length) { vscode.window.showWarningMessage('QIROVA: Could not estimate hardware cost.'); return; }
        const total = (est && est.metadata && est.metadata.total_estimated_usd) ?? '?';
        const go = await vscode.window.showQuickPick([
          { label: 'Yes, spend ~$' + total, detail: 'Run on IBM QPU now' },
          { label: 'Cancel', detail: 'Do not spend' },
        ], { placeHolder: 'QIROVA: Confirm ~$' + total + ' real spend?' });
        if (!go || go.label === 'Cancel') return;
        vscode.window.showInformationMessage('QIROVA: Submitting real-QPU job (~$' + total + ')...');
        const res = await gw.runHardware({ targets: pick.targets, shots: 256, confirm: true }).catch(() => null);
        const results = (res && res.metadata && res.metadata.results) || [];
        const jobs = results.filter((r: any) => r.job_id).map((r: any) => (r.algorithm || '?') + ': ' + r.job_id).join(', ');
        vscode.window.showInformationMessage('QIROVA: QPU run finished. ' + (jobs || 'no job ids returned'));
      } catch (e: any) {
        vscode.window.showErrorMessage('QIROVA: hardware red team failed: ' + (e?.message ?? e));
      }
    }),
    vscode.commands.registerCommand('qirova.suggestNextMigration', async () => {
      try {
        const ed = vscode.window.activeTextEditor;
        if (!ed) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
        const findings = detector.scan(ed.document.getText(), ed.document.languageId);
        if (!findings.length) { vscode.window.showInformationMessage('QIROVA: No findings in this file.'); return; }
        const cur = ed.selection.active.line;
        const sorted = [...findings].sort((a, b) => a.line - b.line);
        const next = sorted.find((f) => f.line > cur) ?? sorted[0];
        await remediator.previewMigrationHunk(ed.document.uri.fsPath, next.line, next.col);
      } catch { /* best-effort */ }
    }),
    vscode.commands.registerCommand('qirova.applyTheme', () => vscode.workspace.getConfiguration().update('workbench.colorTheme', 'QIROVA Secure', vscode.ConfigurationTarget.Global).then(() => vscode.window.showInformationMessage('QIROVA Secure theme applied.'))),
    vscode.commands.registerCommand('qirova.refreshFindings', () => {
      findingsProvider.refresh();
      vscode.window.showInformationMessage('QIROVA: Findings refreshed.');
    }),
    vscode.commands.registerCommand('qirova.redTeamChat', async () => {
      try {
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: '@qirova run a red-team review of the current file' });
      } catch {
        await vscode.commands.executeCommand('qirova.openCopilot');
      }
    }),
    vscode.commands.registerCommand('qirova.openWalkthrough', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#qirova.welcome`, true)),
    vscode.commands.registerCommand('qirova.findings.remediate', (finding: CryptoFinding) => {
      if (!finding?.uri) return;
      return remediator.applyFix(finding);
    }),
    vscode.commands.registerCommand('qirova.findings.jumpTo', async (finding: CryptoFinding) => {
      if (!finding?.uri) return;
      try {
        const ed = await vscode.window.showTextDocument(vscode.Uri.file(finding.uri), { preview: false });
        const line = Number.isFinite(finding.line) ? finding.line : 0;
        const col = Number.isFinite(finding.col) ? finding.col : 0;
        ed.revealRange(new vscode.Range(line, col, line, col + (finding.length ?? 1)), vscode.TextEditorRevealType.InCenter);
      } catch { return; }
    }),
    vscode.commands.registerCommand('qirova.findings.suppress', (finding: CryptoFinding) => {
      if (!finding?.uri) return;
      return remediator.suppressFinding(finding);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) return;
      statusBar.updateFileScore(editor.document);
      const liveCfg = vscode.workspace.getConfiguration('ecdat');
      if (liveCfg.get<boolean>('scan.onOpen', true)) {
        scanDocument(editor.document);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      const liveCfg = vscode.workspace.getConfiguration('ecdat');
      if (liveCfg.get<boolean>('scan.onSave', false)) scanDocument(doc);
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.scheme !== 'file') return;
      if (!e.contentChanges.length) return;
      const liveCfg = vscode.workspace.getConfiguration('ecdat');
      if (!liveCfg.get<boolean>('scan.onEdit', true)) return;
      if (editScanTimer) clearTimeout(editScanTimer);
      const doc = e.document;
      editScanTimer = setTimeout(() => {
        editScanTimer = undefined;
        const isActive = vscode.window.activeTextEditor?.document === doc;
        void scanDocument(doc, isActive);
      }, 400);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('qirova.welcome.done', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#qirova.welcome`, false))
  );

  statusBar.start();
  void riskProvider.refresh().catch(() => undefined);
  void complianceProvider.refresh().catch(() => undefined);
  void threatProvider.refresh().catch(() => undefined);

  vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'QIROVA activating…' }, async p => {
    p.report({ message: 'Probing gateway…' });
    const live = autoConnect ? await gateway.ping() : false;
    statusBar.setConnected(live);
    p.report({ message: live ? `Connected: ${gatewayUrl}` : `MOCK mode — gateway unreachable at ${gatewayUrl}` });
    setTimeout(() => p.report({ message: 'Done.' }), 200);
  });

  // Re-probe periodically so the MOCK badge flips to LIVE by itself once the
  // gateway answers (e.g. backend started after the IDE). Cheap 2.5 s ping.
  if (gatewayProbeTimer) clearInterval(gatewayProbeTimer);
  gatewayProbeTimer = setInterval(async () => {
    try {
      if (!gateway) return;
      statusBar.setConnected(autoConnect ? await gateway.ping() : false);
    } catch { /* keep last badge state */ }
  }, 30000);
  const probeTimerRef: any = gatewayProbeTimer as any;
  if (probeTimerRef && typeof probeTimerRef.unref === 'function') probeTimerRef.unref();
  context.subscriptions.push({ dispose: () => { if (gatewayProbeTimer) clearInterval(gatewayProbeTimer); } });

  const isFresh = context.globalState.get<boolean>('qirova.welcomed', false);
  if (!isFresh) {
    void context.globalState.update('qirova.welcomed', true);
    setTimeout(() => vscode.window.showInformationMessage('🛡️ QIROVA IDE active. Open the walkthrough to get started.', 'Open Walkthrough').then(s => { if (s) vscode.commands.executeCommand('qirova.openWalkthrough'); }), 1500);
  }

}

export function deactivate(): void {
  if (editScanTimer) clearTimeout(editScanTimer);
  editScanTimer = undefined;
  if (gatewayProbeTimer) clearInterval(gatewayProbeTimer);
  gatewayProbeTimer = undefined;
  statusBar?.dispose();
}

async function scanActive(broadcast = true): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
  await scanDocument(editor.document, broadcast);
}

async function scanDocument(doc: vscode.TextDocument, broadcast = true): Promise<CryptoFinding[]> {
  if (doc.uri.scheme !== 'file') return [];
  if (doc.lineCount > 5000) return [];

  const text = doc.getText();
  const findings = detector.scan(text, doc.languageId);
  const diags: vscode.Diagnostic[] = [];

  for (const f of findings) {
    f.uri = doc.uri.fsPath;
    const range = new vscode.Range(f.line, f.col, f.line, f.col + f.length);
    const diag = new vscode.Diagnostic(range, `[${f.algorithmCategory}] ${f.message} → Suggested: ${f.remediationHint}`, severityFor(f.severity));
    diag.code = f.algorithmId;
    diag.source = 'QIROVA';
    diag.tags = f.suppress ? [vscode.DiagnosticTag.Unnecessary] : [];
    diags.push(diag);
  }
  diagnosticCollection.set(doc.uri, diags);
  findingsProvider.setFile(doc.uri.fsPath, findings);
  if (broadcast) {
    statusBar.updateFileScore(doc);
  }
  return findings;
}

function severityFor(s: CryptoFinding['severity']): vscode.DiagnosticSeverity {
  switch (s) {
    case 'broken': return vscode.DiagnosticSeverity.Error;
    case 'vulnerable': return vscode.DiagnosticSeverity.Error;
    case 'deprecated': return vscode.DiagnosticSeverity.Warning;
    case 'info': return vscode.DiagnosticSeverity.Information;
    default: return vscode.DiagnosticSeverity.Hint;
  }
}

async function exportCbom(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) { vscode.window.showWarningMessage('No workspace open.'); return; }
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'QIROVA: Generating CBOM…' }, async () => {
    const findings = await scanner.scanWorkspace();
    const cbom = gateway.buildCbomLocal(findings, workspace.uri.fsPath);
    const target = vscode.Uri.joinPath(workspace.uri, 'qirova-cbom.json');
    await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(cbom, null, 2), 'utf-8'));
    vscode.window.showInformationMessage(`CBOM written: ${target.fsPath}`, 'Open').then(s => {
      if (s) vscode.commands.executeCommand('vscode.open', target);
    });
  });
}
