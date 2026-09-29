import * as vscode from 'vscode';
import { GatewayClient } from './gatewayClient';
import * as path from 'path';
import * as fs from 'fs';

export class ConsolePanel {
  private panel: vscode.WebviewPanel | undefined;
  private judgesPanel: vscode.WebviewPanel | undefined;

  constructor(private context: vscode.ExtensionContext, private gateway: GatewayClient) {}

  open(): void {
    if (this.panel) { this.panel.reveal(); return; }
    this.panel = vscode.window.createWebviewPanel(
      'qirova.console', 'QIROVA Security Workbench',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'frontend')),
          vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
        ]
      }
    );
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg?.type === 'ecdat.backend.launch') {
        await this.launchBackend();
        const cfg = vscode.workspace.getConfiguration('ecdat');
        const url = cfg.get<string>('gateway.url', 'http://localhost:8000');
        const ok = await this.gateway.ping();
        this.panel?.webview.postMessage({ type: 'ecdat.backend.status', url, live: ok });
        return;
      }
      if (msg?.type === 'ecdat.backend.ping') {
        const ok = await this.gateway.ping();
        const cfg = vscode.workspace.getConfiguration('ecdat');
        const url = cfg.get<string>('gateway.url', 'http://localhost:8000');
        this.panel?.webview.postMessage({ type: 'ecdat.backend.status', url, live: ok });
        return;
      }
      if (msg?.type === 'ecdat.backend.urlChanged') {
        this.gateway.setBaseUrl(msg.url || 'http://localhost:8000');
        if (msg.apiKey !== undefined) this.gateway.setApiKey(msg.apiKey);
    const cfg = vscode.workspace.getConfiguration('ecdat');
    await cfg.update('gateway.url', this.gateway.getBaseUrl(), vscode.ConfigurationTarget.Global);
        if (msg.apiKey !== undefined) await cfg.update('gateway.apiKey', msg.apiKey, vscode.ConfigurationTarget.Global);
        const ok = await this.gateway.ping();
        this.panel?.webview.postMessage({ type: 'ecdat.backend.status', url: this.gateway.getBaseUrl(), live: ok });
        return;
      }
      if (msg?.type === 'ecdat.cmd') {
        vscode.commands.executeCommand(msg.command);
        return;
      }
      if (msg?.type === 'openJudges') {
        this.openJudges();
        return;
      }
    });
    this.loadHtml();
  }

  private loadHtml(): void {
    if (!this.panel) return;
    const webview = this.panel.webview;
    const mediaDir = path.join(this.context.extensionPath, 'media', 'frontend');
    const indexPath = path.join(mediaDir, 'index.html');
    let html: string;
    try {
      html = fs.readFileSync(indexPath, 'utf-8');
    } catch {
      this.panel.webview.html = `<html><body style="font-family:sans-serif;padding:24px;color:#fff;background:#0f1b2d"><h2>Frontend bundle missing</h2><p>Expected: <code>${indexPath}</code></p></body></html>`;
      return;
    }

    const bridgeUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'frontend', 'ecdat-bridge.js')));

    // Inject gateway URL BEFORE app.js runs: app.js reads window.QIROVA_GATEWAY_URL at load time.
    const cfg = vscode.workspace.getConfiguration('ecdat');
    const url = cfg.get<string>('gateway.url', 'http://localhost:8000');
    const gatewayScript = `<script>window.QIROVA_GATEWAY_URL=${JSON.stringify(url).replace(/</g, '\\u003c')};window.QIROVA_BRIDGE_MODE=true;</script>`;
    html = html.replace('</head>', `${gatewayScript}\n<script>window.__QIROVA_BRIDGE__ = "${bridgeUri}";</script>\n<script src="${bridgeUri}"></script>\n</head>`);

    // Rewrite relative asset paths to webview URIs
    html = html.replace(/href="styles\.css[^"]*"/g, `href="${webview.asWebviewUri(vscode.Uri.file(path.join(mediaDir, 'styles.css')))}"`);
    html = html.replace(/src="app\.js[^"]*"/g, `src="${webview.asWebviewUri(vscode.Uri.file(path.join(mediaDir, 'app.js')))}"`);

    this.panel.webview.html = html;
  }

  openJudges(): void {
    if (this.judgesPanel) { this.judgesPanel.reveal(); return; }
    this.judgesPanel = vscode.window.createWebviewPanel(
      'qirova.judges', 'QIROVA Judges Brief',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'frontend')),
          vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
        ]
      }
    );
    this.judgesPanel.onDidDispose(() => { this.judgesPanel = undefined; });
    this.loadJudgesHtml();
  }

  private loadJudgesHtml(): void {
    if (!this.judgesPanel) return;
    const webview = this.judgesPanel.webview;
    const mediaDir = path.join(this.context.extensionPath, 'media', 'frontend');
    const judgesPath = path.join(mediaDir, 'judges.html');
    let html: string;
    try {
      html = fs.readFileSync(judgesPath, 'utf-8');
    } catch {
      this.judgesPanel.webview.html = `<html><body style="font-family:sans-serif;padding:24px;color:#fff;background:#0f1b2d"><h2>Judges brief missing</h2><p>Expected: <code>${judgesPath}</code></p></body></html>`;
      return;
    }
    const cfg = vscode.workspace.getConfiguration('ecdat');
    const url = cfg.get<string>('gateway.url', 'http://localhost:8000');
    const gatewayScript = `<script>window.QIROVA_GATEWAY_URL=${JSON.stringify(url).replace(/</g, '\\u003c')};window.QIROVA_BRIDGE_MODE=true;</script>`;
    html = html.replace('</head>', `${gatewayScript}\n</head>`);
    html = html.replace(/href="styles\.css[^"]*"/g, `href="${webview.asWebviewUri(vscode.Uri.file(path.join(mediaDir, 'styles.css')))}"`);
    html = html.replace(/src="app\.js[^"]*"/g, `src="${webview.asWebviewUri(vscode.Uri.file(path.join(mediaDir, 'app.js')))}"`);
    this.judgesPanel.webview.html = html;
  }

  private async launchBackend(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('ecdat');
    const url = cfg.get<string>('gateway.url', 'http://localhost:8000');
    const ok = await this.gateway.ping();
    if (ok) return;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    const cwd = workspaceFolder || process.cwd();
    const terminal = vscode.window.createTerminal({ name: 'QIROVA Gateway', cwd });
    terminal.show();
    terminal.sendText('python -X utf8 -m gateway.main');
    await new Promise(r => setTimeout(r, 5000));
  }
}
