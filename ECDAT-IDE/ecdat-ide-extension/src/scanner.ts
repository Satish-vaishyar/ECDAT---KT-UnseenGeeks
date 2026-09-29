import * as vscode from 'vscode';
import { CryptoDetector, CryptoFinding } from './cryptoDetector';

const TARGET_LANGS = new Set(['python', 'javascript', 'typescript', 'java', 'go', 'csharp', 'cpp', 'c', 'rust', 'ruby']);

export class WorkspaceScanner {
  constructor(private detector: CryptoDetector, private gateway: any) {}

  async scanWorkspace(): Promise<CryptoFinding[]> {
    const findings: CryptoFinding[] = [];
    const cfg = vscode.workspace.getConfiguration('ecdat');
    const includeTests = cfg.get<boolean>('scan.includeTests', false);

    const files = await vscode.workspace.findFiles(
      '**/*.{py,js,jsx,ts,tsx,java,go,cs,cpp,cxx,cc,c,rs,rb}',
      '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/target/**,**/out/**,**/vendor/**}',
      2000
    );
    for (const file of files) {
      const rel = vscode.workspace.asRelativePath(file);
      if (!includeTests && isTestPath(rel)) continue;
      const parts = rel.split('.');
      const lang = langFromExt(parts[parts.length - 1]);
      if (!lang) continue;
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
        if (text.length > 2_000_000) continue;
        const fileFindings = this.detector.scan(text, lang);
        for (const fileFinding of fileFindings) fileFinding.uri = doc.uri.fsPath;
        findings.push(...fileFindings);
      } catch { /* ignore */ }
    }
    findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    return findings;
  }
}

function isTestPath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)(tests?|specs?|__tests__|fixtures)([/_\-.]|$)/.test(p)) return true;
  const base = p.slice(p.lastIndexOf('/') + 1);
  return /(\.(test|spec)\.[a-z0-9]+|_(test|spec)\.[a-z0-9]+)$/.test(base);
}

function langFromExt(ext: string): string | undefined {
  const map: Record<string, string> = { py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', java: 'java', go: 'go', cs: 'csharp', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', c: 'c', rs: 'rust', rb: 'ruby' };
  return map[ext.toLowerCase()];
}

function severityRank(s: CryptoFinding['severity']): number {
  return s === 'broken' ? 4 : s === 'vulnerable' ? 3 : s === 'deprecated' ? 2 : 1;
}
