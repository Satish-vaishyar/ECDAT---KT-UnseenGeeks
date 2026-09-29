# QIROVA IDE — System Overview

QIROVA (Quantum Intelligence for Resilient Operations, Vulnerability & Assurance) is a Code-OSS/VSCodium distribution that turns the editor into a **post-quantum cryptography (PQC) IDE**. SIH 2026, problem statement PS-26164 (NTRO).

The extension (`qirova-ide` 1.0.0, publisher `QIROVA`) provides: live crypto-flaw diagnostics, per-file PQC readiness scores, one-click rule-based remediation (MD5 → BLAKE2b, RSA → ML-KEM-768, …), a rule-based Copilot chat in the secondary sidebar, a Security Workbench webview, tree views (Findings / Risk / Compliance / Threat), a Q-Day countdown status bar, workspace scanning, and CycloneDX 1.6 CBOM export — all wired to a Python FastAPI gateway (`C:\Users\Samarth\quantum-pqc-sih2`) with graceful MOCK fallback when the gateway is unreachable. **No LLM is involved anywhere; the Copilot is a deterministic regex router.** (See `AI-BACKEND-INTEGRATION.md` for how to add one.)

## Repository layout

```
D:\sih2\ecdat-ide-extension\      extension project root
  package.json                    contributes: commands, menus, keybindings,
                                  viewsContainers (activitybar + secondarySidebar),
                                  views, configuration (ecdat.*), walkthrough, theme
  src\                            TypeScript source (CommonJS, ES2022, strict)
  out\                            compiled JS (tsc) — what tests and the IDE run
  test\                           node:test suites + vscode mock harness (220 tests)
  media\frontend\                 Security Workbench bundle (index.html, app.js,
                                  styles.css, ecdat-bridge.js)
  media\                          ecdat-icon.svg + view icons
  themes\qirova-secure.json       SOC dark theme
  walkthrough\                    5-step onboarding markdown
  smoke-test.js                   legacy detector smoke test (plain node)

D:\sih2\ecdat-ide-build\          distribution build area
  staging\                        full VSCodium tree + extension + .qirova-profile
  staging\QIROVA-IDE.cmd          launcher (--disable-workspace-trust, passes %*)
  staging\resources\app\extensions\qirova-ide\   deployed extension copy
  staging\resources\app\extensions\.obsolete     must read {} (see §7)
  staging\.qirova-profile\User\settings.json    trust off, scan.onOpen, secondary bar visible
  setup.sed                       iexpress script → QIROVA-IDE-Setup.exe (~250 MB)
D:\sih2\qirova-ide-1.0.0.vsix     packaged extension (vsce)
```

## 1. Detection engine (`src/cryptoDetector.ts`)

Pure logic, zero `vscode` imports — the most-tested module.

- `ALGORITHM_REGISTRY` (`src/cryptoDetector.ts:31`): ~35 algorithm specs `{id, category, severity, cves?, remediation, fips?, description}`. Severities: `broken` (MD5/SHA-1/DES/3DES/RC4/ECB/Math.random/weak RSA/DH…), `vulnerable` (RSA-legacy, cert-verify-disabled), `deprecated` (RSA-2048/3072, P-256/P-384, Ed25519, X25519…), `info` (SHA-2 family, AES-GCM, ChaCha20, and the PQC targets ML-KEM-768 / ML-DSA-65 / SLH-DSA).
- `CryptoDetector.scan(text, languageId)` (`src/cryptoDetector.ts:150`): runs ~50 regex patterns, then (a) re-grades RSA/DH by parsed key size (<2048→broken, <3072→vulnerable, <4096→deprecated, else info), (b) reads `key_size=N` from a 220-char window after `generate_private_key(public_exponent=` (`src/cryptoDetector.ts:197`), (c) dedupes overlapping same-category hits per line, (d) honors `ecdat-ignore-line` / `ecdat-ignore-next-line` (marker must sit in the ~12 chars before the match — see quirks §8), (e) returns findings sorted by severity desc. Finding `uri` is `''` until a caller sets it.
- `computeFileScore(findings)` (`src/cryptoDetector.ts:246`): empty → `{100, 'clean'}`; else `100 − Σ(severityRank×10)` clamped to [0,100], worst = highest severity. Weights: broken 40, vulnerable 30, deprecated 20, info 10.
- Detection coverage: md5/sha1/md4/md2, DES/3DES/RC4/RC2/Blowfish-small, ECB in Java/JS/C# forms, `Math.random()` / `random.randint|choice|shuffle` / `java.util.Random` / `new Random()` / `rand` / `srand` / `drand48` / `rand_r()`, curves (P-192/224/256/384, Ed25519, X25519), RSA 512→4096, DH 512→3072, SHA-2/SHA-3/BLAKE2/3, AES-GCM, ChaCha20-Poly1305, ML-KEM/Kyber, ML-DSA/Dilithium, SLH-DSA/SPHINCS+, `verify=False`, `CERT_NONE`, `check_hostname=False`, `ssl._create_unverified_https_context`, `_ssl._create_unverified_context`.

