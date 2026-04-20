// Deterministic, in-process tests for the runtime-version resolver that
// replaces the old static RUNTIME_VERSION pin. Zero network, zero Electron
// spawn, zero tar drama. Runs in ~200ms.
//
// What's covered:
//   1. ALETHIA_RUNTIME_VERSION env pin short-circuits everything (no fetcher
//      call, no cache read).
//   2. Fresh cache is returned without calling the fetcher.
//   3. Stale cache + successful fetch returns the new version and updates
//      the cache file.
//   4. Stale cache + failed fetch falls back to the stale cached value.
//   5. No cache + failed fetch + existing runtime marker falls back to
//      the marker version.
//   6. No cache + failed fetch + no marker throws a clear error.
//   7. getArtifactName(v) produces the expected filename templates per
//      platform/arch.
//   8. getGithubReleaseBase(v) produces the expected URL.
//
// The fetcher is swapped via the __setLatestVersionFetcherForTests hook
// exported from the bridge. No global-https mocking required.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

// Route ALL bridge filesystem state to an isolated temp dir BEFORE importing.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'alethia-bridge-test-'));
const TEST_RUNTIME_DIR = join(TEST_HOME, '.alethia', 'runtime');
const TEST_LATEST_RELEASE_CACHE = join(TEST_HOME, '.alethia', '.latest-release');
mkdirSync(join(TEST_HOME, '.alethia'), { recursive: true });

process.env.ALETHIA_RUNTIME_DIR = TEST_RUNTIME_DIR;
// The LATEST_RELEASE_CACHE in the bridge is derived from homedir(). We can't
// redirect homedir() without a loader hack, but we can wipe the real user's
// cache path for these tests. Instead: set HOME/USERPROFILE to the temp dir
// so homedir() returns the test root on every platform.
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME; // Windows
// Remove any inherited pin so tests that don't want one don't get one.
delete process.env.ALETHIA_RUNTIME_VERSION;

// Now import the bridge — its module-level constants read these env vars.
const { resolveRuntimeVersion, __setLatestVersionFetcherForTests, getArtifactName, getGithubReleaseBase } =
  await import('../dist/index.js');

// Utility: re-import is not needed; we reset caches by writing/removing files
// and by toggling env vars between tests.
const clearCache = () => {
  try { rmSync(TEST_LATEST_RELEASE_CACHE, { force: true }); } catch { /* ignore */ }
};

const writeCache = (version, ageMs) => {
  mkdirSync(join(TEST_HOME, '.alethia'), { recursive: true });
  writeFileSync(TEST_LATEST_RELEASE_CACHE, JSON.stringify({
    fetchedAt: Date.now() - ageMs,
    version,
  }));
};

const writeInstalledMarker = (version) => {
  mkdirSync(TEST_RUNTIME_DIR, { recursive: true });
  writeFileSync(join(TEST_RUNTIME_DIR, '.installed'), JSON.stringify({
    version,
    installedAt: new Date().toISOString(),
  }));
};

