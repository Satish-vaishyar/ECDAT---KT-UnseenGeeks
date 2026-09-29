'use strict';
// In-process mock of the `vscode` API surface used by the QIROVA extension.
// Loaded in place of the real module (see setup.js) so that compiled out/*.js
// can run under plain Node for unit + integration tests.

const path = require('path');

class Disposable {
  constructor(fn) { this._fn = fn; this.disposed = false; }
  dispose() { if (!this.disposed) { this.disposed = true; try { this._fn && this._fn(); } catch { /* ignore */ } } }
}

class EventEmitter {
  constructor() { this._listeners = []; }
  get event() {
    const self = this;
    return function (listener) {
      self._listeners.push(listener);
      return new Disposable(() => {
        const i = self._listeners.indexOf(listener);
        if (i >= 0) self._listeners.splice(i, 1);
      });
    };
  }
  fire(value) { for (const l of [...this._listeners]) { try { l(value); } catch (e) { console.error('EventEmitter listener threw:', e); } } }
  dispose() { this._listeners = []; }
}

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  with(line, character) { return new Position(line ?? this.line, character ?? this.character); }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
}

class Range {
  constructor(a, b, c, d) {
    if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  contains(p) {
    if (p instanceof Range) return this.contains(p.start) && this.contains(p.end);
    if (p.line < this.start.line || p.line > this.end.line) return false;
    if (p.line === this.start.line && p.character < this.start.character) return false;
    if (p.line === this.end.line && p.character > this.end.character) return false;
    return true;
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
}

class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }

const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
    this.contextValue = undefined;
    this.tooltip = undefined;
    this.description = undefined;
    this.iconPath = undefined;
    this.command = undefined;
  }
}

const DiagnosticSeverity = { Warning: 0, Error: 1, Information: 2, Hint: 3 };
const DiagnosticTag = { Unnecessary: 1, Deprecated: 2 };

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range; this.message = message;
    this.severity = severity === undefined ? DiagnosticSeverity.Error : severity;
    this.code = undefined; this.source = undefined; this.tags = [];
  }
}

const StatusBarAlignment = { Left: 1, Right: 2 };
const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 };
const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 };

class CodeActionKind {
  constructor(value) { this.value = value; }
  contains(other) { return !!other && typeof other.value === 'string' && (other.value === this.value || other.value.startsWith(this.value + '.')); }
  append(...v) { return new CodeActionKind([this.value, ...v].join('.')); }
}
CodeActionKind.Empty = new CodeActionKind('');
CodeActionKind.QuickFix = new CodeActionKind('quickfix');
CodeActionKind.Refactor = new CodeActionKind('refactor');
CodeActionKind.RefactorExtract = new CodeActionKind('refactor.extract');

class CodeAction {
  constructor(title, kind) {
    this.title = title; this.kind = kind;
    this.diagnostics = []; this.edit = undefined; this.command = undefined; this.isPreferred = false;
  }
}

class WorkspaceEdit {
  constructor() { this._edits = new Map(); }
  set(uri, edits) { this._edits.set(uriKey(uri), { uri, edits }); }
  replace(uri, range, newText) {
    const k = uriKey(uri);
    const e = this._edits.get(k) || { uri, edits: [] };
    e.edits.push({ range, newText });
    this._edits.set(k, e);
  }
  insert(uri, position, newText) { this.replace(uri, new Range(position, position), newText); }
  get(uri) { return (this._edits.get(uriKey(uri)) || {}).edits; }
  entries() { return [...this._edits.values()]; }
  isEmpty() { return this._edits.size === 0; }
}

const CompletionItemKind = {
  Text: 1, Method: 2, Function: 3, Constructor: 4, Field: 5, Variable: 6,
  Class: 7, Interface: 8, Module: 9, Property: 10, Unit: 11, Value: 12,
  Enum: 13, Keyword: 14, Snippet: 15, Color: 16, File: 17, Reference: 18,
};

class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; this.insertText = undefined; this.detail = undefined; this.documentation = undefined; }
}