## 2. Copilot (`src/copilot.ts`) — rule-based, no LLM

The chat flow is: sidebar input → webview `postMessage({type:'chat', text})` → `onDidReceiveMessage` → private `handleMessage` → `postMessage({type:'response', response})`; the frontend renders the markdown-ish string with its own `renderMd` (`src/copilot.ts:201`).

- `handleMessage` (`src/copilot.ts:34`) lowercases/trims and tests **in this order**: `/migrate|move|replace|switch/` → `handleMigrate`, `/score|grade|readiness/` → `handleScore`, `/red-?team|attack|bleichenbacher|padding|fuzz/` → `handleRedTeam`, `/monte\s*carlo|q-?day|quantum/` → `handleQday` (async: live Monte Carlo if `gateway.ping()`, else the mock P50-2038 table), `/cbom|cyclonedx|export/` → `handleCbom`, `/scan/` → `handleScan`, else `getWelcome`. Only the first 8 findings get snippets, 12 red-team rows max; beyond that a `> N more findings` tail.
- `CopilotPanel.show()` (`src/copilot.ts:16`) creates the editor-side `WebviewPanel` once and reveals it on repeat calls; `CopilotSidebarProvider.resolveWebviewView` (`src/copilot.ts:289`) builds a separate `CopilotPanel` internally for HTML/handlers and wires the same chat protocol.
- `registerCopilot` (`src/copilot.ts:307`) registers the `qirova.copilotView` WebviewViewProvider with `retainContextWhenHidden`, the `qirova.openCopilot` command, and — when `ecdat.copilot.autoOpen` (default true) — a 1500 ms timer that tries `qirova.copilotView.focus` first (`focusSidebar`) and falls back to the editor panel.
- **Critical packaging fact**: the view must be declared with `"type": "webview"` in `package.json`, otherwise the workbench creates a Tree pane showing "no data provider". The view lives in the `secondarySidebar` container `qirova-copilot-container`; Findings/Risk/Compliance/Threat stay in the activity-bar `qirova-container`.

## 3. Remediation (`src/remediator.ts`)

- `MIGRATION_SNIPPETS` (`src/remediator.ts:14`): before/after/import/description table for python, javascript, java, go, csharp, rust (e.g. python `rsa_2048` → `from oqs import KeyEncapsulation` + Kyber768 keygen).
- `computeFix` (module-private, `src/remediator.ts:106`): cert-verify special cases (`CERT_NONE`→`CERT_REQUIRED`, `check_hostname=False`→`True`, else `verify=True`), then snippet first-line, then keyword fallbacks (`blake2b`, `sha256`, `chacha20`, `AES-256`, `secrets.token_bytes`/`crypto.randomBytes`/`SecureRandom`/`rand.Read`/`RandomNumberGenerator.GetBytes` per language), `ECB`→`GCM`, `Ed448`/`ml_dsa65`/`ml_kem768+x25519` migrations, else null.
- `CryptoRemediator.applyFix` / `remediateActiveFile` (bottom-up single edit) / `suppressFinding` (appends `// qirova-ignore-line: <id> - <msg>`).
- `registerRemediator` wires a `CodeActionProvider` (QuickFix preferred actions + Refactor snippet-insert commands, honoring `context.only`) and a `MigrationSnippetProvider` emitting `qirova:<keyword>` completions (`src/remediator.ts:150`).

