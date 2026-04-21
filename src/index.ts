#!/usr/bin/env node
/**
 * @vitronai/alethia — MCP bridge
 *
 * Stdio MCP server that connects AI agents (Claude Code, Cursor, Cline,
 * Continue, etc.) to a running Alethia runtime via JSON-RPC over a
 * loopback HTTP socket on 127.0.0.1:47432.
 *
 * The Alethia runtime auto-installs on first use. Details at:
 * https://github.com/vitron-ai/alethia/releases
 *
 * Alethia is the patent-pending zero-IPC E2E test runtime built for AI agents.
 * 45x faster than Playwright on the localhost loop. Fail-closed by default.
 * Cryptographically chained audit packs. Local-first. Zero telemetry by default.
 * Opt-in cloud features (when they ship — none today).
 *
 * MIT License — vitron-ai 2026.
 * Patent Pending — U.S. Application No. 19/571,437. The MIT license on this
 * MCP bridge does NOT grant any patent license under U.S. App 19/571,437.
 */

import http from 'node:http';
import https from 'node:https';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, createWriteStream, chmodSync, rmSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { homedir, platform, arch } from 'node:os';
import { pipeline } from 'node:stream/promises';

// ---------------------------------------------------------------------------
// Package metadata (read at runtime from the bundled package.json)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let PKG_VERSION = '0.0.0';
let PKG_NAME = '@vitronai/alethia';
try {
  // dist/index.js -> ../package.json
  const pkgPath = resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string; name?: string };
  if (pkg.version) PKG_VERSION = pkg.version;
  if (pkg.name) PKG_NAME = pkg.name;
} catch {
  // Fallback if package.json can't be read — keeps the binary functional
  // even when invoked from an unusual install location.
}

// ---------------------------------------------------------------------------
// Configuration (env vars + CLI flags)
// ---------------------------------------------------------------------------

const ALETHIA_HOST = process.env.ALETHIA_HOST ?? '127.0.0.1';
const ALETHIA_PORT = Number(process.env.ALETHIA_PORT ?? 47432);
const ALETHIA_TIMEOUT_MS = Number(process.env.ALETHIA_TIMEOUT_MS ?? 60_000);
const DEBUG = process.env.ALETHIA_DEBUG === '1' || process.argv.includes('--debug');
// Read update-related env vars via accessors so tests (and long-running
// sessions where env changes mid-flight) pick up the current value. The
// module-const pattern would capture these once at load and desync.
const skipAutoUpdate = (): boolean => process.env.ALETHIA_SKIP_AUTO_UPDATE === '1';
const isBootstrappedChild = (): boolean => process.env.ALETHIA_BOOTSTRAPPED === '1';
const bridgeSriPin = (): string | null => process.env.ALETHIA_BRIDGE_SRI ?? null;
const bridgeVersionPin = (): string | null => process.env.ALETHIA_BRIDGE_VERSION ?? null;

const debug = (...args: unknown[]): void => {
  if (DEBUG) {
    process.stderr.write(`[alethia-mcp] ${args.map(String).join(' ')}\n`);
  }
};

// Is the bundled Claude Code skill already at ~/.claude/skills/alethia/SKILL.md?
// Used by the initialize handler to decide whether to nudge the agent to tell
// the user about `alethia-mcp --install-skill`.
const isSkillInstalled = (): boolean => {
  try {
    return existsSync(join(homedir(), '.claude', 'skills', 'alethia', 'SKILL.md'));
  } catch {
    return false;
  }
};

// Paths used by skill auto-refresh. The bundled skill ships with each
// published @vitronai/alethia tarball; the installed skill lives in the
// user's ~/.claude/skills. When the two diverge, the installed copy is
// stale — we overwrite it with the bundled version on bridge startup.
const BUNDLED_SKILL_PATH = resolve(__dirname, '..', 'skills', 'alethia', 'SKILL.md');
const INSTALLED_SKILL_PATH = join(homedir(), '.claude', 'skills', 'alethia', 'SKILL.md');

// Hash a skill file for content-address comparison. SHA-256 is overkill for
// this (no adversary to defend against at this layer — both files come from
// trusted channels), but it's the same primitive we use elsewhere and the
// cost is nanoseconds for a ~10KB markdown file. Returns null if the file
// doesn't exist or can't be read.
const hashSkillFile = (path: string): string | null => {
  try {
    const content = readFileSync(path);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
};

// Called on every bridge startup. If the installed skill is missing or
// differs from the bundled one, copy the bundled version over. Silently
// best-effort — a failed refresh should never block the MCP server from
// starting. Writes a single stderr line when a refresh happens so users
// running `--debug` can see the update; silent on the no-op path.
// ---------------------------------------------------------------------------
// Bridge self-update from the npm registry.
//
// Philosophy: the bridge auto-updates from the same signed distribution
// channel a user would install from manually. Trust root = npm registry.
// No new trust decision vs. `npm install -g`.
//
// Mitigations layered on top:
//   - Integrity (SRI) verification against the hash npm serves in the
//     packument. If the tarball doesn't match, refuse.
//   - Major-version gate: 0.x→0.y is fine; 1.x→2.x requires explicit user
//     action. Prevents "hijacker publishes v99.0.0" taking over.
//   - Version pin: ALETHIA_BRIDGE_VERSION=x.y.z skips auto-update entirely.
//   - SRI pin: ALETHIA_BRIDGE_SRI=sha512-... requires a specific hash.
//   - Opt-out: ALETHIA_skipAutoUpdate()=1 disables the whole thing.
//   - Rollback: a new version only becomes "trusted" after a successful
//     MCP initialize handshake. Versions that crash before that get
//     quarantined after 3 failed attempts.
// ---------------------------------------------------------------------------

const BRIDGE_INSTALL_ROOT = join(homedir(), '.alethia', 'bridge');
const BRIDGE_REGISTRY_CACHE = join(homedir(), '.alethia', '.bridge-registry-cache');
const BRIDGE_REGISTRY_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_BOOTSTRAP_ATTEMPTS = 3;

type PackumentInfo = {
  version: string;
  tarballUrl: string;
  integrity: string; // sha512-... SRI string from the registry
};

type RegistryCache = { fetchedAt: number; info: PackumentInfo };

// Parse "x.y.z" or "x.y.z-pre.N". Returns [major, minor, patch] ints.
export const semverParts = (v: string): [number, number, number] => {
  const core = v.split('-')[0] ?? v;
  const parts = core.split('.').map((n) => {
    const x = parseInt(n, 10);
    return Number.isFinite(x) ? x : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
};

export const compareSemver = (a: string, b: string): number => {
  const [aM, aN, aP] = semverParts(a);
  const [bM, bN, bP] = semverParts(b);
  if (aM !== bM) return aM - bM;
  if (aN !== bN) return aN - bN;
  return aP - bP;
};

export const isMajorBoundaryCrossed = (from: string, to: string): boolean =>
  semverParts(from)[0] !== semverParts(to)[0];

const readRegistryCache = (): RegistryCache | null => {
  try {
    const raw = JSON.parse(readFileSync(BRIDGE_REGISTRY_CACHE, 'utf8'));
    if (typeof raw.fetchedAt === 'number' && raw.info && typeof raw.info.version === 'string') return raw;
  } catch { /* no cache */ }
  return null;
};

const writeRegistryCache = (info: PackumentInfo): void => {
  try {
    mkdirSync(dirname(BRIDGE_REGISTRY_CACHE), { recursive: true });
    writeFileSync(BRIDGE_REGISTRY_CACHE, JSON.stringify({ fetchedAt: Date.now(), info }));
  } catch { /* best-effort */ }
};

const fetchPackumentLatest = (): Promise<PackumentInfo | null> =>
  new Promise((resolveFetch) => {
    const req = https.get(
      `https://registry.npmjs.org/${PKG_NAME}/latest`,
      { timeout: 3000, headers: { accept: 'application/json', 'user-agent': `${PKG_NAME}/${PKG_VERSION}` } },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolveFetch(null); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { body += c; if (body.length > 256 * 1024) res.destroy(); });
        res.on('end', () => {
          try {
            const pkg = JSON.parse(body) as { version?: string; dist?: { tarball?: string; integrity?: string } };
            if (typeof pkg.version !== 'string' || typeof pkg.dist?.tarball !== 'string' || typeof pkg.dist?.integrity !== 'string') {
              return resolveFetch(null);
            }
            resolveFetch({ version: pkg.version, tarballUrl: pkg.dist.tarball, integrity: pkg.dist.integrity });
          } catch { resolveFetch(null); }
        });
      },
    );
    req.on('error', () => resolveFetch(null));
    req.on('timeout', () => { req.destroy(); resolveFetch(null); });
  });

// Download a tarball to a temp path. Returns the path on success, null on error.
const downloadTarball = (url: string, destPath: string): Promise<boolean> =>
  new Promise((resolveDownload) => {
    const doGet = (u: string, redirects = 0): void => {
      if (redirects > 5) return resolveDownload(false);
      https.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return doGet(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return resolveDownload(false); }
        const ws = createWriteStream(destPath);
        res.pipe(ws);
        ws.on('finish', () => resolveDownload(true));
        ws.on('error', () => resolveDownload(false));
        res.on('error', () => resolveDownload(false));
      }).on('error', () => resolveDownload(false));
    };
    doGet(url);
  });

