// CJS require-hook: map 'server-only' → empty object.
// tsx transpiles TS modules to CJS; when they `require('server-only')` we
// intercept at resolution.
const Module = require("node:module");
const origResolve = Module._resolveFilename;
const emptyPath = require.resolve("./_server_only_empty.cjs");
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") return emptyPath;
  return origResolve.call(this, request, parent, isMain, options);
};
