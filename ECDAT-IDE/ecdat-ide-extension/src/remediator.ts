import * as vscode from 'vscode';
import { CryptoDetector, CryptoFinding, ALGORITHM_REGISTRY } from './cryptoDetector';
import { GatewayClient } from './gatewayClient';

interface MigrationSnippet {
  algorithm: string;
  language: string;
  before: string;
  after: string;
  importStatement: string;
  description: string;
}

const MIGRATION_SNIPPETS: Record<string, Record<string, MigrationSnippet>> = {
  python: {
    md5: { algorithm: 'md5', language: 'python', before: 'hashlib.md5(data)', after: 'hashlib.blake2b(data, digest_size=32).hexdigest()', importStatement: 'import hashlib', description: 'MD5 is cryptographically broken. Use BLAKE2b (quantum-resistant).' },
    sha1: { algorithm: 'sha1', language: 'python', before: 'hashlib.sha1(data)', after: 'hashlib.sha256(data)', importStatement: 'import hashlib', description: 'SHA-1 has collision attacks. Use SHA-256 or SHA-3.' },
    des: { algorithm: 'des', language: 'python', before: 'DES.new(key, DES.MODE_ECB)', after: 'AES.new(key, AES.MODE_GCM)', importStatement: 'from Crypto.Cipher import AES', description: 'DES is 56-bit and broken. Use AES-256-GCM.' },
    ecb_mode: { algorithm: 'ecb_mode', language: 'python', before: 'DES.MODE_ECB', after: 'AES.MODE_GCM', importStatement: 'from Crypto.Cipher import AES', description: 'ECB mode leaks patterns. Use GCM for authenticated encryption.' },
    rsa_2048: { algorithm: 'rsa_2048', language: 'python', before: 'rsa.generate_private_key(public_exponent=65537, key_size=2048)', after: '# PQC: Use ML-KEM-768 (Kyber) for key exchange\n# For hybrid: ml_kem768 + x25519\nfrom oqs import KeyEncapsulation\nkem = KeyEncapsulation("Kyber768")\nserver_pk = kem.generate_keypair()', importStatement: 'from oqs import KeyEncapsulation', description: 'RSA-2048 is vulnerable to Shor\'s algorithm. Use ML-KEM-768 (FIPS 203).' },
    weak_random: { algorithm: 'math_random', language: 'python', before: 'random.randint(0, 255)', after: 'secrets.randbelow(256)', importStatement: 'import secrets', description: 'random module uses Mersenne Twister (predictable). Use secrets for crypto.' },
    cert_verify_disabled: { algorithm: 'cert_verify_disabled', language: 'python', before: 'requests.post(url, verify=False)', after: 'requests.post(url, verify=True)  # pin CA bundle via verify="/path/to/ca.pem"', importStatement: 'import requests', description: 'Disabled TLS validation enables MitM (CWE-295). Enforce verify=True with a pinned CA bundle.' },
  },
  javascript: {
    md5: { algorithm: 'md5', language: 'javascript', before: 'crypto.createHash("md5")', after: 'crypto.createHash("blake2b512")', importStatement: 'const crypto = require("crypto");', description: 'MD5 is broken. Use BLAKE2b.' },
    sha1: { algorithm: 'sha1', language: 'javascript', before: 'crypto.createHash("sha1")', after: 'crypto.createHash("sha256")', importStatement: 'const crypto = require("crypto");', description: 'SHA-1 has collision attacks. Use SHA-256.' },
    rsa_2048: { algorithm: 'rsa_2048', language: 'javascript', before: 'crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })', after: '// PQC: Use ML-KEM-768 via oqs-node\nconst oqs = require("oqs-node");\nconst kem = new oqs.KeyEncapsulation("Kyber768");\nconst pk = kem.generateKeyPair();', importStatement: 'const oqs = require("oqs-node");', description: 'RSA-2048 vulnerable to quantum. Use ML-KEM-768.' },
    weak_random: { algorithm: 'math_random', language: 'javascript', before: 'Math.random()', after: 'crypto.randomBytes(32).toString("hex")', importStatement: 'const crypto = require("crypto");', description: 'Math.random() is not cryptographically secure.' },
  },
  java: {
    des: { algorithm: 'des', language: 'java', before: 'Cipher.getInstance("DES/ECB/PKCS5Padding")', after: 'Cipher.getInstance("AES/GCM/NoPadding")', importStatement: 'import javax.crypto.Cipher;\nimport javax.crypto.spec.GCMParameterSpec;\nimport javax.crypto.spec.SecretKeySpec;', description: 'DES is 56-bit and broken. Use AES-256-GCM.' },
    ecb_mode: { algorithm: 'ecb_mode', language: 'java', before: 'DES/ECB/PKCS5Padding', after: 'AES/GCM/NoPadding', importStatement: 'import javax.crypto.Cipher;\nimport javax.crypto.spec.GCMParameterSpec;', description: 'ECB leaks patterns. Use GCM for authenticated encryption.' },
    rsa_2048: { algorithm: 'rsa_2048', language: 'java', before: 'KeyPairGenerator.getInstance("RSA").initialize(2048)', after: '// PQC: Use ML-KEM-768 via Bouncy Castle\nimport org.bouncycastle.pqc.jcajce.spec.KEMParameterSpec;\nKeyPairGenerator kpg = KeyPairGenerator.getInstance("ML-KEM-768", "BCPQC");', importStatement: 'import org.bouncycastle.pqc.jcajce.provider.BouncyCastlePQCProvider;', description: 'RSA-2048 vulnerable to Shor. Use ML-KEM-768.' },
    weak_random: { algorithm: 'math_random', language: 'java', before: 'new Random()', after: 'new SecureRandom()', importStatement: 'import java.security.SecureRandom;', description: 'Random() is predictable. Use SecureRandom for crypto.' },
    md5: { algorithm: 'md5', language: 'java', before: 'MessageDigest.getInstance("MD5")', after: 'MessageDigest.getInstance("SHA-256")', importStatement: 'import java.security.MessageDigest;', description: 'MD5 is broken. Use SHA-256.' },
  },
  go: {
    md5: { algorithm: 'md5', language: 'go', before: 'crypto/md5', after: 'crypto/blake2b', importStatement: '"crypto/blake2b"', description: 'MD5 is broken. Use BLAKE2b.' },
    rsa_2048: { algorithm: 'rsa_2048', language: 'go', before: 'rsa.GenerateKey(rand.Reader, 2048)', after: '// PQC: Use ML-KEM-768 via cloudflare/circl\nimport "github.com/cloudflare/circl/kem/kyber/kyber768"', importStatement: '"github.com/cloudflare/circl/kem/kyber/kyber768"', description: 'RSA-2048 vulnerable. Use ML-KEM-768.' },
  },
  csharp: {
    des: { algorithm: 'des', language: 'csharp', before: 'DES.Create()', after: 'Aes.Create()', importStatement: 'using System.Security.Cryptography;', description: 'DES is broken. Use AES-256.' },
    weak_random: { algorithm: 'math_random', language: 'csharp', before: 'new Random()', after: 'RandomNumberGenerator.GetBytes(32)', importStatement: 'using System.Security.Cryptography;', description: 'Random() is not secure. Use RandomNumberGenerator.' },
  },
  rust: {
    md5: { algorithm: 'md5', language: 'rust', before: 'md5::compute', after: 'blake3::hash', importStatement: 'use blake3;', description: 'MD5 is broken. Use BLAKE3.' },
  },
};