// Verify an SRI integrity string against a file. SRI format: "sha512-<base64>".
// npm serves sha512 for all modern packages. Reject other algorithms — an
// attacker shouldn't be able to downgrade us to sha1.
const verifySri = (filePath: string, sri: string): boolean => {
  const match = sri.match(/^sha512-([A-Za-z0-9+/=]+)$/);
  if (!match) return false;
  const expectedB64 = match[1];
  try {
    const actualB64 = createHash('sha512').update(readFileSync(filePath)).digest('base64');
    return actualB64 === expectedB64;
  } catch {
    return false;
  }
};

const readVersionDirState = (versionDir: string): { verified: boolean; attempts: number } => {
  return {
    verified: existsSync(join(versionDir, '.verified')),
    attempts: (() => {
      try {
        const raw = readFileSync(join(versionDir, '.bootstrap-attempts'), 'utf8');
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : 0;
      } catch { return 0; }
    })(),
  };
};

const incrementBootstrapAttempts = (versionDir: string): number => {
  const current = readVersionDirState(versionDir).attempts;
  const next = current + 1;
  try { writeFileSync(join(versionDir, '.bootstrap-attempts'), String(next)); } catch { /* best effort */ }
  return next;
};

// Mark the CURRENT running version as verified-working. Called after we
// produce a valid MCP initialize response. Idempotent.
const markCurrentVersionVerified = (): void => {
  // __dirname is .../dist; parent is the install dir for this version.
  const currentInstallDir = resolve(__dirname, '..');
  // If we're running from the globally-installed npm path (not from
  // ~/.alethia/bridge/<version>/), there's nothing to mark — the global
  // install is implicitly trusted.
  if (!currentInstallDir.startsWith(BRIDGE_INSTALL_ROOT)) return;
  try { writeFileSync(join(currentInstallDir, '.verified'), new Date().toISOString()); } catch { /* best effort */ }
};

// Determine which bridge version THIS spawn should actually run. May return:
//   - null: run ourselves (we're the newest trusted option)
//   - a path: exec into this dist/index.js instead
// Honors env pins + rollback + major-version gate.
export const selectBootstrapTarget = (): { version: string; jsPath: string; installDir: string } | null => {
  if (isBootstrappedChild()) return null; // already a bootstrap child; don't recurse
  if (skipAutoUpdate()) return null;

  let candidates: string[] = [];
  try {
    candidates = readdirSync(BRIDGE_INSTALL_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(name => /^\d+\.\d+\.\d+/.test(name));
  } catch {
    return null; // no install root yet
  }

  // If user pinned a specific version, honor it.
  const pin = bridgeVersionPin();
  if (pin) {
    if (candidates.includes(pin)) {
      const dir = join(BRIDGE_INSTALL_ROOT, pin);
      const js = join(dir, 'dist', 'index.js');
      if (existsSync(js) && pin !== PKG_VERSION) {
        return { version: pin, jsPath: js, installDir: dir };
      }
    }
    return null; // pin is us or pin doesn't exist → run ourselves
  }

  // Sort descending by semver, pick the newest that's (a) trusted OR
  // (b) untrusted but under the retry threshold, AND (c) doesn't cross
  // a major boundary from our own version.
  candidates.sort((a, b) => compareSemver(b, a));
  for (const version of candidates) {
    if (compareSemver(version, PKG_VERSION) <= 0) continue; // not newer
    if (isMajorBoundaryCrossed(PKG_VERSION, version)) continue; // gate
    const dir = join(BRIDGE_INSTALL_ROOT, version);
    const js = join(dir, 'dist', 'index.js');
    if (!existsSync(js)) continue;
    const state = readVersionDirState(dir);
    if (state.verified) return { version, jsPath: js, installDir: dir };
    if (state.attempts >= MAX_BOOTSTRAP_ATTEMPTS) continue; // quarantined
    // Untrusted but under threshold — try it, and increment attempts
    // BEFORE exec so a crash-during-init is properly counted.
    incrementBootstrapAttempts(dir);
    return { version, jsPath: js, installDir: dir };
  }
  return null;
};

// Fire-and-forget: check npm for a newer version, download+verify+install if
// one exists. Runs after the bridge is up and serving; doesn't block MCP
// client traffic. The new version takes effect on next spawn.
const backgroundCheckForNewBridge = async (): Promise<void> => {
  if (skipAutoUpdate() || isBootstrappedChild() || bridgeVersionPin()) return;

  const cached = readRegistryCache();
  const fresh = cached && Date.now() - cached.fetchedAt < BRIDGE_REGISTRY_TTL_MS;
  const info = fresh ? cached.info : await fetchPackumentLatest();
  if (!info) return;
  if (!fresh) writeRegistryCache(info);

  if (compareSemver(info.version, PKG_VERSION) <= 0) return; // not newer
  if (isMajorBoundaryCrossed(PKG_VERSION, info.version)) {
    process.stderr.write(
      `[alethia] newer bridge ${info.version} available but crosses a major version boundary from ${PKG_VERSION}. ` +
      `Not auto-updating. Run \`npm install -g ${PKG_NAME}@${info.version}\` to accept the upgrade manually.\n`,
    );
    return;
  }

  // If the user pinned an integrity hash, refuse anything else.
  const sriPin = bridgeSriPin();
  if (sriPin && sriPin !== info.integrity) {
    process.stderr.write(
      `[alethia] refusing to auto-update to ${info.version}: integrity mismatch with ALETHIA_BRIDGE_SRI pin.\n`,
    );
    return;
  }

  const targetDir = join(BRIDGE_INSTALL_ROOT, info.version);
  if (existsSync(join(targetDir, 'dist', 'index.js'))) return; // already installed

  mkdirSync(BRIDGE_INSTALL_ROOT, { recursive: true });
  const tarballPath = join(BRIDGE_INSTALL_ROOT, `${info.version}.tgz`);
  const downloaded = await downloadTarball(info.tarballUrl, tarballPath);
  if (!downloaded) {
    try { rmSync(tarballPath, { force: true }); } catch { /* ignore */ }
    return;
  }

  if (!verifySri(tarballPath, info.integrity)) {
    process.stderr.write(
      `[alethia] downloaded ${info.version} tarball FAILED integrity check — refusing to install.\n`,
    );
    try { rmSync(tarballPath, { force: true }); } catch { /* ignore */ }
    return;
  }

  // Extract the tarball. npm tarballs contain a `package/` prefix; strip it so
  // we end up with dist/, skills/, package.json directly under <version>/.
  mkdirSync(targetDir, { recursive: true });
  try {
    execSync(`tar -xzf "${tarballPath}" -C "${targetDir}" --strip-components=1`, { stdio: 'pipe' });
  } catch {
    process.stderr.write(`[alethia] failed to extract ${info.version} tarball.\n`);
    try { rmSync(targetDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(tarballPath, { force: true }); } catch { /* ignore */ }
    return;
  }

  try { rmSync(tarballPath, { force: true }); } catch { /* ignore */ }

  process.stderr.write(
    `[alethia] installed bridge ${info.version} to ${targetDir}. ` +
    `Takes effect on next MCP client spawn.\n`,
  );
};

const refreshSkillIfStale = (): 'refreshed' | 'already-current' | 'not-installed' | 'no-bundle' => {
  const bundledHash = hashSkillFile(BUNDLED_SKILL_PATH);
  if (!bundledHash) return 'no-bundle';
  const installedHash = hashSkillFile(INSTALLED_SKILL_PATH);
  if (installedHash === null) return 'not-installed';
  if (installedHash === bundledHash) return 'already-current';
  // Installed is stale. Overwrite with bundled.
  try {
    mkdirSync(dirname(INSTALLED_SKILL_PATH), { recursive: true });
    writeFileSync(INSTALLED_SKILL_PATH, readFileSync(BUNDLED_SKILL_PATH));
    process.stderr.write(
      `[alethia] refreshed Claude Code skill at ${INSTALLED_SKILL_PATH} ` +
      `(hash ${installedHash.slice(0, 8)} → ${bundledHash.slice(0, 8)})\n`,
    );
    return 'refreshed';
  } catch {
    return 'not-installed';
  }
};

// ---------------------------------------------------------------------------
// Demo server — serves demo/ files on localhost for preview panels
// ---------------------------------------------------------------------------

let demoServer: http.Server | null = null;
let demoServerPort: number | null = null;

const DEMO_DIR = resolve(__dirname, '..', 'demo');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const startDemoServer = (): Promise<{ port: number; url: string; pages: string[] }> => {
  if (demoServer && demoServerPort) {
    const pages = getDemoPages();
    return Promise.resolve({ port: demoServerPort, url: `http://127.0.0.1:${demoServerPort}`, pages });
  }

  return new Promise((resolveStart, rejectStart) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url ?? '/').split('?')[0];
      const safePath = urlPath.replace(/\.\./g, '').replace(/^\/+/, '');
      const filePath = join(DEMO_DIR, safePath || 'index.html');

      if (!filePath.startsWith(DEMO_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      try {
        const data = readFileSync(filePath);
        const ext = '.' + (filePath.split('.').pop() ?? 'html');
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404).end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectStart(new Error('Demo server failed to start'));
        return;
      }
      demoServer = server;
      demoServerPort = addr.port;
      const pages = getDemoPages();
      debug(`demo server listening on 127.0.0.1:${addr.port}`);
      resolveStart({ port: addr.port, url: `http://127.0.0.1:${addr.port}`, pages });
    });

    server.on('error', rejectStart);
  });
};

