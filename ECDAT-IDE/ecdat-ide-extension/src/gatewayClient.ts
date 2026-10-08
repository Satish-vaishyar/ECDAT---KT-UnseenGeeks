import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { CryptoFinding } from './cryptoDetector';

export class GatewayClient {
  private baseUrl: string;
  private apiKey: string;
  private connected = false;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = GatewayClient.normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
  }

  private static normalizeBaseUrl(url: string): string {
    // Avoid IPv6/IPv4 localhost flakiness: uvicorn binds 127.0.0.1, while
    // Node may resolve 'localhost' to ::1 and fail to connect.
    return (url || '').replace(/:\/\/localhost(?=[:/]|$)/i, '://127.0.0.1').replace(/\/+$/, '');
  }

  setBaseUrl(url: string): void { this.baseUrl = GatewayClient.normalizeBaseUrl(url); }
  getBaseUrl(): string { return this.baseUrl; }
  setApiKey(k: string): void { this.apiKey = k; }
  isConnected(): boolean { return this.connected; }

  async ping(): Promise<boolean> {
    try {
      await this.request('GET', '/healthz', undefined, undefined, 5000);
      this.connected = true;
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async getRisk(): Promise<any> {
    return this.request('GET', '/api/v1/risk/portfolio', undefined, undefined, 15000).catch(() => null);
  }

  async getRiskScore(algorithm: string, keySize?: number): Promise<any> {
    return this.request('POST', '/api/v1/risk/score', { algorithm, key_size: keySize ?? null }, undefined, 60000).catch(() => null);
  }

  async getModels(): Promise<any> {
    return this.request('GET', '/api/v1/models/status', undefined, undefined, 30000).catch(() => null);
  }

  async chat(model: string, messages: { role: string; content: string }[], temperature = 0.2, maxTokens = 1024): Promise<any> {
    return this.request('POST', '/api/v1/ai/chat', { model, messages, temperature, max_tokens: maxTokens }, undefined, 180000).catch(() => null);
  }

  async chatStream(model: string, messages: { role: string; content: string }[], onDelta: (delta: string) => void, temperature = 0.2, maxTokens = 1024): Promise<string> {
    const url = new URL(this.baseUrl + '/api/v1/ai/chat');
    const lib = url.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: true }), 'utf-8');
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
      'Content-Length': String(payload.length),
      'User-Agent': 'QIROVA-IDE/1.0.0'
    };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return new Promise((resolve, reject) => {
      let full = '';
      const req = lib.request({
        host: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        method: 'POST', path: url.pathname + (url.search || ''), headers, timeout: 180000
      }, res => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let buf = '';
        res.on('data', (c: Buffer) => {
          buf += c.toString('utf-8');
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          for (const line of parts) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const data = t.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const evt = JSON.parse(data);
              if (typeof evt.delta === 'string' && evt.delta) { full += evt.delta; onDelta(evt.delta); }
              if (typeof evt.error === 'string' && evt.error) { full += `\n> Stream error: ${evt.error}`; onDelta(`\n> Stream error: ${evt.error}`); }
            } catch { /* partial SSE frame, wait for more */ }
          }
        });
        res.on('end', () => resolve(full));
      });
      req.on('error', e => reject(e));
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.write(payload);
      req.end();
    });
  }

  async runMonteCarlo(payload: any = { iterations: 100000 }): Promise<any> {
    return this.request('POST', '/api/v1/risk/monte-carlo', payload).catch((e) => ({ error: e.message }));
  }

  async runRedTeam(payload: any = { phase: 0 }): Promise<any> {
    return this.request('POST', '/api/v1/redteam/run', payload, undefined, 300000).catch(() => null);
  }

  async getRedTeamTimeline(): Promise<any> {
    return this.request('GET', '/api/v1/redteam/timeline', undefined, undefined, 60000).catch(() => null);
  }

  async getHardwareStatus(): Promise<any> {
    return this.request('GET', '/api/v1/redteam/hardware/status', undefined, undefined, 30000).catch(() => null);
  }

  async estimateHardware(payload: any = {}): Promise<any> {
    return this.request('POST', '/api/v1/redteam/hardware/estimate', payload, undefined, 120000).catch(() => null);
  }

  async runHardware(payload: any = {}): Promise<any> {
    return this.request('POST', '/api/v1/redteam/hardware/run', payload, undefined, 1200000).catch(() => null);
  }

  async classify(code: string, language = 'python'): Promise<any> {
    return this.request('POST', '/api/v1/classify', { code, language }).catch(() => null);
  }

  async scanSource(code: string, language = 'python'): Promise<any> {
    return this.request('POST', '/api/v1/scan/source', { code, language }, undefined, 60000).catch(() => null);
  }

  async getMisuse(code: string, language = 'python'): Promise<any> {
    return this.request('POST', '/api/v1/classify/misuse', { code, language }, undefined, 30000).catch(() => null);
  }

  async searchCve(query: string, topK = 5): Promise<any> {
    return this.request('POST', '/api/v1/knowledge/vuln', { query, top_k: topK }).catch(() => null);
  }

  async runPipeline(payload: { source_code: string; language?: string; filename?: string }): Promise<any> {
    const { source_code, language, filename } = payload;
    return this.request('POST', '/api/v1/pipeline/audit',
      { code: source_code, target_name: filename, language, enable_remediation: true },
      undefined, 1200000).catch(() => null);
  }

  async runCompat(algorithms: string[] = []): Promise<any[]> {
    const out: any[] = [];
    for (const alg of algorithms.slice(0, 8)) {
      const r = await this.request('GET', `/api/v1/quantum/pqc-matrix/${encodeURIComponent(alg)}`, undefined, undefined, 30000).catch(() => null);
      if (r) out.push(r);
    }
    return out;
  }

  async getQars(algorithm: string, keySize?: number): Promise<any> {
    return this.request('POST', '/api/v1/quantum/qars', { algorithm, key_size: keySize ?? null }, undefined, 60000).catch(() => null);
  }

  async getHndl(payload: { algorithm?: string; vulnerability?: number; shelf_life?: number; reconnaissance?: number; economic_value?: number } = {}): Promise<any> {
    return this.request('POST', '/api/v1/quantum/hndl', payload, undefined, 60000).catch(() => null);
  }

  async getMigrationCost(algorithm: string): Promise<any> {
    return this.request('GET', `/api/v1/migration/cost/${encodeURIComponent(algorithm)}`, undefined, undefined, 30000).catch(() => null);
  }

  async getCertInMappings(): Promise<any> {
    return this.request('POST', '/api/v1/compliance/cert-in', {}, undefined, 30000).catch(() => null);
  }

  async getCompliance(algorithm: string, region = 'IN'): Promise<any> {
    return this.request('POST', '/api/v1/knowledge/compliance', { algorithm, region }, undefined, 30000).catch(() => null);
  }

  async getTrapdoor(code?: string, algorithm?: string): Promise<any> {
    return this.request('POST', '/api/v1/security/trapdoor', { code_snippet: code ?? '', algorithm: algorithm ?? '' }, undefined, 30000).catch(() => null);
  }

  async getRemediationRoadmap(): Promise<any> {
    return this.request('POST', '/api/v1/remediation/roadmap', {}, undefined, 30000).catch(() => null);
  }

  async getCdkg(query: string, topK = 3): Promise<any> {
    return this.request('POST', '/api/v1/knowledge/query', { query, top_k: topK }, undefined, 30000).catch(() => null);
  }

  async getRag(query: string, topK = 3): Promise<any> {
    return this.request('POST', '/api/v1/rag/search', { query, top_k: topK }, undefined, 30000).catch(() => null);
  }

  async getHybrid(query: string, topK = 3): Promise<any> {
    return this.request('POST', '/api/v1/knowledge/hybrid', { query, top_k: topK }, undefined, 30000).catch(() => null);
  }

  async getVector(query: string, topK = 3): Promise<any> {
    return this.request('POST', '/api/v1/knowledge/vector', { query, top_k: topK }, undefined, 30000).catch(() => null);
  }

  async getTrust(source: string, claim?: string): Promise<any> {
    return this.request('POST', '/api/v1/knowledge/trust', { source, claim: claim ?? '' }, undefined, 30000).catch(() => null);
  }

  async getTemporal(algorithm: string): Promise<any> {
    return this.request('POST', '/api/v1/knowledge/temporal', { algorithm }, undefined, 30000).catch(() => null);
  }

  async getCryptoApi(apiName: string, language = 'python'): Promise<any> {
    return this.request('POST', '/api/v1/knowledge/crypto-api', { api_name: apiName, language }, undefined, 30000).catch(() => null);
  }

  async getMigrationSuggestions(findings: any[]): Promise<any[]> {
    const suggestions: any[] = [];
    for (const f of findings.slice(0, 8)) {
      const alg = f.algorithmId || f.algorithm || '';
      const lang = f.language || 'python';
      const fallback = {
        algorithm: alg.toUpperCase(),
        target: f.remediationHint || 'PQC migration',
        language: lang,
        description: f.message || '',
        before: f.snippet || '',
        after: f.remediationSnippet || `# Migrate ${alg.toUpperCase()} to ${f.remediationHint || 'PQC'}`,
        notes: undefined as string | undefined
      };
      try {
        const cost = await this.request('GET', `/api/v1/migration/cost/${encodeURIComponent(alg)}`, undefined, undefined, 30000).catch(() => null);
        const formatted = cost?.metadata?.migration_cost?.costs?.inr?.formatted
          ?? cost?.metadata?.migration_cost?.costs?.usd?.formatted;
        const rec = (cost?.findings?.[0]?.recommendation as string | undefined)
          ?? (formatted ? `Est. Cost: ${formatted}` : undefined);
        suggestions.push({ ...fallback, notes: rec });
      } catch {
        suggestions.push({ ...fallback });
      }
    }
    return suggestions;
  }

  async getSystemResources(): Promise<any> {
    return this.request('GET', '/api/v1/system/resources', undefined, undefined, 3000).catch(() => null);
  }

  async scanBinary(base64Data: string, filePath?: string): Promise<any> {
    return this.request('POST', '/api/v1/scan/binary', { binary_data: base64Data, file_path: filePath ?? 'upload.bin' }, undefined, 30000).catch(() => null);
  }

  async scanEntropy(code: string): Promise<any> {
    return this.request('POST', '/api/v1/scan/entropy', { code }, undefined, 30000).catch(() => null);
  }

  async attackCosts(algo: string): Promise<any> {
    return this.request('GET', `/api/v1/quantum/attack-costs/${encodeURIComponent(algo)}`, undefined, undefined, 60000).catch(() => null);
  }

  async getForecast(algorithm: string): Promise<any> {
    return this.request('POST', '/api/v1/risk/forecast', { algorithm }, undefined, 60000).catch(() => null);
  }

  async getGnn(algorithm: string): Promise<any> {
    return this.request('POST', '/api/v1/risk/gnn', { algorithm_id: algorithm }, undefined, 60000).catch(() => null);
  }

  async getRobust(code: string): Promise<any> {
    return this.request('POST', '/api/v1/robust/detect', { code }, undefined, 60000).catch(() => null);
  }

  async runUploadAudit(files: { path: string; contentBase64: string }[], targetName: string): Promise<any> {
    const mapped = files.slice(0, 200).map(f => ({ path: f.path, content_base64: f.contentBase64 }));
    return this.request('POST', '/api/v1/pipeline/upload-audit', { files: mapped, target_name: targetName }, undefined, 600000).catch(() => null);
  }

  async getScanCbom(scanId: string): Promise<any> {
    return this.request('GET', `/api/v1/scans/${encodeURIComponent(scanId)}/cbom`, undefined, undefined, 15000).catch(() => null);
  }

  async getScanReport(scanId: string): Promise<any> {
    return this.request('GET', `/api/v1/scans/${encodeURIComponent(scanId)}/report`, undefined, undefined, 15000).catch(() => null);
  }

  buildCbomLocal(findings: CryptoFinding[], rootPath: string): any {
    const components: any[] = [];
    for (const f of findings) {
      components.push({
        type: 'cryptographic-asset',
        name: f.algorithmName.toUpperCase(),
        category: f.algorithmCategory,
        severity: f.severity,
        description: f.message,
        suggestedMigration: f.remediationHint,
        keySize: f.keySize,
        evidence: [
          { type: 'source-location', file: f.uri || '', line: f.line + 1, column: f.col + 1, snippet: f.fileSnippet }
        ],
        filePath: f.uri ? f.uri.replace(rootPath, '') : ''
      });
    }
    return {
      bomFormat: 'CycloneDX',
      specVersion: '1.7',
      serialNumber: `urn:uuid:${cryptoUUID()}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [{ vendor: 'QIROVA', name: 'qirova-ide', version: '1.0.0' }],
        component: { type: 'application', name: 'qirova-ide-workspace', version: '1.0.0' }
      },
      components
    };
  }

  private request(method: string, path: string, body?: any, _token?: string, timeoutMs = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try { url = new URL(this.baseUrl + path); } catch (e: any) { return reject(new Error(`Bad URL: ${this.baseUrl}${path}`)); }
      const lib = url.protocol === 'https:' ? https : http;
      const payload = body ? Buffer.from(JSON.stringify(body), 'utf-8') : undefined;
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': 'QIROVA-IDE/1.0.0'
      };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(payload.length); }
      const req = lib.request({
        host: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        method, path: url.pathname + (url.search || ''), headers, timeout: timeoutMs
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({ raw: text }); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${text}`));
          }
        });
      });
      req.on('error', e => reject(e));
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

function cryptoUUID(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) out += '-';
    let c = Math.floor(Math.random() * 16);
    if (i === 12) c = 4;
    if (i === 16) c = (c & 0x3) | 0x8;
    out += hex[c];
  }
  return out;
}