export class CryptoRemediator {
  private gateway: GatewayClient | undefined;
  readonly review = new MigrationReviewManager();

  setGateway(gateway: GatewayClient): void {
    this.gateway = gateway;
  }

  async applyFix(finding: CryptoFinding): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.fsPath !== finding.uri) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(finding.uri));
      await vscode.window.showTextDocument(doc);
      return this.applyFix(finding);
    }
    const fix = computeFix(finding, editor.document.languageId);
    if (!fix) {
      vscode.window.showInformationMessage(`No automatic remediation for ${finding.algorithmId}. See ${finding.remediationHint} for guidance.`);
      return;
    }
    await editor.edit(b => b.replace(fix.range, fix.newText));
    vscode.window.showInformationMessage(`QIROVA: ${finding.algorithmId.toUpperCase()} remediated at line ${finding.line + 1}.`);
  }

  async remediateActiveFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('QIROVA: No active editor.'); return; }
    const detector = new CryptoDetector();
    const findings = detector.scan(editor.document.getText(), editor.document.languageId);
    if (!findings.length) { vscode.window.showInformationMessage('QIROVA: No findings to remediate.'); return; }
    let count = 0;
    const fails: string[] = [];
    const sorted = [...findings].sort((a, b) => b.line - a.line);
    await editor.edit(b => {
      for (const f of sorted) {
        const fix = computeFix(f, editor.document.languageId);
        if (!fix) { fails.push(`${f.algorithmId}:${f.line + 1}`); continue; }
        b.replace(fix.range, fix.newText);
        count++;
      }
    });
    vscode.window.showInformationMessage(`QIROVA: ${count} fix${count === 1 ? '' : 'es'} applied. ${fails.length ? `Manual: ${fails.length}` : ''}`);
  }

  async suppressFinding(finding: CryptoFinding): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    await editor.edit(b => b.insert(editor.document.lineAt(finding.line).range.end, `  // qirova-ignore-line: ${finding.algorithmId} - ${finding.message}`));
  }

  getMigrationSnippet(finding: CryptoFinding, lang: string): MigrationSnippet | null {
    const langSnippets = MIGRATION_SNIPPETS[lang];
    if (!langSnippets) return null;
    return langSnippets[finding.algorithmId] || null;
  }

  async previewMigrationHunk(docUri: string, line: number, ch: number): Promise<boolean> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(docUri));
      const ed = await vscode.window.showTextDocument(doc);
      const pos = new vscode.Position(Math.max(0, line), Math.max(0, ch || 0));
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      return true;
    } catch {
      return false;
    }
  }
}

