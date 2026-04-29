// Tests for the `alethia run` CLI subcommand. Three layers:
//   1. parseRunArgs — pure argv parsing (no IO)
//   2. extractRunResult / formatRunResult — pure result transforms
//   3. End-to-end smoke: spawn `node dist/index.js run --help` and check exit 0
//
// The actual run-against-runtime flow isn't tested here — it would need
// a live runtime + a target page. The bridge-smoke.test.mjs already
// covers the runtime-spawn path; this file covers the new CLI surface.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const BRIDGE_BIN = join(__dirname, '..', 'dist', 'index.js');

const { parseRunArgs, extractRunResult, formatRunResult } = await import('../dist/index.js');

test('parseRunArgs: empty argv returns error', () => {
  const r = parseRunArgs([]);
  assert.equal(r.mode, 'error');
});

test('parseRunArgs: --help returns help mode', () => {
  assert.equal(parseRunArgs(['--help']).mode, 'help');
  assert.equal(parseRunArgs(['-h']).mode, 'help');
});

test('parseRunArgs: positional path', () => {
  const r = parseRunArgs(['tests/login.alethia']);
  assert.equal(r.mode, 'file');
  assert.equal(r.path, 'tests/login.alethia');
  assert.equal(r.json, false);
  assert.equal(r.quiet, false);
});

test('parseRunArgs: stdin via -', () => {
  assert.equal(parseRunArgs(['-']).mode, 'stdin');
});

test('parseRunArgs: --nlp inline', () => {
  const r = parseRunArgs(['--nlp', 'navigate to /\nclick Sign In']);
  assert.equal(r.mode, 'inline');
  assert.equal(r.nlp, 'navigate to /\nclick Sign In');
});

test('parseRunArgs: --nlp without value errors', () => {
  const r = parseRunArgs(['--nlp']);
  assert.equal(r.mode, 'error');
  assert.match(r.message, /requires a value/);
});

test('parseRunArgs: --json + --quiet flags', () => {
  const r = parseRunArgs(['tests/x.alethia', '--json', '--quiet']);
  assert.equal(r.mode, 'file');
  assert.equal(r.json, true);
  assert.equal(r.quiet, true);
});

test('parseRunArgs: --name forwarded', () => {
  const r = parseRunArgs(['--nlp', 'click X', '--name', 'login flow']);
  assert.equal(r.mode, 'inline');
  assert.equal(r.name, 'login flow');
});

test('parseRunArgs: --nlp + path is rejected', () => {
  const r = parseRunArgs(['--nlp', 'click X', 'tests/login.alethia']);
  assert.equal(r.mode, 'error');
  assert.match(r.message, /either --nlp or a path/);
});

test('parseRunArgs: two positional args is rejected', () => {
  const r = parseRunArgs(['tests/a.alethia', 'tests/b.alethia']);
  assert.equal(r.mode, 'error');
  assert.match(r.message, /Unexpected extra argument/);
});

test('parseRunArgs: unknown flag is rejected', () => {
  const r = parseRunArgs(['--unknown-flag']);
  assert.equal(r.mode, 'error');
  assert.match(r.message, /Unknown flag/);
});

test('extractRunResult: empty response yields zeroed result', () => {
  const r = extractRunResult({});
  assert.equal(r.stepCount, 0);
  assert.equal(r.passCount, 0);
  assert.equal(r.failCount, 0);
});

test('extractRunResult: parses runtime response with stepRuns + lines', () => {
  const response = {
    ok: true,
    run: {
      name: 'login flow',
      elapsedMs: 234,
      stepRuns: [
        { ok: true, detail: 'Navigated to /', elapsedMs: 45 },
        { ok: true, detail: 'Clicked Sign In', elapsedMs: 38 },
        { ok: false, detail: 'Element not found: Welcome', elapsedMs: 1500, reasonCode: 'ELEMENT_NOT_FOUND' },
      ],
      lines: [
        { original: 'navigate to /', ir: 'NAVIGATE /', confidence: 1 },
        { original: 'click Sign In', ir: 'CLICK :text(Sign In)', confidence: 0.95 },
        { original: 'assert Welcome is visible', ir: 'ASSERT_EXISTS :text(Welcome)', confidence: 0.94 },
      ],
    },
  };
  const r = extractRunResult(response);
  assert.equal(r.name, 'login flow');
  assert.equal(r.elapsedMs, 234);
  assert.equal(r.stepCount, 3);
  assert.equal(r.passCount, 2);
  assert.equal(r.failCount, 1);
  assert.equal(r.ok, false);
  assert.equal(r.steps[2].line, 'assert Welcome is visible');
  assert.equal(r.steps[2].reasonCode, 'ELEMENT_NOT_FOUND');
});

test('extractRunResult: success run', () => {
  const r = extractRunResult({
    ok: true,
    run: { name: 'all good', elapsedMs: 100, stepRuns: [{ ok: true, detail: 'ok', elapsedMs: 50 }], lines: [{ original: 'click X', ir: '', confidence: 1 }] },
  });
  assert.equal(r.ok, true);
  assert.equal(r.passCount, 1);
});

test('formatRunResult: --json emits valid JSON', () => {
  const result = {
    ok: true, name: 'x', passCount: 1, failCount: 0, stepCount: 1, elapsedMs: 10,
    steps: [{ ok: true, line: 'click X', detail: '', elapsedMs: 10 }],
  };
  const out = formatRunResult(result, { json: true, quiet: false });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.passCount, 1);
});

test('formatRunResult: --quiet emits one-line summary', () => {
  const passing = formatRunResult({
    ok: true, name: 'x', passCount: 3, failCount: 0, stepCount: 3, elapsedMs: 100, steps: [],
  }, { json: false, quiet: true });
  assert.match(passing, /3\/3 passed in 100ms/);

  const failing = formatRunResult({
    ok: false, name: 'x', passCount: 1, failCount: 2, stepCount: 3, elapsedMs: 100, steps: [],
  }, { json: false, quiet: true });
  assert.match(failing, /2 of 3 failed/);
});

test('formatRunResult: default text format includes step lines + summary', () => {
  const out = formatRunResult({
    ok: false, name: 'login', passCount: 1, failCount: 1, stepCount: 2, elapsedMs: 200,
    steps: [
      { ok: true, line: 'navigate to /', detail: 'Navigated', elapsedMs: 45 },
      { ok: false, line: 'click Sign In', detail: 'Element not found', elapsedMs: 150 },
    ],
  }, { json: false, quiet: false });
  assert.match(out, /Alethia · login/);
  assert.match(out, /1\. navigate to \//);
  assert.match(out, /2\. click Sign In/);
  assert.match(out, /Element not found/);
  assert.match(out, /1 of 2 failed/);
});

// End-to-end smoke: spawning the built bridge with `run --help` should exit 0
// and emit the run-mode help.
test('e2e: alethia-mcp run --help exits 0 with usage', () => {
  const r = spawnSync('node', [BRIDGE_BIN, 'run', '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /USAGE/);
  assert.match(r.stdout, /alethia run/);
});

test('e2e: alethia-mcp run with no args exits 2', () => {
  const r = spawnSync('node', [BRIDGE_BIN, 'run'], { encoding: 'utf8' });
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /No NLP source/);
});

test('e2e: alethia-mcp run with non-existent file exits 1', () => {
  const r = spawnSync('node', [BRIDGE_BIN, 'run', '/tmp/nonexistent-alethia-test-file.alethia'], { encoding: 'utf8' });
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}`);
  assert.match(r.stderr, /file not found/);
});