const getDemoPages = (): string[] => {
  try {
    return readdirSync(DEMO_DIR).filter(f => f.endsWith('.html')).sort();
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Auto-install: download, verify, extract, and spawn the headless runtime
//
// Philosophy change vs. 0.5.x — the bridge no longer pins a specific runtime
// version in source. Instead, it asks GitHub Releases what's current and
// downloads that. Rationale:
//   - One fewer thing to hand-edit at release time (RUNTIME_VERSION bump was
//     a step that went wrong twice in session 2026-04-19).
//   - Globally-installed bridges no longer silently get frozen on last
//     month's runtime. They pull the current signed pair on demand.
//   - Explicit opt-out: set ALETHIA_RUNTIME_VERSION=x.y.z to pin — useful
//     for reproducible CI, bisection, or deliberately staying behind.
//
// All downloads still go through the same Ed25519 + SHA-256 verification
// path. The Ed25519 public key ships embedded in the bridge and is the
// chain-of-custody anchor — we trust what GitHub serves only to the extent
// that its signature matches this key.
// ---------------------------------------------------------------------------

const RUNTIME_DIR = process.env.ALETHIA_RUNTIME_DIR ?? join(homedir(), '.alethia', 'runtime');
const RUNTIME_MARKER = join(RUNTIME_DIR, '.installed');
const LATEST_RELEASE_CACHE = join(homedir(), '.alethia', '.latest-release');
const LATEST_RELEASE_TTL_MS = 60 * 60 * 1000; // 1h — fresh enough to pick up new releases same-day.
const GITHUB_API_LATEST = 'https://api.github.com/repos/vitron-ai/alethia/releases/latest';

// Ed25519 public key for release verification — embedded so it ships with npm
const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0zXtS6R90li3nBHsO4iae1Ltddx9skjQuFv+/V497UQ=
-----END PUBLIC KEY-----`;

type ReleaseManifest = {
  schemaVersion: string;
  version: string;
  signatureAlgorithm: string;
  artifacts: Array<{ file: string; platform: string; arch: string; sha256: string; sizeBytes: number }>;
  canonicalSha256: string;
  signature: string;
};

type LatestReleaseCache = { fetchedAt: number; version: string };

// Pin override (advanced users / CI / bisection). Accepts "0.4.0" or "v0.4.0"
// for convenience; normalized to the bare semver form used throughout.
const getPinnedRuntimeVersion = (): string | null => {
  const raw = process.env.ALETHIA_RUNTIME_VERSION;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
};

// Query GitHub Releases for the current latest version. Cached 1h in
// ~/.alethia/.latest-release. Honors ALETHIA_RUNTIME_VERSION pin override
// (skips network entirely if pinned).
//
// Fetch failures are non-fatal if we have *any* cached value (even stale),
// any installed runtime (use its marker version), or the user has pinned.
// Only the cold path (first run + offline + no pin) produces an error,
// because there is no signed chain-of-custody anchor we can use without
// reaching the release metadata at least once.
// Test hook — allows tests to swap the network fetcher for a deterministic
// mock. Production callers never set this; the default is the real
// fetchLatestRuntimeVersion. Keeps the test surface in-process with no mocks
// of global https.get required.
let _fetcherForTests: (() => Promise<string | null>) | null = null;
export const __setLatestVersionFetcherForTests = (fn: (() => Promise<string | null>) | null): void => {
  _fetcherForTests = fn;
};

// Test hooks for bridge self-update. Tests can swap the packument fetcher
// and inspect the install root without hitting the network.
export const __BRIDGE_INSTALL_ROOT_FOR_TESTS = (): string => BRIDGE_INSTALL_ROOT;

export const resolveRuntimeVersion = async (): Promise<string> => {
  const pinned = getPinnedRuntimeVersion();
  if (pinned) {
    debug(`runtime version pinned via ALETHIA_RUNTIME_VERSION=${pinned}`);
    return pinned;
  }

  const cached = readLatestReleaseCache();
  if (cached && Date.now() - cached.fetchedAt < LATEST_RELEASE_TTL_MS) {
    debug(`using cached latest-release version ${cached.version} (age ${Date.now() - cached.fetchedAt}ms)`);
    return cached.version;
  }

  const fetched = await (_fetcherForTests ?? fetchLatestRuntimeVersion)();
  if (fetched) {
    writeLatestReleaseCache(fetched);
    return fetched;
  }

  // Network failed. Fall back to stale cache, then installed marker.
  if (cached) {
    debug(`latest-release fetch failed; using stale cache ${cached.version}`);
    return cached.version;
  }
  const installed = getLocalInstalledRuntimeVersion();
  if (installed && installed !== 'unknown') {
    debug(`latest-release fetch failed and no cache; using installed marker ${installed}`);
    return installed;
  }

  throw new Error(
    'Could not determine runtime version. ' +
    'The bridge needs to reach https://api.github.com/repos/vitron-ai/alethia/releases/latest at least once to discover the current signed runtime. ' +
    'Pin a specific version to skip this: ALETHIA_RUNTIME_VERSION=x.y.z',
  );
};

const readLatestReleaseCache = (): LatestReleaseCache | null => {
  try {
    const raw = JSON.parse(readFileSync(LATEST_RELEASE_CACHE, 'utf8'));
    if (typeof raw.fetchedAt === 'number' && typeof raw.version === 'string') return raw;
  } catch { /* no cache / corrupt */ }
  return null;
};

const writeLatestReleaseCache = (version: string): void => {
  try {
    mkdirSync(dirname(LATEST_RELEASE_CACHE), { recursive: true });
    writeFileSync(LATEST_RELEASE_CACHE, JSON.stringify({ fetchedAt: Date.now(), version }));
  } catch { /* best effort */ }
};

const fetchLatestRuntimeVersion = (): Promise<string | null> =>
  new Promise((resolveFetch) => {
    const req = https.get(
      GITHUB_API_LATEST,
      {
        timeout: 3000,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `${PKG_NAME}/${PKG_VERSION}`,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          // GitHub API doesn't redirect for this endpoint, but be safe.
          resolveFetch(null);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); return resolveFetch(null); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { body += c; if (body.length > 256 * 1024) res.destroy(); });
        res.on('end', () => {
          try {
            const tag = JSON.parse(body).tag_name as unknown;
            if (typeof tag !== 'string') return resolveFetch(null);
            // Accept "v0.4.0" or "0.4.0"
            resolveFetch(tag.startsWith('v') ? tag.slice(1) : tag);
          } catch { resolveFetch(null); }
        });
      },
    );
    req.on('error', () => resolveFetch(null));
    req.on('timeout', () => { req.destroy(); resolveFetch(null); });
  });

// Platform → artifact filename template. The version is substituted at
// install time now that it's no longer a module-level constant.
export const getArtifactName = (runtimeVersion: string): string | null => {
  const p = platform();
  const a = arch();
  const templates: Record<string, Record<string, string>> = {
    darwin: {
      x64: `Alethia-${runtimeVersion}-mac.tar.gz`,
      arm64: `Alethia-${runtimeVersion}-mac-arm64.tar.gz`,
    },
    linux: {
      x64: `alethia-${runtimeVersion}.tar.gz`,
      arm64: `alethia-${runtimeVersion}-arm64.tar.gz`,
    },
    win32: {
      x64: `Alethia-${runtimeVersion}-win.zip`,
    },
  };
  return templates[p]?.[a] ?? null;
};

export const getGithubReleaseBase = (runtimeVersion: string): string =>
  `https://github.com/vitron-ai/alethia/releases/download/v${runtimeVersion}`;

// Finds the runtime binary in the install dir. Runtime version is only needed
// for Linux (version-prefixed extract dir); Mac and Windows have stable layouts.
const getExecutablePath = (runtimeVersion?: string): string => {
  const p = platform();
  if (p === 'darwin') {
    // Look for the .app inside the extracted directory
    const macDir = existsSync(join(RUNTIME_DIR, 'mac')) ? 'mac' : 'mac-arm64';
    return join(RUNTIME_DIR, macDir, 'Alethia.app', 'Contents', 'MacOS', 'Alethia');
  }
  if (p === 'win32') {
    return join(RUNTIME_DIR, 'win-unpacked', 'Alethia.exe');
  }
  // Linux — the tarball extracts into a version-prefixed directory. Try the
  // expected-for-this-version paths first, then scan.
  const linuxCandidates = runtimeVersion
    ? [`alethia-${runtimeVersion}`, `alethia-${runtimeVersion}-arm64`, 'linux-unpacked', 'linux-arm64-unpacked']
    : ['linux-unpacked', 'linux-arm64-unpacked'];
  for (const dir of linuxCandidates) {
    const exe = join(RUNTIME_DIR, dir, 'alethia');
    if (existsSync(exe)) return exe;
  }
  // Last-resort scan: any immediate subdirectory with an `alethia` binary.
  try {
    for (const entry of readdirSync(RUNTIME_DIR)) {
      const candidate = join(RUNTIME_DIR, entry, 'alethia');
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* ignore */ }
  // Return a canonical expected path so downstream errors tell the user
  // where we LOOKED (rather than landing on an unrelated arm64 path).
  return join(RUNTIME_DIR, runtimeVersion ? `alethia-${runtimeVersion}` : 'linux-unpacked', 'alethia');
};

const httpsGet = (url: string): Promise<http.IncomingMessage> =>
  new Promise((res, rej) => {
    const doGet = (u: string, redirects = 0): void => {
      if (redirects > 5) { rej(new Error('Too many redirects')); return; }
      https.get(u, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          doGet(response.headers.location, redirects + 1);
          return;
        }
        if (response.statusCode !== 200) {
          rej(new Error(`HTTP ${response.statusCode} for ${u}`));
          return;
        }
        res(response);
      }).on('error', rej);
    };
    doGet(url);
  });

const downloadFile = async (url: string, dest: string): Promise<void> => {
  debug(`downloading ${url}`);
  const response = await httpsGet(url);
  const ws = createWriteStream(dest);
  await pipeline(response, ws);
  debug(`saved to ${dest}`);
};

const verifyManifest = (manifest: ReleaseManifest): boolean => {
  // Reconstruct the canonical payload that was signed (manifest without canonicalSha256 and signature)
  const { canonicalSha256: _c, signature: _s, ...unsigned } = manifest;
  const canonical = JSON.stringify(unsigned, Object.keys(unsigned).sort(), 0);
  const sig = Buffer.from(manifest.signature, 'base64');
  const pubKey = createPublicKey(RELEASE_PUBLIC_KEY);
  return cryptoVerify(null, Buffer.from(canonical, 'utf8'), pubKey, sig);
};

const sha256File = (filePath: string): string => {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
};

let runtimeProcess: ChildProcess | null = null;
let autoInstallAttempted = false;

// Detect what version is on disk. The marker file is the fast path; if it's
// missing (legacy install, partial extract, manual drop) we fall back to the
// platform's bundled version metadata so a stale binary cannot pose as fresh.
// Returns:
//   - the version string if knowable
//   - 'unknown' if the executable exists but we can't identify its version
//   - null if no runtime is installed at all
export const getLocalInstalledRuntimeVersion = (runtimeDir = RUNTIME_DIR): string | null => {
  const markerPath = join(runtimeDir, '.installed');
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { version?: string };
      if (typeof marker.version === 'string' && marker.version.length > 0) return marker.version;
    } catch { /* fall through */ }
  }
  if (platform() === 'darwin') {
    const macDir = existsSync(join(runtimeDir, 'mac')) ? 'mac' : 'mac-arm64';
    const plistPath = join(runtimeDir, macDir, 'Alethia.app', 'Contents', 'Info.plist');
    if (existsSync(plistPath)) {
      try {
        const plist = readFileSync(plistPath, 'utf8');
        const match = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
        if (match) return match[1];
      } catch { /* fall through */ }
    }
  }
  // Binary present but no version metadata — treat as outdated so upgrade kicks in.
  if (existsSync(getExecutablePath())) return 'unknown';
  return null;
};

