import * as vscode from 'vscode';
import { GatewayClient } from './gatewayClient';

export class RiskProvider implements vscode.TreeDataProvider<RiskNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RiskNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private scores: Record<string, any> | undefined;
  private error: string | undefined;
  private loading = false;
  private forecast: number | null = null;
  private gnn: string | null = null;

  constructor(private gateway: GatewayClient) {}

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = undefined;
    this.forecast = null;
    this.gnn = null;
    this._onDidChangeTreeData.fire(undefined);
    try {
      const data = await this.gateway.getRisk();
      if (data && typeof data === 'object') {
        this.scores = data;
      } else {
        this.error = 'Gateway returned no risk data';
        this.scores = this.mockScores();
      }
    } catch (e: any) {
      this.error = e?.message ?? 'Gateway unreachable';
      this.scores = this.mockScores();
    }
    if (!this.error && this.scores) {
      try {
        const risers: any[] = Array.isArray((this.scores as any).risers) ? (this.scores as any).risers : [];
        const name = risers.length > 0 ? String(risers[0]?.name ?? '') : '';
        if (name) {
          const gw: any = this.gateway as any;
          const [fc, gn] = await Promise.all([
            (async () => { try { return typeof gw.getForecast === 'function' ? await gw.getForecast(name) : null; } catch { return null; } })(),
            (async () => { try { return typeof gw.getGnn === 'function' ? await gw.getGnn(name) : null; } catch { return null; } })(),
          ]);
          try {
            const v = Number((fc as any)?.metadata?.forecast_last);
            this.forecast = Number.isFinite(v) ? v : null;
          } catch { this.forecast = null; }
          try {
            this.gnn = this.parseGnnText(gn);
          } catch { this.gnn = null; }
        }
      } catch { /* enrichment must never fail refresh */ }
    }
    this.loading = false;
    this._onDidChangeTreeData.fire(undefined);
  }

  private parseGnnText(gn: any): string | null {
    if (!gn || typeof gn !== 'object') return null;
    const md: any = (gn as any).metadata ?? {};
    const ps = Number(md.propagation_score);
    if (Number.isFinite(ps)) return String(md.propagation_score);
    if (typeof md.cascade === 'string' && md.cascade) return md.cascade;
    const mo: any = md.model_output;
    if (typeof mo === 'string' && mo) return mo;
    if (mo && typeof mo === 'object') {
      for (const k of ['cascade_score', 'risk_score', 'score', 'propagation_score']) {
        const cand = Number(mo[k]);
        if (Number.isFinite(cand)) return String(mo[k]);
      }
      if (typeof mo.summary === 'string' && mo.summary) return mo.summary;
    }
    if (typeof (gn as any).quantum_risk === 'string' && (gn as any).quantum_risk) return (gn as any).quantum_risk;
    if (typeof md.quantum_risk === 'string' && md.quantum_risk) return md.quantum_risk;
    return null;
  }

  private mockScores(): any {
    return {
      qday: { p5: 2033, p50: 2038, p95: 2046, probability: 0.71 },
      worst: 'RSA-2048',
      risers: [
        { name: 'RSA-2048', qars: 0.91, tier: 'CRITICAL' },
        { name: 'ECDSA-P256', qars: 0.79, tier: 'CRITICAL' },
        { name: 'AES-GCM', qars: 0.32, tier: 'GREEN' },
        { name: 'ML-KEM-768', qars: 0.05, tier: 'GREEN' }
      ]
    };
  }

  getTreeItem(element: RiskNode): vscode.TreeItem { return element; }

  getChildren(): RiskNode[] {
    if (this.loading) return [new RiskNode('Connecting to gateway\u2026', '', 'info')];
    if (!this.scores) return [new RiskNode('Quantum Risk Lab', '', 'header')];
    const lines: RiskNode[] = [];
    if (this.error) lines.push(new RiskNode('Gateway offline - showing mock risk data', this.error, 'warn'));
    const q = this.scores.qday ?? {};
    lines.push(new RiskNode(`Q-Day P5: ${q.p5 ?? '\u2014'}`, 'Advent of CRQC (5% probability year)', 'critical'));
    lines.push(new RiskNode(`Q-Day P50: ${q.p50 ?? '\u2014'}`, 'Median expectation', 'critical'));
    lines.push(new RiskNode(`Q-Day P95: ${q.p95 ?? '\u2014'}`, 'Long-tail horizon', 'warn'));
    const prob = Number(q.probability ?? 0);
    lines.push(new RiskNode(`P(exposure by P50): ${((Number.isFinite(prob) ? prob : 0) * 100).toFixed(0)}%`, 'Mosca X+Y>Z given your portfolio', 'warn'));
    lines.push(new RiskNode('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', '', 'sep'));
    const risers: any[] = Array.isArray(this.scores.risers) ? this.scores.risers : [];
    for (const r of risers) {
      if (!r) continue;
      const qars = Number(r.qars);
      const qarsLabel = Number.isFinite(qars) ? qars.toFixed(2) : 'n/a';
      const tier = String(r.tier ?? '').toUpperCase();
      const label = String(r.name ?? 'unknown');
      lines.push(new RiskNode(`${label}  QARS ${qarsLabel} [${tier || 'N/A'}]`, '', tier === 'CRITICAL' ? 'critical' : tier === 'RED' ? 'warn' : 'ok'));
    }
    if (!this.error) {
      const firstName = risers.length > 0 ? String(risers[0]?.name ?? 'unknown') : '';
      if (this.forecast !== null && this.forecast !== undefined && firstName) {
        const v: number = this.forecast;
        lines.push(new RiskNode(`Forecast ${firstName} P30: ${v}`, '', v >= 70 ? 'warn' : 'ok'));
      }
      if (this.gnn !== null && this.gnn !== undefined) {
        lines.push(new RiskNode(`GNN cascade: ${this.gnn}`, '', 'ok'));
      }
    }
    lines.push(new RiskNode('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', '', 'sep'));
    lines.push(new RiskNode('\u25b6 Run Monte Carlo', '', 'action', { command: 'qirova.runMonteCarlo', title: 'Run Monte Carlo' }));
    lines.push(new RiskNode('\u2912 Export CBOM', '', 'action', { command: 'qirova.exportCbom', title: 'Export CBOM' }));
    lines.push(new RiskNode('Show Q-Day', '', 'action', { command: 'qirova.showQday', title: 'Show Q-Day' }));
    return lines;
  }
}

export class RiskNode extends vscode.TreeItem {
  constructor(label: string, tooltip: string, kind: 'critical' | 'warn' | 'ok' | 'info' | 'sep' | 'header' | 'action', command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = tooltip;
    this.contextValue = 'risk-item';
    if (command) this.command = command;
    switch (kind) {
      case 'critical': this.iconPath = new vscode.ThemeIcon('flame', new vscode.ThemeColor('charts.red')); break;
      case 'warn': this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange')); break;
      case 'ok': this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')); break;
      case 'info': this.iconPath = new vscode.ThemeIcon('pulse'); break;
      case 'sep': break;
      case 'header': this.iconPath = new vscode.ThemeIcon('shield'); break;
      case 'action': this.iconPath = new vscode.ThemeIcon('play'); break;
    }
  }
}