class InlineCompletionItem {
  constructor(insertText, range, command) { this.insertText = insertText; this.range = range; this.command = command; this.filterText = undefined; }
}

class CodeLens {
  constructor(range, command) { this.range = range; this.command = command; this.isResolved = true; }
}

class SnippetString { constructor(value) { this.value = value ?? ''; } append(s) { this.value += s; return this; } }
class MarkdownString { constructor(value) { this.value = value ?? ''; this.isTrusted = false; } appendMarkdown(s) { this.value += s; return this; } appendCodeblock(code, lang) { this.value += '```' + (lang || '') + '\n' + code + '\n```\n'; return this; } }

// --- Uri -------------------------------------------------------------------

function uriKey(uri) { return typeof uri === 'string' ? uri : (uri && uri.toString()) || String(uri); }

class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme; this.authority = authority || '';
    this.path = path || ''; this.query = query || ''; this.fragment = fragment || '';
    this.fsPath = Uri.fsPathOf(this);
  }
  static file(p) {
    const norm = path.resolve(String(p).replace(/\\/g, '/')).replace(/\\/g, '/');
    return new Uri('file', '', norm.startsWith('/') ? norm : '/' + norm);
  }
  static parse(v) {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/)?([^?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(String(v));
    if (!m) return Uri.file(String(v));
    return new Uri(m[1], m[2] || '', m[3] || '', m[4] || '', m[5] || '');
  }
  static joinPath(base, ...segments) {
    const parts = [base.path, ...segments].join('/');
    const normalized = parts.split('/').filter(s => s !== '' && s !== '.');
    const out = [];
    for (const s of normalized) { if (s === '..') out.pop(); else out.push(s); }
    const u = new Uri(base.scheme, base.authority, '/' + out.join('/'));
    return u;
  }
  static from(o) { return new Uri(o.scheme, o.authority, o.path, o.query, o.fragment); }
  static fsPathOf(u) {
    let p = u.path || '';
    if (u.scheme === 'file') {
      p = p.replace(/\//g, path.sep);
      if (/^[a-zA-Z]:/.test(p.slice(1))) p = p.slice(1);
      else if (p.startsWith(path.sep + path.sep)) p = p.slice(1);
    }
    return p;
  }
  with(change) { return new Uri(change.scheme ?? this.scheme, change.authority ?? this.authority, change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment); }
  toString() {
    const q = this.query ? '?' + this.query : '';
    const f = this.fragment ? '#' + this.fragment : '';
    const auth = this.authority ? '//' + this.authority : '';
    return `${this.scheme}:${auth}${this.path}${q}${f}`;
  }
  toJSON() { return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment }; }
}

// --- TextDocument / TextEditor --------------------------------------------

function offsetOf(text, line, character) {
  const lines = text.split('\n');
  let off = 0;
  for (let i = 0; i < line && i < lines.length; i++) off += lines[i].length + 1;
  return off + Math.min(character, (lines[line] || '').length);
}