export function computeFix(finding: CryptoFinding, lang: string): { range: vscode.Range; newText: string } | null {
  const start = new vscode.Position(finding.line, finding.col);
  const end = new vscode.Position(finding.line, finding.col + finding.length);
  const range = new vscode.Range(start, end);

  if (finding.algorithmId === 'cert_verify_disabled') {
    if (/\bCERT_NONE\b/.test(finding.fileSnippet)) return { range, newText: 'CERT_REQUIRED' };
    if (/\bcheck_hostname\s*=\s*False\b/.test(finding.fileSnippet)) return { range, newText: 'check_hostname=True' };
    return { range, newText: 'verify=True' };
  }

  const snippet = MIGRATION_SNIPPETS[lang]?.[finding.algorithmId];
  if (snippet) {
    return { range, newText: snippet.after.split('\n')[0] };
  }

  if (finding.algorithmId === 'md5') return { range, newText: 'blake2b' };
  if (finding.algorithmId === 'sha1') return { range, newText: 'sha256' };
  if (finding.algorithmId === 'rc4') return { range, newText: 'chacha20' };
  if (finding.algorithmId === '3des' || finding.algorithmId === 'des') return { range, newText: 'AES-256' };
  if (finding.algorithmId === 'md4' || finding.algorithmId === 'md2') return { range, newText: 'blake2b' };
  if (finding.algorithmId === 'rc2' || finding.algorithmId === 'blowfish_small') return { range, newText: 'AES-256' };

  if (finding.algorithmId === 'math_random') {
    if (lang === 'python') return { range, newText: 'secrets.token_bytes' };
    if (lang === 'javascript' || lang === 'typescript') return { range, newText: 'crypto.randomBytes' };
    if (lang === 'java') return { range, newText: 'SecureRandom' };
    if (lang === 'go') return { range, newText: 'rand.Read' };
    if (lang === 'csharp') return { range, newText: 'RandomNumberGenerator.GetBytes' };
  }

  if (finding.algorithmId === 'ecb_mode') {
    return { range, newText: finding.fileSnippet.replace(/\b(ECB)\b/g, 'GCM') };
  }

  if (finding.algorithmId === 'ecdsa_p256' || finding.algorithmId === 'ecdsa_p224' || finding.algorithmId === 'ecdsa_p192') return { range, newText: 'Ed448' };
  if (finding.algorithmId === 'ed25519' || finding.algorithmId === 'ecdsa_p384') return { range, newText: 'ml_dsa65' };
  if (finding.algorithmId === 'x25519') return { range, newText: 'ml_kem768+x25519' };
  if (finding.algorithmId === 'rsa_legacy' || finding.algorithmId === 'rsa_2048' || finding.algorithmId === 'rsa_3072') return { range, newText: 'ml_kem768+x25519' };
  if (finding.algorithmId === 'dh_small' || finding.algorithmId === 'dh_2048' || finding.algorithmId === 'dh_3072') return { range, newText: 'ml_kem768+x25519' };

  return null;
}