## 4. Gateway client (`src/gatewayClient.ts`)

`GatewayClient(baseUrl, apiKey)` — raw `http`/`https` requests with `Bearer` auth, per-call timeouts, and `.catch(() => null)` (or `{error}` for Monte Carlo) so the IDE never crashes offline. Endpoints (`/api/v1/...`): `health`, `risk/score`, `risk/monte-carlo`, `classify`, `knowledge/vuln`, `pipeline/audit`, `pipeline/compat`, `quantum/qars`, `quantum/hndl`, `migration/cost/:alg`, `compliance/cert-in`, `remediation/roadmap`, `system/resources`, plus `buildCbomLocal` emitting CycloneDX 1.6 with `urn:uuid:` serials.

## 5. Extension host wiring (`src/extension.ts`)

`activate` (`src/extension.ts:27`): reads `ecdat.gateway.*` config → constructs gateway, detector, remediator, the four tree providers, `StatusBarManager`, `WorkspaceScanner`, `ConsolePanel` → diagnostic collection `qirova` → registers all four tree providers → `registerCopilot` (in try/catch) → `registerRemediator` → 17 commands (`qirova.*`) → editor/save/edit listeners (scan-on-open default on, on-save off, **debounced 400 ms on-edit**) → status bar start, risk refresh, gateway probe (`withProgress`), first-run walkthrough prompt. `scanDocument` writes Diagnostics (broken/vulnerable→Error, deprecated→Warning, info→Information) and feeds Findings + status bar. `exportCbom` scans the workspace and writes `qirova-cbom.json`. `deactivate` clears the timer and disposes the bar.

## 6. UI: status bar, providers, workbench (`src/statusBar.ts`, `*Provider.ts`, `src/scanner.ts`, `src/consolePanel.ts`)

- `StatusBarManager`: four plain-ASCII items (no codicons/unicode) — per-file `PQC n/100` (color-banded, 30 s cache, workspace average `WS n/100`), `Q-Day P50: YEAR (T-n)` (live fetch of `/api/v1/monte-carlo` percentiles p50 with error≤5 / warning≤12 bands, mock 2038 fallback), `MOCK`/`LIVE` badge. `showQdayDetail` offers Run Simulation / Open Workbench.
- Providers: `FindingsProvider` merges per-file + workspace findings, dedupes by uri|line|col|algorithmId, groups BROKEN/VULNERABLE/DEPRECATED/INFO with `qirova.findings.jumpTo` commands; `RiskProvider` renders gateway risk with mock fallback (`refresh()` shows a loading node while pending); `ComplianceProvider` = 7 static frameworks (FIPS 203/204, CNSA 2.0, CERT-In, DPDP, SP 800-131A, BSI); `ThreatProvider` = 4 static intel items on a 60 s refresh interval (pushed disposer — callers must dispose the context).
- `WorkspaceScanner`: `findFiles('**/*.{py,js,…,rb}', <excludes>, 2000)`, skips test paths unless `ecdat.scan.includeTests`, unknown exts, >2 MB files, unreadable files; stamps `finding.uri`.
- `ConsolePanel.open()`: loads `media/frontend/index.html`, **injects `window.QIROVA_GATEWAY_URL` before `app.js`** (`src/consolePanel.ts:78`), rewrites asset URLs to webview URIs, handles `ecdat.backend.{launch,ping,urlChanged}` and `ecdat.cmd` messages; `launchBackend` spawns a `QIROVA Gateway` terminal running `python -X utf8 -m gateway.main` only if ping fails (then waits 5 s).

Configuration keys (`ecdat.*`): `gateway.url` (default `http://localhost:8000`), `gateway.apiKey`, `gateway.autoConnect`, `scan.onOpen/onSave/onEdit/includeTests`, `ui.theme`, `statusBar.qday/score`, `copilot.enabled/autoOpen`.

## 7. Tests (`test\`) — 220 tests, 96.27% lines