// Probe a runtime that is already responding on ALETHIA_PORT. Returns the
// reported version, or null if we can't reach one (or the runtime is too old
// to expose alethia_status). This is the source of truth for "what's actually
// running", which the on-disk marker can lie about (orphan processes, stale
// installs, manual launches).
const probeRunningRuntimeVersion = async (): Promise<string | null> => {
  try {
    const resp = await callAlethia(
      { jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'alethia_status', arguments: {} } },
      3_000,
    );
    if (resp.error) return null;
    const result = resp.result as { version?: string } | undefined;
    return typeof result?.version === 'string' ? result.version : null;
  } catch {
    return null;
  }
};

let runtimeVersionVerified = false;
let resolvedTargetVersion: string | null = null;

// One-shot guard, called before each tool dispatch. If a runtime is already on
// the port with a version that doesn't match what this bridge is targeting,
// refuse to operate — the user is silently driving against a stale runtime
// (likely an orphan from a prior bridge that wasn't cleaned up). Returns
// silently if no runtime answers (the normal install path will then take over).
const ensureCorrectRuntimeVersion = async (): Promise<void> => {
  if (runtimeVersionVerified) return;
  const runningVersion = await probeRunningRuntimeVersion();
  if (runningVersion === null) {
    // Nothing answering or too-old runtime — let the install/spawn path drive.
    return;
  }
  const targetVersion = resolvedTargetVersion ?? (resolvedTargetVersion = await resolveRuntimeVersion());
  if (runningVersion !== targetVersion) {
    throw new Error(
      `Stale Alethia runtime v${runningVersion} is responding on port ${ALETHIA_PORT}; this bridge is targeting v${targetVersion}. ` +
      `An older runtime (likely orphaned from a previous bridge process) is occupying the port, so the bridge cannot spawn the current version. ` +
      `Quit the running runtime — on macOS: \`pkill -f Alethia.app\` — then restart your MCP host.`,
    );
  }
  runtimeVersionVerified = true;
};

