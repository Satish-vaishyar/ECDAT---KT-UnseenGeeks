import * as vscode from 'vscode';
import { GatewayClient } from './gatewayClient';
import { CryptoDetector, ALGORITHM_REGISTRY, CryptoFinding } from './cryptoDetector';
import { CryptoRemediator, computeFix, hunkToEdit } from './remediator';

export interface MigrationHunk {
  id: string;
  algorithmId: string;
  line: number;
  oldLine: string;
  newLine: string;
  startChar: number;
  endChar: number;
  newText: string;
  kind: string;
  description: string;
}

export class CopilotPanel {
  private panel: vscode.WebviewPanel | undefined;
  onProgress: ((delta: string) => void) | undefined;
  private pendingMigration: Map<string, MigrationHunk[]> = new Map();
  private reviewSeq = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private gateway: GatewayClient,
    private detector: CryptoDetector,
    private remediator: CryptoRemediator
  ) {}

  show(): void {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.Beside); return; }
    this.panel = vscode.window.createWebviewPanel(
      'qirova.copilot', 'QIROVA Copilot',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'ecdat-icon.svg');
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg.type === 'applyHunks') {
        const res = await this.applyMigrationHunks(String(msg.file || ''), Array.isArray(msg.ids) ? msg.ids : []);
        this.panel?.webview.postMessage({ type: 'hunksApplied', file: msg.file, applied: res.applied, skipped: res.skipped });
      }
      if (msg.type === 'chat') {
        const streamed = await this.handleMessageStream(msg.text, (delta: string) => {
          this.panel?.webview.postMessage({ type: 'responseChunk', delta });
        });
        if (streamed === null) {
          const response = await this.handleMessage(msg.text);
          this.panel?.webview.postMessage({ type: 'response', response });
        } else {
          this.panel?.webview.postMessage({ type: 'response', response: streamed, streamed: true });
        }
      }
    });
    this.panel.webview.html = this.getHtml();
  }

  private async handleMessage(text: string): Promise<string> {
    const prompt = text.toLowerCase().trim();

    if (/knowledge|cdkg|\brag\b|\bkb\b/.test(prompt)) return this.handleKnowledge(text);
    if (/\bq-?red\b|\bqred\b/.test(prompt)) return this.handleHardwareRedTeam();
    if (/migrate|move|replace|switch/.test(prompt)) return this.handleMigrate();
    if (/score|grade|readiness/.test(prompt)) return this.handleScore();
    if (/red-?team|attack|bleichenbacher|padding|fuzz/.test(prompt)) return this.handleRedTeam();
    if (/monte\s*carlo|q-?day|quantum/.test(prompt)) return this.handleQday();
    if (/cbom|cyclonedx|export/.test(prompt)) return this.handleCbom();
    if (/scan/.test(prompt)) return this.handleScan();

    const greeting = this.matchGreeting(prompt);
    if (greeting) return greeting;
    return (await this.handleAiChat(text)) ?? this.getWelcome();
  }

  private matchGreeting(prompt: string): string | null {
    if (/^(hi|hii+|hello|hey|yo|namaste)\.?$/.test(prompt)) {
      return '### Hi! I\'m QIROVA Copilot\n\nQuantum-security assistant for PQC migration. ' +
        'Try **migrate**, **score**, **red-team**, **q-day**, **cbom**, **scan** — or just **ask anything** in plain words.';
    }
    if (/^(who are you|what are you|your name|about yourself)\??$/.test(prompt)) {
      return '### QIROVA Copilot\n\nI\'m the in-IDE assistant for post-quantum migration: ' +
        'crypto misuse detection (models 01–06), quantum risk scoring (25–27), knowledge search (12–24), ' +
        'and DeepSeek-class code reasoning (07–11) via the gateway. Ask me anything, or run **scan**.';
    }
    if (/^(thanks|thank you|thx|dhanyavad[a]?)\b/.test(prompt)) {
      return 'You\'re welcome! Stay quantum-safe. Run **scan** anytime for a fresh review.';
    }
    if (/^(bye|goodbye|see you)\b/.test(prompt)) {
      return 'Goodbye! Your findings stay in the side panels for later.';
    }
    return null;
  }

  private aiConfig(): { enabled: boolean; model: string; stream: boolean; temperature: number; maxTokens: number } {
    const cfg = vscode.workspace.getConfiguration('ecdat');
    return {
      enabled: cfg.get<boolean>('ai.enabled', true) !== false,
      model: cfg.get<string>('ai.model', 'deepseek_coder') || 'deepseek_coder',
      stream: cfg.get<boolean>('ai.stream', true) !== false,
      temperature: cfg.get<number>('ai.temperature', 0.2) ?? 0.2,
      maxTokens: cfg.get<number>('ai.maxTokens', 1024) ?? 1024
    };
  }

  private buildChatMessages(text: string): { role: string; content: string }[] {
    const system = 'You are QIROVA, a post-quantum cryptography migration assistant inside a code IDE. ' +
      'Answer concisely in Markdown. When crypto algorithms are mentioned, name the NIST PQC replacement ' +
      '(RSA/ECDSA/ECDH -> ML-KEM-768 or ML-DSA-65, MD5/SHA-1 -> SHA-256/BLAKE3, DES/3DES/RC4 -> AES-256-GCM).';
    const file = vscode.window.activeTextEditor?.document;
    let user = text;
    if (file && file.uri.scheme === 'file') {
      const name = file.fileName.split(/[/\\]/).pop() || 'active file';
      user += `\n\nActive file: ${name} (${file.languageId})\n\`\`\`\n${file.getText().slice(0, 2000)}\n\`\`\``;
    }
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  private formatAiResult(model: string, out: any): string | null {
    if (out === undefined || out === null) return null;
    const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
    if (!text.trim()) return null;
    return `### QIROVA AI (\`${model}\`)\n\n${text.slice(0, 4000)}`;
  }

  private async handleAiChat(text: string): Promise<string | null> {
    try {
      const ai = this.aiConfig();
      if (!ai.enabled) return null;
      const gw: any = this.gateway;
      if (typeof gw.chat !== 'function') return null;
      if (!(await gw.ping())) return null;
      const r = await gw.chat(ai.model, this.buildChatMessages(text), ai.temperature, ai.maxTokens);
      const out = r?.metadata?.text ?? r?.metadata?.model_output;
      return this.formatAiResult(ai.model, out);
    } catch {
      return null;
    }
  }

  private async handleMessageStream(text: string, onDelta: (delta: string) => void): Promise<string | null> {
    try {
      const ai = this.aiConfig();
      if (!ai.enabled || !ai.stream) return null;
      const gw: any = this.gateway;
      if (typeof gw.chatStream !== 'function') return null;
      const prompt = text.toLowerCase().trim();
      // Greetings and keyword shortcuts answer instantly through the normal path.
      if (this.matchGreeting(prompt)) return null;
      if (/migrate|move|replace|switch|score|grade|readiness|red-?team|q-?red|qred|attack|bleichenbacher|padding|fuzz|monte\s*carlo|q-?day|quantum|cbom|cyclonedx|export|scan|knowledge|cdkg|\brag\b|\bkb\b/.test(prompt)) return null;
      const full = await gw.chatStream(ai.model, this.buildChatMessages(text), onDelta, ai.temperature, ai.maxTokens);
      if (!full || !String(full).trim()) return null;
      return `### QIROVA AI (\`${ai.model}\`)\n\n${String(full).slice(0, 4000)}`;
    } catch {
      return null;
    }
  }

  private async handleMigrate(): Promise<string> {
    const file = vscode.window.activeTextEditor?.document;
    if (!file) return '### No file open\n\nOpen a file with crypto code first.';
    const findings = this.detector.scan(file.getText(), file.languageId);
    if (!findings.length) return '### No crypto usage detected\n\nThe active file has no cryptographic patterns.';
    let md = '### PQC Migration Snippets\n\n';
    for (const f of findings.slice(0, 8)) {
      const spec = ALGORITHM_REGISTRY[f.algorithmId];
      const snippet = this.remediator.getMigrationSnippet(f, file.languageId);
      md += '---\n\n';
      md += '**' + f.algorithmId.toUpperCase() + '** \u2192 ' + f.remediationHint + '\n\n';
      if (spec?.description) md += spec.description + '\n\n';
      if (snippet) {
        if (snippet.importStatement) {
          md += 'Import:\n\n```\n' + snippet.importStatement + '\n```\n\n';
        }
        md += 'Migration code:\n\n```\n' + snippet.after + '\n```\n\n';
        if (snippet.description) md += '> ' + snippet.description + '\n\n';
      } else {
        md += 'Replace with: **' + f.remediationHint + '**\n\n';
      }
    }
    if (findings.length > 8) md += '> ' + (findings.length - 8) + ' more findings.\n\n';
    const ai = await this.aiMigrationSection(file.getText(), file.languageId, findings);
    if (ai) md += ai;
    try {
      const hunks = this.buildMigrationHunks(file);
      if (hunks.length) {
        this.pendingMigration.set(this.migrationKeyFor(file.uri.fsPath), hunks);
        void this.remediator.review.show(file.uri.fsPath, hunks);
        void this.previewFirstHunk(file, hunks);
        md += '\n> Review **' + hunks.length + '** suggested change(s) below ' + String.fromCharCode(8212) + ' Accept each one, or Accept All.\n' + this.migrationPayload(file, hunks) + '\n';
      }
    } catch { /* review is best-effort */ }
    return md;
  }

  private async aiMigrationSection(code: string, language: string, findings: CryptoFinding[]): Promise<string | null> {
    try {
      const cfg = this.aiConfig();
      const gw: any = this.gateway;
      if (!cfg.enabled || typeof gw.chat !== 'function' || !(await gw.ping())) return null;
      const flagged = findings.slice(0, 8).map(f => `- ${f.algorithmId.toUpperCase()} (line ${f.line + 1}): ${f.message || ''} -> migrate to ${f.remediationHint}`).join('\n');
      const messages = [
        { role: 'system', content: 'You are QIROVA, a post-quantum migration specialist. Rewrite the given code, replacing every flagged primitive with its stated PQC replacement. Output ONE unified diff-style code block for the whole file, then a 3-bullet migration checklist. Be concrete and concise.' },
        { role: 'user', content: `Language: ${language}\n\nFlagged findings:\n${flagged}\n\nFile:\n\`\`\`\n${code.slice(0, 6000)}\n\`\`\`` },
      ];
      const r = await gw.chat(cfg.model, messages, cfg.temperature, cfg.maxTokens);
      const out = r?.metadata?.text ?? r?.metadata?.model_output;
      const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
      if (!text || !text.trim()) return null;
      return `\n### AI migration (LIVE)\n\n${text.slice(0, 4000)}\n`;
    } catch {
      return null;
    }
  }

  private async previewFirstHunk(doc: any, hunks: MigrationHunk[]): Promise<void> {
    try {
      const first = hunks.find((h) => h.kind === 'fix') ?? hunks[0];
      if (!first) return;
      await this.remediator.previewMigrationHunk(doc.uri.fsPath, first.line, first.startChar);
    } catch { /* preview is best-effort */ }
  }

  private migrationKeyFor(filePath: string): string {
    return (filePath || '').toLowerCase();
  }

  private buildMigrationHunks(doc: any): MigrationHunk[] {
    const hunks: MigrationHunk[] = [];
    try {
      const text: string = doc.getText();
      const lang: string = doc.languageId;
      const findings = this.detector.scan(text, lang).slice(0, 8);
      const seenImports: Record<string, boolean> = {};
      const seq = this.reviewSeq++;
      let n = 0;
      for (const f of findings) {
        const fix = computeFix(f, lang);
        if (fix) {
          try {
            const lineText: string = doc.lineAt(f.line).text;
            const sc = Math.max(0, Math.min(fix.range.start.character, lineText.length));
            const ec = Math.max(sc, Math.min(fix.range.end.character, lineText.length));
            hunks.push({
              id: 'm' + seq + 'h' + (n++),
              algorithmId: f.algorithmId,
              line: f.line,
              oldLine: lineText,
              newLine: lineText.slice(0, sc) + fix.newText + lineText.slice(ec),
              startChar: sc, endChar: ec, newText: fix.newText,
              kind: 'fix', description: f.remediationHint || ''
            });
          } catch { /* bad line: skip */ }
        }
        try {
          const snippet = this.remediator.getMigrationSnippet(f, lang);
          const firstImport = snippet && snippet.importStatement ? snippet.importStatement.split('\n')[0].trim() : '';
          if (firstImport && !seenImports[firstImport] && text.indexOf(firstImport) === -1) {
            seenImports[firstImport] = true;
            hunks.push({
              id: 'm' + seq + 'h' + (n++),
              algorithmId: f.algorithmId,
              line: 0,
              oldLine: '',
              newLine: snippet!.importStatement,
              startChar: 0, endChar: 0, newText: snippet!.importStatement + '\n',
              kind: 'import', description: 'Add import: ' + firstImport
            });
          }
        } catch { /* ignore */ }
      }
    } catch { /* never break migrate on review errors */ }
    return hunks;
  }

  private circuitPayload(file: string, circuits: Array<{ id: string; title: string; svg: string }>): string {
    const data = { file, fileName: 'Quantum circuits', circuits };
    const raw = JSON.stringify(data);
    const safe = raw.split('<').join('\\u003c').split('>').join('\\u003e');
    return '<script type="application/json" class="qirova-circuits">' + safe + '</script>';
  }

  private appendCircuitPayload(md: string, entries: any[], file: string, titleOf: (e: any) => string): string {
    try {
      const circuits: Array<{ id: string; title: string; svg: string }> = [];
      let n = 0;
      for (const e of entries || []) {
        if (circuits.length >= 6) break;
        const svg = e ? (e as any).circuit_svg : null;
        if (typeof svg !== 'string' || !svg || !svg.startsWith('<svg')) continue;
        circuits.push({ id: 'c' + (n++), title: titleOf(e), svg });
      }
      if (!circuits.length) return md;
      return md + '\n' + this.circuitPayload(file, circuits) + '\n';
    } catch {
      return md;
    }
  }

  private migrationPayload(doc: any, hunks: MigrationHunk[]): string {
    const data = { file: doc.uri.fsPath, fileName: this.baseName(doc.uri.fsPath), hunks };
    const raw = JSON.stringify(data);
    const safe = raw.split('<').join('\\u003c').split('>').join('\\u003e');
    return '<script type="application/json" class="qirova-hunks">' + safe + '</script>';
  }

  async applyMigrationHunks(filePath: string, ids: string[]): Promise<{ applied: string[]; skipped: Array<{ id: string; reason: string }> }> {
    const applied: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      const hunks = this.pendingMigration.get(this.migrationKeyFor(filePath)) ?? [];
      const byId: Record<string, MigrationHunk> = {};
      for (const h of hunks) byId[h.id] = h;
      const wanted = (ids || []).filter((id, i, a) => a.indexOf(id) === i);
      const edit = new vscode.WorkspaceEdit();
      for (const id of wanted) {
        const h = byId[id];
        if (!h) { skipped.push({ id, reason: 'unknown change' }); continue; }
        const te = hunkToEdit(doc, h);
        if (!te) { skipped.push({ id, reason: 'file changed since review' }); continue; }
        edit.replace(doc.uri, te.range, te.newText);
        applied.push(id);
      }
      if (applied.length) {
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) return { applied: [], skipped: wanted.map((id) => ({ id, reason: 'edit rejected' })) };
      }
      try {
        this.pendingMigration.set(this.migrationKeyFor(filePath), hunks.filter((h) => wanted.indexOf(h.id) === -1));
      } catch { /* ignore */ }
      try { this.remediator.review.drop(filePath, applied); } catch { /* ignore */ }
      return { applied, skipped };
    } catch (e: any) {
      return { applied, skipped: (ids || []).map((id) => ({ id, reason: e?.message ?? 'failed' })) };
    }
  }

  private async handleScore(): Promise<string> {
    const file = vscode.window.activeTextEditor?.document;
    if (!file) return 'Open a file first.';
    const findings = this.detector.scan(file.getText(), file.languageId);
    const { score, worst } = this.detector.computeFileScore(findings);
    let md = '### PQC Readiness\n\n| Metric | Value |\n|---|---|\n| Score | **' + score + '/100** |\n| Worst | ' + worst + ' |\n| Findings | ' + findings.length + ' |';
    const live = await this.liveScoreVerdicts(file.getText(), file.languageId, findings);
    if (live) md += '\n' + live;
    return md;
  }

  private async liveScoreVerdicts(code: string, language: string, findings: CryptoFinding[]): Promise<string | null> {
    try {
      const gw: any = this.gateway;
      if (!code || !(await gw.ping())) return null;
      const rows: string[] = [];
      if (typeof gw.scanSource === 'function') {
        const s = await gw.scanSource(code.slice(0, 8000), language).catch(() => null);
        const p = s?.metadata?.model01_probability;
        const label = s?.metadata?.model01_label;
        if (typeof p === 'number') {
          rows.push(`| Model 01 AST-CryptoNet | misuse probability **${p.toFixed(2)}** (${label ?? 'n/a'}) | model |`);
        }
      }
      const worstAlg = findings.length ? findings.slice().sort((a, b) => b.severity.localeCompare(a.severity))[0].algorithmId.toUpperCase() : null;
      if (worstAlg && typeof gw.getRiskScore === 'function') {
        const q = await gw.getRiskScore(worstAlg).catch(() => null);
        const mo = q?.metadata?.model_output && typeof q.metadata.model_output === 'object' ? q.metadata.model_output : null;
        const qscore = q?.metadata?.qars_score ?? mo?.qars_score ?? q?.findings?.[0]?.confidence;
        const tier = q?.metadata?.tier ?? mo?.risk_tier ?? q?.quantum_risk;
        if (qscore !== undefined && qscore !== null) {
          rows.push(`| Model 25 QARS (${worstAlg}) | score **${typeof qscore === 'number' ? qscore : qscore}**${tier ? `, tier ${tier}` : ''} | model |`);
        }
      }
      if (!rows.length) return null;
      return '\n### Model scoring (LIVE)\n\n| Source | Verdict | Kind |\n|---|---|---|\n' + rows.join('\n');
    } catch {
      return null;
    }
  }

  private async handleHardwareRedTeam(): Promise<string> {
    try {
      const gw: any = this.gateway;
      if (typeof gw.getHardwareStatus !== 'function' || !(await gw.ping())) {
        return '### Real-QPU red team\n\nBackend gateway unreachable.';
      }
      const st = await gw.getHardwareStatus().catch(() => null);
      const meta = (st && st.metadata) || {};
      let md = '\n### Real-QPU red team (IBM Quantum hardware)\n\n';
      md += 'Simulation is free and runs with **red-team**. Hardware spends real money ($' + (meta.rate_per_minute_usd ?? 96) + '/min).\n\n';
      md += '| Item | Value |\n|---|---|\n';
      md += '| Token configured | ' + (meta.token_configured ? 'YES' : 'NO') + ' |\n';
      md += '| Note | ' + (meta.note ?? 'n/a') + ' |\n';
      const backs = Array.isArray(meta.backends) ? meta.backends : [];
      if (backs.length) {
        md += '\n| Backend | Qubits | Queue |\n|---|---|---|\n';
        for (const b of backs.slice(0, 5)) md += '| ' + (b.name ?? '?') + ' | ' + (b.qubits ?? '?') + ' | ' + (b.queue_depth ?? '?') + ' |\n';
      }
      const est = typeof gw.estimateHardware === 'function'
        ? await gw.estimateHardware({ targets: ['RSA-15', 'AES-4'], shots: 256 }).catch(() => null)
        : null;
      const items = (est && est.metadata && est.metadata.items) || [];
      if (items.length) {
        md += '\n| Target | Qubits | Fits | Est. USD |\n|---|---|---|---|\n';
        for (const it of items) {
          md += '| ' + (it.target ?? '?') + ' | ' + (it.qubits ?? '?') + ' | ' + (it.fits_hardware ? 'yes' : 'no') + ' | $' + ((it.estimate && it.estimate.cost_usd) ?? '?') + ' |\n';
        }
        md += '\n> Total estimate: **$' + ((est && est.metadata && est.metadata.total_estimated_usd) ?? '?') + '**. Nothing is spent by this message.\n';
        md = this.appendCircuitPayload(md, items, 'qred', (it) => {
          const t = (it.target ?? it.algorithm ?? 'circuit');
          const nq = (it.num_qubits ?? it.qubits);
          return (nq !== undefined && nq !== null) ? String(t) + ' (' + nq + ' qubits)' : String(t);
        });
      }
      md += '\n> To spend, run the `QIROVA: Run Real-QPU Red Team (confirms spend)` command from the palette.\n';
      const file = vscode.window.activeTextEditor?.document;
      const rtFindings = file ? this.detector.scan(file.getText(), file.languageId) : [];
      if (rtFindings.length) {
        md += '\n### Red-Team Review\n\n';
        md += '| Algorithm | Vulnerability | Fix | Line |\n|---|---|---|---\n';
        for (const f of rtFindings.slice(0, 12)) {
          md += '| ' + f.algorithmId.toUpperCase() + ' | ' + (f.message || '-') + ' | **' + f.remediationHint + '** | ' + (f.line + 1) + ' |\n';
        }
      }
      return md;
    } catch {
      return '### Real-QPU red team\n\nUnavailable right now.';
    }
  }

  private async liveRedTeamCampaign(): Promise<string | null> {    try {
      const gw: any = this.gateway;
      if (typeof gw.runRedTeam !== 'function' || !(await gw.ping())) return null;
      const r = await gw.runRedTeam({ phase: 0 }).catch(() => null);
      const camp = r?.metadata?.campaign ?? r?.campaign;
      if (!camp || typeof camp !== 'object') return null;
      const s = camp.summary ?? {};
      let md = '\n### Quantum red-team campaign (LIVE)\n\n';
      md += '| Metric | Value |\n|---|---|\n';
      md += '| Attacks | ' + (s.total_attacks ?? '?') + ' |\n';
      md += '| Broken (classical) | **' + (s.broken_count ?? '?') + '** |\n';
      md += '| PQC resistant | ' + (s.resistant_count ?? '?') + ' |\n';
      md += '| Cost | $' + (s.total_cost_usd ?? 0) + ' (simulation) |\n';
      const p1 = Array.isArray(camp.phase1) ? camp.phase1 : [];
      if (p1.length) {
        md += '\n| Target | Attack | Broken |\n|---|---|---|\n';
        for (const a of p1.slice(0, 8)) md += '| ' + (a.algorithm ?? '?') + ' | ' + (a.attack ?? '?') + ' | ' + (a.broken ? 'YES' : 'no') + ' |\n';
      }
      const p3 = Array.isArray(camp.phase3) ? camp.phase3 : [];
      if (p3.length) {
        md += '\n| Algorithm | Break year | Status |\n|---|---|---|\n';
        for (const p of p3.slice(0, 7)) md += '| ' + (p.algorithm ?? '?') + ' | ' + (p.break_year ?? '?') + ' | ' + (p.status ?? '?') + ' |\n';
      }
      md = this.appendCircuitPayload(md, p1, 'redteam', (a) => {
        const algo = (a.algorithm ?? a.target ?? 'circuit');
        const atk = (a.attack ?? 'circuit');
        const nq = (a.num_qubits ?? a.qubits);
        return (nq !== undefined && nq !== null)
          ? String(algo) + ' \u00b7 ' + String(atk) + ' (' + nq + ' qubits)'
          : String(algo) + ' \u00b7 ' + String(atk);
      });
      return md;
    } catch {
      return null;
    }
  }

  private async handleRedTeam(): Promise<string> {
    const file = vscode.window.activeTextEditor?.document;
    const findings = file ? this.detector.scan(file.getText(), file.languageId) : [];
    let md = '';
    const live = await this.liveModelVerdicts(file?.getText() ?? '', file?.languageId ?? 'python');
    if (live) md += live + '\n';
    const camp = await this.liveRedTeamCampaign();
    if (camp) md += camp;
    if (!findings.length && !live) return 'No crypto weaknesses detected.';
    md += '### Red-Team Review\n\n| Algorithm | Vulnerability | Fix | Line |\n|---|---|---|---|\n';
    for (const f of findings.slice(0, 12)) {
      md += '| ' + f.algorithmId.toUpperCase() + ' | ' + (f.message || '-') + ' | **' + f.remediationHint + '** | ' + (f.line + 1) + ' |\n';
    }
    return md;
  }

  private async liveModelVerdicts(code: string, language: string): Promise<string | null> {
    try {
      const gw: any = this.gateway;
      if (!code || typeof gw.getMisuse !== 'function' || !(await gw.ping())) return null;
      const rows: string[] = [];
      const misuse = await gw.getMisuse(code.slice(0, 4000), language).catch(() => null);
      const mf = misuse?.findings?.[0];
      if (mf) {
        rows.push(`| Model 06 MisuseDetector | **${mf.algorithm ?? mf.status}** (conf ${(Number(mf.confidence) || 0).toFixed(2)}) | ${mf.recommendation ?? '-'} | model |`);
      }
      if (typeof gw.getTrapdoor === 'function') {
        const trap = await gw.getTrapdoor(code.slice(0, 4000)).catch(() => null);
        const hits: any[] = Array.isArray(trap?.findings) ? trap.findings : [];
        rows.push(hits.length
          ? `| Model 23 Trapdoor | **${hits.length} IOC hit(s): ${hits.slice(0, 3).map((h: any) => h.algorithm ?? h.id).join(', ')}** | isolate + rotate | model |`
          : `| Model 23 Trapdoor | no trapdoor IOCs | - | model |`);
      }
      if (typeof gw.classify === 'function') {
        const cls = await gw.classify(code.slice(0, 4000), language).catch(() => null);
        const out: any = cls?.metadata?.model_output ?? cls?.findings?.[0] ?? null;
        if (out && typeof out === 'object') {
          const fam = out.level_1_family ?? out.family ?? out.category ?? '?';
          const alg = out.level_2_algorithm ?? out.algorithm ?? out.algorithmId ?? '?';
          const risk = out.level_3_quantum_risk ?? out.quantum_risk ?? out.risk ?? out.severity ?? '?';
          rows.push(`| Model 04 Classifier | **${fam}/${alg} risk ${risk}** | migrate | model |`);
        }
      }
      if (typeof gw.getRobust === 'function') {
        const rob = await gw.getRobust(code.slice(0, 4000)).catch(() => null);
        const prob = rob?.metadata?.adversarial_probability ?? rob?.metadata?.adv_prob
          ?? rob?.adversarial_probability ?? rob?.findings?.[0]?.adversarial_probability ?? null;
        if (prob !== null && prob !== undefined) {
          rows.push(`| Model 05 Robust (adv prob ${prob}) | adversarial risk | harden inputs | model |`);
        }
      }
      if (!rows.length) return null;
      return '### Model verdicts (LIVE)\n\n| Source | Verdict | Action | Line |\n|---|---|---|---|\n' + rows.join('\n');
    } catch {
      return null;
    }
  }

  private async handleQday(): Promise<string> {
    const live = await this.gateway.ping();
    if (!live) return '### Q-Day Monte Carlo (mock)\n\n| Percentile | Year |\n|---|---|\n| P5 | 2033 |\n| **P50** | **2038** |\n| P95 | 2046 |\n\nP(exposure by 2038): **71%**';
    try {
      const r = await this.gateway.runMonteCarlo({ iterations: 100000 });
      let out = this.formatQdayLive(r);
      const extra = await this.liveRiskDetail();
      if (extra) out += extra;
      return out;
    } catch (e: any) {
      return '> Error: ' + e.message;
    }
  }

  private async liveRiskDetail(): Promise<string | null> {
    try {
      const file = vscode.window.activeTextEditor?.document;
      if (!file || file.uri.scheme !== 'file') return null;
      const findings = this.detector.scan(file.getText(), file.languageId);
      if (!findings.length) return null;
      const worst = findings.slice().sort((a, b) => b.severity.localeCompare(a.severity))[0];
      const algo = worst.algorithmId.toUpperCase();
      const gw: any = this.gateway;
      if (!(await gw.ping())) return null;
      let md = '### Quantum risk detail (' + algo + ')\n\n';
      md += '| Source | Value |\n|---|---|\n';
      if (typeof gw.getRiskScore === 'function') {
        const q = await gw.getRiskScore(algo).catch(() => null);
        const mo = (q && q.metadata && q.metadata.model_output && typeof q.metadata.model_output === 'object') ? q.metadata.model_output : null;
        const score = (q && q.metadata && (q.metadata.qars_score ?? (mo && mo.qars_score))) ?? null;
        const tier = (q && q.metadata && (q.metadata.tier ?? (mo && (mo.risk_tier ?? mo.tier)))) ?? (q && q.quantum_risk) ?? null;
        const action = (mo && mo.action_required) ?? null;
        if (score !== null && score !== undefined) md += '| QARS score | ' + score + (tier ? ' (' + tier + ')' : '') + ' |\n';
        if (action) md += '| Action | ' + action + ' |\n';
      }
      if (typeof gw.getHndl === 'function') {
        const h = await gw.getHndl({ algorithm: algo }).catch(() => null);
        const hs = (h && (h.hndl_score ?? (h.metadata && h.metadata.hndl_score))) ?? null;
        const hl = (h && (h.risk_level ?? (h.metadata && h.metadata.risk_level))) ?? null;
        if (hs !== null && hs !== undefined) md += '| HNDL exposure | ' + hs + (hl ? ' (' + hl + ')' : '') + ' |\n';
      }
      if (typeof gw.getForecast === 'function') {
        const f = await gw.getForecast(algo).catch(() => null);
        const fl = (f && (f.forecast_last ?? (f.metadata && (f.metadata.forecast_last ?? (f.metadata.model_output && f.metadata.model_output.forecast_last))))) ?? null;
        if (fl !== null && fl !== undefined) md += '| 30-day forecast | ' + Number(fl).toFixed(2) + ' |\n';
      }
      return md;
    } catch {
      return null;
    }
  }

  private formatQdayLive(r: any): string {
    let md = '### Q-Day Monte Carlo (live)\n\n';
    const m = (r && typeof r === 'object') ? r : {};
    const meta = (m.metadata && typeof m.metadata === 'object') ? m.metadata : {};
    const q = (meta.qday && typeof meta.qday === 'object') ? meta.qday : {};
    const g = (k: string) => q[k] ?? m[k] ?? meta[k];
    const yr = (v: any) => (typeof v === 'number' ? String(Math.round(v)) : String(v ?? '?'));
    const band = (v: any) => Array.isArray(v) && v.length >= 2 ? yr(v[0]) + ' - ' + yr(v[v.length - 1]) : (v === undefined ? undefined : String(v));
    const rows: Array<[string, string]> = [];
    const p5 = g('p5_year') ?? g('p5');
    const p25 = g('p25_year');
    const p50 = g('p50_year') ?? g('p50') ?? g('year_p50') ?? g('median_year');
    const p75 = g('p75_year');
    const p95 = g('p95_year') ?? g('p95') ?? g('year_p95');
    if (p5 !== undefined) rows.push(['P5', yr(p5)]);
    if (p25 !== undefined) rows.push(['P25', yr(p25)]);
    if (p50 !== undefined) rows.push(['**P50**', '**' + yr(p50) + '**']);
    if (p75 !== undefined) rows.push(['P75', yr(p75)]);
    if (p95 !== undefined) rows.push(['P95', yr(p95)]);
    const ana = g('analytical_p50_year');
    if (ana !== undefined) rows.push(['Analytical P50', yr(ana) + (g('analytical_crosscheck_pass') ? ' (crosscheck pass)' : '')]);
    const ci50 = band(g('ci50')); if (ci50 !== undefined) rows.push(['CI 50%', ci50]);
    const ci80 = band(g('ci80')); if (ci80 !== undefined) rows.push(['CI 80%', ci80]);
    const ci95 = band(g('ci95')); if (ci95 !== undefined) rows.push(['CI 95%', ci95]);
    const meanT = g('mean_t_years'); if (meanT !== undefined) rows.push(['Mean horizon', Number(meanT).toFixed(1) + ' yrs']);
    const medT = g('median_t_years'); if (medT !== undefined) rows.push(['Median horizon', Number(medT).toFixed(1) + ' yrs']);
    const stdT = g('std_t_years'); if (stdT !== undefined) rows.push(['Std dev', Number(stdT).toFixed(1) + ' yrs']);
    const sims = g('simulation_count') ?? g('samples') ?? g('n_samples') ?? g('iterations');
    if (sims !== undefined) rows.push(['Simulations', String(sims)]);
    const seed = g('seed'); if (seed !== undefined) rows.push(['Seed', String(seed)]);
    const base = g('base_year'); if (base !== undefined) rows.push(['Base year', String(base)]);
    const ver = g('parameter_version') ?? g('calculation_version');
    if (ver !== undefined) rows.push(['Parameters', String(ver)]);
    const svc = m.docker_service ?? m.model;
    if (svc !== undefined) rows.push(['Backend', String(svc)]);
    if (!rows.length) return md + 'No model fields returned.\n';
    md += '| Estimate | Value |\n|---|---|\n';
    for (const r2 of rows) md += '| ' + r2[0] + ' | ' + r2[1] + ' |\n';
    return md;
  }

  private handleCbom(): string {
    const file = vscode.window.activeTextEditor?.document;
    const findings = file ? this.detector.scan(file.getText(), file.languageId) : [];
    if (!findings.length) return 'No crypto findings to export.';
    let md = '### CycloneDX CBOM\n\n| Algorithm | File | Line | Risk |\n|---|---|---|---|\n';
    for (const f of findings) {
      md += '| ' + f.algorithmId.toUpperCase() + ' | ' + (file?.fileName.split(/[/\\]/).pop() || '-') + ' | ' + (f.line + 1) + ' | ' + f.severity + ' |\n';
    }
    md += '\nRun `QIROVA: Export CBOM (CycloneDX)` from Command Palette to save.';
    return md;
  }

  private async handleScan(): Promise<string> {
    this.postProgress('> Scan started - checking the active file and workspace. Live stages follow.\n');
    const sections: string[] = [];
    let worst: { name: string; text: string; language: string; score: number } | null = null;
    const file = vscode.window.activeTextEditor?.document;
    if (file && file.uri.scheme === 'file') {
      const findings = this.detector.scan(file.getText(), file.languageId);
      const { score } = this.detector.computeFileScore(findings);
      worst = { name: this.baseName(file.fileName), text: file.getText(), language: file.languageId, score };
      let md = '### Scan Complete \u2014 Score: ' + score + '/100\n\n';
      if (!findings.length) {
        md += 'No crypto issues found.';
      } else {
        md += '| # | Algorithm | Line | Severity | Fix |\n|---|---|---|---|---|\n';
        findings.forEach((f, i) => {
          md += '| ' + (i + 1) + ' | ' + f.algorithmId.toUpperCase() + ' | ' + (f.line + 1) + ' | ' + f.severity + ' | ' + f.remediationHint + ' |\n';
        });
      }
      sections.push(md);
    }
    const ws = await this.scanWorkspaceSection();
    if (ws) {
      sections.push(ws.text);
      if (!worst || ws.worstScore < worst.score) worst = ws.worst;
    }
    if (!sections.length) return 'Open a file first.';
    let md = sections.join('\n');
    if (worst) {
      const deep = await this.deepScanSection(worst);
      if (deep) {
        md += '\n' + deep;
      } else {
        md += '\n> Backend gateway unreachable \u2014 showing local scan only. Start the QIROVA backend and run scan again for the 29-model staged audit.\n';
      }
    }
    return md;
  }

  private baseName(p: string): string {
    return (p || '').split(/[/\\]/).pop() || 'file';
  }

  private langForFile(name: string): string {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map: Record<string, string> = {
      py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      java: 'java', go: 'go', cs: 'csharp', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', c: 'c', rs: 'rust'
    };
    return map[ext] || 'plaintext';
  }

  private async scanWorkspaceSection(): Promise<{ text: string; worst: { name: string; text: string; language: string; score: number }; worstScore: number } | null> {
    try {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (!folders.length) return null;
      let uris: any[] = [];
      try {
        const found = vscode.workspace.findFiles(
          '**/*.{py,js,jsx,ts,tsx,java,go,cs,cpp,c,rs}',
          '**/{node_modules,.venv,.git,dist,build,out,target,.next,__pycache__,.hg,.svn}/**',
          200) as unknown as Promise<any[]>;
        let giveUpTimer: any = null;
        const giveUp = new Promise<any[]>((resolve) => {
          giveUpTimer = setTimeout(() => resolve([]), 25000);
          if (giveUpTimer && typeof giveUpTimer.unref === 'function') giveUpTimer.unref();
        });
        uris = (await Promise.race([found, giveUp])) ?? [];
      } catch {
        return null;
      }
      const rows: string[] = [];
      let worst: { name: string; text: string; language: string; score: number } | null = null;
      let totalFindings = 0;
      for (const uri of (uris || []).slice(0, 20)) {
        try {
          const fsPath = (uri as any).fsPath ?? String(uri);
          const name = this.baseName(fsPath);
          try {
            const fsApi: any = vscode.workspace.fs as any;
            if (typeof fsApi.stat === 'function') {
              const st = await fsApi.stat(uri as any);
              if (st && typeof st.size === 'number' && st.size > 262144) continue;
            }
          } catch { /* fall through to read */ }
          const buf = await vscode.workspace.fs.readFile(uri as any);
          const raw: any = (buf as any)?.value ?? buf;
          const text = Buffer.from(raw).toString('utf-8').slice(0, 100000);
          if (!text.trim()) continue;
          const language = this.langForFile(name);
          const findings = this.detector.scan(text, language);
          const { score } = this.detector.computeFileScore(findings);
          const worstAlg = findings.length
            ? findings.slice().sort((a, b) => b.severity.localeCompare(a.severity))[0].algorithmId.toUpperCase()
            : 'clean';
          rows.push('| ' + name + ' | ' + findings.length + ' | ' + score + ' | ' + worstAlg + ' |');
          totalFindings += findings.length;
          if (!worst || score < worst.score) worst = { name, text, language, score };
        } catch { /* unreadable file: skip */ }
      }
      if (!rows.length) return null;
      let md = '### Workspace scan \u2014 ' + rows.length + ' file(s), ' + totalFindings + ' finding(s)\n\n';
      md += '| File | Findings | Score | Worst |\n|---|---|---|---|\n' + rows.join('\n');
      return { text: md, worst: worst!, worstScore: worst!.score };
    } catch {
      return null;
    }
  }

  private postProgress(delta: string): void {
    try {
      const target: any = this.panel;
      target?.webview?.postMessage({ type: 'responseChunk', delta });
    } catch { /* headless tests: no webview */ }
    try { this.onProgress?.(delta); } catch { /* no sink */ }
  }

  private async deepScanSection(worst: { name: string; text: string; language: string; score: number }): Promise<string | null> {
    try {
      const gw: any = this.gateway;
      this.postProgress('> Running 29-model pipeline audit on `' + worst.name + '` \u2014 this takes a few minutes on CPU.\n\n');
      this.postProgress('> **Models in progress** (same backend as the web app: `POST /api/v1/pipeline/audit`)\n'
        + '> | | Stage | Models |\n> |---|---|---|\n'
        + '> | \u2026 | Stage 1 \u2014 Discover | 01\u201303 \u00b7 AST, binary, and entropy discovery |\n'
        + '> | \u2026 | Stage 2 \u2014 Detect misuse | 06 \u00b7 misuse and weak primitive detection |\n'
        + '> | \u2026 | Stage 3 \u2014 Classify and remediate | 04 and 07 \u00b7 classification and remediation |\n'
        + '> | \u2026 | Stage 4 \u2014 Model intelligence | 08\u201329 \u00b7 retrieval, risk, and migration intelligence |\n'
        + '> | \u2026 | Stage 5 \u2014 Assemble report | findings, evidence, and CBOM |\n\n');
      if (typeof gw.runPipeline !== 'function') return null;
      // NOTE: stage plan already posted above; ping only gates the audit call.
      if (!(await gw.ping())) return null;
      const startedAt = Date.now();
      const tick: any = setInterval(() => {
        try { this.postProgress('> ... ' + Math.round((Date.now() - startedAt) / 1000) + 's elapsed - 29 models still working (typically 4-8 min on CPU).\n'); } catch { /* ignore */ }
      }, 60000);
      if (tick && typeof tick.unref === 'function') tick.unref();
      let r: any = null;
      try {
        r = await gw.runPipeline({
          source_code: worst.text.slice(0, 20000),
          language: worst.language,
          filename: worst.name
        });
      } catch {
        r = null;
      } finally {
        clearInterval(tick);
      }
      if (!r || typeof r !== 'object') return null;
      return this.renderAuditReport(worst.name, r);
    } catch {
      return null;
    }
  }

  private renderAuditReport(name: string, r: any): string {
    const sid = r.scan_id ?? r.scanId ?? r.id;
    const n = r.total_findings ?? r.findings?.length ?? '?';
    const risk = r.quantum_risk ?? r.risk ?? '?';
    const sev = r.severity_counts;
    const secs = Math.round((Number(r.duration_ms) || 0) / 1000);
    const intel: Record<string, any> = (r.model_intelligence && typeof r.model_intelligence === 'object') ? r.model_intelligence : {};
    const keys = Object.keys(intel);
    const kl = keys.map((k) => k.toLowerCase());
    const hasKey = (...needles: string[]) => needles.some((x) => kl.some((k) => k.includes(x)));
    const stageHits: number[] = [
      ['model_01', 'model_02', 'model_03', 'robustness', 'entropy', 'ast', 'binary', 'source'].filter((x) => hasKey(x)).length,
      ['model_06', 'misuse', 'vuln_intel'].filter((x) => hasKey(x)).length,
      ['model_04', 'model_07', 'classif', 'remediat', 'migration'].filter((x) => hasKey(x)).length,
      ['model_08', 'model_09', 'model_10', 'model_11', 'cdkg', 'rag', 'model_14', 'model_16', 'sourcetrust', 'tkg', 'gnn', 'quantum_cost', 'trapdoor', 'model_2'].filter((x) => hasKey(x)).length,
      1,
    ];
    const stages: string[][] = [
      ['Stage 1 \u2014 Discover', '01\u201303 \u00b7 AST, binary, and entropy discovery'],
      ['Stage 2 \u2014 Detect misuse', '06 \u00b7 misuse and weak primitive detection'],
      ['Stage 3 \u2014 Classify and remediate', '04 and 07 \u00b7 classification and remediation'],
      ['Stage 4 \u2014 Model intelligence', '08\u201329 \u00b7 retrieval, risk, and migration intelligence'],
      ['Stage 5 \u2014 Assemble report', 'findings, evidence, and CBOM'],
    ];
    let md = '### Deep scan (29 models, LIVE) \u2014 ' + name + '\n\n';
    md += '### Models in progress \u2014 all 5 stages complete \u2713' + (secs ? ' (' + secs + 's)' : '') + '\n\n';
    md += '| | Stage | Models | Evidence |\n|---|---|---|---|\n';
    if (r.partial) {
      md += '> **Partial audit** - deadline reached with ' + (r.model_evidence_count ?? 0) +
        ' model evidence records. Completed stages are marked above; skipped models show no evidence. Run scan again or raise ECDAT_AUDIT_DEADLINE_S.\n\n';
    }
    stages.forEach((s, i) => {
      const note = i === 4 ? 'report assembled' : (stageHits[i] ? stageHits[i] + ' evidence record(s)' : 'ran clean');
      md += '| \u2713 | ' + s[0] + ' | ' + s[1] + ' | ' + note + ' |\n';
    });
    md += '\n';
    md += '| Metric | Value |\n|---|---|\n';
    md += '| Findings | **' + n + '**' +
      (sev ? ` (CRITICAL ${sev.CRITICAL ?? 0}, HIGH ${sev.HIGH ?? 0}, MEDIUM ${sev.MEDIUM ?? 0}, LOW ${sev.LOW ?? 0})` : '') + ' |\n';
    md += '| Quantum risk | **' + risk + '** |\n';
    md += '| Model evidence | ' + (r.model_evidence_count ?? '?') + ' records |\n';
    md += '| Duration | ' + (secs ? secs + 's' : 'n/a') + ' |\n';
    if (sid) md += '| Scan ID | `' + sid + '` |\n';
    md += '\n';
    if (keys.length) {
      md += '### Model evidence\n\n| Model | Evidence |\n|---|---|\n';
      for (const k of keys.slice(0, 15)) md += '| ' + k + ' | ' + this.summarizeIntel(intel[k]) + ' |\n';
      md += '\n';
    }
    const mc = r.migration_cost ?? {};
    const pm = mc.person_months?.expected_p50 ?? mc.expected_p50;
    if (pm !== undefined && pm !== null) {
      md += '> Migration effort (CostNet P50): **' + pm + ' person-months**' +
        (mc.recommended_replacement ? ' \u2192 ' + mc.recommended_replacement : '') + '.\n';
    }
    return md;
  }

  private summarizeIntel(v: any): string {
    if (v === null || v === undefined) return '-';
    if (typeof v === 'string') return v.slice(0, 100);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.length + ' item(s)';
    if (typeof v === 'object') {
      const o = v as Record<string, any>;
      const pick = o.level_2_algorithm ?? o.algorithm ?? o.prediction ?? o.label
        ?? o.status ?? o.found ?? o.match ?? o.risk_tier ?? o.tier;
      const conf = o.confidence ?? o.probability ?? o.score;
      let s = pick !== undefined ? String(pick) : Object.keys(o).slice(0, 3).join(', ');
      if (conf !== undefined && typeof conf === 'number') s += ` (${conf.toFixed(2)})`;
      return s.slice(0, 120);
    }
    return String(v).slice(0, 100);
  }

  private async handleKnowledge(text: string): Promise<string> {
    const query = text.replace(/\b(knowledge|cdkg|rag|kb)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const q = query || text.trim();
    const standards = this.knowledgeStandards(q);
    try {
      const gw: any = this.gateway;
      if (typeof gw.searchCve !== 'function' || !(await gw.ping())) {
        return '### Knowledge (offline)\n\nGateway knowledge base unavailable. ' +
          'Showing local PQC standards for `' + q + '`.\n\n' +
          'Try `knowledge <cve-id or algorithm>` when the gateway is online.\n\n' + standards;
      }
      const r = await gw.searchCve(q, 5).catch(() => null);
      const results: any[] = r?.metadata?.results ?? r?.results ?? r?.findings ?? [];
      let md = '### Knowledge: ' + q + '\n\n';
      if (Array.isArray(results) && results.length) {
        md += '| CVE | Description | CVSS |\n|---|---|---|\n';
        for (const item of results.slice(0, 5)) {
          const id = item.cve_id ?? item.id ?? item.cve ?? '-';
          const desc = String(item.description ?? item.desc ?? item.summary ?? '-').replace(/\n/g, ' ').slice(0, 200);
          const cvss = item.cvss ?? item.score ?? '-';
          md += '| ' + id + ' | ' + desc + ' | ' + cvss + ' |\n';
        }
        md += '\n';
      } else {
        md += 'No CVE results found in the gateway knowledge base for `' + q + '`.\n\n';
      }
      const qLower = q.toLowerCase();
      const temporalAlg = Object.keys(ALGORITHM_REGISTRY).find((id) => {
        const lower = id.toLowerCase();
        return qLower.includes(lower) || qLower.includes(lower.replace(/_/g, '')) ||
          qLower.includes(lower.split(/[_-]+/)[0]);
      });
      const apiMatch = q.match(/[A-Za-z_][\w]*\.[\w]+/);
      const apiToken = apiMatch ? apiMatch[0] : null;
      const settled = await Promise.allSettled([
        typeof gw.getCdkg === 'function' ? gw.getCdkg(q, 2).catch(() => null) : Promise.resolve(null),
        typeof gw.getRag === 'function' ? gw.getRag(q, 2).catch(() => null) : Promise.resolve(null),
        typeof gw.getTrust === 'function' ? gw.getTrust(q).catch(() => null) : Promise.resolve(null),
        temporalAlg && typeof gw.getTemporal === 'function' ? gw.getTemporal(temporalAlg).catch(() => null) : Promise.resolve(null),
        apiToken && typeof gw.getCryptoApi === 'function' ? gw.getCryptoApi(apiToken).catch(() => null) : Promise.resolve(null),
      ]);
      const val = (s: PromiseSettledResult<any>): any => (s.status === 'fulfilled' ? s.value : null);
      const cdkg = val(settled[0]);
      const cdkgHint = cdkg?.metadata?.migration_hint ?? cdkg?.migration_hint ?? null;
      if (cdkgHint !== null && cdkgHint !== undefined && String(cdkgHint).trim()) {
        md += '### Knowledge graph (CDKG)\n\n' +
          String(typeof cdkgHint === 'string' ? cdkgHint : JSON.stringify(cdkgHint)).slice(0, 500) + '\n\n';
      }
      const rag = val(settled[1]);
      const ragDocs: any[] = rag?.metadata?.documents ?? rag?.metadata?.results ?? rag?.documents ?? rag?.results ?? [];
      if (Array.isArray(ragDocs) && ragDocs.length) {
        const top = ragDocs[0];
        const ragText = String(top?.text ?? top?.content ?? top?.description ?? JSON.stringify(top)).slice(0, 300);
        if (ragText.trim()) md += '### RAG\n\n' + ragText + '\n\n';
      } else {
        const ragOut = rag?.metadata?.model_output ?? null;
        if (ragOut !== null && ragOut !== undefined && String(ragOut).trim()) {
          md += '### RAG\n\n' + String(typeof ragOut === 'string' ? ragOut : JSON.stringify(ragOut)).slice(0, 300) + '\n\n';
        }
      }
      const trust = val(settled[2]);
      const trustScore = trust?.metadata?.trust_score ?? trust?.metadata?.score ?? trust?.trust_score ?? null;
      if (trustScore !== null && trustScore !== undefined && String(trustScore).trim()) {
        md += '### Source trust\n\nscore: ' + String(trustScore).slice(0, 200) + '\n\n';
      }
      const temporal = val(settled[3]);
      if (temporal) {
        const tOut: any = temporal?.metadata?.model_output ?? temporal?.metadata ?? null;
        const tText = tOut !== null && tOut !== undefined
          ? String(typeof tOut === 'string' ? tOut : JSON.stringify(tOut)).slice(0, 500) : '';
        if (tText.trim() && tText !== '{}') md += '### Temporal\n\n' + tText + '\n\n';
      }
      const capi = val(settled[4]);
      if (capi) {
        const cOut: any = capi?.metadata?.model_output ?? capi?.metadata ?? null;
        const cText = cOut !== null && cOut !== undefined
          ? String(typeof cOut === 'string' ? cOut : JSON.stringify(cOut)).slice(0, 500) : '';
        if (cText.trim() && cText !== '{}') md += '### API lookup\n\n' + cText + '\n\n';
      }
      md += standards;
      return md;
    } catch {
      return '### Knowledge (offline)\n\nGateway knowledge base unavailable. ' +
        'Showing local PQC standards for `' + q + '`.\n\n' + standards;
    }
  }

  private knowledgeStandards(query: string): string {
    const q = query.toLowerCase();
    const hits = Object.entries(ALGORITHM_REGISTRY).filter(([id]) => {
      const lower = id.toLowerCase();
      const nosym = lower.replace(/[_-]+/g, '');
      const base = lower.split(/[_-]+/)[0];
      if (q.includes(lower) || q.includes(lower.replace(/_/g, '-')) ||
        q.includes(lower.replace(/_/g, ' ')) || (nosym && q.includes(nosym))) return true;
      if (base.length >= 2 && new RegExp('\\b' + base + '\\b').test(q)) return true;
      return false;
    });
    let md = '### Standards (PQC replacements)\n\n';
    if (!hits.length) {
      md += 'No specific algorithm detected in query. Examples: `knowledge rsa`, `knowledge md5`, `knowledge CVE-2024-0001`.\n\n';
      md += '| Algorithm | Replacement |\n|---|---|---|\n';
      for (const id of ['rsa_2048', 'ecdsa_p256', 'md5', 'sha1', 'des']) {
        const spec: any = (ALGORITHM_REGISTRY as any)[id];
        if (spec) md += '| ' + id.toUpperCase() + ' | ' + (spec.remediation || '-') + ' |\n';
      }
      return md;
    }
    md += '| Algorithm | Replacement |\n|---|---|---|\n';
    for (const [id, spec] of hits.slice(0, 8)) {
      md += '| ' + id.toUpperCase() + ' | ' + ((spec as any).remediation || '-') + ' |\n';
    }
    return md;
  }

  private getWelcome(): string {
    return '### QIROVA Copilot\n\nI can help you with:\n\n- **migrate** \u2014 PQC migration code snippets\n- **score** \u2014 Per-file readiness score\n- **red-team** \u2014 Vulnerability review\n- **q-day** \u2014 Quantum Monte Carlo\n- **cbom** \u2014 Export Crypto Bill of Materials\n- **scan** \u2014 Scan active file\n- **knowledge** \u2014 CVE intel + PQC standards (CDKG/RAG)\n- **ask anything** \u2014 AI chat via the gateway (models 08\u201311), with active-file context';
  }

  private getHtml(): string {
    const nonce = Date.now().toString(36);
    return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<style>\n' +
'*{box-sizing:border-box;margin:0;padding:0}\n' +
'body{font-family:var(--vscode-font-family,"Segoe WPC","Segoe UI",system-ui,sans-serif);background:var(--vscode-sideBar-background,#0d1117);color:var(--vscode-sideBar-foreground,#cccccc);font-size:var(--vscode-font-size,13px);display:flex;flex-direction:column;height:100vh}\n' +
'#messages{flex:1;overflow-y:auto;padding:12px 14px}\n' +
'.msg{margin-bottom:14px;line-height:1.65;overflow-wrap:break-word}\n' +
'.user-label{color:var(--vscode-textLink-foreground,#4aa8ff);font-size:12px;font-weight:600;margin-bottom:2px}\n' +
'.bot-label{color:var(--vscode-testing-iconPassed,#3fb950);font-size:11px;font-weight:600;margin-bottom:2px}\n' +
'h3{color:var(--vscode-textLink-foreground,#4aa8ff);margin:10px 0 5px;font-size:14px;font-weight:600}\n' +
'h3:first-child{margin-top:0}\n' +
'p{margin:4px 0}\n' +
'table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12.5px;border:1px solid var(--vscode-panel-border,#21262d)}\n' +
'th,td{padding:7px 10px;border:1px solid var(--vscode-panel-border,#21262d);text-align:left}\n' +
'th{background:var(--vscode-editor-background,#161b22);color:var(--vscode-descriptionForeground,#8b949e);font-weight:600}\n' +
'ul{margin:4px 0 4px 18px;padding:0}\n' +
'li{margin:2px 0}\n' +
'.tbl-cap{font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground,#8b949e);padding:2px 0 4px}\n' +
'code{font-family:var(--vscode-editor-font-family,monospace);background:var(--vscode-textCodeBlock-background,#161b22);padding:1px 5px;border-radius:4px;font-size:12.5px;color:var(--vscode-textPreformat-foreground,#79c0ff)}\n' +
'pre{background:var(--vscode-textCodeBlock-background,#161b22);border:1px solid var(--vscode-panel-border,#21262d);border-radius:6px;padding:10px 12px;margin:6px 0;overflow-x:auto}\n' +
'pre code{background:none;border:none;padding:0;color:var(--vscode-editor-foreground,#cccccc)}\n' +
'blockquote{border-left:2px solid var(--vscode-textBlockQuote-border,#3b5070);background:var(--vscode-textBlockQuote-background,rgba(88,120,180,0.08));padding:3px 10px;margin:4px 0;color:var(--vscode-descriptionForeground,#9aa4b2);font-size:12.5px}\n' +
'strong{color:var(--vscode-editor-foreground,#f0f6fc)}\n' +
'hr{border:none;border-top:1px solid var(--vscode-panel-border,#21262d);margin:10px 0}\n' +
'#input-bar{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--vscode-panel-border,#21262d);background:var(--vscode-sideBar-background,#0d1117)}\n' +
'#input{flex:1;background:var(--vscode-input-background,#161b22);border:1px solid var(--vscode-input-border,#30363d);border-radius:6px;padding:9px 12px;color:var(--vscode-input-foreground,#cccccc);font-size:13px;outline:none;font-family:inherit}\n' +
'#input:focus{border-color:var(--vscode-focusBorder,#4aa8ff)}\n' +
'#input::placeholder{color:var(--vscode-input-placeholderForeground,#8b949e)}\n' +
'#send{background:var(--vscode-button-background,#0e639c);border:1px solid transparent;border-radius:6px;padding:8px 18px;color:var(--vscode-button-foreground,#ffffff);font-weight:600;cursor:pointer;font-family:inherit;font-size:13px}\n' +
'#send:hover{background:var(--vscode-button-hoverBackground,#1177bb)}\n' +
'.quick-actions{padding:8px 14px 2px;display:flex;gap:6px;flex-wrap:wrap}\n' +
'.quick-btn{background:transparent;border:1px solid var(--vscode-panel-border,#30363d);border-radius:20px;padding:6px 14px;color:var(--vscode-descriptionForeground,#8b949e);font-size:12.5px;cursor:pointer;font-family:inherit}\n' +
'.quick-btn:hover{border-color:var(--vscode-textLink-foreground,#4aa8ff);color:var(--vscode-textLink-foreground,#4aa8ff)}\n' +
'.mig{border:1px solid var(--vscode-panel-border,#21262d);border-radius:6px;margin:8px 0;overflow:hidden;background:var(--vscode-editor-background,transparent)}\n' +
'.mig-head{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--vscode-editor-background,#161b22);font-size:12px;border-bottom:1px solid var(--vscode-panel-border,#21262d)}\n' +
'.mig-head strong{color:var(--vscode-editor-foreground,#f0f6fc)}\n' +
'.mig-head span{color:var(--vscode-descriptionForeground,#8b949e)}\n' +
'.mig-actions{margin-left:auto;display:flex;gap:6px}\n' +
'.mig-btn{background:var(--vscode-button-background,#0e639c);border:1px solid transparent;border-radius:6px;padding:5px 12px;color:var(--vscode-button-foreground,#ffffff);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit}\n' +
'.mig-btn:hover{background:var(--vscode-button-hoverBackground,#1177bb)}\n' +
'.mig-btn.reject{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#cccccc)}\n' +
'.mig-btn.reject:hover{background:var(--vscode-button-secondaryHoverBackground,#45494e)}\n' +
'.mig-btn:disabled{opacity:.5;cursor:default}\n' +
'.hunk{border-top:1px solid var(--vscode-panel-border,#21262d);padding:7px 10px}\n' +
'.hunk:first-of-type{border-top:none}\n' +
'.hunk.applied{border-left:2px solid var(--vscode-testing-iconPassed,#3fb950)}\n' +
'.hunk.rejected{opacity:.55}\n' +
'.hunk-title{font-size:11px;color:var(--vscode-descriptionForeground,#8b949e);margin-bottom:5px}\n' +
'.hunk-title code{color:var(--vscode-textPreformat-foreground,#79c0ff)}\n' +
'.old-line{background:var(--vscode-diffEditor-removedTextBackground,rgba(248,81,73,.12));color:var(--vscode-diffEditor-removedTextBorder,#ffa198);border-radius:4px;padding:2px 6px;font-family:var(--vscode-editor-font-family,monospace);font-size:12.5px;white-space:pre-wrap;word-break:break-word}\n' +
'.new-line{background:var(--vscode-diffEditor-insertedTextBackground,rgba(63,185,80,.12));color:var(--vscode-diffEditor-insertedTextBorder,#7ee787);border-radius:4px;padding:2px 6px;font-family:var(--vscode-editor-font-family,monospace);font-size:12.5px;white-space:pre-wrap;word-break:break-word}\n' +
'.hunk-btns{display:flex;gap:6px;margin-top:6px}\n' +
'.hunk-note{font-size:11px;color:var(--vscode-descriptionForeground,#8b949e);margin-top:4px}\n' +
'.qc{border:1px solid var(--vscode-panel-border,#21262d);border-radius:6px;margin:8px 0;overflow:hidden}\n' +
'.qc-head{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--vscode-editor-background,#161b22);font-size:12px;font-weight:600;color:var(--vscode-editor-foreground,#f0f6fc);border-bottom:1px solid var(--vscode-panel-border,#21262d)}\n' +
'.qc-details{padding:7px 10px}\n' +
'.qc-details summary{cursor:pointer;color:var(--vscode-textLink-foreground,#4aa8ff);font-size:12px}\n' +
'.qc-details summary:hover{text-decoration:underline}\n' +
'.qc-svg{background:#ffffff;border-radius:4px;padding:8px;overflow-x:auto;max-height:420px;overflow-y:auto;margin-top:6px}\n' +
'.qc-svg svg{max-width:none}\n' +
'.msg-body.assistant{display:block;background:#000000;background:var(--vscode-editor-background,#000000);border:1px solid var(--vscode-panel-border,#21262d);border-radius:8px;padding:10px 12px}\n' +
'.msg-body.user{display:block;padding:2px 0;color:var(--vscode-descriptionForeground,#9aa4b2)}\n' +
'@keyframes qirova-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}\n' +
'.msg{animation:qirova-in .18s ease-out}\n' +
'@media (prefers-reduced-motion:reduce){.msg{animation:none}}\n' +
'.quick-btn,.mig-btn,#send{transition:background-color .15s ease,border-color .15s ease,color .15s ease}\n' +
'tr{transition:background-color .12s ease}\n' +
'tbody tr:hover{background:var(--vscode-list-hoverBackground,rgba(88,120,180,.08))}\n' +
'::-webkit-scrollbar{width:10px;height:10px}\n' +
'::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background,rgba(121,121,121,.4));border-radius:5px;border:2px solid transparent;background-clip:content-box}\n' +
'::-webkit-scrollbar-thumb:hover{background:var(--vscode-scrollbarSlider-hoverBackground,rgba(100,100,100,.7));border:2px solid transparent;background-clip:content-box}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<div id="messages"></div>\n' +
'<div class="quick-actions">\n' +
'  <button class="quick-btn" data-cmd="migrate">migrate</button>\n' +
'  <button class="quick-btn" data-cmd="score">score</button>\n' +
'  <button class="quick-btn" data-cmd="red-team">red-team</button>\n' +
'  <button class="quick-btn" data-cmd="q-day">q-day</button>\n' +
'  <button class="quick-btn" data-cmd="cbom">cbom</button>\n' +
'  <button class="quick-btn" data-cmd="scan">scan</button>\n' +
'  <button class="quick-btn" data-cmd="qred">q-redteam</button>\n' +
'</div>\n' +
'<div id="input-bar">\n' +
'  <input id="input" placeholder="Type: migrate, score, red-team, q-day, cbom, scan..." autocomplete="off">\n' +
'  <button id="send">Send</button>\n' +
'</div>\n' +
'<script nonce="' + nonce + '">\n' +
'const vscode = acquireVsCodeApi();\n' +
'const msgs = document.getElementById("messages");\n' +
'const input = document.getElementById("input");\n' +
'const sendBtn = document.getElementById("send");\n' +
'\n' +
'function addMsg(text, cls) {\n' +
'  const wrap = document.createElement("div");\n' +
'  wrap.className = "msg";\n' +
'  const label = document.createElement("div");\n' +
'  label.className = cls === "user" ? "user-label" : "bot-label";\n' +
'  label.textContent = cls === "user" ? "You" : "QIROVA";\n' +
'  wrap.appendChild(label);\n' +
'  const body = document.createElement("div");\n' +
'  body.className = "msg-body " + (cls === "user" ? "user" : "assistant");\n' +
'  body.innerHTML = renderMd(text);\n' +
'  wrap.appendChild(body);\n' +
'  msgs.appendChild(wrap);\n' +
'  msgs.scrollTop = msgs.scrollHeight;\n' +
'}\n' +
'\n' +
'function renderMd(s) {\n' +
'  var fences = s.match(/```/g);\n' +
'  if (fences && fences.length % 2 === 1) s += "\\n```";\n' +
'  // code blocks\n' +
'  s = s.replace(/```(\\w*)\\n([\\s\\S]*?)```/g, function(m, lang, code) {\n' +
'    return "<pre><code>" + code.replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</code></pre>";\n' +
'  });\n' +
'  // inline code\n' +
'  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");\n' +
'  // headers\n' +
'  s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>");\n' +
'  // bold\n' +
'  s = s.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");\n' +
'  // blockquote\n' +
'  s = s.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");\n' +
'  // horizontal rule\n' +
'  s = s.replace(/^---$/gm, "<hr>");\n' +
'  // tables\n' +
'  var lines = s.split("\\n");\n' +
'  var inTable = false;\n' +
'  var tableRows = [];\n' +
'  var result = [];\n' +
'  function flushTable() {\n' +
'    if (!inTable) return;\n' +
'    var maxCells = 0;\n' +
'    tableRows.forEach(function(r){ if (r.length > maxCells) maxCells = r.length; });\n' +
'    var caption = "";\n' +
'    if (tableRows.length > 1 && tableRows[0].length === 1 && maxCells > 1) {\n' +
'      caption = tableRows[0][0];\n' +
'      tableRows = tableRows.slice(1);\n' +
'    }\n' +
'    var single = tableRows.every(function(r){return r.length <= 1});\n' +
'    if (single) {\n' +
'      result.push("<ul>");\n' +
'      tableRows.forEach(function(r){ result.push("<li>" + r[0] + "</li>"); });\n' +
'      result.push("</ul>");\n' +
'    } else {\n' +
'      if (caption) result.push("<div class=\\"tbl-cap\\">" + caption + "</div>");\n' +
'      result.push("<table>");\n' +
'      tableRows.forEach(function(r){ while (r.length < maxCells) r.push(""); result.push("<tr>" + r.map(function(c){return "<td>" + c + "</td>"}).join("") + "</tr>"); });\n' +
'      result.push("</table>");\n' +
'    }\n' +
'    tableRows = []; inTable = false;\n' +
'  }\n' +
'  for (var i = 0; i < lines.length; i++) {\n' +
'    var line = lines[i];\n' +
'    if (line.match(/^\\|(.+)\\|$/)) {\n' +
'      var cells = line.split("|").filter(function(c){return c.trim()}).map(function(c){return c.trim()});\n' +
'      if (cells.every(function(c){return c.trim().match(/^[\\s:-]+$/)})) {\n' +
'        continue;\n' +
'      }\n' +
'      inTable = true; tableRows.push(cells);\n' +
'    } else {\n' +
'      flushTable();\n' +
'      result.push(line);\n' +
'    }\n' +
'  }\n' +
'  flushTable();\n' +
'  s = result.join("\\n");\n' +
'  s = s.replace(/>\\n+</g, "><");\n' +
'  // line breaks\n' +
'  s = s.replace(/\\n/g, "<br>");\n' +
'  return s;\n' +
'}\n' +
'\n' +
'function escHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}\n' +
'function markHunkRejected(card, note){ if(!card || card.dataset.done) return; card.dataset.done = "1"; card.classList.add("rejected"); var btns = card.querySelector(".hunk-btns"); if (btns) btns.remove(); var p = document.createElement("div"); p.className = "hunk-note"; p.textContent = note; card.appendChild(p); }\n' +
'function markHunkApplied(card){ if(!card || card.dataset.done) return; card.dataset.done = "1"; card.classList.add("applied"); var btns = card.querySelector(".hunk-btns"); if (btns) btns.remove(); var p = document.createElement("div"); p.className = "hunk-note"; p.textContent = "Accepted and applied."; card.appendChild(p); }\n' +
'function wireMigrationCards(root){\n' +
'  var scripts = root.querySelectorAll("script.qirova-hunks");\n' +
'  for (var i=0;i<scripts.length;i++) {\n' +
'    (function(el){\n' +
'      var data; try { data = JSON.parse(el.textContent); } catch(e){ return; }\n' +
'      var hunks = data.hunks || [];\n' +
'      if (!hunks.length) return;\n' +
'      var box = document.createElement("div");\n' +
'      box.className = "mig";\n' +
'      var head = document.createElement("div");\n' +
'      head.className = "mig-head";\n' +
'      head.innerHTML = "<strong>" + hunks.length + " suggested change(s)</strong><span>" + escHtml(data.fileName || "") + "</span>";\n' +
'      var acts = document.createElement("div");\n' +
'      acts.className = "mig-actions";\n' +
'      var acceptAll = document.createElement("button");\n' +
'      acceptAll.className = "mig-btn";\n' +
'      acceptAll.textContent = "Accept All";\n' +
'      var rejectAll = document.createElement("button");\n' +
'      rejectAll.className = "mig-btn reject";\n' +
'      rejectAll.textContent = "Reject All";\n' +
'      acts.appendChild(acceptAll); acts.appendChild(rejectAll);\n' +
'      head.appendChild(acts); box.appendChild(head);\n' +
'      var cards = {};\n' +
'      hunks.forEach(function(h){\n' +
'        var card = document.createElement("div");\n' +
'        card.className = "hunk"; card.dataset.hunk = h.id;\n' +
'        var title = document.createElement("div");\n' +
'        title.className = "hunk-title";\n' +
'        title.innerHTML = "<code>" + escHtml(h.algorithmId || "") + "</code> line " + (h.line + 1) + (h.kind === "import" ? " (import)" : "") + (h.description ? " - " + escHtml(h.description) : "");\n' +
'        card.appendChild(title);\n' +
'        if (h.oldLine) { var o = document.createElement("div"); o.className = "old-line"; o.textContent = "- " + h.oldLine; card.appendChild(o); }\n' +
'        var nn = document.createElement("div"); nn.className = "new-line"; nn.textContent = "+ " + h.newLine; card.appendChild(nn);\n' +
'        var btns = document.createElement("div"); btns.className = "hunk-btns";\n' +
'        var acc = document.createElement("button"); acc.className = "mig-btn"; acc.textContent = "Accept";\n' +
'        var rej = document.createElement("button"); rej.className = "mig-btn reject"; rej.textContent = "Reject";\n' +
'        acc.addEventListener("click", function(){ setBusy(true); vscode.postMessage({ type: "applyHunks", file: data.file, ids: [h.id] }); });\n' +
'        rej.addEventListener("click", function(){ markHunkRejected(card, "Rejected - not applied."); });\n' +
'        btns.appendChild(acc); btns.appendChild(rej); card.appendChild(btns);\n' +
'        box.appendChild(card); cards[h.id] = card;\n' +
'      });\n' +
'      function setBusy(b){ acceptAll.disabled = b; rejectAll.disabled = b; Object.keys(cards).forEach(function(k){ var q = cards[k].querySelectorAll("button"); for (var j=0;j<q.length;j++) q[j].disabled = b; }); }\n' +
'      acceptAll.addEventListener("click", function(){ setBusy(true); vscode.postMessage({ type: "applyHunks", file: data.file, ids: hunks.map(function(h){ return h.id; }) }); });\n' +
'      rejectAll.addEventListener("click", function(){ hunks.forEach(function(h){ markHunkRejected(cards[h.id], "Rejected - not applied."); }); });\n' +
'      box._qirova = { file: data.file, cards: cards, setBusy: setBusy };\n' +
'      el.parentNode.insertBefore(box, el.nextSibling);\n' +
'    })(scripts[i]);\n' +
'  }\n' +
'}\n' +
'function wireCircuitCards(root){\n' +
'  var scripts = root.querySelectorAll("script.qirova-circuits");\n' +
'  for (var i=0;i<scripts.length;i++) {\n' +
'    (function(el){\n' +
'      var data; try { data = JSON.parse(el.textContent); } catch(e){ return; }\n' +
'      var circuits = data.circuits || [];\n' +
'      if (!circuits.length) return;\n' +
'      var anchor = el;\n' +
'      circuits.forEach(function(c){\n' +
'        var box = document.createElement("div");\n' +
'        box.className = "qc";\n' +
'        var head = document.createElement("div");\n' +
'        head.className = "qc-head";\n' +
'        head.textContent = "Quantum circuit \\u2014 " + (c.title || c.id || "circuit");\n' +
'        box.appendChild(head);\n' +
'        var det = document.createElement("details");\n' +
'        det.className = "qc-details";\n' +
'        var sum = document.createElement("summary");\n' +
'        sum.textContent = "Show circuit";\n' +
'        det.appendChild(sum);\n' +
'        var holder = document.createElement("div");\n' +
'        holder.className = "qc-svg";\n' +
'        holder.innerHTML = c.svg || "";\n' +
'        det.appendChild(holder);\n' +
'        box.appendChild(det);\n' +
'        anchor.parentNode.insertBefore(box, anchor.nextSibling);\n' +
'        anchor = box;\n' +
'      });\n' +
'    })(scripts[i]);\n' +
'  }\n' +
'}\n' +
'function send() {\n' +
'  var text = input.value.trim();\n' +
'  if (!text) return;\n' +
'  addMsg(text, "user");\n' +
'  input.value = "";\n' +
'  addMsg("Thinking...", "assistant");\n' +
'  vscode.postMessage({ type: "chat", text: text });\n' +
'}\n' +
'\n' +
'sendBtn.addEventListener("click", send);\n' +
'input.addEventListener("keydown", function(e) { if (e.key === "Enter") send(); });\n' +
'document.querySelectorAll(".quick-btn").forEach(function(b) {\n' +
'  b.addEventListener("click", function() { input.value = b.dataset.cmd; send(); });\n' +
'});\n' +
'\n' +
'window.addEventListener("message", function(e) {\n' +
'  var msg = e.data;\n' +
'  if (msg.type === "responseChunk") {\n' +
'    var thinking = msgs.querySelector(".msg:last-child");\n' +
'    if (thinking && (thinking.textContent.indexOf("Thinking") !== -1 || thinking.dataset.streamed === "1")) {\n' +
'      thinking.dataset.streamed = "1";\n' +
'      var body = thinking.querySelector("div:last-child");\n' +
'      if (body) body.textContent = (body.textContent === "Thinking..." ? "" : body.textContent) + msg.delta;\n' +
'    }\n' +
'    return;\n' +
'  }\n' +
'  if (msg.type === "hunksApplied") {\n' +
'    var boxes = msgs.querySelectorAll(".mig");\n' +
'    for (var bi=0;bi<boxes.length;bi++) {\n' +
'      var st = boxes[bi]._qirova; if (!st || st.file !== msg.file) continue;\n' +
'      st.setBusy(false);\n' +
'      (msg.applied || []).forEach(function(id){ markHunkApplied(st.cards[id]); });\n' +
'      (msg.skipped || []).forEach(function(s){ var card = st.cards[s.id]; if (card && !card.dataset.done) { card.dataset.done = "1"; var btns = card.querySelector(".hunk-btns"); if (btns) btns.remove(); var p = document.createElement("div"); p.className = "hunk-note"; p.textContent = "Skipped: " + (s.reason || "unknown"); card.appendChild(p); } });\n' +
'    }\n' +
'    return;\n' +
'  }\n' +'  if (msg.type === "response") {\n' +
'    var last = msgs.querySelector(".msg:last-child");\n' +
'    if (last && (last.textContent.indexOf("Thinking") !== -1 || last.dataset.streamed === "1")) last.remove();\n' +
'    addMsg(msg.response, "assistant");\n' +
'    wireMigrationCards(msgs.querySelector(".msg:last-child"));\n' +
'    wireCircuitCards(msgs.querySelector(".msg:last-child"));\n' +
'  }\n' +
'});\n' +
'\n' +
'addMsg("' + this.getWelcome().replace(/"/g, '\\"').replace(/\n/g, '\\n') + '", "assistant");\n' +
'</script>\n' +
'</body>\n' +
'</html>';
  }
}
export class CopilotSidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  constructor(
    private context: vscode.ExtensionContext,
    private gateway: GatewayClient,
    private detector: CryptoDetector,
    private remediator: CryptoRemediator
  ) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const panel = new CopilotPanel(this.context, this.gateway, this.detector, this.remediator);
    view.webview.html = (panel as any).getHtml();
    (panel as any).onProgress = (delta: string) => {
      try { view.webview.postMessage({ type: 'responseChunk', delta }); } catch { /* ignore */ }
    };
    view.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg.type === 'applyHunks') {
        const res = await (panel as any).applyMigrationHunks(String(msg.file || ''), Array.isArray(msg.ids) ? msg.ids : []);
        view.webview.postMessage({ type: 'hunksApplied', file: msg.file, applied: res.applied, skipped: res.skipped });
      }
      if (msg.type === 'chat') {
        const streamed = await (panel as any).handleMessageStream(msg.text, (delta: string) => {
          view.webview.postMessage({ type: 'responseChunk', delta });
        });
        if (streamed === null) {
          const response = await (panel as any).handleMessage(msg.text);
          view.webview.postMessage({ type: 'response', response });
        } else {
          view.webview.postMessage({ type: 'response', response: streamed, streamed: true });
        }
      }
    });
  }
  reveal(): void {
    this.view?.show(true);
  }
}
export function registerChatParticipant(context: vscode.ExtensionContext, gateway: GatewayClient, detector: CryptoDetector, remediator: CryptoRemediator): void {
  try {
    const chatNs: any = (vscode as any).chat;
    if (!chatNs?.createChatParticipant) return;
    const participant = chatNs.createChatParticipant('qirova', async (request: any, _ctx: any, stream: any, _token: any) => {
      try {
        const panel = new CopilotPanel(context, gateway, detector, remediator);
        const md = (await (panel as any).handleMessage(request.prompt))
          ?? (await (panel as any).handleAiChat(request.prompt))
          ?? (panel as any).getWelcome();
        stream.markdown(md);
      } catch (e: any) {
        stream.markdown('> QIROVA error: ' + (e?.message ?? e));
      }
    });
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'ecdat-icon.svg');
    context.subscriptions.push(participant);
  } catch { /* chat UI unavailable on this engine: copilot webview remains */ }
}
export function registerCopilot(context: vscode.ExtensionContext, gateway: GatewayClient, detector: CryptoDetector, remediator: CryptoRemediator): void {
  const copilot = new CopilotPanel(context, gateway, detector, remediator);
  const sidebar = new CopilotSidebarProvider(context, gateway, detector, remediator);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('qirova.copilotView', sidebar, { webviewOptions: { retainContextWhenHidden: true } })
  );
  const focusSidebar = async (): Promise<void> => {
    try {
      await vscode.commands.executeCommand('qirova.copilotView.focus');
      sidebar.reveal();
      return;
    } catch { /* fall through to editor panel */ }
    copilot.show();
  };
  context.subscriptions.push(vscode.commands.registerCommand('qirova.openCopilot', focusSidebar));
  // Auto-reveal the Copilot view in the secondary sidebar shortly after
  // activation so migration code suggestions are visible without extra clicks.
  const autoOpen = vscode.workspace.getConfiguration('ecdat').get<boolean>('copilot.autoOpen', true);
  if (autoOpen) {
    const t = setTimeout(() => { void focusSidebar(); }, 1500);
    context.subscriptions.push({ dispose: () => clearTimeout(t) });
  }
}