Zero-dependency: Node 24's built-in `node:test` + V8 coverage (the npm registry was unreachable, so no jest/mocha).

```
npm test               # node --test "test/*.test.js"
npm run test:coverage  # gates: lines ≥80, branches ≥75, functions ≥75 (exit≠0 on breach)
npm run test:unit      # detector + remediator/copilot + providers/statusbar
npm run test:integration
```

- `test/helpers/vscode-mock.js` — in-process `vscode` API mock (Uri/Position/Range/TreeItem/Diagnostic/CodeAction/WorkspaceEdit/EventEmitter, window/workspace/commands/languages, editable TextDocuments, webview message capture); `setup.js` redirects `require('vscode')` to it; `fixtures.js` — `makeContext`/`disposeContext`, vulnerable-source samples, `activateEditor`.
- `test/detector.test.js` (88) · `test/remediator-copilot.test.js` (55) · `test/providers-statusbar.test.js` (40) · `test/integration.test.js` (34, incl. a real local HTTP gateway: health/risk/monte-carlo/cost/audit, auth headers, 500s, non-JSON, timeouts) · `test/smoke.test.js` (3, legacy).
- Current per-file line coverage: copilot 98.4, cryptoDetector 98.7, remediator 97.8, extension 96.1, statusBar 96.6, findingsProvider 96.1, consolePanel 95.6, riskProvider 95.9, scanner 93.3, gatewayClient 92.9, threatProvider 92.4, complianceProvider 92.2. Uncovered lines are nearly all TS `__createBinding`/`__importStar` boilerplate, not logic.

## 8. Build → deploy → verify pipeline

1. `npx tsc -p ./` → `npx @vscode/vsce package --no-dependencies --out D:\sih2\qirova-ide-1.0.0.vsix` (expect only pre-existing grunt/gulp/jake engine warnings).
2. `Stop-Process VSCodium` (staging is locked while running) → expand vsix → copy `extension\*` into `staging\resources\app\extensions\qirova-ide` → reset `.obsolete` to `{}` (a stale `{"qirova.qirova-ide-1.0.0":true}` from a rejected `--install-extension` attempt can reappear — harmless but reset it).
3. `iexpress.exe /N setup.sed` → `QIROVA-IDE-Setup.exe` (~250 MB; the SED needs CRLF endings, a `TargetName`, and a non-empty install command — it currently zips staging to `QIROVA-payload.zip` and extracts with `tar`).
4. Launch `staging\QIROVA-IDE.cmd [folder]`; confirm extension host log shows activation `onView:qirova.copilotView`; the Copilot lands in the **secondary** sidebar (`workbench.secondarySideBar.defaultVisibility: visible` is in the profile settings).
5. Keep `src` ↔ `out` ↔ staging `qirova-ide` in sync (compare `Get-FileHash`); a stale `out/*.js` once caused a phantom view-ID bug.

Gotchas seen in practice: McAfee kills multi-command PowerShell (run steps singly, retry); PowerShell 5.1 `Set-Content -Encoding UTF8` writes a BOM (can break JSON configs — prefer ASCII/`[IO.File]::WriteAllText`); unit-test-discovered product quirks: `remediateActiveFile` collects a `fails` list it never prints; `/migrate/` never matches the word "migration"; `red team` (space) falls through to the welcome; completion snippets exist only for md5/sha1/des/ecb keywords; the detector is case-sensitive (`rsa.generate_private_key`, lowercase `sha256`, `rand_r(x)` are missed), and the ignore-comment marker must sit within ~12 chars before the match.

## 9. Demo corpus

`C:\Users\Samarth\quantum-pqc-sih2\data\demo_test_suite\`: `01_vulnerable_rsa_server.py` (20 findings), `03_payment_gateway_insecure_tls.py` (finds `cert_verify_disabled`), `04_false_alarm_auth_logger.py` (clean, 100), `05_quantum_resilient_argon2.py` (clean, 100), `LegacyPinEncryptor.java`, `vulnerable_crypto_app.bin/.exe`. Detector results on these are asserted in the integration tests' spirit and were verified live in the IDE (migrate on file 01 returns the ML-KEM-768 snippet + NIST SP 800-131A guidance).