const ensureRuntime = async (): Promise<void> => {
  if (autoInstallAttempted) return;
  autoInstallAttempted = true;

  const targetVersion = resolvedTargetVersion ?? (resolvedTargetVersion = await resolveRuntimeVersion());
  const artifactName = getArtifactName(targetVersion);
  if (!artifactName) {
    throw new Error(
      `No Alethia runtime available for ${platform()}-${arch()}. ` +
      `Supported: macOS (x64/arm64), Linux (x64/arm64), Windows (x64). ` +
      `Contact gatekeeper@vitron.ai for assistance.`
    );
  }

  // Check what's installed on disk. Marker is fast path; Info.plist fallback
  // catches legacy installs / partial extracts that never wrote a marker.
  const installedVersion = getLocalInstalledRuntimeVersion();
  if (installedVersion === targetVersion) {
    debug('runtime already installed and up-to-date, spawning');
    await spawnRuntime(targetVersion);
    return;
  }
  if (installedVersion) {
    process.stderr.write(`[alethia] Installed runtime v${installedVersion} differs from target v${targetVersion}. Replacing...\n`);
    // Wipe the stale install before re-extracting so orphan files from the
    // previous version (different bundle layout, removed assets) don't linger.
    try { rmSync(RUNTIME_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  } else {
    process.stderr.write(`[alethia] Runtime not found. Auto-installing v${targetVersion}...\n`);
  }

  mkdirSync(RUNTIME_DIR, { recursive: true });
  const artifactPath = join(RUNTIME_DIR, artifactName);
  const manifestPath = join(RUNTIME_DIR, 'manifest.json');
  const releaseBase = getGithubReleaseBase(targetVersion);

  // Download manifest + artifact
  await downloadFile(`${releaseBase}/manifest.json`, manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReleaseManifest;

  // Verify Ed25519 signature on manifest
  process.stderr.write('[alethia] Verifying Ed25519 signature...\n');
  if (!verifyManifest(manifest)) {
    throw new Error(
      'Release manifest signature verification FAILED. ' +
      'The download may have been tampered with. Aborting. ' +
      'Contact gatekeeper@vitron.ai if this persists.'
    );
  }
  debug('manifest signature verified');

  // Download the binary
  await downloadFile(`${releaseBase}/${artifactName}`, artifactPath);

  // Verify SHA-256 of downloaded artifact against manifest
  const expectedHash = manifest.artifacts.find(a => a.file === artifactName)?.sha256;
  if (!expectedHash) {
    throw new Error(`Artifact ${artifactName} not found in signed manifest.`);
  }
  const actualHash = sha256File(artifactPath);
  if (actualHash !== expectedHash) {
    throw new Error(
      `SHA-256 mismatch for ${artifactName}.\n` +
      `  Expected: ${expectedHash}\n` +
      `  Got:      ${actualHash}\n` +
      `The download may be corrupted or tampered with. Aborting.`
    );
  }
  process.stderr.write('[alethia] SHA-256 verified.\n');

  // Extract
  process.stderr.write('[alethia] Extracting runtime...\n');
  if (artifactName.endsWith('.tar.gz')) {
    execSync(`tar -xzf "${artifactPath}" -C "${RUNTIME_DIR}"`, { stdio: 'pipe' });
  } else if (artifactName.endsWith('.zip')) {
    execSync(`unzip -o -q "${artifactPath}" -d "${RUNTIME_DIR}"`, { stdio: 'pipe' });
  }

  // Mark as installed
  writeFileSync(RUNTIME_MARKER, JSON.stringify({ version: targetVersion, installedAt: new Date().toISOString() }), 'utf8');
  process.stderr.write(`[alethia] Runtime v${targetVersion} installed to ${RUNTIME_DIR}\n`);

  await spawnRuntime(targetVersion);
};

const spawnRuntime = async (runtimeVersion?: string): Promise<void> => {
  const exe = getExecutablePath(runtimeVersion);
  if (!existsSync(exe)) {
    throw new Error(`Runtime executable not found at ${exe}. Try deleting ${RUNTIME_DIR} and restarting.`);
  }

  // Make sure it's executable (Linux/Mac)
  if (platform() !== 'win32') {
    try { chmodSync(exe, 0o755); } catch { /* best effort */ }
  }

  // Cockpit visibility is on by default — it's the oversight surface that
  // makes agent runs legible to humans. Explicit opt-outs:
  //   ALETHIA_HEADLESS=1        → hide (primary switch)
  //   ALETHIA_VISIBLE=0|false   → hide (deprecated alias, kept one release)
  //   CI env detected           → hide (no DISPLAY on Linux runners, noisy locally)
  // The runtime can still be popped into view mid-session via the
  // alethia_show_cockpit MCP tool when it was launched hidden.
  const isCi =
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    process.env.GITHUB_ACTIONS === 'true' ||
    process.env.GITLAB_CI === 'true' ||
    process.env.CIRCLECI === 'true' ||
    process.env.BUILDKITE === 'true';
  const explicitHide =
    process.env.ALETHIA_HEADLESS === '1' ||
    process.env.ALETHIA_HEADLESS === 'true' ||
    process.env.ALETHIA_VISIBLE === '0' ||
    process.env.ALETHIA_VISIBLE === 'false';
  const visible = !explicitHide && !isCi;
  process.stderr.write(`[alethia] Spawning runtime (${visible ? 'visible' : 'headless'})...\n`);
  // Headless is passed via env var. ALETHIA_HEADLESS=1 is the runtime's
  // own switch and does not depend on any passthrough CLI flag.
  //
  // Strip ELECTRON_RUN_AS_NODE from the inherited env so a leaked dev-env
  // setting on the caller's shell doesn't silently re-route the runtime
  // into a non-runtime interpreter mode.
  const { ELECTRON_RUN_AS_NODE: _stripped, ...safeEnv } = process.env;
  runtimeProcess = spawn(exe, [], {
    env: { ...safeEnv, ...(visible ? {} : { ALETHIA_HEADLESS: '1' }) },
    stdio: 'ignore',
    detached: false,
  });

  runtimeProcess.on('exit', (code) => {
    debug(`runtime exited with code ${code}`);
    runtimeProcess = null;
  });

  // Wait for port to bind
  const maxWait = 15_000;
  const interval = 300;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await callAlethia({ jsonrpc: '2.0', id: 0, method: 'tools/list' }, 2_000);
      process.stderr.write('[alethia] Runtime is ready.\n');
      return;
    } catch {
      await new Promise(r => setTimeout(r, interval));
    }
  }
  throw new Error(`Runtime failed to start within ${maxWait / 1000}s. Check ${RUNTIME_DIR} for issues.`);
};

// Clean up spawned runtime on exit
const cleanupRuntime = (): void => {
  if (runtimeProcess && !runtimeProcess.killed) {
    debug('killing spawned runtime');
    runtimeProcess.kill('SIGTERM');
  }
};
process.on('exit', cleanupRuntime);

// ---------------------------------------------------------------------------
// CLI flag handling — runs before any stdio processing
// ---------------------------------------------------------------------------

const CLI_HELP = `${PKG_NAME} v${PKG_VERSION}
MCP bridge for Alethia — the patent-pending zero-IPC E2E test runtime for AI agents.

WHAT THIS IS
  This npm package is the MIT-licensed open-source MCP bridge — a thin
  stdio→HTTP relay (~9 KB) that lets MCP-capable AI agents talk to the
  Alethia runtime running locally on 127.0.0.1:47432.

  The runtime is closed-source and patent-pending — U.S. Patent
  Application No. 19/571,437. The MIT license on this bridge does NOT
  grant any patent license under that application or any other vitron.ai
  patent rights.

USAGE
  alethia-mcp                      Run as a stdio MCP server (default)
  alethia-mcp --version            Print the version and exit
  alethia-mcp --help               Print this message and exit
  alethia-mcp --health-check       Probe the Alethia runtime and exit 0/1
  alethia-mcp --install-skill      Install the bundled Claude Code skill to
                                   ~/.claude/skills/alethia/SKILL.md
  alethia-mcp --debug              Run with debug logging on stderr

RUNTIME
  The runtime auto-installs on first use from GitHub Releases.
  Ed25519-signed, SHA-256 verified. No signup required.

      Releases:        https://github.com/vitron-ai/alethia/releases
      Licensing:       gatekeeper@vitron.ai

ENVIRONMENT
  ALETHIA_HOST          Host of the Alethia runtime (default: 127.0.0.1)
  ALETHIA_PORT          Port of the Alethia runtime (default: 47432)
  ALETHIA_TIMEOUT_MS    Per-request timeout in milliseconds (default: 60000)
  ALETHIA_DEBUG         Set to "1" to enable debug logging on stderr

INTEGRATIONS
  Add to your MCP client config (Claude Code, Cursor, Cline, Continue, etc.):

      {
        "mcpServers": {
          "alethia": { "command": "alethia-mcp" }
        }
      }

ABOUT
  Patent Pending — U.S. Application No. 19/571,437.
  Title: "Deterministic Local Automation Runtime with Zero-IPC Execution,
          Offline Operation, and Per-Step Policy Enforcement"
  Licensing inquiries: gatekeeper@vitron.ai
  Bridge source (MIT): https://github.com/vitron-ai/alethia-mcp
  Project landing:     https://github.com/vitron-ai/alethia
`;

const printAndExit = (message: string, code = 0): never => {
  process.stdout.write(message);
  if (!message.endsWith('\n')) process.stdout.write('\n');
  process.exit(code);
};

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printAndExit(CLI_HELP);
}
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  printAndExit(`${PKG_NAME} v${PKG_VERSION}`);
}

// ---------------------------------------------------------------------------
// JSON-RPC types (subset of MCP protocol)
// ---------------------------------------------------------------------------

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type AlethiaHttpResponse = {
  jsonrpc?: string;
  id?: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
};

// ---------------------------------------------------------------------------
// HTTP client — calls the Alethia runtime's local RPC server
// ---------------------------------------------------------------------------

class AlethiaConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlethiaConnectionError';
  }
}

const callAlethia = (body: unknown, timeoutMs = ALETHIA_TIMEOUT_MS): Promise<AlethiaHttpResponse> =>
  new Promise((resolveCall, rejectCall) => {
    const payload = JSON.stringify(body);
    debug('->', payload);

    const req = http.request(
      {
        hostname: ALETHIA_HOST,
        port: ALETHIA_PORT,
        path: '/',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          debug('<-', data);
          try {
            resolveCall(JSON.parse(data) as AlethiaHttpResponse);
          } catch {
            rejectCall(new Error(`Invalid JSON from Alethia runtime: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Alethia runtime timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
        rejectCall(new AlethiaConnectionError(
          `Alethia runtime is not running on ${ALETHIA_HOST}:${ALETHIA_PORT}.\n` +
          `\n` +
          `The runtime auto-installs on first use. If this is your first run,\n` +
          `the bridge will download and verify the signed runtime binary.\n` +
          `If the runtime was previously installed, it may have exited.\n` +
          `\n` +
          `Troubleshooting:\n` +
          `  → Run: alethia-mcp --health-check\n` +
          `  → Releases: https://github.com/vitron-ai/alethia/releases\n` +
          `  → Licensing: gatekeeper@vitron.ai\n` +
          `\n` +
          `Override host/port with ALETHIA_HOST / ALETHIA_PORT environment vars\n` +
          `if your runtime listens on a non-default address.`
        ));
      } else {
        rejectCall(err);
      }
    });

    req.write(payload);
    req.end();
  });

// ---------------------------------------------------------------------------
// Health check mode — probe and exit
// ---------------------------------------------------------------------------

