#!/usr/bin/env node
/**
 * @vitronai/alethia — MCP bridge
 *
 * Stdio MCP server that connects AI agents (Claude Code, Cursor, Cline,
 * Continue, etc.) to a running Alethia desktop app via JSON-RPC over a
 * loopback HTTP socket on 127.0.0.1:47432.
 *
 * The Alethia desktop app must be running locally. Download it at:
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
import { readFileSync, existsSync, mkdirSync, writeFileSync, createWriteStream, chmodSync } from 'node:fs';
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
// Auto-install: download, verify, extract, and spawn the headless runtime
// ---------------------------------------------------------------------------

const RUNTIME_VERSION = '0.1.0-alpha.1';
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
  // Linux
  const linuxDir = existsSync(join(RUNTIME_DIR, 'linux-unpacked')) ? 'linux-unpacked' : 'linux-arm64-unpacked';
  return join(RUNTIME_DIR, linuxDir, 'alethia');
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

  // Check if already installed
  if (existsSync(RUNTIME_MARKER)) {
    debug('runtime already installed, spawning');
    await spawnRuntime();
    return;
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

  process.stderr.write('[alethia] Spawning headless runtime...\n');
  runtimeProcess = spawn(exe, ['--headless'], {
    env: { ...process.env, ALETHIA_HEADLESS: '1' },
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
  Alethia desktop runtime running locally on 127.0.0.1:47432.

  The runtime itself (in-process zero-IPC executor, VITRON-EA1 policy
  gate, NLP compiler) is closed-source and patent-pending — U.S. Patent
  Application No. 19/571,437. The MIT license on this bridge does NOT
  grant any patent license under that application or any other vitron.ai
  patent rights.

USAGE
  alethia-mcp                      Run as a stdio MCP server (default)
  alethia-mcp --version            Print the version and exit
  alethia-mcp --help               Print this message and exit
  alethia-mcp --health-check       Probe the Alethia desktop runtime and exit 0/1
  alethia-mcp --debug              Run with debug logging on stderr

GETTING THE DESKTOP RUNTIME
  The runtime is currently in design-partner alpha:

      Landing page:    https://github.com/vitron-ai/alethia
      Request access:  gatekeeper@vitron.ai

  Public binary releases ship with the v0.3 milestone.

ENVIRONMENT
  ALETHIA_HOST          Host of the Alethia desktop runtime (default: 127.0.0.1)
  ALETHIA_PORT          Port of the Alethia desktop runtime (default: 47432)
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
// HTTP client — calls the Alethia desktop app's local RPC server
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
            rejectCall(new Error(`Invalid JSON from Alethia desktop app: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Alethia desktop app timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
        rejectCall(new AlethiaConnectionError(
          `Alethia desktop runtime is not running on ${ALETHIA_HOST}:${ALETHIA_PORT}.\n` +
          `\n` +
          `This npm package is the open-source MCP bridge — a thin stdio→HTTP relay\n` +
          `to the Alethia desktop runtime. The runtime contains the patent-pending\n` +
          `in-process zero-IPC executor (U.S. Patent App. No. 19/571,437) and is\n` +
          `distributed separately under the design partner program.\n` +
          `\n` +
          `To get access to the desktop runtime:\n` +
          `  → Design-partner alpha is open: https://github.com/vitron-ai/alethia\n` +
          `  → Request access: gatekeeper@vitron.ai\n` +
          `  → Public binary releases ship with the v0.3 milestone.\n` +
          `\n` +
          `Once the desktop runtime is running locally, re-run your MCP client.\n` +
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
  process.stdout.write(`Probing Alethia desktop runtime at ${ALETHIA_HOST}:${ALETHIA_PORT}...\n`);
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
      `The Alethia desktop runtime (which contains the patent-pending in-process\n` +
      `zero-IPC executor) is required and is currently in design-partner alpha.\n` +
      `\n` +
      `Request runtime access:\n` +
      `  → https://github.com/vitron-ai/alethia\n` +
      `  → gatekeeper@vitron.ai\n`
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
      'Compiles to Action IR, runs through the VITRON-EA1 fail-closed policy gate, executes step-by-step ' +
      'with synchronous DOM access (no CDP marshalling), and returns a PlanRun with per-step results, ' +
      'policy audit records, and a SHA-256 integrity hash. ' +
      'Default profile is "controlled-web" — destructive actions (delete, purchase, transfer) are blocked unless ' +
      'the caller explicitly opts into "open-web". Sensitive input (passwords, credit cards, SSN) is blocked ' +
      'in all profiles unless allowSensitiveInput is true. ' +
      '~13ms per step on average — 45x faster than Playwright on the localhost loop.',
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
      'Clear an active kill switch and reset the shared executor state. ' +
      'Re-enables tell() calls. The reset itself is logged in the audit trail for compliance review.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

// Map external tool names to the internal Electron RPC tool names
const TOOL_NAME_MAP: Record<string, string> = {
  alethia_tell: 'alethia_tell',
  alethia_compile: 'alethia_compile_nlp',
  alethia_status: 'alethia_status',
  alethia_activate_kill_switch: 'alethia_activate_kill_switch',
  alethia_reset_kill_switch: 'alethia_reset_kill_switch',
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
    case 'alethia_status':
    case 'alethia_reset_kill_switch':
      return null;
    default:
      return `unknown tool: ${toolName}`;
  }
};

// ---------------------------------------------------------------------------
// MCP request handlers
// ---------------------------------------------------------------------------

const wrapMcpResult = (data: unknown, isError = false): { content: Array<{ type: 'text'; text: string }>; isError: boolean } => ({
  content: [
    {
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    },
  ],
  isError,
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
            'Use alethia_tell to drive a real browser with plain English. ' +
            'The Alethia desktop app must be running locally on 127.0.0.1:47432.',
        },
      };
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      // No response expected for notifications, but return a stub for safety
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
      const params = (request.params ?? {}) as Record<string, unknown>;
      const toolName = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      const internalName = TOOL_NAME_MAP[toolName];
      if (!internalName) {
        return {
          jsonrpc: '2.0',
          id,
          result: wrapMcpResult(`Unknown tool: ${toolName}. Valid tools: ${Object.keys(TOOL_NAME_MAP).join(', ')}`, true),
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
        const httpResponse = await callAlethia({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: internalName, arguments: args },
        });

        if (httpResponse.error) {
          return {
            jsonrpc: '2.0',
            id,
            result: wrapMcpResult(`Alethia runtime error: ${httpResponse.error.message}`, true),
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

const write = (response: JsonRpcResponse): void => {
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
