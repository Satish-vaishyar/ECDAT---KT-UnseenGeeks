# Integrating a Real AI Backend into QIROVA Copilot

This guide is for developers who want to replace (or augment) the current **deterministic, rule-based** Copilot with a real AI backend — an LLM endpoint, a RAG service over your crypto knowledge base, or the existing FastAPI gateway extended with an `/api/v1/ai/*` route.

It assumes you have read `QIROVA-OVERVIEW.md` §2 and can run `npm test`.

## 1. Where the current chat flows (the seam)

Everything happens in `src/copilot.ts`:

1. **Frontend → host.** The sidebar webview (`getHtml`, `src/copilot.ts:133`) sends `vscode.postMessage({ type: 'chat', text })` on Send / Enter / quick-button click (`src/copilot.ts:248`).
2. **Host → frontend.** Both `CopilotPanel.show()` (`src/copilot.ts:25`) and `CopilotSidebarProvider.resolveWebviewView` (`src/copilot.ts:294`) listen with `onDidReceiveMessage`, call the **private** `handleMessage(text)`, and reply `postMessage({ type: 'response', response })`. The frontend renders that string with its own `renderMd` (`src/copilot.ts:201`).
3. **Router.** `handleMessage` (`src/copilot.ts:34`) lowercases/trims and matches the first of migrate → score → red-team → q-day → cbom → scan, else the welcome text. `handleQday` (`src/copilot.ts:92`) is the existing hybrid example: `gateway.ping()` → live `runMonteCarlo()` or mock table.

**The integration seam is `handleMessage` + the `CopilotPanel` constructor.** You do not need to touch the webview HTML, the view registration (`registerCopilot`, `src/copilot.ts:307`), or the focus/auto-open logic — unless you want streaming (see §4).

## 2. Recommended approach: new gateway endpoint + thin client method

Keep the extension host free of LLM SDKs (no new runtime deps, no secret handling in the webview) and put model access behind your gateway, following the established `GatewayClient` pattern (`src/gatewayClient.ts:143`).

**Step 1 — server side.** Add a route to the FastAPI gateway, e.g. `POST /api/v1/ai/chat` accepting:

```json
{ "messages": [{"role": "system|user", "content": "..."}], "context": { "findings": [...], "language": "python", "score": 20 }, "stream": false }
```

and returning `{"response": "<markdown string>"}`. Keep the response plain markdown — the frontend already renders `###` headers, tables, code fences, `**bold**`, `> quotes`.

**Step 2 — client method.** Add to `GatewayClient`, mirroring `runPipeline` (`src/gatewayClient.ts:49`):

```ts
async chat(payload: { messages: any[]; context?: any }): Promise<any> {
  return this.request('POST', '/api/v1/ai/chat', payload, undefined, 60000).catch((e) => ({ error: e.message }));
}
```

The 60 s timeout matters — inference is slower than the 10 s default. The `.catch` keeps the offline contract: every other method degrades to `null`/`{error}` instead of throwing.

**Step 3 — route in `handleMessage`.** Insert the AI branch **after** the deterministic ones you want to keep, or gate it with config:

```ts
private async handleMessage(text: string): Promise<string> {
  const prompt = text.toLowerCase().trim();
  if (/migrate|move|replace|switch/.test(prompt)) return this.handleMigrate();
  // ... keep score/red-team/q-day/cbom/scan as deterministic fast paths ...
  if (/scan/.test(prompt)) return this.handleScan();
  return this.handleAiChat(text); // NEW: fallthrough becomes the model
}

private async handleAiChat(text: string): Promise<string> {
  const file = vscode.window.activeTextEditor?.document;
  const findings = file ? this.detector.scan(file.getText(), file.languageId) : [];
  const { score } = this.detector.computeFileScore(findings);
  const live = await this.gateway.ping();
  if (!live) return this.getWelcome(); // offline: deterministic fallback, never hang
  const r = await this.gateway.chat({
    messages: [{ role: 'user', content: text }],
    context: { findings: findings.slice(0, 12), language: file?.languageId, score },
  });
  if (!r || r.error) return `> AI backend unavailable (${r?.error ?? 'empty response'}).\n\n` + this.getWelcome();
  return String(r.response ?? r.raw ?? 'Empty response from AI backend.');
}
```

Keeping the keyword branches first preserves the tested, instant, offline-capable answers for `migrate`/`score`/etc., and the model handles everything else (previously the welcome text). Alternatively, route *everything* to the model when an `ecdat.ai.enabled` setting is on — see §5.

**Step 4 — prompt context.** The detector output is your retrieval layer for free: pass `findings` (algorithmId, severity, line, remediationHint), the file's `languageId`, and the `score`. The remediation table (`MIGRATION_SNIPPETS`, `src/remediator.ts:14`) can be injected server-side as few-shot examples. Never send more than ~12 findings (payload size) — mirroring the existing slice limits.

## 3. Alternative: direct provider SDK in the extension host

If you must call OpenAI/Anthropic/Azure directly from the extension:

