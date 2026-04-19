// Smoke tests for @vitronai/alethia
//
// These tests do NOT require a running Alethia runtime. They verify:
//   - The CLI binary launches and responds to --version, --help
//   - The stdio protocol parses cleanly and returns correct shapes for
//     initialize, tools/list, and unknown methods
//   - tools/list returns the expected 7 tools
//   - Validation rejects malformed tools/call args
//
// Run with `npm test` (uses node:test, no external dependencies).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = resolve(__dirname, '..', 'dist', 'index.js');
const PKG = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));

const EXPECTED_TOOLS = [
  'alethia_tell',
  'alethia_compile',
  'alethia_status',
  'alethia_activate_kill_switch',
  'alethia_reset_kill_switch',
  'alethia_screenshot',
  'alethia_eval',
  'alethia_audit_wcag',
  'alethia_audit_nist',
  'alethia_export_session',
  'alethia_tell_parallel',
  'alethia_serve_demo',
  'alethia_propose_tests',
  'alethia_assert_safety',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runCli = (args, { input, timeoutMs = 5000 } = {}) =>
  new Promise((resolveRun, rejectRun) => {
    const proc = spawn('node', [BIN, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      rejectRun(new Error(`runCli timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
    if (input !== undefined) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });

const sendRpc = async (requests, { timeoutMs = 5000, port = '1', extraEnv = {} } = {}) => {
  const input = requests.map((r) => JSON.stringify(r)).join('\n') + '\n';
  // Force ALETHIA_HOST to a guaranteed-unreachable address for tests that
  // would otherwise try to talk to a real Alethia instance. Tests that need
  // to point at a fake server can pass `port` and `extraEnv`.
  const proc = spawn('node', [BIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ALETHIA_HOST: '127.0.0.1', ALETHIA_PORT: String(port), ALETHIA_TIMEOUT_MS: '500', ...extraEnv },
  });
  let stdout = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  const finished = new Promise((resolveFinish) => {
    proc.on('exit', () => resolveFinish());
  });
  proc.stdin.write(input);
  proc.stdin.end();

  // Wait either for the process to exit or for the expected number of responses
  await Promise.race([
    finished,
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
  proc.kill('SIGKILL');

  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};

// ---------------------------------------------------------------------------
// CLI flag tests
// ---------------------------------------------------------------------------

test('--version prints package name and version', async () => {
  const { code, stdout } = await runCli(['--version']);
  assert.equal(code, 0);
  assert.match(stdout, new RegExp(PKG.name.replace('/', '\\/')));
  assert.match(stdout, new RegExp(`v${PKG.version.replace(/\./g, '\\.')}`));
});

test('-v is an alias for --version', async () => {
  const { code, stdout } = await runCli(['-v']);
  assert.equal(code, 0);
  assert.match(stdout, /v\d+\.\d+\.\d+/);
});

test('--help prints usage information', async () => {
  const { code, stdout } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /USAGE/);
  assert.match(stdout, /alethia-mcp/);
  assert.match(stdout, /ALETHIA_HOST/);
  assert.match(stdout, /ALETHIA_PORT/);
  assert.match(stdout, /Patent Pending/);
});

test('-h is an alias for --help', async () => {
  const { code, stdout } = await runCli(['-h']);
  assert.equal(code, 0);
  assert.match(stdout, /USAGE/);
});

test('--health-check exits non-zero when no Alethia runtime is reachable', async () => {
  const proc = spawn('node', [BIN, '--health-check'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ALETHIA_HOST: '127.0.0.1', ALETHIA_PORT: '1', ALETHIA_TIMEOUT_MS: '500' },
  });
  let stdout = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  const code = await new Promise((resolveCode) => proc.on('exit', resolveCode));
  assert.equal(code, 1, 'health check should exit 1 when offline');
  assert.match(stdout, /Probing Alethia/);
  assert.match(stdout, /not running|offline|Connection|✗/i);
});

// ---------------------------------------------------------------------------
// Stdio MCP protocol tests (no real Alethia required)
// ---------------------------------------------------------------------------

test('initialize returns correct protocol version and server info', async () => {
  const responses = await sendRpc([
    { jsonrpc: '2.0', method: 'initialize', id: 1 },
  ]);
  assert.equal(responses.length, 1);
  const r = responses[0];
  assert.equal(r.jsonrpc, '2.0');
  assert.equal(r.id, 1);
  assert.ok(r.result, 'initialize should return a result');
  assert.equal(r.result.serverInfo.name, '@vitronai/alethia');
  assert.match(r.result.serverInfo.version, /^\d+\.\d+\.\d+/);
  assert.ok(r.result.protocolVersion, 'should declare a protocol version');
  assert.ok(r.result.capabilities?.tools, 'should declare tools capability');
});

test('tools/list returns the expected set of MCP tools', async () => {
  const responses = await sendRpc([
    { jsonrpc: '2.0', method: 'tools/list', id: 1 },
  ]);
  assert.equal(responses.length, 1);
  const tools = responses[0].result.tools;
  assert.ok(Array.isArray(tools));
  assert.equal(tools.length, EXPECTED_TOOLS.length);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...EXPECTED_TOOLS].sort());

  // Each tool must have a non-trivial description (the LLM-facing pitch)
  for (const t of tools) {
    assert.ok(t.description.length > 50, `${t.name} description too short`);
    assert.ok(t.inputSchema, `${t.name} missing inputSchema`);
  }
});

test('tools/call with unknown tool name returns isError content', async () => {
  const responses = await sendRpc([
    { jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'definitely_not_a_tool', arguments: {} } },
  ]);
  assert.equal(responses.length, 1);
  const r = responses[0];
  assert.ok(r.result?.content, 'should return MCP content envelope, not error');
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Unknown tool/);
});

test('tools/call alethia_tell with empty instructions returns validation error', async () => {
  const responses = await sendRpc([
    { jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'alethia_tell', arguments: { instructions: '' } } },
  ]);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /non-empty/);
});

test('tools/call alethia_tell with non-string instructions returns validation error', async () => {
  const responses = await sendRpc([
    { jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'alethia_tell', arguments: { instructions: 42 } } },
  ]);
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /string/);
});

test('tools/call alethia_tell when offline auto-installs or returns error gracefully', async () => {
  // The bridge auto-installs the runtime on ECONNREFUSED.
  // This test verifies the bridge doesn't crash — it either auto-installs
  // successfully (returns a PlanRun) or returns a structured error.
  const responses = await sendRpc([
    { jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'alethia_tell', arguments: { instructions: 'wait 50 milliseconds' } } },
  ], { timeoutMs: 90000 });
  assert.equal(responses.length, 1);
  const r = responses[0];
  assert.ok(r.result?.content, 'should return MCP content envelope, not crash');
  // Either auto-install succeeded (isError: false) or failed gracefully (isError: true)
  assert.equal(typeof r.result.isError, 'boolean');
});

test('unknown method returns standard JSON-RPC method-not-found error', async () => {
  const responses = await sendRpc([
    { jsonrpc: '2.0', method: 'definitely/not/a/method', id: 1 },
  ]);
  assert.equal(responses.length, 1);
  const r = responses[0];
  assert.ok(r.error, 'should return error for unknown method');
  assert.equal(r.error.code, -32601);
});

// ---------------------------------------------------------------------------
// Stale-runtime guard — regression test for the silent-staleness bug where a
// stale runtime orphaned on the port would silently serve every tool call,
// bypassing auto-update entirely. The bridge must refuse to operate against a
// runtime whose reported version doesn't match what this bridge ships against.
// ---------------------------------------------------------------------------

const startFakeRuntime = (reportedVersion) =>
  new Promise((resolveStart, rejectStart) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let rpc;
        try { rpc = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
        // Fake an alethia_status response with the requested version.
        if (rpc.method === 'tools/call' && rpc.params?.name === 'alethia_status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: { ok: true, version: reportedVersion, defaultPolicyProfile: 'controlled-web' },
          }));
          return;
        }
        // Anything else: respond with a generic OK so a missing version-guard
        // would let the call through silently — that's the bug we're catching.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { ok: true, fake: true } }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { rejectStart(new Error('fake runtime failed to bind')); return; }
      resolveStart({ port: addr.port, close: () => new Promise((r) => server.close(r)) });
    });
    server.on('error', rejectStart);
  });

test('refuses to operate against a stale runtime squatting on the port', async () => {
  // This guards against the regression where an orphan v0.1.0-alpha.6 runtime
  // (left over from a previous bridge process) would silently serve every
  // tool call from a freshly-installed v0.4.x bridge. The bridge must detect
  // version mismatch on first call and surface a clear, actionable error.
  const fake = await startFakeRuntime('0.0.0-orphaned-stale');
  try {
    const responses = await sendRpc(
      [{
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: { name: 'alethia_tell', arguments: { instructions: 'wait 50 milliseconds' } },
      }],
      { timeoutMs: 8000, port: fake.port, extraEnv: { ALETHIA_RUNTIME_DIR: '/tmp/alethia-test-noop' } },
    );
    assert.equal(responses.length, 1);
    const r = responses[0];
    assert.ok(r.result?.content, 'should return MCP envelope, not crash');
    assert.equal(r.result.isError, true, 'must refuse stale runtime, not silently use it');
    const msg = r.result.content[0].text;
    assert.match(msg, /[Ss]tale Alethia runtime/, 'error must name the staleness condition');
    assert.match(msg, /0\.0\.0-orphaned-stale/, 'error must report the offending version');
  } finally {
    await fake.close();
  }
});

test('malformed JSON on stdin returns parse error', async () => {
  const proc = spawn('node', [BIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ALETHIA_PORT: '1', ALETHIA_TIMEOUT_MS: '500' },
  });
  let stdout = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stdin.write('not valid json\n');
  proc.stdin.end();
  await new Promise((r) => setTimeout(r, 500));
  proc.kill('SIGKILL');
  const lines = stdout.split('\n').filter(Boolean);
  assert.ok(lines.length >= 1);
  const err = JSON.parse(lines[0]);
  assert.equal(err.error?.code, -32700);
  assert.match(err.error.message, /Parse error/);
});