export function registerRemediator(context: vscode.ExtensionContext, remediator: CryptoRemediator, detector: CryptoDetector): void {
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      [
        { language: 'python' }, { language: 'javascript' }, { language: 'typescript' },
        { language: 'java' }, { language: 'go' }, { language: 'csharp' },
        { language: 'cpp' }, { language: 'c' }, { language: 'rust' }
      ],
      new MigrationInlineProvider(detector)
    )
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [
        { language: 'python' }, { language: 'javascript' }, { language: 'typescript' },
        { language: 'java' }, { language: 'go' }, { language: 'csharp' },
        { language: 'cpp' }, { language: 'c' }, { language: 'rust' }
      ],
      new CodeActionProvider(detector, remediator),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor] }
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'python' }, { language: 'javascript' }, { language: 'java' }, { language: 'go' }, { language: 'csharp' }, { language: 'rust' }],
      new MigrationSnippetProvider(remediator),
      '.'
    )
  );
  const review = remediator.review;
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'python' }, { language: 'javascript' }, { language: 'typescript' },
        { language: 'java' }, { language: 'go' }, { language: 'csharp' },
        { language: 'cpp' }, { language: 'c' }, { language: 'rust' }
      ],
      review
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('qirova.migration.accept', (uri: string, id: string) => review.accept(uri, id))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('qirova.migration.reject', (uri: string, id: string) => { review.reject(uri, id); })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('qirova.migration.acceptAll', (uri: string) => review.acceptAll(uri))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('qirova.migration.rejectAll', (uri: string) => { review.rejectAll(uri); })
  );
}

class CodeActionProvider implements vscode.CodeActionProvider {
  constructor(private detector: CryptoDetector, private remediator: CryptoRemediator) {}

  provideCodeActions(doc: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, _token: vscode.CancellationToken): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    const text = doc.getText();
    const findings = this.detector.scan(text, doc.languageId);
    const out: vscode.CodeAction[] = [];
    const wantsQuickFix = !context.only || context.only.contains(vscode.CodeActionKind.QuickFix);
    const wantsRefactor = !context.only || context.only.contains(vscode.CodeActionKind.Refactor);

    for (const f of findings) {
      if (f.line !== range.start.line) continue;

      if (wantsQuickFix) {
        const fix = computeFix(f, doc.languageId);
        if (fix) {
          const action = new vscode.CodeAction(`QIROVA: Migrate ${f.algorithmId.toUpperCase()} \u2192 ${f.remediationHint}`, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [];
          action.edit = new vscode.WorkspaceEdit();
          action.edit.set(doc.uri, [fix]);
          action.isPreferred = true;
          out.push(action);
        }
      }

      if (wantsRefactor) {
        const snippet = this.remediator.getMigrationSnippet(f, doc.languageId);
        if (snippet) {
          const snippetAction = new vscode.CodeAction(`QIROVA: Insert full ${f.algorithmId.toUpperCase()} migration snippet`, vscode.CodeActionKind.Refactor);
          snippetAction.command = {
            command: 'qirova.insertMigrationSnippet',
            title: 'Insert Migration Snippet',
            arguments: [f, doc.uri]
          };
          out.push(snippetAction);
        }
      }
    }

    if (out.length === 0) return [];
    return out;
  }
}