class TextDocument {
  constructor(uri, text, languageId) {
    this.uri = uri;
    this._text = text ?? '';
    this.languageId = languageId || 'plaintext';
    this.version = 1;
    this.isDirty = false;
  }
  get fsPath() { return this.uri.fsPath; }
  get fileName() { return this.uri.fsPath; }
  get lineCount() { return this._text.split('\n').length; }
  getText(range) {
    if (!range) return this._text;
    const a = offsetOf(this._text, range.start.line, range.start.character);
    const b = offsetOf(this._text, range.end.line, range.end.character);
    return this._text.slice(a, b);
  }
  lineAt(lineOrPosition) {
    const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
    const lines = this._text.split('\n');
    const text = lines[line] ?? '';
    return {
      lineNumber: line,
      text,
      range: new Range(line, 0, line, text.length),
      firstNonWhitespaceCharacterIndex: text.search(/\S|$/),
      isEmptyOrWhitespace: /^\s*$/.test(text),
    };
  }
  offsetAt(position) { return offsetOf(this._text, position.line, position.character); }
  positionAt(offset) {
    const lines = this._text.slice(0, offset).split('\n');
    return new Position(lines.length - 1, lines[lines.length - 1].length);
  }
  getTextInRange(r) { return this.getText(r); }
  _applyEdits(edits) {
    const sorted = [...edits].sort((a, b) =>
      b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
    for (const e of sorted) {
      const a = offsetOf(this._text, e.range.start.line, e.range.start.character);
      const b = offsetOf(this._text, e.range.end.line, e.range.end.character);
      this._text = this._text.slice(0, a) + (e.newText ?? '') + this._text.slice(b);
    }
    this.version++;
    this.isDirty = true;
  }
}

class TextEditor {
  constructor(document, mockState) {
    this.document = document;
    this.selection = new Selection(new Position(0, 0), new Position(0, 0));
    this.selections = [this.selection];
    this.visibleRanges = [];
    this._mock = mockState;
    this.revealCalls = [];
  }
  edit(callbackBuilder, _options) {
    const ops = [];
    const builder = {
      replace: (range, newText) => ops.push({ range, newText }),
      insert: (position, newText) => ops.push({ range: new Range(position, position), newText }),
      delete: (range) => ops.push({ range, newText: '' }),
      setEndOfLine: () => {},
    };
    try { callbackBuilder(builder); } catch (e) { return Promise.resolve(false); }
    this.document._applyEdits(ops);
    if (this._mock) this._mock._edits.push({ fsPath: this.document.uri.fsPath, ops });
    return Promise.resolve(true);
  }
  revealRange(range, _type) { this.revealCalls.push({ range, type: _type }); }
  setDecorations(type, ranges) { (this._decorCalls = this._decorCalls || []).push({ type, ranges }); }
}

class Selection extends Range {
  constructor(anchorLine, anchorChar, activeLine, activeChar) {
    if (typeof anchorLine === 'number') super(anchorLine, anchorChar, activeLine ?? anchorLine, activeChar ?? anchorChar);
    else super(anchorLine, anchorChar);
    this.anchor = this.start; this.active = this.end;
  }
}

// --- Mock state ------------------------------------------------------------

const state = {
  commands: new Map(),
  commandHistory: [],
  throwOnUnregistered: new Set(),
  treeProviders: new Map(),
  webviewViewProviders: new Map(),
  codeActionProviders: [],
  completionProviders: [],
  inlineProviders: [],
  codeLensProviders: [],
  decorationTypes: [],
  diagnosticCollections: [],
  statusBarItems: [],
  webviewPanels: [],
  terminals: [],
  messages: [],           // showInformation/Warning/ErrorMessage calls
  messageResponse: undefined,
  quickPickResponse: undefined,
  quickPickCalls: [],
  config: new Map(),      // full key -> value
  configUpdateCalls: [],
  workspaceFolders: [],
  findFilesResult: [],
  findFilesCalls: [],
  openDocs: new Map(),    // fsPath -> TextDocument
  docRegistry: [],        // order of creation
  activeTextEditor: undefined,
  activeEditorListeners: [],
  didChangeDocListeners: [],
  didSaveDocListeners: [],
  executed: [],           // executeCommand calls
  writtenFiles: [],
  progressCalls: [],
  withProgressTasks: [],
  openTextDocCalls: [],
  showTextDocCalls: [],
  editLog: [],
  _edits: [],
  env: { remoteName: undefined, appName: 'QIROVA-Test', uriScheme: 'vscode', language: 'en', machineId: 'test', sessionId: 'test', isFirst: false, isTelemetryEnabled: false },
};

function reset() {
  state.commands.clear();
  state.commandHistory.length = 0;
  state.throwOnUnregistered.clear();
  state.treeProviders.clear();
  state.webviewViewProviders.clear();
  state.codeActionProviders.length = 0;
  state.completionProviders.length = 0;
  state.inlineProviders.length = 0;
  state.codeLensProviders.length = 0;
  state.decorationTypes.length = 0;
  state.diagnosticCollections.length = 0;
  state.statusBarItems.length = 0;
  state.webviewPanels.length = 0;
  state.terminals.length = 0;
  state.messages.length = 0;
  state.messageResponse = undefined;
  state.quickPickResponse = undefined;
  state.quickPickCalls.length = 0;
  state.config.clear();
  state.configUpdateCalls.length = 0;
  state.workspaceFolders.length = 0;
  state.findFilesResult.length = 0;
  state.findFilesCalls.length = 0;
  state.openDocs.clear();
  state.docRegistry.length = 0;
  state.activeTextEditor = undefined;
  state.activeEditorListeners.length = 0;
  state.didChangeDocListeners.length = 0;
  state.didSaveDocListeners.length = 0;
  state.executed.length = 0;
  state.writtenFiles.length = 0;
  state.progressCalls.length = 0;
  state.withProgressTasks.length = 0;
  state.openTextDocCalls.length = 0;
  state.showTextDocCalls.length = 0;
  state.editLog.length = 0;
  state._edits.length = 0;
}

// --- helpers exported to tests --------------------------------------------

function setConfig(key, value) { state.config.set(key, value); }

function openDocument(fsPath, text, languageId) {
  const doc = new TextDocument(Uri.file(fsPath), text, languageId);
  state.openDocs.set(path.resolve(fsPath), doc);
  state.docRegistry.push(doc);
  return doc;
}

function setActiveTextEditor(editor) {
  state.activeTextEditor = editor;
  for (const l of [...state.activeEditorListeners]) l(editor);
}

function findDocument(fsPath) { return state.openDocs.get(path.resolve(fsPath)); }

function fireDidChangeTextDocument(document, contentChanges) {
  const e = { document, contentChanges: contentChanges ?? [{ text: document.getText() }], reason: 1 };
  for (const l of [...state.didChangeDocListeners]) l(e);
  return e;
}

function fireDidSaveTextDocument(document) {
  const e = { document };
  for (const l of [...state.didSaveDocListeners]) l(e);
  return e;
}

function getRegisteredCommand(id) { return state.commands.get(id); }
function findStatusBarItem(predicate) { return state.statusBarItems.find(predicate); }
function allMessages() { return state.messages.map(m => m.message); }

async function executeRegistered(id, ...args) {
  const fn = state.commands.get(id);
  if (!fn) throw new Error(`command not found: ${id}`);
  return fn(...args);
}

// --- vscode module ---------------------------------------------------------

const vscode = {
  version: '1.85.0-test',
  Disposable,
  EventEmitter,
  Position,
  Range,
  Selection,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
  StatusBarAlignment,
  ViewColumn,
  ProgressLocation,
  ConfigurationTarget,
  TextEditorRevealType,
  CodeActionKind,
  CodeAction,
  WorkspaceEdit,
  CompletionItem,
  CompletionItemKind,
  InlineCompletionItem,
  CodeLens,
  SnippetString,
  MarkdownString,
  Uri,

  languages: {
    createDiagnosticCollection(name) {
      const map = new Map();
      const coll = {
        name,
        set: (uri, diags) => { map.set(uriKey(uri), diags || []); },
        get: (uri) => map.get(uriKey(uri)),
        has: (uri) => map.has(uriKey(uri)),
        delete: (uri) => map.delete(uriKey(uri)),
        clear: () => map.clear(),
        forEach: (cb) => { for (const [k, v] of map) cb(k, v); },
        dispose: () => map.clear(),
        _map: map,
      };
      state.diagnosticCollections.push(coll);
      return coll;
    },
    registerCodeActionsProvider(selector, provider, metadata) {
      state.codeActionProviders.push({ selector, provider, metadata });
      return new Disposable(() => { const i = state.codeActionProviders.findIndex(p => p.provider === provider); if (i >= 0) state.codeActionProviders.splice(i, 1); });
    },
    registerCompletionItemProvider(selector, provider, ...trigger) {
      state.completionProviders.push({ selector, provider, trigger });
      return new Disposable(() => { const i = state.completionProviders.findIndex(p => p.provider === provider); if (i >= 0) state.completionProviders.splice(i, 1); });
    },
    registerInlineCompletionItemProvider(selector, provider) {
      state.inlineProviders.push({ selector, provider });
      return new Disposable(() => { const i = state.inlineProviders.findIndex(p => p.provider === provider); if (i >= 0) state.inlineProviders.splice(i, 1); });
    },
    registerCodeLensProvider(selector, provider) {
      state.codeLensProviders.push({ selector, provider });
      return new Disposable(() => { const i = state.codeLensProviders.findIndex(p => p.provider === provider); if (i >= 0) state.codeLensProviders.splice(i, 1); });
    },
    registerHoverProvider() { return new Disposable(() => {}); },
    registerDocumentLinkProvider() { return new Disposable(() => {}); },
  },

  commands: {
    registerCommand(id, fn) {
      state.commands.set(id, fn);
      state.commandHistory.push({ type: 'register', id });
      return new Disposable(() => { state.commands.delete(id); });
    },
    executeCommand(id, ...args) {
      state.executed.push({ id, args });
      if (state.throwOnUnregistered.has(id) || (!state.commands.has(id) && state.throwOnUnregistered.has('*'))) {
        return Promise.reject(new Error(`command '${id}' not found`));
      }
      const fn = state.commands.get(id);
      if (!fn) return Promise.resolve(undefined);
      try { return Promise.resolve(fn(...args)); } catch (e) { return Promise.reject(e); }
    },
    getCommands() { return Promise.resolve([...state.commands.keys()]); },
  },

  window: {
    get activeTextEditor() { return state.activeTextEditor; },
    createStatusBarItem(alignmentOrId, priority) {
      const item = {
        id: typeof alignmentOrId === 'string' ? alignmentOrId : undefined,
        alignment: typeof alignmentOrId === 'number' ? alignmentOrId : StatusBarAlignment.Left,
        priority,
        text: '', tooltip: '', command: '', color: undefined, backgroundColor: undefined,
        name: undefined, _visible: false,
        show() { this._visible = true; },
        hide() { this._visible = false; },
        dispose() { const i = state.statusBarItems.indexOf(this); if (i >= 0) state.statusBarItems.splice(i, 1); },
      };
      state.statusBarItems.push(item);
      return item;
    },
    createWebviewPanel(viewType, title, viewColumnOrOptions, options) {
      const listeners = [];
      const disposers = [];
      const posted = [];
      const webview = {
        html: '',
        options: options || {},
        posted,
        _listeners: listeners,
        onDidReceiveMessage(cb) { listeners.push(cb); return new Disposable(() => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }); },
        postMessage(msg) { posted.push(msg); return Promise.resolve(true); },
        asWebviewUri(uri) { return Uri.parse('vscode-webview://local' + (uri.path || '')); },
        cspSource: 'vscode-webview://local',
        async emit(msg) { for (const cb of [...listeners]) await cb(msg); },
      };
      const panel = {
        viewType, title, webview,
        iconPath: undefined, active: true, visible: true,
        _disposers: disposers,
        _revealed: 0,
        onDidDispose(cb) { disposers.push(cb); return new Disposable(() => { const i = disposers.indexOf(cb); if (i >= 0) disposers.splice(i, 1); }); },
        reveal() { this._revealed++; this.visible = true; this.active = true; },
        dispose() { this.visible = false; for (const cb of [...disposers]) cb(); const i = state.webviewPanels.indexOf(this); if (i >= 0) state.webviewPanels.splice(i, 1); },
      };
      state.webviewPanels.push(panel);
      return panel;
    },
    registerTreeDataProvider(viewId, provider) {
      state.treeProviders.set(viewId, provider);
      return new Disposable(() => { state.treeProviders.delete(viewId); });
    },
    registerWebviewViewProvider(viewId, provider, options) {
      state.webviewViewProviders.set(viewId, { provider, options });
      return new Disposable(() => { state.webviewViewProviders.delete(viewId); });
    },
    createTreeView() { return new Disposable(() => {}); },
    registerFileDecorationProvider() { return new Disposable(() => {}); },
    createTextEditorDecorationType(options) {
      const t = { options, disposed: false, dispose() { this.disposed = true; } };
      state.decorationTypes.push(t);
      return t;
    },
    async showInformationMessage(message, ...rest) { state.messages.push({ level: 'info', message, items: rest.filter(x => typeof x === 'string') }); return state.messageResponse; },
    async showWarningMessage(message, ...rest) { state.messages.push({ level: 'warn', message, items: rest.filter(x => typeof x === 'string') }); return state.messageResponse; },
    async showErrorMessage(message, ...rest) { state.messages.push({ level: 'error', message, items: rest.filter(x => typeof x === 'string') }); return state.messageResponse; },
    async showQuickPick(items, _opts) { state.quickPickCalls.push({ items }); return state.quickPickResponse; },
    async showInputBox() { return undefined; },
    async showTextDocument(arg, _opts) {
      state.showTextDocCalls.push(arg);
      const doc = typeof arg.getText === 'function' ? arg : openDocument(String(arg.fsPath || arg), '');
      const ed = new TextEditor(doc, state);
      state.activeTextEditor = ed;
      for (const l of [...state.activeEditorListeners]) l(ed);
      return ed;
    },
    async withProgress(_options, task) {
      state.progressCalls.push(_options);
      const reporter = { report: (v) => { state.progressCalls.push({ report: v }); } };
      state.withProgressTasks.push(task);
      return task(reporter);
    },
    onDidChangeActiveTextEditor(cb) { state.activeEditorListeners.push(cb); return new Disposable(() => { const i = state.activeEditorListeners.indexOf(cb); if (i >= 0) state.activeEditorListeners.splice(i, 1); }); },
    onDidChangeVisibleTextEditors() { return new Disposable(() => {}); },
    onDidChangeTextEditorSelection() { return new Disposable(() => {}); },
    createTerminal(opts) {
      const t = {
        name: (opts && opts.name) || 'terminal', cwd: opts && opts.cwd,
        shown: 0, sent: [],
        show() { this.shown++; },
        hide() {},
        sendText(text, addNewLine) { this.sent.push({ text, addNewLine }); },
        dispose() { const i = state.terminals.indexOf(this); if (i >= 0) state.terminals.splice(i, 1); },
      };
      state.terminals.push(t);
      return t;
    },
    createOutputChannel(name) {
      return { name, append: () => {}, appendLine: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {}, replace: () => {} };
    },
    showWorkspaceFolderPicker: async () => undefined,
    onDidChangeWindowState: () => new Disposable(() => {}),
    onDidCloseTerminal: () => new Disposable(() => {}),
    onDidOpenTerminal: () => new Disposable(() => {}),
    setStatusBarMessage: () => new Disposable(() => {}),
  },

