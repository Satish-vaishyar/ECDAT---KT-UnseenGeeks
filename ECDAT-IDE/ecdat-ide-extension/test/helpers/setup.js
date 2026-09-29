'use strict';
// Redirects `require('vscode')` to the in-process mock so compiled out/*.js
// can run under plain Node. Require this FIRST in every test file.

const Module = require('module');

let installed = false;

function install() {
  if (installed) return require('./vscode-mock');
  installed = true;
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') return require.resolve('./vscode-mock.js');
    return originalResolve.call(this, request, ...rest);
  };
  return require('./vscode-mock');
}

const vscode = install();

module.exports = { vscode, install };