class MigrationSnippetProvider implements vscode.CompletionItemProvider {
  constructor(private remediator: CryptoRemediator) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {
    const line = document.lineAt(position.line).text;
    const items: vscode.CompletionItem[] = [];

    const keywords = ['md5', 'sha1', 'des', 'ecb', 'rsa', 'random', 'ecdsa', 'x25519'];
    for (const kw of keywords) {
      if (line.toLowerCase().includes(kw)) {
        const finding: CryptoFinding = {
          algorithmId: kw === 'random' ? 'math_random' : kw === 'ecb' ? 'ecb_mode' : kw,
          algorithmName: kw, algorithmCategory: 'CRYPTO', severity: 'deprecated',
          message: '', remediationHint: '', detectionMethod: 'pattern', uri: document.uri.fsPath,
          line: position.line, col: position.character, length: kw.length,
          keySize: undefined, fileSnippet: line, suppress: false
        };
        const snippet = this.remediator.getMigrationSnippet(finding, document.languageId);
        if (snippet) {
          const item = new vscode.CompletionItem(`qirova:${kw}`, vscode.CompletionItemKind.Snippet);
          item.insertText = new vscode.SnippetString(snippet.after);
          item.detail = `QIROVA Migration: ${kw} \u2192 ${snippet.algorithm}`;
          item.documentation = new vscode.MarkdownString(`**${snippet.description}**\n\n\`\`\`${snippet.language}\n${snippet.after}\n\`\`\``);
          items.push(item);
        }
      }
    }
    return items;
  }
}

class MigrationInlineProvider implements vscode.InlineCompletionItemProvider {
  constructor(private detector: CryptoDetector) {}

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
    try {
      const findings = this.detector.scan(document.getText(), document.languageId);
      const hit = findings.find((f) => f.line === position.line);
      if (!hit) return [];
      const fix = computeFix(hit, document.languageId);
      if (!fix) return [];
      return [new vscode.InlineCompletionItem(fix.newText, fix.range)];
    } catch {
      return [];
    }
  }
}

export function hunkToEdit(doc: vscode.TextDocument, h: any): { range: vscode.Range; newText: string } | null {
  try {
    if (h && h.kind === 'import') {
      return { range: new vscode.Range(0, 0, 0, 0), newText: String(h.newText ?? '') };
    }
    const lineText: string = doc.lineAt(h.line).text;
    if (lineText !== h.oldLine) return null;
    return { range: new vscode.Range(h.line, h.startChar, h.line, h.endChar), newText: h.newText };
  } catch {
    return null;
  }
}

export class MigrationReviewManager {
  private pending: Map<string, any[]> = new Map();
  private decorByDoc: Map<string, vscode.TextEditorDecorationType[]> = new Map();
  private oldDecor: vscode.TextEditorDecorationType | undefined;
  private lensEvent = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.lensEvent.event;

  keyFor(uri: string): string { return (uri || '').toLowerCase(); }
  hunksFor(docUri: string): any[] { return this.pending.get(this.keyFor(docUri)) ?? []; }

  provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
    const hunks = this.hunksFor(document.uri.fsPath);
    if (!hunks.length) return [];
    const uri = document.uri.fsPath;
    const out: vscode.CodeLens[] = [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0),
        { title: 'Accept All (' + hunks.length + ')', command: 'qirova.migration.acceptAll', arguments: [uri] }),
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0),
        { title: 'Reject All', command: 'qirova.migration.rejectAll', arguments: [uri] }),
    ];
    for (const h of hunks) {
      const line = Math.max(0, h.line || 0);
      const r = new vscode.Range(line, 0, line, 0);
      out.push(new vscode.CodeLens(r, { title: 'Accept', command: 'qirova.migration.accept', arguments: [uri, h.id] }));
      out.push(new vscode.CodeLens(r, { title: 'Reject', command: 'qirova.migration.reject', arguments: [uri, h.id] }));
    }
    return out;
  }

  async show(docUri: string, hunks: any[]): Promise<void> {
    this.pending.set(this.keyFor(docUri), [...hunks]);
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(docUri));
      await vscode.window.showTextDocument(doc);
      this.decorate(doc);
    } catch { /* headless tests */ }
    this.lensEvent.fire();
  }

  drop(docUri: string, ids: string[]): void {
    const left = this.hunksFor(docUri).filter((h) => ids.indexOf(h.id) === -1);
    if (!left.length) { this.clear(docUri); return; }
    this.pending.set(this.keyFor(docUri), left);
    this.refresh(docUri);
  }

  clear(docUri?: string): void {
    try {
      const kill = (list: vscode.TextEditorDecorationType[] | undefined) => {
        for (const t of (list ?? [])) { try { t.dispose(); } catch { /* ignore */ } }
      };
      if (docUri) {
        const key = this.keyFor(docUri);
        kill(this.decorByDoc.get(key));
        this.decorByDoc.delete(key);
        this.pending.delete(key);
      } else {
        for (const list of this.decorByDoc.values()) kill(list);
        this.decorByDoc.clear();
        this.pending.clear();
      }
    } finally {
      this.lensEvent.fire();
    }
  }

  async accept(docUri: string, id: string): Promise<boolean> {
    try {
      const h = this.hunksFor(docUri).find((x) => x.id === id);
      if (!h) return false;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(docUri));
      const te = hunkToEdit(doc, h);
      if (!te) { this.drop(docUri, [id]); return false; }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, te.range, te.newText);
      const ok = await vscode.workspace.applyEdit(edit);
      this.drop(docUri, ok ? [id] : []);
      return ok;
    } catch {
      return false;
    }
  }

  async acceptAll(docUri: string): Promise<number> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(docUri));
      const hunks = [...this.hunksFor(docUri)].sort((a, b) => (b.line || 0) - (a.line || 0));
      const edit = new vscode.WorkspaceEdit();
      const applied: string[] = [];
      for (const h of hunks) {
        const te = hunkToEdit(doc, h);
        if (!te) continue;
        edit.replace(doc.uri, te.range, te.newText);
        applied.push(h.id);
      }
      if (applied.length) await vscode.workspace.applyEdit(edit);
      this.drop(docUri, applied);
      return applied.length;
    } catch {
      return 0;
    }
  }

  reject(docUri: string, id: string): void { this.drop(docUri, [id]); }
  rejectAll(docUri: string): void { this.clear(docUri); }

  private refresh(docUri: string): void {
    try {
      const docs = vscode.workspace.textDocuments.filter((d) => this.keyFor(d.uri.fsPath) === this.keyFor(docUri));
      for (const d of docs) this.decorate(d);
    } catch { /* ignore */ }
    this.lensEvent.fire();
  }

  private decorate(doc: vscode.TextDocument): void {
    const key = this.keyFor(doc.uri.fsPath);
    for (const t of (this.decorByDoc.get(key) ?? [])) { try { t.dispose(); } catch { /* ignore */ } }
    const made: vscode.TextEditorDecorationType[] = [];
    try {
      const hunks = this.hunksFor(doc.uri.fsPath);
      if (!this.oldDecor) {
        this.oldDecor = vscode.window.createTextEditorDecorationType({
          backgroundColor: 'rgba(248,81,73,0.16)', borderRadius: '3px'
        });
      }
      const ed: any = vscode.window.activeTextEditor;
      const oldRanges: vscode.Range[] = [];
      for (const h of hunks) {
        if (!h || h.kind === 'import') continue;
        try {
          const len = doc.lineAt(h.line).text.length;
          oldRanges.push(new vscode.Range(h.line, 0, h.line, len));
          const after = vscode.window.createTextEditorDecorationType({
            after: {
              contentText: '  =>  ' + String(h.newLine ?? h.newText ?? '').split(String.fromCharCode(10))[0].slice(0, 160),
              color: '#7ee787'
            }
          });
          made.push(after);
          try { ed?.setDecorations(after, [new vscode.Range(h.line, len, h.line, len)]); } catch { /* ignore */ }
        } catch { /* bad hunk: skip */ }
      }
      try { ed?.setDecorations(this.oldDecor, oldRanges); } catch { /* ignore */ }
    } catch { /* ignore */ }
    this.decorByDoc.set(key, made);
  }
}
