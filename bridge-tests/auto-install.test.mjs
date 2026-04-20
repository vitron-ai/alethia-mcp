// End-to-end auto-install smoke: the critical-path user journey.
//
// Most bridge tests deliberately avoid spawning a real runtime. This one
// does the opposite — it wipes the runtime install dir, runs the bridge's
// --health-check entry point (the same path every first-time user hits),
// and asserts:
//
//   1. The bridge downloads an artifact from GitHub Releases for the pinned
//      RUNTIME_VERSION, without 404-ing.
//   2. Ed25519 + SHA-256 verification pass.
//   3. The extracted runtime spawns and answers on 127.0.0.1:47432.
//   4. The runtime self-reports the version the bridge expected (guards
//      against the v0.3.1 "version stamping" regression).
//   5. The marker file at ~/.alethia/runtime/.installed is written.
//
// Requires network (GitHub download). Skipped with SKIP_AUTO_INSTALL_TEST=1
// for dev loops and offline CI. Takes ~20-40s on a warm machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = resolve(__dirname, '..', 'dist', 'index.js');
const PKG = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
const RUNTIME_DIR = join(homedir(), '.alethia', 'runtime');
const MARKER = join(RUNTIME_DIR, '.installed');

const shouldSkip = process.env.SKIP_AUTO_INSTALL_TEST === '1';

// Read the RUNTIME_VERSION the shipped bridge is pinned to. Test asserts the
// runtime that gets installed matches this — if a bridge is published with
// the wrong pin, this test catches it before users do.
const expectedRuntimeVersion = (() => {
  const src = readFileSync(resolve(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const m = src.match(/const RUNTIME_VERSION = '([^']+)'/);
  return m ? m[1] : null;
})();

const runBridgeCli = (args, { timeoutMs = 90_000 } = {}) =>
  new Promise((resolveRun, rejectRun) => {
    const proc = spawn('node', [BIN, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      rejectRun(new Error(`health-check timed out after ${timeoutMs}ms\nSTDERR:\n${stderr}`));
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });

// Backup the user's existing runtime dir (if any) so running this test
// doesn't wipe a known-good local install. Returns a restore function.
const stashRuntimeDir = () => {
  if (!existsSync(RUNTIME_DIR)) {
    return () => { /* nothing to restore */ };
  }
  const backup = `${RUNTIME_DIR}.test-backup-${Date.now()}`;
  renameSync(RUNTIME_DIR, backup);
  return () => {
    try { rmSync(RUNTIME_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
    renameSync(backup, RUNTIME_DIR);
  };
};

// Kill any Alethia runtime lingering on port 47432 before the test. An
// orphan from a prior session would cause the bridge's version-mismatch
// guard to throw, which would misreport as a download failure.
const killAnyRunningRuntime = () => new Promise((r) => {
  const proc = spawn('pkill', ['-f', 'Alethia.app']);
  proc.on('exit', () => setTimeout(r, 500));
});

test(
  'auto-install: fresh machine → health-check downloads, verifies, spawns, answers',
  { skip: shouldSkip ? 'SKIP_AUTO_INSTALL_TEST=1' : false, timeout: 120_000 },
  async () => {
    assert.ok(expectedRuntimeVersion, 'could not extract RUNTIME_VERSION from src/index.ts');

    await killAnyRunningRuntime();
    const restore = stashRuntimeDir();

    try {
      const { code, stdout, stderr } = await runBridgeCli(['--health-check']);
      const combined = stdout + '\n' + stderr;

      // 1. Health-check exits cleanly. A non-zero exit covers: network
      //    failure, bad signature, wrong artifact name, spawn failure.
      assert.equal(
        code, 0,
        `health-check exited with code ${code}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      );

      // 2. The expected signature-verification + download lines appeared.
      //    If any regress, we see it here rather than in a user's MCP client.
      assert.match(combined, /Verifying Ed25519 signature/, 'expected Ed25519 verification step');
      assert.match(combined, /SHA-256 verified/, 'expected SHA-256 verification step');

      // 3. Marker file written with the version this bridge is pinned to.
      assert.ok(existsSync(MARKER), 'expected ~/.alethia/runtime/.installed after auto-install');
      const marker = JSON.parse(readFileSync(MARKER, 'utf8'));
      assert.equal(
        marker.version, expectedRuntimeVersion,
        `runtime marker says v${marker.version}; bridge ${PKG.version} is pinned to v${expectedRuntimeVersion}`,
      );

      // 4. Health-check's own summary line confirms the running runtime
      //    matches — catches "version stamping" regressions where the
      //    binary self-reports a stale hardcoded version string despite
      //    the filename / marker saying otherwise.
      assert.match(
        combined,
        new RegExp(`runtime version:\\s+${expectedRuntimeVersion.replace(/\./g, '\\.')}`),
        'health-check should print the expected runtime version',
      );

      // 5. The install dropped the expected platform subdir (smoke check
      //    — if the artifact tar is ever shipped with the wrong internal
      //    layout, mac vs mac-arm64 vs linux vs win-unpacked would fail).
      const dirs = readdirSync(RUNTIME_DIR);
      const hasPlatformDir = dirs.some((d) =>
        d === 'mac' || d === 'mac-arm64' || d.startsWith('alethia-') || d === 'win-unpacked',
      );
      assert.ok(hasPlatformDir, `expected a platform subdir in ${RUNTIME_DIR}; got: ${dirs.join(', ')}`);
    } finally {
      // Always tear down the test-installed runtime process + restore the
      // user's original state, regardless of whether assertions passed.
      await killAnyRunningRuntime();
      restore();
    }
  },
);