const clearInstalledMarker = () => {
  try { rmSync(TEST_RUNTIME_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
};

test.afterEach(() => {
  __setLatestVersionFetcherForTests(null);
  delete process.env.ALETHIA_RUNTIME_VERSION;
  clearCache();
  clearInstalledMarker();
});

test.after(() => {
  try { rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 1. Env pin short-circuits everything
// ---------------------------------------------------------------------------

test('ALETHIA_RUNTIME_VERSION pin skips cache and fetcher', async () => {
  process.env.ALETHIA_RUNTIME_VERSION = '0.3.7';
  let fetcherCalled = false;
  __setLatestVersionFetcherForTests(async () => { fetcherCalled = true; return '99.99.99'; });
  writeCache('1.2.3', 0); // fresh cache — should STILL be skipped

  const v = await resolveRuntimeVersion();
  assert.equal(v, '0.3.7');
  assert.equal(fetcherCalled, false, 'pin should skip fetcher entirely');
});

test('ALETHIA_RUNTIME_VERSION accepts "v" prefix', async () => {
  process.env.ALETHIA_RUNTIME_VERSION = 'v0.3.7';
  const v = await resolveRuntimeVersion();
  assert.equal(v, '0.3.7');
});

// ---------------------------------------------------------------------------
// 2. Fresh cache hit (no fetcher call)
// ---------------------------------------------------------------------------

test('fresh cache returns cached version without calling fetcher', async () => {
  writeCache('0.4.2', 60_000); // 60s old → fresh (TTL is 1h)
  let fetcherCalled = false;
  __setLatestVersionFetcherForTests(async () => { fetcherCalled = true; return '9.9.9'; });

  const v = await resolveRuntimeVersion();
  assert.equal(v, '0.4.2');
  assert.equal(fetcherCalled, false, 'fresh cache should not trigger fetcher');
});

// ---------------------------------------------------------------------------
// 3. Stale cache + successful fetch updates the cache
// ---------------------------------------------------------------------------

test('stale cache + successful fetch returns new version and rewrites cache', async () => {
  writeCache('0.3.0', 2 * 60 * 60 * 1000); // 2h old → stale (TTL is 1h)
  __setLatestVersionFetcherForTests(async () => '0.5.0');

  const v = await resolveRuntimeVersion();
  assert.equal(v, '0.5.0');

  const rewritten = JSON.parse(readFileSync(TEST_LATEST_RELEASE_CACHE, 'utf8'));
  assert.equal(rewritten.version, '0.5.0');
  assert.ok(
    Date.now() - rewritten.fetchedAt < 5_000,
    'cache fetchedAt should be updated to ~now',
  );
});

// ---------------------------------------------------------------------------
// 4. Stale cache + failed fetch falls back to stale cache
// ---------------------------------------------------------------------------

test('stale cache + failed fetch falls back to stale cache value', async () => {
  writeCache('0.3.0', 2 * 60 * 60 * 1000);
  __setLatestVersionFetcherForTests(async () => null); // simulate offline / rate-limit

  const v = await resolveRuntimeVersion();
  assert.equal(v, '0.3.0', 'should soft-fallback to stale cache');
});

// ---------------------------------------------------------------------------
// 5. No cache + failed fetch + marker → use marker version
// ---------------------------------------------------------------------------

test('no cache + failed fetch + installed marker falls back to marker version', async () => {
  clearCache();
  writeInstalledMarker('0.2.9');
  __setLatestVersionFetcherForTests(async () => null);

  const v = await resolveRuntimeVersion();
  assert.equal(v, '0.2.9', 'should soft-fallback to installed runtime version');
});

// ---------------------------------------------------------------------------
// 6. No cache + failed fetch + no marker → clear error
// ---------------------------------------------------------------------------

test('no cache + failed fetch + no marker throws a clear error', async () => {
  clearCache();
  clearInstalledMarker();
  __setLatestVersionFetcherForTests(async () => null);

  await assert.rejects(
    () => resolveRuntimeVersion(),
    /Could not determine runtime version.*ALETHIA_RUNTIME_VERSION/s,
    'cold-path offline user should get an actionable error mentioning the pin env var',
  );
});

// ---------------------------------------------------------------------------
// 7. Artifact naming per platform × arch
// ---------------------------------------------------------------------------

test('getArtifactName returns platform-specific templates', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  try {
    // Verify whatever the CURRENT runner is — cross-platform spoofing of
    // process.platform is flaky and not worth it. The important invariant is
    // the template shape: version is interpolated, extension is correct.
    const v = '1.2.3';
    const name = getArtifactName(v);
    assert.ok(name, `expected an artifact name for ${originalPlatform}-${originalArch}`);
    assert.match(name, /1\.2\.3/, 'artifact name should contain the version');
    assert.match(name, /\.(tar\.gz|zip)$/, 'artifact name should end with .tar.gz or .zip');
    if (originalPlatform === 'win32') assert.match(name, /\.zip$/);
    if (originalPlatform === 'linux') assert.match(name, /\.tar\.gz$/);
    if (originalPlatform === 'darwin') assert.match(name, /\.tar\.gz$/);
  } finally {
    // no-op — we don't mutate process.platform here
    void originalPlatform; void originalArch;
  }
});

// ---------------------------------------------------------------------------
// 8. GitHub release URL construction
// ---------------------------------------------------------------------------

test('getGithubReleaseBase produces the expected URL', () => {
  assert.equal(
    getGithubReleaseBase('0.4.0'),
    'https://github.com/vitron-ai/alethia/releases/download/v0.4.0',
  );
  assert.equal(
    getGithubReleaseBase('1.2.3-pre.5'),
    'https://github.com/vitron-ai/alethia/releases/download/v1.2.3-pre.5',
  );
});
