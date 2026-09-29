import * as vscode from 'vscode';
import { CryptoFinding } from './cryptoDetector';

interface SeverityGroup { label: string; weight: number; items: CryptoFinding[]; }

export class FindingsProvider implements vscode.TreeDataProvider<FindingNode | GroupNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FindingNode | GroupNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private perFile = new Map<string, CryptoFinding[]>();
  private workspaceFindings: CryptoFinding[] = [];

  constructor(private context: vscode.ExtensionContext) {}

  setFile(file: string, findings: CryptoFinding[]) {
    this.perFile.set(file, findings);
    this._onDidChangeTreeData.fire(undefined);
  }

  setWorkspace(findings: CryptoFinding[]) {
    this.workspaceFindings = findings;
    this._onDidChangeTreeData.fire(undefined);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: FindingNode | GroupNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FindingNode | GroupNode): (FindingNode | GroupNode)[] {
    if (!element) {
      const all = this.merged();
      const counts = new Map<string, number>();
      for (const f of all) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
      const groups: GroupNode[] = [];
      if (all.length === 0) {
        groups.push(new GroupNode('No findings', 'Open a file to scan or run a workspace scan', 0, 'clean'));
      }
      if (counts.get('broken')) groups.push(new GroupNode(`BROKEN (${counts.get('broken')})`, 'Forbidden algorithms detected', counts.get('broken')!, 'broken'));
      if (counts.get('vulnerable')) groups.push(new GroupNode(`VULNERABLE (${counts.get('vulnerable')})`, 'Quantum-vulnerable algorithms', counts.get('vulnerable')!, 'vulnerable'));
      if (counts.get('deprecated')) groups.push(new GroupNode(`DEPRECATED (${counts.get('deprecated')})`, 'Will fail audit post-2030', counts.get('deprecated')!, 'deprecated'));
      if (counts.get('info')) groups.push(new GroupNode(`INFO (${counts.get('info')})`, 'Acceptable today', counts.get('info')!, 'info'));
      return groups;
    }
    if (element instanceof GroupNode) {
      if (element.sevKey === 'clean') return [];
      const out: FindingNode[] = [];
      for (const f of this.merged()) {
        if (severityGroup(f.severity) !== element.sevKey) continue;
        out.push(new FindingNode(f, this.context));
      }
      return out;
    }
    return [];
  }

  private merged(): CryptoFinding[] {
    const seen = new Set<string>();
    const out: CryptoFinding[] = [];
    const add = (f: CryptoFinding) => {
      if (!f) return;
      const key = `${f.uri ?? ''}|${f.line ?? -1}|${f.col ?? -1}|${f.algorithmId ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(f);
    };
    for (const list of this.perFile.values()) for (const f of list ?? []) add(f);
    for (const f of this.workspaceFindings ?? []) add(f);
    return out;
  }
}

function severityGroup(s: CryptoFinding['severity']): 'broken' | 'vulnerable' | 'deprecated' | 'info' | 'clean' {
  return s === 'broken' || s === 'vulnerable' || s === 'deprecated' || s === 'info' ? s : 'info';
}

export class GroupNode extends vscode.TreeItem {
  constructor(label: string, sub: string, count: number, public sevKey: 'broken' | 'vulnerable' | 'deprecated' | 'info' | 'clean') {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = sub;
    this.description = `${count} finding${count === 1 ? '' : 's'}`;
    this.iconPath = iconFor(sevKey);
    this.contextValue = 'group';
  }
}

export class FindingNode extends vscode.TreeItem {
  constructor(public finding: CryptoFinding, ctx: vscode.ExtensionContext) {
    const name = String(finding?.algorithmName || finding?.algorithmId || 'finding').toUpperCase();
    const line = (finding?.line ?? 0) + 1;
    const file = finding?.uri ? vscode.workspace.asRelativePath(finding.uri) : '';
    super(file ? `${name}  \u2014 ${file}:${line}` : `${name}  Line ${line}`, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `${finding?.message ?? ''}\n\nRemediation: ${finding?.remediationHint ?? ''}\nFile: ${finding?.fileSnippet ?? ''}`;
    this.description = finding?.remediationHint ?? '';
    this.iconPath = iconFor(finding?.severity ?? 'info');
    this.contextValue = 'finding';
    this.command = { command: 'qirova.findings.jumpTo', title: 'Jump', arguments: [finding] };
  }
}

function iconFor(s: string): vscode.ThemeIcon {
  switch (s) {
    case 'broken': return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    case 'vulnerable': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
    case 'deprecated': return new vscode.ThemeIcon('alert', new vscode.ThemeColor('charts.yellow'));
    case 'info': return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.blue'));
    default: return new vscode.ThemeIcon('shield');
  }
}