  workspace: {
    get workspaceFolders() { return state.workspaceFolders; },
    getConfiguration(section) {
      return {
        get(key, defaultValue) {
          const full = section ? `${section}.${key}` : key;
          return state.config.has(full) ? state.config.get(full) : defaultValue;
        },
        has(key) { return state.config.has(section ? `${section}.${key}` : key); },
        inspect(key) {
          const full = section ? `${section}.${key}` : key;
          return { key: full, defaultValue: undefined, globalValue: state.config.get(full), workspaceValue: undefined, workspaceFolderValue: undefined };
        },
        async update(key, value, target) {
          const full = section ? `${section}.${key}` : key;
          state.config.set(full, value);
          state.configUpdateCalls.push({ full, value, target });
          return undefined;
        },
      };
    },
    async findFiles(include, exclude, maxResults) {
      state.findFilesCalls.push({ include, exclude, maxResults });
      return state.findFilesResult.slice(0, maxResults || undefined);
    },
    async openTextDocument(arg) {
      state.openTextDocCalls.push(arg);
      if (arg && typeof arg === 'object' && arg.fsPath) {
        const key = path.resolve(arg.fsPath);
        let doc = state.openDocs.get(key);
        if (!doc) {
          let content = '';
          try { content = require('fs').readFileSync(key, 'utf-8'); } catch { content = ''; }
          const langMap = { '.py': 'python', '.js': 'javascript', '.ts': 'typescript', '.java': 'java', '.go': 'go', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c', '.rs': 'rust', '.rb': 'ruby' };
          const ext = path.extname(key).toLowerCase();
          doc = new TextDocument(Uri.file(key), content, langMap[ext] || 'plaintext');
          state.openDocs.set(key, doc);
          state.docRegistry.push(doc);
        }
        return doc;
      }
      if (typeof arg === 'string') {
        const doc = new TextDocument(Uri.file(path.join(process.cwd(), `untitled-${state.docRegistry.length}`)), arg, 'plaintext');
        state.docRegistry.push(doc);
        return doc;
      }
      throw new Error('unsupported openTextDocument arg');
    },
    asRelativePath(uriOrPath, _includeWorkspaceFolder) {
      const p = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
      if (!state.workspaceFolders.length) return p;
      for (const f of state.workspaceFolders) {
        const root = f.uri.fsPath.replace(/\\/g, '/');
        const target = String(p).replace(/\\/g, '/');
        if (target.toLowerCase().startsWith(root.toLowerCase())) {
          const rel = target.slice(root.length).replace(/^\//, '');
          return rel;
        }
      }
      return p;
    },
    getWorkspaceFolder(uri) {
      return state.workspaceFolders.find(f => String(uri.fsPath).toLowerCase().startsWith(f.uri.fsPath.toLowerCase()));
    },
    onDidChangeTextDocument(cb) { state.didChangeDocListeners.push(cb); return new Disposable(() => { const i = state.didChangeDocListeners.indexOf(cb); if (i >= 0) state.didChangeDocListeners.splice(i, 1); }); },
    onDidSaveTextDocument(cb) { state.didSaveDocListeners.push(cb); return new Disposable(() => { const i = state.didSaveDocListeners.indexOf(cb); if (i >= 0) state.didSaveDocListeners.splice(i, 1); }); },
    onDidChangeConfiguration() { return new Disposable(() => {}); },
    onDidChangeWorkspaceFolders() { return new Disposable(() => {}); },
    onDidCloseTextDocument() { return new Disposable(() => {}); },
    onDidOpenTextDocument() { return new Disposable(() => {}); },
    fs: {
      async writeFile(uri, content) {
        const fs = require('fs');
        const p = uri.fsPath;
        try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch { /* ignore */ }
        fs.writeFileSync(p, Buffer.isBuffer(content) ? content : Buffer.from(String(content)));
        state.writtenFiles.push(p);
        return undefined;
      },
      async readFile(uri) { return { value: require('fs').readFileSync(uri.fsPath) }; },
      async stat(uri) { const st = require('fs').statSync(uri.fsPath); return { type: 1, ctime: st.ctimeMs, mtime: st.mtimeMs, size: st.size }; },
      async delete(uri) { require('fs').rmSync(uri.fsPath, { force: true, recursive: true }); },
      async rename() {},
      async copy() {},
      isWritableFileSystem: true,
    },
    get textDocuments() { return [...state.docRegistry]; },
    applyEdit: async () => true,
    save: async () => true,
  },

  env: Object.assign({}, state.env),

  extensions: {
    getExtension() { return undefined; },
    all: [],
  },

  // Test-only helpers (not part of the real API).
  __state: state,
  __reset: reset,
  __setConfig: setConfig,
  __openDocument: openDocument,
  __setActiveTextEditor: setActiveTextEditor,
  __findDocument: findDocument,
  __fireDidChangeTextDocument: fireDidChangeTextDocument,
  __fireDidSaveTextDocument: fireDidSaveTextDocument,
  __getRegisteredCommand: getRegisteredCommand,
  __findStatusBarItem: findStatusBarItem,
  __allMessages: allMessages,
  __executeRegistered: executeRegistered,
  __TextDocument: TextDocument,
  __TextEditor: TextEditor,
};

module.exports = vscode;
