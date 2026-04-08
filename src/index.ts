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
 * Cryptographically chained audit packs. Local-first, no telemetry.
 *
 * MIT License — vitron-ai 2026.
 * Patent Pending — U.S. Application No. 19/571,437. The MIT license on this
 * MCP bridge does NOT grant any patent license under U.S. App 19/571,437.
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
  try {
    const response = await callAlethia(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      5_000
    );
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

      try {
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
      } catch (err) {
        if (err instanceof AlethiaConnectionError) {
          return {
            jsonrpc: '2.0',
            id,
            result: wrapMcpResult(err.message, true),
          };
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