const runHealthCheck = async (): Promise<never> => {
  process.stdout.write(`Probing Alethia runtime at ${ALETHIA_HOST}:${ALETHIA_PORT}...\n`);
  const probeRuntime = async (): Promise<AlethiaHttpResponse> => {
    try {
      return await callAlethia({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 5_000);
    } catch (err) {
      if (err instanceof AlethiaConnectionError) {
        process.stdout.write('Runtime not running. Attempting auto-install...\n');
        await ensureRuntime();
        return await callAlethia({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 5_000);
      }
      throw err;
    }
  };

  try {
    const response = await probeRuntime();
    if (response.error) {
      process.stdout.write(`✗ Alethia returned an error: ${response.error.message}\n`);
      process.exit(1);
    }
    const result = response.result as { tools?: Array<{ name: string }> } | undefined;
    const toolCount = result?.tools?.length ?? 0;
    process.stdout.write(`✓ Connected. ${toolCount} MCP tool${toolCount === 1 ? '' : 's'} available.\n`);

    // Also probe status if available
    try {
      const statusResp = await callAlethia(
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'alethia_status', arguments: {} } },
        5_000
      );
      if (!statusResp.error && statusResp.result) {
        const status = statusResp.result as { version?: string; defaultPolicyProfile?: string; killSwitch?: { active?: boolean } };
        // Wire value is 'controlled-web' for API stability; display label is
        // 'local-only' to match the cockpit badge and the actual invariant.
        const displayProfile =
          status.defaultPolicyProfile === 'controlled-web' ? 'local-only' : (status.defaultPolicyProfile ?? 'unknown');
        process.stdout.write(`  runtime version:  ${status.version ?? 'unknown'}\n`);
        process.stdout.write(`  default profile:  ${displayProfile}\n`);
        process.stdout.write(`  kill switch:      ${status.killSwitch?.active ? 'ACTIVE' : 'inactive'}\n`);
      }
    } catch {
      // Old runtime versions may not have alethia_status; not fatal.
    }

    process.exit(0);
  } catch (err) {
    if (err instanceof AlethiaConnectionError) {
      process.stdout.write(`✗ ${err.message}\n`);
    } else {
      process.stdout.write(`✗ Health check failed: ${(err as Error).message}\n`);
    }
    process.stdout.write(
      `\n` +
      `This npm package is the MIT-licensed MCP bridge — a stdio→HTTP relay only.\n` +
      `The Alethia runtime (patent-pending) auto-installs on first use from\n` +
      `GitHub Releases. Ed25519-signed, no signup required.\n` +
      `\n` +
      `  → https://github.com/vitron-ai/alethia/releases\n` +
      `  → Licensing: gatekeeper@vitron.ai\n`
    );
    process.exit(1);
  }
};

if (process.argv.includes('--health-check')) {
  // Top-level await — blocks the rest of the script so the stdio loop below
  // never gets a chance to close stdin out from under runHealthCheck.
  // runHealthCheck calls process.exit() so this await never resolves.
  await runHealthCheck();
}

