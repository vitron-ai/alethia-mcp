#!/usr/bin/env node
/**
 * @vitronai/alethia — MCP bridge
 *
 * Connects AI agents (Claude, GPT, Cursor, etc.) to a running Alethia
 * desktop app via the MCP stdio protocol.
 *
 * The Alethia desktop app must be running locally. Download it at:
 * https://github.com/vitron-ai/alethia/releases
 *
 * MIT License — vitron-ai 2026
 */

import http from 'node:http';

const ALETHIA_PORT = Number(process.env.ALETHIA_PORT ?? 47432);
const ALETHIA_HOST = '127.0.0.1';

// ---------------------------------------------------------------------------
// JSON-RPC types
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
  error?: { code: number; message: string };
};

// ---------------------------------------------------------------------------
// HTTP client — calls the Alethia desktop app
// ---------------------------------------------------------------------------

const callAlethia = (body: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
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
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON from Alethia app'));
          }
        });
      }
    );
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        reject(new Error(
          `Alethia desktop app is not running on port ${ALETHIA_PORT}. ` +
          'Download it at https://github.com/vitron-ai/alethia/releases'
        ));
      } else {
        reject(err);
      }
    });
    req.write(payload);
    req.end();
  });

// ---------------------------------------------------------------------------
// MCP stdio transport
// ---------------------------------------------------------------------------

const write = (response: JsonRpcResponse): void => {
  process.stdout.write(`${JSON.stringify(response)}\n`);
};

const handle = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const id = request.id ?? null;
  const method = request.method ?? '';

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2026-02-01',
          serverInfo: { name: '@vitronai/alethia', version: '0.1.0' },
          capabilities: { tools: {} },
        },
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'alethia_tell',
              description:
                'Execute natural language E2E test instructions against the app under test. ' +
                'Runs entirely local — no cloud, no telemetry. ' +
                'Example: "navigate to http://localhost:3000\\nclick Sign In\\nassert the dashboard is visible"',
              inputSchema: {
                type: 'object',
                properties: {
                  nlp: {
                    type: 'string',
                    description: 'One or more plain-English test instructions, one per line.',
                  },
                  name: {
                    type: 'string',
                    description: 'Optional name for this test run.',
                  },
                },
                required: ['nlp'],
              },
            },
            {
              name: 'alethia_compile',
              description:
                'Compile natural language instructions to Alethia Action IR without executing. ' +
                'Useful for previewing what will run before committing.',
              inputSchema: {
                type: 'object',
                properties: {
                  nlp: {
                    type: 'string',
                    description: 'Plain-English test instructions to compile.',
                  },
                },
                required: ['nlp'],
              },
            },
          ],
        },
      };
    }

    if (method === 'tools/call') {
      const params = (request.params ?? {}) as Record<string, unknown>;
      const toolName = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      if (toolName === 'alethia_tell' || toolName === 'alethia_compile') {
        const result = await callAlethia({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: toolName === 'alethia_tell' ? 'vitron_tell' : 'vitron_compile_nlp',
            arguments: args,
          },
        });
        return { jsonrpc: '2.0', id, result };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      };
    }

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
// Main — read newline-delimited JSON from stdin
// ---------------------------------------------------------------------------

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
    void handle(request).then(write);
  }
});