- Put the key in `ecdat.ai.apiKey` (same shape as `ecdat.gateway.apiKey`), read via `vscode.workspace.getConfiguration('ecdat').get<string>('ai.apiKey', '')`. Never hardcode keys, never log them.
- Use global `fetch` (Node 18+; the extension already uses it in `src/statusBar.ts:66`), not a new dependency — `vsce package --no-dependencies` and the offline install story stay intact.
- Prefer this only for prototyping: you lose the gateway's auth/audit trail, and every IDE instance needs its own key. The gateway route (§2) is the production shape.

## 4. Streaming (optional, larger change)

Today's protocol is single-shot: one `{type:'response'}` per `{type:'chat'}`. For token streaming:

1. Have the server (or SDK call) yield chunks; in the host, `postMessage({ type: 'responseChunk', delta })` per chunk plus a final `{ type: 'responseDone' }`.
2. Extend the frontend script (`getHtml` template, `src/copilot.ts:263`): accumulate `delta` into the pending "Thinking…" bubble instead of replacing it, then run the existing `renderMd` once on `responseDone`.
3. Keep a non-streaming fallback: if the first chunk doesn't arrive within ~5 s, fall back to awaiting the full response (or the deterministic welcome) so the UI never stalls.

Test streaming through the mock webview (`webview.emit` / `posted` array in `test/helpers/vscode-mock.js`) — assert chunk order and final render, not timing.

## 5. Configuration additions

Declare new settings in `package.json` under `contributes.configuration.properties`, following the existing `ecdat.*` block:

```json
"ecdat.ai.enabled":      { "type": "boolean", "default": false, "description": "Route unmatched Copilot prompts to the AI backend instead of the welcome text." },
"ecdat.ai.endpoint":     { "type": "string",  "default": "",    "description": "Override AI endpoint path; default uses <gateway.url>/api/v1/ai/chat." },
"ecdat.ai.model":        { "type": "string",  "default": "",    "description": "Model name passed through to the backend (informational in the extension)." },
"ecdat.ai.timeoutSecs":  { "type": "number",  "default": 60,    "description": "AI request timeout in seconds." },
"ecdat.ai.includeCode":  { "type": "boolean", "default": false, "description": "Include active-file source (truncated) in AI context. Off by default for data hygiene." }
```

Read them with `vscode.workspace.getConfiguration('ecdat').get<boolean>('ai.enabled', false)`. Add `ecdat.ai.*` defaults to the mock config in tests via `vscode.__setConfig('ecdat.ai.enabled', true)`.

## 6. Testing your integration (required — coverage is gated)

`npm run test:coverage` fails the build if lines <80%, branches <75%, functions <75%. Follow the existing patterns:

- **Unit** (extend `test/remediator-copilot.test.js`): construct `CopilotPanel` with a fake gateway `{ ping, chat }` (any object with those methods works — see the q-day tests). Assert: AI branch hit on unmatched text when enabled; offline (`ping` false) returns deterministic fallback; `chat` rejecting returns the `> AI backend unavailable` message; context payload passed to `chat` contains ≤12 findings + language + score.
- **Integration** (extend `test/integration.test.js`): add an `/api/v1/ai/chat` route to the local `http` test server (echo the received `messages`/`context` so you can assert the payload, record the `Authorization` header), then drive `{type:'chat', text:'explain rsa'}` through `panel.webview.emit` and assert the posted `{type:'response'}`.
- **No-network rule**: never call a real model endpoint from tests. The suite must stay ~9 s and hermetic.

## 7. Security and product checklist

- [ ] API keys only via settings (`ecdat.gateway.apiKey` / `ecdat.ai.apiKey`); never in code, logs, or the webview HTML.
- [ ] `ai.includeCode` defaults **off**; when on, truncate source (e.g. 8 k chars) and strip nothing else — document what leaves the machine.
- [ ] Every AI path has a deterministic fallback (welcome text or keyword branch) when offline, on timeout, or on `{error}` — the extension must never hang or throw on chat.
- [ ] Sanitize model markdown minimally: the frontend injects `innerHTML` (`renderMd`), so prefer fenced code and tables; avoid raw `<script>`/`<iframe>` in prompts and strip them server-side if untrusted content flows through.
- [ ] Keep `handleMigrate`/`handleScore`/remediation snippets as the source of truth for *code* answers; use the model for explanation, prioritization, and custom questions — not for replacing the tested snippet table silently.
- [ ] Update the Copilot welcome bullets (`getWelcome`, `src/copilot.ts:129`) if new capabilities appear, and the walkthrough (`walkthrough/`) if UX changes.
- [ ] Re-run `npm run test:coverage` and `npm run lint`, rebuild the vsix, and re-verify the sidebar chat live per `QIROVA-OVERVIEW.md` §8.

## 8. Minimal end-to-end example

With a gateway serving `POST /api/v1/ai/chat → {"response": "..."}` at `http://localhost:8000`, `ecdat.ai.enabled: true`, and an active Python file, typing `why is md5 broken here?` should produce: `handleMessage` skips all keyword branches → `handleAiChat` → detector finds `md5` + score → `gateway.chat({messages, context})` → markdown answer naming the line, the CVE (CVE-2004-2761, from `ALGORITHM_REGISTRY`), and the BLAKE3 migration — with the `> AI backend unavailable` fallback if you stop the gateway mid-chat. That is the whole integration: one client method, one router branch, one config flag, tests around all three.