if (process.argv.includes('--install-skill')) {
  // Copy the bundled Claude Code skill into ~/.claude/skills/alethia/.
  // When a user adds our MCP server they get the tools; this makes the
  // workflow knowledge (when to use which tool chain, how NLP maps to
  // the resolver, how to exercise the EA1 gate) also show up in their
  // Claude Code context automatically.
  const skillSrc = resolve(__dirname, '..', 'skills', 'alethia', 'SKILL.md');
  const skillDest = join(homedir(), '.claude', 'skills', 'alethia', 'SKILL.md');
  if (!existsSync(skillSrc)) {
    process.stderr.write(`[alethia] skill source not found at ${skillSrc}. Your install may be incomplete; try reinstalling @vitronai/alethia.\n`);
    process.exit(1);
  }
  try {
    mkdirSync(dirname(skillDest), { recursive: true });
    const content = readFileSync(skillSrc, 'utf8');
    writeFileSync(skillDest, content, 'utf8');
    process.stdout.write(
      `✓ Installed Alethia skill to ${skillDest}\n` +
      `\n` +
      `  Claude Code will auto-load it on its next start. When you ask about\n` +
      `  testing a page, running a compliance audit, or proving the EA1 gate,\n` +
      `  Claude will invoke this skill with the right tool chain.\n`
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[alethia] failed to install skill: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// MCP tool definitions — these are the descriptions the LLM sees
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'alethia_tell',
    description:
      'Execute natural-language E2E test instructions against the page Alethia is currently driving. ' +
      'Returns per-step results, policy audit records, and a SHA-256 integrity hash. ' +
      'Destructive actions (delete, purchase, transfer, etc.) are blocked unconditionally. ' +
      'Sensitive input (passwords, credit cards, SSN) is blocked unless allowSensitiveInput is true. ' +
      '~13 ms per step on average.',
    inputSchema: {
      type: 'object',
      properties: {
        instructions: {
          type: 'string',
          description: 'One or more plain-English test instructions, newline-separated. Example: "navigate to http://localhost:3000\\nclick Sign In\\nassert the dashboard is visible"',
        },
        name: {
          type: 'string',
          description: 'Optional run name for audit logs and replay.',
        },
        allowSensitiveInput: {
          type: 'boolean',
          description: 'Set to true to allow typing into password, token, credit card, and other sensitive fields. Only use for legitimate auth or payment flow tests.',
        },
      },
      required: ['instructions'],
    },
  },
  {
    name: 'alethia_compile',
    description:
      'Compile natural-language test instructions to Alethia Action IR text, without executing anything. ' +
      'Returns the compiled IR, per-line confidence scores (0-1), and warnings for any lines the compiler ' +
      'could not parse. Use this to preview what tell() will run, debug coverage gaps, or generate ' +
      'reproducible IR scripts for CI pipelines.',
    inputSchema: {
      type: 'object',
      properties: {
        instructions: {
          type: 'string',
          description: 'Plain-English instructions to compile (does not execute).',
        },
      },
      required: ['instructions'],
    },
  },
  {
    name: 'alethia_status',
    description:
      'Health and identity probe. Returns runtime version, the default VITRON-EA1 policy profile in effect, ' +
      'kill switch state, driver statistics (queued plans, run count, audit count), the current page domain, ' +
      'and runtime capabilities. Use this for liveness checks before sending tell() calls, and to verify ' +
      'the runtime is in a known-good state at the start of an agent loop.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alethia_activate_kill_switch',
    description:
      'Halt all current and queued automation immediately. The per-step VITRON-EA1 policy gate stays armed; ' +
      'subsequent tell() calls will be blocked with reason KILL_SWITCH_ACTIVE until reset. ' +
      'Use this when an agent appears to be acting unsafely, when human review is required, or to enforce ' +
      'a hard boundary at the end of a controlled test run.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional explanation that lands in the audit trail for later review.',
        },
      },
    },
  },
  {
    name: 'alethia_reset_kill_switch',
    description:
      'Clear an active kill switch and resume normal operation. ' +
      'Re-enables tell() calls. The reset itself is logged in the audit trail for compliance review.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alethia_screenshot',
    description:
      'Capture a PNG screenshot of the current page and return it as a base64-encoded image. ' +
      'Use this to visually verify what the browser is showing after running test steps with alethia_tell.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alethia_eval',
    description:
      'Evaluate a JavaScript expression in the page under test and return the result. ' +
      'Runs in the context of the navigated page, not the Alethia host UI. ' +
      'Use this for queries the NLP compiler cannot express — counting elements, reading computed styles, ' +
      'checking localStorage, or any DOM inspection that needs raw JS.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate in the page context. Example: "document.querySelectorAll(\'li\').length"',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'alethia_audit_wcag',
    description:
      'Run a WCAG 2.1 AA accessibility audit on the current page. Checks 14 criteria including ' +
      'alt text, form labels, keyboard access, page title, lang attribute, link purpose, ' +
      'heading structure, duplicate IDs, and more. Call after navigating with alethia_tell. ' +
      'Returns findings with WCAG criterion numbers, severity levels, and issue counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alethia_audit_nist',
    description:
      'Run a NIST SP 800-53 Rev. 5 web application security controls audit on the current page. ' +
      'Checks 8 controls across 3 families: AC (login lockout, security banners, session timeout), ' +
      'IA (unmasked passwords, weak password constraints, MFA indicators), ' +
      'SI (input validation, error information leakage). ' +
      'Call after navigating with alethia_tell. Returns findings with control IDs and severity levels.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alethia_export_session',
    description:
      'Export the full session recording as a signed evidence pack. Contains every tool call ' +
      'made during this session with timestamps, inputs, outputs, policy decisions, and a ' +
      'SHA-256 integrity hash. Use at the end of an agent loop to produce cryptographic proof ' +
      'of everything the agent did. Designed for compliance review and chain-of-custody.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alethia_tell_parallel',
    description:
      'Run multiple test flows concurrently — each against a different URL. ' +
      'Takes an array of test specs, spawns a browser instance per spec, runs them in parallel, ' +
      'and returns all results together. Use this to verify multiple pages simultaneously.',
    inputSchema: {
      type: 'object',
      properties: {
        specs: {
          type: 'array',
          description: 'Array of test specs. Each has "url" (file:// or http://localhost) and "instructions" (test steps).',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to navigate to' },
              instructions: { type: 'string', description: 'Plain-English test steps' },
              name: { type: 'string', description: 'Optional name for this spec' },
            },
            required: ['url', 'instructions'],
          },
        },
      },
      required: ['specs'],
    },
  },
  {
    name: 'alethia_serve_demo',
    description:
      'Start a local HTTP server for the built-in Alethia demo pages and return the base URL. ' +
      'Use this to serve demo pages on localhost so they appear in preview panels (Claude Code, VS Code, etc.). ' +
      'The server runs on a random available port on 127.0.0.1. Call this before alethia_tell to get a localhost URL ' +
      'instead of a file:// path. Returns the base URL and a list of available demo pages.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alethia_propose_tests',
    description:
      'Navigate to a URL, scan the page for interactive elements (headings, buttons, forms, links, ' +
      'destructive actions), and generate a candidate NLP test suite ready to pass to alethia_tell. ' +
      'Returns an array of plain-English test blocks, including an auto-generated "EA1 Safety Gate Verification" ' +
      'block that uses "expect block: <action>" for every destructive control on the page. ' +
      'Use this to bootstrap test coverage for a new page or to discover what the safety gate should be watching.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to and scan (file://, http://localhost, etc.).',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'alethia_assert_safety',
    description:
      'Navigate to a URL, discover every destructive / write-high action on the page, and verify the ' +
      'VITRON-EA1 policy gate blocks each one. Returns a per-action report with block/allow status. ' +
      'This is the automated policy-verification primitive — proves the safety gate works on a real page ' +
      'without the agent or human having to click each destructive button manually. Use it as a compliance ' +
      'check before releasing an agent-driven workflow against a customer environment.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to and audit.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'alethia_show_cockpit',
    description:
      'Show the Alethia cockpit window — the oversight surface where the target app is driven and each ' +
      'step is highlighted live (green = pass, blue = type, red = EA1 block). Use this to pop the UI ' +
      'into view during a headless-launched session for demos, review, or partner walkthroughs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alethia_hide_cockpit',
    description:
      'Hide the Alethia cockpit window. The runtime keeps running and continues to accept tool calls; ' +
      'only the visible window is dismissed.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

// Map public MCP tool names to internal runtime tool names
const TOOL_NAME_MAP: Record<string, string> = {
  alethia_tell: 'alethia_tell',
  alethia_compile: 'alethia_compile_nlp',
  alethia_status: 'alethia_status',
  alethia_activate_kill_switch: 'alethia_activate_kill_switch',
  alethia_reset_kill_switch: 'alethia_reset_kill_switch',
  alethia_screenshot: 'alethia_screenshot',
  alethia_eval: 'alethia_eval',
  alethia_audit_wcag: 'alethia_audit_wcag',
  alethia_audit_nist: 'alethia_audit_nist',
  alethia_export_session: 'alethia_export_session',
  alethia_tell_parallel: 'alethia_tell_parallel',
  alethia_propose_tests: 'alethia_propose_tests',
  alethia_assert_safety: 'alethia_assert_safety',
  alethia_show_cockpit: 'alethia_show_cockpit',
  alethia_hide_cockpit: 'alethia_hide_cockpit',
};

// ---------------------------------------------------------------------------
// Per-tool input validation
// ---------------------------------------------------------------------------

const validateToolArgs = (toolName: string, args: Record<string, unknown>): string | null => {
  switch (toolName) {
    case 'alethia_tell':
    case 'alethia_compile': {
      const instructions = args.instructions;
      if (typeof instructions !== 'string') return `tool "${toolName}" requires "instructions" to be a string`;
      if (instructions.trim().length === 0) return `tool "${toolName}" requires "instructions" to be non-empty`;
      if (instructions.length > 100_000) return `tool "${toolName}" "instructions" exceeds 100KB limit`;
      if ('name' in args && args.name !== undefined && typeof args.name !== 'string') {
        return `tool "${toolName}" requires "name" to be a string when provided`;
      }
      return null;
    }
    case 'alethia_activate_kill_switch':
      if ('reason' in args && args.reason !== undefined && typeof args.reason !== 'string') {
        return `tool "${toolName}" requires "reason" to be a string when provided`;
      }
      return null;
    case 'alethia_eval': {
      const expression = args.expression;
      if (typeof expression !== 'string') return `tool "${toolName}" requires "expression" to be a string`;
      if (expression.trim().length === 0) return `tool "${toolName}" requires "expression" to be non-empty`;
      if (expression.length > 50_000) return `tool "${toolName}" "expression" exceeds 50KB limit`;
      return null;
    }
    case 'alethia_propose_tests':
    case 'alethia_assert_safety': {
      const url = args.url;
      if (typeof url !== 'string') return `tool "${toolName}" requires "url" to be a string`;
      if (url.trim().length === 0) return `tool "${toolName}" requires "url" to be non-empty`;
      return null;
    }
    case 'alethia_status':
    case 'alethia_reset_kill_switch':
    case 'alethia_screenshot':
    case 'alethia_audit_wcag':
    case 'alethia_audit_nist':
    case 'alethia_export_session':
    case 'alethia_tell_parallel':
    case 'alethia_show_cockpit':
    case 'alethia_hide_cockpit':
      return null;
    default:
      return `unknown tool: ${toolName}`;
  }
};

// ---------------------------------------------------------------------------
// MCP request handlers
// ---------------------------------------------------------------------------

type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

const wrapMcpResult = (data: unknown, isError = false): { content: McpContentBlock[]; isError: boolean } => ({
  content: [
    {
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    },
  ],
  isError,
});

const wrapMcpScreenshot = (result: Record<string, unknown>): { content: McpContentBlock[]; isError: boolean } => ({
  content: [
    {
      type: 'image',
      data: String(result.data ?? ''),
      mimeType: 'image/png',
    },
    {
      type: 'text',
      text: JSON.stringify({ width: result.width, height: result.height, format: result.format }, null, 2),
    },
  ],
  isError: false,
});

const handle = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const id = request.id ?? null;
  const method = request.method ?? '';

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          serverInfo: { name: PKG_NAME, version: PKG_VERSION },
          capabilities: {
            tools: { listChanged: false },
          },
          instructions:
            (isSkillInstalled()
              ? ''
              : 'TIP FOR THE USER: Alethia ships a Claude Code skill that teaches Claude when to use each tool and how to compose them. It is not installed yet on this machine. Tell the user once per session: "To pre-load the Alethia workflow playbook for every Claude Code session, run: `alethia-mcp --install-skill`". Do NOT repeat this tip after the user has installed it.\n\n') +
            'Alethia is the patent-pending zero-IPC E2E test runtime built for AI agents. ' +
            '~13ms per step, 45x faster than CDP-based tools. Local-first, zero telemetry by default.\n\n' +
            'Core tools:\n' +
            '- alethia_tell: Drive a real browser with plain English. Returns per-step results, DOM diffs (what changed), ' +
            'a semantic page snapshot (~200 tokens), EA1 policy audits, and a SHA-256 integrity hash.\n' +
            '- alethia_compile: Preview what tell() will run without executing.\n' +
            '- alethia_status: Health check — version, policy profile, kill switch state.\n' +
            '- alethia_screenshot: Capture a PNG screenshot of the current page.\n' +
            '- alethia_eval: Run JavaScript in the page under test.\n' +
            '- alethia_activate_kill_switch / alethia_reset_kill_switch: Emergency halt and resume.\n' +
            '- alethia_audit_wcag: WCAG 2.1 AA accessibility audit — 14 criteria.\n' +
            '- alethia_audit_nist: NIST SP 800-53 security controls audit — 8 controls.\n' +
            '- alethia_export_session: Export signed evidence pack of everything the agent did this session.\n' +
            '- alethia_serve_demo: Start a localhost server for built-in demo pages. Opens in preview panels.\n' +
            '- alethia_propose_tests: Scan a URL and return a candidate NLP test suite ready for alethia_tell, including an auto-generated "expect block:" block for every destructive action.\n' +
            '- alethia_assert_safety: Walk every destructive action on a URL and verify the EA1 gate blocks each one. Returns a per-action block/allow report.\n' +
            '- alethia_show_cockpit / alethia_hide_cockpit: Toggle the live oversight window during a session.\n\n' +
            'Common workflows (chain these tools, do not ask the user for raw tool names):\n' +
            '- Smoke test a page: alethia_tell with "navigate to <url>" + plain-English asserts.\n' +
            '- Bootstrap tests on an unknown page: alethia_propose_tests (returns ready NLP blocks) → alethia_tell to run them.\n' +
            '- Full compliance pass: alethia_tell (navigate) → alethia_audit_wcag → alethia_audit_nist → alethia_export_session for the signed pack.\n' +
            '- Prove the EA1 safety gate works: alethia_assert_safety (auto-discovers destructive actions and verifies each is blocked).\n' +
            '- Demo / visual verification: alethia_serve_demo (localhost URL) → alethia_tell → alethia_screenshot.\n' +
            '- End of every compliance session: alethia_export_session returns a SHA-256-hashed, Ed25519-signable evidence pack.\n\n' +
            'Key capabilities:\n' +
            '- Smart assertions: on failure, returns near-matches, page context, and suggested fixes.\n' +
            '- Page readiness: auto-waits for loading indicators before assertions.\n' +
            '- Conditional steps: "if cookie banner exists, click Accept" — skips gracefully.\n' +
            '- Interaction checks: verifies elements are visible, enabled, and not blocked by overlays.\n' +
            '- EA1 safety gate: destructive actions (delete, purchase, transfer) are blocked by default.\n\n' +
            'The runtime auto-installs on first use and runs locally on 127.0.0.1:47432. ' +
            'Works with local files (file://) and localhost dev servers.',
        },
      };
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      // Client confirmed successful handshake. Mark this bridge version as
      // trusted so future spawns skip the retry-budget dance. No-op if we
      // were spawned from the globally-installed npm path (the global install
      // is implicitly trusted — only ~/.alethia/bridge/<version>/ needs this).
      markCurrentVersionVerified();
      return null as unknown as JsonRpcResponse;
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
      const params = (request.params ?? {}) as Record<string, unknown>;
      const toolName = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      // alethia_serve_demo is handled locally — not forwarded to the runtime.
      if (toolName === 'alethia_serve_demo') {
        try {
          const { port, url, pages } = await startDemoServer();
          const pageList = pages.map(p => `  ${url}/${p}`).join('\n');
          return {
            jsonrpc: '2.0',
            id,
            result: wrapMcpResult(
              `Demo server running on ${url}\n\nAvailable pages:\n${pageList}\n\n` +
              `Open any URL above in the preview panel, then use alethia_tell to drive it.\n` +
              `Example: alethia_tell "navigate to ${url}/${pages.find(p => p.includes('claude-code')) ?? pages[0]}"`,
            ),
          };
        } catch (err) {
          return { jsonrpc: '2.0', id, result: wrapMcpResult(`Failed to start demo server: ${err}`, true) };
        }
      }

      const internalName = TOOL_NAME_MAP[toolName];
      if (!internalName) {
        return {
          jsonrpc: '2.0',
          id,
          result: wrapMcpResult(`Unknown tool: ${toolName}. Valid tools: ${Object.keys(TOOL_NAME_MAP).join(', ')}, alethia_serve_demo`, true),
        };
      }

      const validationError = validateToolArgs(toolName, args);
      if (validationError) {
        return {
          jsonrpc: '2.0',
          id,
          result: wrapMcpResult(`Invalid arguments: ${validationError}`, true),
        };
      }

      const doCall = async (): Promise<JsonRpcResponse> => {
        // Strip profile from args — agents must not override the EA1 policy.
        // The runtime enforces controlled-web by default; profile switching
        // requires human configuration, not per-call agent override.
        const { profile: _stripped, ...safeArgs } = args;
        const httpResponse = await callAlethia({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: internalName, arguments: safeArgs },
        });

        if (httpResponse.error) {
          return {
            jsonrpc: '2.0',
            id,
            result: wrapMcpResult(`Alethia runtime error: ${httpResponse.error.message}`, true),
          };
        }

        // Screenshot responses get special MCP image content blocks
        if (toolName === 'alethia_screenshot' && httpResponse.result && typeof httpResponse.result === 'object') {
          return {
            jsonrpc: '2.0',
            id,
            result: wrapMcpScreenshot(httpResponse.result as Record<string, unknown>),
          };
        }

        // Evidence-pack responses get a bridge-side metadata wrapper with
        // the bridge version + installed skill content hash. Partners doing
        // chain-of-custody review can reconstruct the exact
        // runtime+bridge+skill triple that produced the evidence.
        if (toolName === 'alethia_export_session' && httpResponse.result && typeof httpResponse.result === 'object') {
          const wrappedEvidence = {
            bridge: {
              name: PKG_NAME,
              version: PKG_VERSION,
            },
            skill: {
              installedHash: hashSkillFile(INSTALLED_SKILL_PATH),
              bundledHash: hashSkillFile(BUNDLED_SKILL_PATH),
            },
            evidencePack: httpResponse.result,
          };
          return {
            jsonrpc: '2.0',
            id,
            result: wrapMcpResult(wrappedEvidence),
          };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: wrapMcpResult(httpResponse.result ?? null),
        };
      };

      // Refuse to operate against a stale runtime that's squatting on the port
      // (orphan from a previous bridge process, manual launch, etc.). Without
      // this guard the bridge would silently use whatever's running, and the
      // user would never know they're months behind on policy/runtime patches.
      try {
        await ensureCorrectRuntimeVersion();
      } catch (versionErr) {
        return {
          jsonrpc: '2.0',
          id,
          result: wrapMcpResult((versionErr as Error).message, true),
        };
      }

      try {
        return await doCall();
      } catch (err) {
        if (err instanceof AlethiaConnectionError) {
          // Runtime not running — try auto-install + spawn
          try {
            await ensureRuntime();
            return await doCall();
          } catch (installErr) {
            return {
              jsonrpc: '2.0',
              id,
              result: wrapMcpResult((installErr as Error).message, true),
            };
          }
        }
        throw err;
      }
    }

    // Any notification (no id) gets no response
    if (method.startsWith('notifications/') || id === undefined) {
      return null as unknown as JsonRpcResponse;
    }

    // Unknown method — return MCP-style error
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: (err as Error).message },
    };
  }
};

