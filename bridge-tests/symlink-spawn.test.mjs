// Regression test for the 0.6.0 silent-exit bug (fixed in 0.6.1).
//
// When npm installs @vitronai/alethia globally, the `alethia-mcp` command
// is a SYMLINK in /usr/local/bin (or similar) pointing at the installed
// dist/index.js. When Claude Desktop / Cursor / Cline spawn the bridge,
// process.argv[1] is the symlink path — NOT the real file path that
// import.meta.url resolves to.
//
// 0.6.0 shipped with an isMainModule check that compared those two
// with strict equality. The comparison always failed in production
// (because argv[1] was a symlink), so the stdin handler never attached
// and the bridge process exited immediately. Every MCP client logged:
//
//   "Server transport closed unexpectedly, this is likely due to the
//    process exiting early."
//
// No existing test caught this because every test spawned the bridge
// via `node /absolute/path/to/dist/index.js` — the real file path,
// where strict equality trivially succeeded.
//
// This test spawns the bridge via a symlink (the same code path every
// production install takes) and asserts the stdin handler IS attached
// by writing an MCP `initialize` request and waiting for a response.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { symlinkSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = resolve(__dirname, '..', 'dist', 'index.js');

test(
  'regression: bridge responds to initialize when spawned via a symlink (0.6.0 silent-exit bug)',
  { timeout: 10_000 },
  async () => {
    assert.ok(existsSync(BIN), `dist/index.js missing at ${BIN}; run \`npm run build\` first`);

    // Mirror what npm global-install does: create a symlink that points at
    // the real dist/index.js in a throwaway directory. argv[1] will be the
    // symlink, which is the exact condition that broke 0.6.0.
    const symlinkDir = mkdtempSync(join(tmpdir(), 'alethia-symlink-test-'));
    const symlinkPath = join(symlinkDir, 'alethia-mcp');
    symlinkSync(BIN, symlinkPath);

    try {
      const proc = spawn('node', [symlinkPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Point at an unreachable port so we don't try to spawn the real
          // runtime during this test. The initialize handshake doesn't
          // require a live runtime — it's pure stdio protocol.
          ALETHIA_HOST: '127.0.0.1',
          ALETHIA_PORT: '1',
          ALETHIA_TIMEOUT_MS: '500',
        },
      });

      let stdout = '';
      let stderr = '';
      let exitCode = null;
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('exit', (code) => { exitCode = code; });

      // Send a valid MCP initialize request. A working bridge responds
      // within ~200ms. A broken-spawn bridge never reads stdin and exits
      // on its own within ~100ms (nothing holding the event loop open).
      const initializeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } },
      }) + '\n';
      proc.stdin.write(initializeMessage);

      // Wait up to 3s for a response line on stdout.
      const gotResponse = await new Promise((resolveWait) => {
        const deadline = Date.now() + 3000;
        const poll = setInterval(() => {
          if (stdout.includes('"jsonrpc"') || exitCode !== null || Date.now() > deadline) {
            clearInterval(poll);
            resolveWait(stdout.includes('"jsonrpc"'));
          }
        }, 50);
      });

      // Tear down before asserting so we don't leak a process on failure.
      proc.stdin.end();
      proc.kill('SIGKILL');

      // If the bridge never responded, either it exited before reading
      // stdin (the 0.6.0 bug) or it hung without responding. The former
      // is the common failure; the latter is effectively the same symptom
      // from a user's perspective.
      assert.ok(
        gotResponse,
        `bridge did not respond to initialize within 3s when spawned via symlink.\n` +
        `This is the 0.6.0 silent-exit bug class.\n` +
        `exitCode: ${exitCode}\n` +
        `stdout: ${JSON.stringify(stdout)}\n` +
        `stderr: ${JSON.stringify(stderr)}`,
      );

      // Response should contain jsonrpc protocol marker + serverInfo.
      assert.match(stdout, /"jsonrpc"\s*:\s*"2\.0"/, 'response should be valid JSON-RPC 2.0');
      assert.match(stdout, /"serverInfo"/, 'response should include serverInfo');
    } finally {
      try { rmSync(symlinkPath, { force: true }); } catch { /* ignore */ }
      try { rmSync(symlinkDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  },
);
