// Runs the test/*.js suites under Node instead of macOS JavaScriptCore.
//
//   node test/run-node.mjs                  # every suite
//   node test/run-node.mjs test/smoke.js    # just the ones named
//
// Must be run from the repo root, like the suites themselves. JSC stays the
// reference runner (see README.md); this exists for two reasons. It works
// anywhere Node does — Linux CI, a cloud session, a machine with no Xcode.
// And Node fails on an unhandled promise rejection where JSC's shell drops
// it silently: an exception inside an async click handler that the stub DOM
// in test/wiring.js provokes is invisible under JSC and fatal here.
//
// Each suite runs in its own process, as it would under `jsc -m`, with the
// three JSC shell globals the suites use (load, print, readFile) provided.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url);

if (process.env.RUN_NODE_SUITE) {
  // Node defines these as getter-only on globalThis; the suites assign
  // their own stubs to them, as they can under JSC.
  for (const key of ['navigator', 'crypto', 'localStorage', 'location', 'performance']) {
    Object.defineProperty(globalThis, key, {
      value: globalThis[key], writable: true, configurable: true,
    });
  }
  globalThis.load = (file) => vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  globalThis.print = (...args) => console.log(...args);
  globalThis.readFile = (file) => fs.readFileSync(file, 'utf8');
  await import(pathToFileURL(path.resolve(process.env.RUN_NODE_SUITE)).href);
} else {
  const suites = process.argv.length > 2
    ? process.argv.slice(2)
    : fs.readdirSync('test').filter((f) => f.endsWith('.js')).sort().map((f) => `test/${f}`);
  const failed = [];
  for (const suite of suites) {
    console.log(`=== ${suite}`);
    const result = spawnSync(process.execPath, [self], {
      stdio: 'inherit',
      env: { ...process.env, RUN_NODE_SUITE: suite },
    });
    if (result.status !== 0) failed.push(suite);
  }
  if (failed.length) {
    console.log(`\nFAILED: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nall ${suites.length} suites passed`);
}