// ---------------------------------------------------------------------------
// Stdio transport — newline-delimited JSON-RPC
// ---------------------------------------------------------------------------

const write = (response: JsonRpcResponse | null): void => {
  if (!response) return; // Notifications get no response
  process.stdout.write(`${JSON.stringify(response)}\n`);
};

// Only attach stdio handlers when this module is the entry point. Keeps
// test imports from hanging on process.stdin, and keeps the server from
// accidentally starting twice if the file is ever imported from another
// CLI wrapper.
//
// The tricky bit: when npm installs the package globally, `alethia-mcp`
// is a bin symlink in /usr/local/bin (or similar), and process.argv[1]
// points at the symlink — not the real dist/index.js path that
// import.meta.url resolves to. Strict equality of those two would fail
// EVERY production spawn, silently drop the stdin handler, and cause the
// process to exit immediately. Resolve symlinks on the argv path before
// comparing. (This bit us on 0.6.0 — Claude Desktop log showed
// "Server transport closed unexpectedly".)
const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    // argv[1] doesn't exist or permissions issue — fall back to direct
    // compare (still handles the `node path/to/index.js` case).
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
})();

if (isMainModule) {
  // BOOTSTRAP HANDOFF: if a newer, signature-verified bridge is installed
  // at ~/.alethia/bridge/<version>/, exec to it instead of running ourselves.
  // This is how the self-update mechanism hands off control without requiring
  // the user to re-run `npm install -g`. Runs BEFORE we attach stdio
  // handlers — the child process inherits our stdio directly.
  const bootstrapTarget = selectBootstrapTarget();
  if (bootstrapTarget) {
    debug(`bootstrapping to bridge ${bootstrapTarget.version} at ${bootstrapTarget.jsPath}`);
    const child = spawn(process.execPath, [bootstrapTarget.jsPath], {
      stdio: 'inherit',
      env: { ...process.env, ALETHIA_BOOTSTRAPPED: '1' },
    });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
    child.on('error', (err) => {
      process.stderr.write(`[alethia] bootstrap child failed to spawn: ${err.message}; falling back to bundled bridge\n`);
      // Fall through — let the current process keep running normally below.
    });
  } else {
    // We're the version that's going to serve this session. Continue with
    // normal startup: skill refresh, stdio handlers, background update check.
    debug(`starting ${PKG_NAME} v${PKG_VERSION}, target ${ALETHIA_HOST}:${ALETHIA_PORT}, timeout ${ALETHIA_TIMEOUT_MS}ms`);

    // Auto-refresh the Claude Code skill if the installed copy differs from
    // the one bundled with this bridge version. No-op if the user never
    // installed the skill, or if the two match. This is the "users don't
    // have to manually re-run --install-skill every time we ship a new
    // playbook" guarantee.
    refreshSkillIfStale();

    // Kick off the background check for a newer bridge release. If one
    // exists and passes integrity verification, it's downloaded + extracted
    // to ~/.alethia/bridge/<version>/ and takes effect on next spawn. Does
    // not block the current session — purely ahead-of-time prep.
    void backgroundCheckForNewBridge().catch(() => { /* silent */ });

  process.stdin.setEncoding('utf8');
  let buffer = '';

  process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  while (true) {
    const nl = buffer.indexOf('\n');
    if (nl === -1) break;
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }

    void handle(request).then(write).catch((err: Error) => {
      write({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32000, message: err.message } });
    });
  }
});

process.stdin.on('end', () => {
  // Set exitCode but DON'T forcibly exit. Pending HTTP responses (e.g. an
  // in-flight tools/call against an offline runtime) need to write their
  // error response back before the process is allowed to exit. The Node
  // event loop will drain naturally and exit with this code once there's
  // no remaining work.
  debug('stdin closed, will exit when pending work drains');
  process.exitCode = 0;
});

const shutdown = (signal: string) => () => {
  debug(`received ${signal}, exiting`);
  process.exit(0);
};

  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
  } // end: else branch of bootstrap check
}
