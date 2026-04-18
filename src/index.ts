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
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, createWriteStream, chmodSync } from 'node:fs';
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

const debug = (...args: unknown[]): void => {
  if (DEBUG) {
    process.stderr.write(`[alethia-mcp] ${args.map(String).join(' ')}\n`);
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
// ---------------------------------------------------------------------------

const RUNTIME_VERSION = '0.2.4';
const RUNTIME_DIR = join(homedir(), '.alethia', 'runtime');
const RUNTIME_MARKER = join(RUNTIME_DIR, '.installed');
const GITHUB_RELEASE_BASE = `https://github.com/vitron-ai/alethia/releases/download/v${RUNTIME_VERSION}`;

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

const PLATFORM_MAP: Record<string, Record<string, string>> = {
  darwin: {
    x64: `Alethia-${RUNTIME_VERSION}-mac.tar.gz`,
    arm64: `Alethia-${RUNTIME_VERSION}-mac-arm64.tar.gz`,
  },
  linux: {
    x64: `alethia-${RUNTIME_VERSION}.tar.gz`,
    arm64: `alethia-${RUNTIME_VERSION}-arm64.tar.gz`,
  },
  win32: {
    x64: `Alethia-${RUNTIME_VERSION}-win.zip`,
  },
};

const getArtifactName = (): string | null => {
  const p = platform();
  const a = arch();
  return PLATFORM_MAP[p]?.[a] ?? null;
};

const getExecutablePath = (): string => {
  const p = platform();
  if (p === 'darwin') {
    // Look for the .app inside the extracted directory
    const macDir = existsSync(join(RUNTIME_DIR, 'mac')) ? 'mac' : 'mac-arm64';
    return join(RUNTIME_DIR, macDir, 'Alethia.app', 'Contents', 'MacOS', 'Alethia');
  }
  if (p === 'win32') {
    return join(RUNTIME_DIR, 'win-unpacked', 'Alethia.exe');
  }
  // Linux — the tarball extracts into a version-prefixed directory.
  // Probe likely candidates and fall back to scanning RUNTIME_DIR.
  const linuxCandidates = [
    `alethia-${RUNTIME_VERSION}`,
    `alethia-${RUNTIME_VERSION}-arm64`,
    'linux-unpacked',
    'linux-arm64-unpacked',
  ];
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
  // Return the canonical expected path so the downstream error message
  // tells the user where we LOOKED (rather than landing on an unrelated arm64 path).
  return join(RUNTIME_DIR, `alethia-${RUNTIME_VERSION}`, 'alethia');
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

const ensureRuntime = async (): Promise<void> => {
  if (autoInstallAttempted) return;
  autoInstallAttempted = true;

  const artifactName = getArtifactName();
  if (!artifactName) {
    throw new Error(
      `No Alethia runtime available for ${platform()}-${arch()}. ` +
      `Supported: macOS (x64/arm64), Linux (x64/arm64), Windows (x64). ` +
      `Contact gatekeeper@vitron.ai for assistance.`
    );
  }

  // Check if already installed and up-to-date
  if (existsSync(RUNTIME_MARKER)) {
    try {
      const marker = JSON.parse(readFileSync(RUNTIME_MARKER, 'utf8')) as { version?: string };
      if (marker.version === RUNTIME_VERSION) {
        debug('runtime already installed and up-to-date, spawning');
        await spawnRuntime();
        return;
      }
      process.stderr.write(`[alethia] Installed runtime v${marker.version ?? 'unknown'} is outdated. Upgrading to v${RUNTIME_VERSION}...\n`);
    } catch {
      debug('could not read runtime marker, re-installing');
    }
  }

  process.stderr.write(`[alethia] Runtime not found. Auto-installing v${RUNTIME_VERSION}...\n`);

  mkdirSync(RUNTIME_DIR, { recursive: true });
  const artifactPath = join(RUNTIME_DIR, artifactName);
  const manifestPath = join(RUNTIME_DIR, 'manifest.json');

  // Download manifest + artifact
  await downloadFile(`${GITHUB_RELEASE_BASE}/manifest.json`, manifestPath);
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
  await downloadFile(`${GITHUB_RELEASE_BASE}/${artifactName}`, artifactPath);

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
  writeFileSync(RUNTIME_MARKER, JSON.stringify({ version: RUNTIME_VERSION, installedAt: new Date().toISOString() }), 'utf8');
  process.stderr.write(`[alethia] Runtime v${RUNTIME_VERSION} installed to ${RUNTIME_DIR}\n`);

  await spawnRuntime();
};

const spawnRuntime = async (): Promise<void> => {
  const exe = getExecutablePath();
  if (!existsSync(exe)) {
    throw new Error(`Runtime executable not found at ${exe}. Try deleting ${RUNTIME_DIR} and restarting.`);
  }

  // Make sure it's executable (Linux/Mac)
  if (platform() !== 'win32') {
    try { chmodSync(exe, 0o755); } catch { /* best effort */ }
  }

  const visible = process.env.ALETHIA_VISIBLE === '1' || process.env.ALETHIA_VISIBLE === 'true';
  process.stderr.write(`[alethia] Spawning runtime (${visible ? 'visible' : 'headless'})...\n`);
  runtimeProcess = spawn(exe, visible ? [] : ['--headless'], {
    env: { ...process.env, ...(visible ? {} : { ALETHIA_HEADLESS: '1' }) },
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
        process.stdout.write(`  runtime version:  ${status.version ?? 'unknown'}\n`);
        process.stdout.write(`  default profile:  ${status.defaultPolicyProfile ?? 'unknown'}\n`);
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
        nlp: {
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
      required: ['nlp'],
    },
  },
  {
    name: 'alethia_compile',
    description:
      'Compile natural-language test instructions to Alethia Action IR text, without executing anything. ' +
      'Returns the compiled IR, per-line confidence scores (0-1), and warnings for any lines the NLP compiler ' +
      'could not parse. Use this to preview what tell() will run, debug NLP coverage gaps, or generate ' +
      'reproducible IR scripts for CI pipelines.',
    inputSchema: {
      type: 'object',
      properties: {
        nlp: {
          type: 'string',
          description: 'NL instructions to compile (does not execute).',
        },
      },
      required: ['nlp'],
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
          description: 'Array of test specs. Each has "url" (file:// or http://localhost) and "nlp" (test steps).',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to navigate to' },
              nlp: { type: 'string', description: 'Plain English test steps' },
              name: { type: 'string', description: 'Optional name for this spec' },
            },
            required: ['url', 'nlp'],
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
};

// ---------------------------------------------------------------------------
// Per-tool input validation
// ---------------------------------------------------------------------------

const validateToolArgs = (toolName: string, args: Record<string, unknown>): string | null => {
  switch (toolName) {
    case 'alethia_tell':
    case 'alethia_compile': {
      const nlp = args.nlp;
      if (typeof nlp !== 'string') return `tool "${toolName}" requires "nlp" to be a string`;
      if (nlp.trim().length === 0) return `tool "${toolName}" requires "nlp" to be non-empty`;
      if (nlp.length > 100_000) return `tool "${toolName}" "nlp" exceeds 100KB limit`;
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
            '- alethia_assert_safety: Walk every destructive action on a URL and verify the EA1 gate blocks each one. Returns a per-action block/allow report.\n\n' +
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
      // Notifications must not receive a response per MCP spec
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

        return {
          jsonrpc: '2.0',
          id,
          result: wrapMcpResult(httpResponse.result ?? null),
        };
      };

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

debug(`starting ${PKG_NAME} v${PKG_VERSION}, target ${ALETHIA_HOST}:${ALETHIA_PORT}, timeout ${ALETHIA_TIMEOUT_MS}ms`);

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
