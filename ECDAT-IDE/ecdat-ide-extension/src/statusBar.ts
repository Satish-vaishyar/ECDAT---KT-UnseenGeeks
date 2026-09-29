import * as vscode from 'vscode';
import { GatewayClient } from './gatewayClient';
import { CryptoDetector, CryptoFinding } from './cryptoDetector';

interface CacheEntry { findings: CryptoFinding[]; score: number; worst: string; ts: number; }
const CACHE = new Map<string, CacheEntry>();

export class StatusBarManager {
  private fileScore: vscode.StatusBarItem;
  private qday: vscode.StatusBarItem;
  private modeBadge: vscode.StatusBarItem;
  private workspaceScore: vscode.StatusBarItem;
  private detector = new CryptoDetector();
  private qdayP50: number | null = null;

  constructor() {
    this.fileScore = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.fileScore.command = 'qirova.runMonteCarlo';
    this.fileScore.tooltip = 'Per-file PQC Readiness Score';

    this.workspaceScore = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    this.workspaceScore.command = 'qirova.scanWorkspace';

    this.qday = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 150);
    this.qday.command = 'qirova.showQday';
    this.qday.tooltip = 'Q-Day P50 (median CRQC horizon) — click for details';

    this.modeBadge = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
    this.modeBadge.command = 'qirova.openConsole';
  }

  start(): void {
    const cfg = vscode.workspace.getConfiguration('ecdat');
    if (cfg.get<boolean>('statusBar.score', true)) {
      this.fileScore.show();
      this.workspaceScore.show();
    }
    if (cfg.get<boolean>('statusBar.qday', true)) {
      this.applyQdayFromMock();
      this.qday.show();
    }
    this.modeBadge.text = 'MOCK';
    this.modeBadge.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.modeBadge.tooltip = 'QIROVA gateway connection — click to open workbench';
    this.modeBadge.show();
  }

  setConnected(live: boolean): void {
    if (live) {
      this.modeBadge.text = 'LIVE';
      this.modeBadge.backgroundColor = new vscode.ThemeColor('statusBarItem.successBackground');
      this.modeBadge.tooltip = 'QIROVA gateway connected — click to open workbench';
      this.fetchQdayP50();
    } else {
      this.modeBadge.text = 'MOCK';
      this.modeBadge.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.modeBadge.tooltip = `QIROVA gateway unreachable — running in MOCK mode`;
      this.applyQdayFromMock();
    }
  }

  private async fetchQdayP50(): Promise<void> {
    try {
      const cfg = vscode.workspace.getConfiguration('ecdat');
      const url = cfg.get<string>('gateway.url', 'http://localhost:8000');
      const resp = await fetch(`${url}/api/v1/risk/monte-carlo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iterations: 10000 })
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        const raw = data?.metadata?.qday?.p50_year
          ?? data?.metadata?.qday_years?.p50
          ?? data?.percentiles?.p50
          ?? data?.p50;
        const currentYear = new Date().getFullYear();
        const p50 = typeof raw === 'number'
          ? (raw < 1000 ? Math.round(currentYear + raw) : Math.round(raw))
          : undefined;
        if (typeof p50 === 'number') {
          this.qdayP50 = p50;
          const currentYear = new Date().getFullYear();
          const yearsLeft = p50 - currentYear;
          this.qday.text = `Q-Day P50: ${p50} (T-${yearsLeft > 0 ? yearsLeft : 'NOW'})`;
          this.qday.tooltip = `Q-Day P50: ${p50} — ${yearsLeft > 0 ? yearsLeft + ' years left' : 'CRITICAL: quantum threat imminent'} — click for details`;
          this.qday.backgroundColor = yearsLeft <= 5
            ? new vscode.ThemeColor('statusBarItem.errorBackground')
            : yearsLeft <= 12
              ? new vscode.ThemeColor('statusBarItem.warningBackground')
              : new vscode.ThemeColor('statusBarItem.successBackground');
        }
      }
    } catch {
      this.applyQdayFromMock();
    }
  }

  private applyQdayFromMock(): void {
    const p50 = this.qdayP50 ?? 2038;
    const currentYear = new Date().getFullYear();
    const yearsLeft = p50 - currentYear;
    this.qday.text = `Q-Day P50: ${p50} (T-${yearsLeft > 0 ? yearsLeft : 'NOW'})`;
    this.qday.tooltip = `Q-Day P50: ${p50} (mock) — click for details`;
    this.qday.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  updateFileScore(doc: vscode.TextDocument): void {
    if (!doc.uri.scheme || doc.uri.scheme !== 'file') {
      this.fileScore.text = 'PQC - no file';
      return;
    }
    const cacheKey = doc.uri.fsPath + ':' + doc.version;
    let entry = CACHE.get(cacheKey);
    if (!entry || Date.now() - entry.ts > 30000) {
      const findings = this.detector.scan(doc.getText(), doc.languageId);
      const { score, worst } = this.detector.computeFileScore(findings);
      const worstLabel = findings.length === 0 ? 'clean' : findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]?.algorithmId;
      entry = { findings, score, worst: worstLabel ?? 'clean', ts: Date.now() };
      CACHE.set(cacheKey, entry);
      for (const k of [...CACHE.keys()]) {
        if (k.startsWith(doc.uri.fsPath + ':') && k !== cacheKey) CACHE.delete(k);
      }
    }

    const { score, worst } = entry;
    const color = score > 80 ? 'charts.green' : score > 50 ? 'charts.yellow' : 'charts.red';
    this.fileScore.text = `PQC ${score}/100`;
    this.fileScore.color = new vscode.ThemeColor(color);
    this.fileScore.tooltip = `PQC Readiness: ${score}/100 (worst: ${worst.toUpperCase()}) — ${entry.findings.length} finding${entry.findings.length === 1 ? '' : 's'}`;

    const all = [...CACHE.values()];
    if (all.length) {
      const ws = Math.round(all.reduce((s, e) => s + e.score, 0) / all.length);
      this.workspaceScore.text = `WS ${ws}/100`;
      this.workspaceScore.color = new vscode.ThemeColor(ws > 80 ? 'charts.green' : ws > 50 ? 'charts.yellow' : 'charts.red');
      this.workspaceScore.tooltip = `Workspace avg: ${ws}/100 across ${all.length} scanned file(s)`;
    }
  }

  showQdayDetail(): void {
    const p50 = this.qdayP50 ?? 2038;
    const live = this.qdayP50 !== null ? 'live gateway estimate' : 'mock fallback';
    vscode.window.showInformationMessage(`Q-Day P50 (median expectation): ${p50} — ${live}, based on Monte Carlo quantum-horizon simulation.`, 'Run Simulation', 'Open Workbench').then(s => {
      if (s === 'Run Simulation') vscode.commands.executeCommand('qirova.runMonteCarlo');
      if (s === 'Open Workbench') vscode.commands.executeCommand('qirova.openConsole');
    });
  }

  dispose(): void {
    this.fileScore.dispose();
    this.qday.dispose();
    this.modeBadge.dispose();
    this.workspaceScore.dispose();
  }
}

function severityRank(s: CryptoFinding['severity']): number {
  return s === 'broken' ? 4 : s === 'vulnerable' ? 3 : s === 'deprecated' ? 2 : 1;
}
