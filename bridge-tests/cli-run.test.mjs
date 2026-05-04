// Tests for the `alethia run` CLI subcommand. Three layers:
//   1. parseRunArgs — pure argv parsing (no IO)
//   2. extractRunResult / formatRunResult — pure result transforms
//   3. End-to-end smoke: spawn `node dist/index.js run --help` and check exit 0
//
// The actual run-against-runtime flow isn't tested here — it would need
// a live runtime + a target page. The bridge-smoke.test.mjs already
// covers the runtime-spawn path; this file covers the new CLI surface.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const BRIDGE_BIN = join(__dirname, '..', 'dist', 'index.js');

const { parseRunArgs, extractRunResult, formatRunResult } = await import('../dist/index.js');

test('parseRunArgs: empty argv returns error', () => {
  const r = parseRunArgs([]);
  expect(r.mode).toBe('error');
});

test('parseRunArgs: --help returns help mode', () => {
  expect(parseRunArgs(['--help']).mode).toBe('help');
  expect(parseRunArgs(['-h']).mode).toBe('help');
});

test('parseRunArgs: positional path', () => {
  const r = parseRunArgs(['tests/login.alethia']);
  expect(r.mode).toBe('file');
  expect(r.path).toBe('tests/login.alethia');
  expect(r.json).toBe(false);
  expect(r.quiet).toBe(false);
});

test('parseRunArgs: stdin via -', () => {
  expect(parseRunArgs(['-']).mode).toBe('stdin');
});

test('parseRunArgs: --nlp inline', () => {
  const r = parseRunArgs(['--nlp', 'navigate to /\nclick Sign In']);
  expect(r.mode).toBe('inline');
  expect(r.nlp).toBe('navigate to /\nclick Sign In');
});

test('parseRunArgs: --nlp without value errors', () => {
  const r = parseRunArgs(['--nlp']);
  expect(r.mode).toBe('error');
  expect(r.message).toMatch(/requires a value/);
});

test('parseRunArgs: --json + --quiet flags', () => {
  const r = parseRunArgs(['tests/x.alethia', '--json', '--quiet']);
  expect(r.mode).toBe('file');
  expect(r.json).toBe(true);
  expect(r.quiet).toBe(true);
});

test('parseRunArgs: --name forwarded', () => {
  const r = parseRunArgs(['--nlp', 'click X', '--name', 'login flow']);
  expect(r.mode).toBe('inline');
  expect(r.name).toBe('login flow');
});

test('parseRunArgs: --nlp + path is rejected', () => {
  const r = parseRunArgs(['--nlp', 'click X', 'tests/login.alethia']);
  expect(r.mode).toBe('error');
  expect(r.message).toMatch(/either --nlp or a path/);
});

test('parseRunArgs: two positional args is rejected', () => {
  const r = parseRunArgs(['tests/a.alethia', 'tests/b.alethia']);
  expect(r.mode).toBe('error');
  expect(r.message).toMatch(/Unexpected extra argument/);
});

test('parseRunArgs: unknown flag is rejected', () => {
  const r = parseRunArgs(['--unknown-flag']);
  expect(r.mode).toBe('error');
  expect(r.message).toMatch(/Unknown flag/);
});

test('extractRunResult: empty response yields zeroed result', () => {
  const r = extractRunResult({});
  expect(r.stepCount).toBe(0);
  expect(r.passCount).toBe(0);
  expect(r.failCount).toBe(0);
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
  expect(r.name).toBe('login flow');
  expect(r.elapsedMs).toBe(234);
  expect(r.stepCount).toBe(3);
  expect(r.passCount).toBe(2);
  expect(r.failCount).toBe(1);
  expect(r.ok).toBe(false);
  expect(r.steps[2].line).toBe('assert Welcome is visible');
  expect(r.steps[2].reasonCode).toBe('ELEMENT_NOT_FOUND');
});

test('extractRunResult: success run', () => {
  const r = extractRunResult({
    ok: true,
    run: { name: 'all good', elapsedMs: 100, stepRuns: [{ ok: true, detail: 'ok', elapsedMs: 50 }], lines: [{ original: 'click X', ir: '', confidence: 1 }] },
  });
  expect(r.ok).toBe(true);
  expect(r.passCount).toBe(1);
});

test('formatRunResult: --json emits valid JSON', () => {
  const result = {
    ok: true, name: 'x', passCount: 1, failCount: 0, stepCount: 1, elapsedMs: 10,
    steps: [{ ok: true, line: 'click X', detail: '', elapsedMs: 10 }],
  };
  const out = formatRunResult(result, { json: true, quiet: false });
  const parsed = JSON.parse(out);
  expect(parsed.ok).toBe(true);
  expect(parsed.passCount).toBe(1);
});

test('formatRunResult: --quiet emits one-line summary', () => {
  const passing = formatRunResult({
    ok: true, name: 'x', passCount: 3, failCount: 0, stepCount: 3, elapsedMs: 100, steps: [],
  }, { json: false, quiet: true });
  expect(passing).toMatch(/3\/3 passed in 100ms/);

  const failing = formatRunResult({
    ok: false, name: 'x', passCount: 1, failCount: 2, stepCount: 3, elapsedMs: 100, steps: [],
  }, { json: false, quiet: true });
  expect(failing).toMatch(/2 of 3 failed/);
});

test('formatRunResult: default text format includes step lines + summary', () => {
  const out = formatRunResult({
    ok: false, name: 'login', passCount: 1, failCount: 1, stepCount: 2, elapsedMs: 200,
    steps: [
      { ok: true, line: 'navigate to /', detail: 'Navigated', elapsedMs: 45 },
      { ok: false, line: 'click Sign In', detail: 'Element not found', elapsedMs: 150 },
    ],
  }, { json: false, quiet: false });
  expect(out).toMatch(/Alethia · login/);
  expect(out).toMatch(/1\. navigate to \//);
  expect(out).toMatch(/2\. click Sign In/);
  expect(out).toMatch(/Element not found/);
  expect(out).toMatch(/1 of 2 failed/);
});

// End-to-end smoke: spawning the built bridge with `run --help` should exit 0
// and emit the run-mode help.
test('e2e: alethia-mcp run --help exits 0 with usage', () => {
  const r = spawnSync('node', [BRIDGE_BIN, 'run', '--help'], { encoding: 'utf8' });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/USAGE/);
  expect(r.stdout).toMatch(/alethia run/);
});

test('e2e: alethia-mcp run with no args exits 2', () => {
  const r = spawnSync('node', [BRIDGE_BIN, 'run'], { encoding: 'utf8' });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/No NLP source/);
});

test('e2e: alethia-mcp run with non-existent file exits 1', () => {
  const r = spawnSync('node', [BRIDGE_BIN, 'run', '/tmp/nonexistent-alethia-test-file.alethia'], { encoding: 'utf8' });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/file not found/);
});
