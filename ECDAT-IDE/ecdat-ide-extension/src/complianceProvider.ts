import * as vscode from 'vscode';
import { GatewayClient } from './gatewayClient';

export class ComplianceProvider implements vscode.TreeDataProvider<ComplianceNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ComplianceNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private liveRows: any[] | undefined;

  constructor(private gateway: GatewayClient) {}

  getTreeItem(element: ComplianceNode): vscode.TreeItem { return element; }

  async refresh(): Promise<void> {
    try {
      const gw: any = this.gateway;
      const res = typeof gw.getCertInMappings === 'function' ? await gw.getCertInMappings() : null;
      if (res && typeof res === 'object') {
        const firstFinding = Array.isArray(res.findings) ? res.findings[0] : undefined;
        this.liveRows = [{
          framework: `CERT-In ${res.elements_compliant ?? '?'} of ${res.elements_evaluated ?? 8} elements (live)`,
          state: String(res.status ?? 'EVALUATED'),
          gap: String(firstFinding?.remedy ?? res.deadline ?? 'gateway connected')
        }];
      }
    } catch {
      this.liveRows = undefined;
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(): ComplianceNode[] {
    const cfg: any[] = [
      ...(this.liveRows ?? []),
      { framework: 'NIST FIPS 203 (ML-KEM)', state: 'PARTIAL', gap: 'RSA-2048 still in prod' },
      { framework: 'NIST FIPS 204 (ML-DSA)', state: 'GAP', gap: 'ECDSA-P256 in signing pipeline' },
      { framework: 'CNSA 2.0 timeline', state: 'AT RISK', gap: 'PQC migration due 2030-01' },
      { framework: 'CERT-In 8 elements', state: '5/8', gap: 'Protocol expiry, key rotation' },
      { framework: 'DPDP \u00a78(4) \u20b9250cr cap', state: 'OPEN', gap: 'Annual report overdue' },
      { framework: 'NIST SP 800-131A Rev. 2', state: 'PARTIAL', gap: 'SHA-1 still used in legacy' },
      { framework: 'BSI TR-02102', state: 'PARTIAL', gap: 'Long-term PQC budget missing' }
    ];
    return cfg.filter(c => !!c).map(c => new ComplianceNode(c));
  }
}

export class ComplianceNode extends vscode.TreeItem {
  constructor(public cfg: any) {
    super(String(cfg?.framework ?? 'Unknown framework'), vscode.TreeItemCollapsibleState.None);
    const state = String(cfg?.state ?? 'UNKNOWN');
    this.tooltip = `State: ${state}\nGap: ${cfg?.gap ?? 'n/a'}`;
    this.description = state;
    this.contextValue = 'compliance';
    this.iconPath = state.startsWith('GAP') || state === 'AT RISK' || state === 'OPEN'
      ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'))
      : state === 'PARTIAL'
        ? new vscode.ThemeIcon('alert', new vscode.ThemeColor('charts.yellow'))
        : new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
  }
}
