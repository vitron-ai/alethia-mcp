#!/usr/bin/env node
// Opt-in, runtime-backed smoke test for the public MCP bridge.
// Separate from the default suite: it may download and run the proprietary runtime.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bridge = join(root, 'dist', 'index.js');
const timeoutMs = Number(process.env.ALETHIA_E2E_TIMEOUT_MS ?? 300_000);
const child = spawn(process.execPath, [bridge], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ALETHIA_HEADLESS: '1',
    ALETHIA_QUIET: '1',
    ALETHIA_SKIP_AUTO_UPDATE: '1',
  },
});

let stdoutBuffer = '';
let stderr = '';
let nextId = 1;
const pending = new Map();

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk;
  while (true) {
    const newline = stdoutBuffer.indexOf('\n');
    if (newline < 0) break;
    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failPending(new Error('Bridge wrote non-JSON data to stdout: ' + line));
      continue;
    }
    const item = pending.get(message.id);
    if (!item) continue;
    clearTimeout(item.timer);
    pending.delete(message.id);
    item.resolve(message);
  }
});
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16_000); });
child.on('error', failPending);
child.on('exit', (code, signal) => {
  failPending(new Error('Bridge exited before replying (code=' + code + ', signal=' + signal + ')'));
});

function failPending(error) {
  for (const [id, item] of pending) {
    clearTimeout(item.timer);
    pending.delete(id);
    item.reject(error);
  }
}

function request(method, params = {}, requestTimeoutMs = 15_000) {
  const id = nextId++;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error('Timed out waiting for MCP ' + method));
    }, requestTimeoutMs);
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(method, params = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

function requireSuccess(response, label) {
  if (response.error) throw new Error(label + ': ' + response.error.message);
  const result = response.result;
  const text = result?.content?.find((item) => item.type === 'text')?.text ?? '';
  if (result?.isError) throw new Error(label + ': ' + text);
  return text;
}

async function stopBridge() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill('SIGTERM');
  let timer;
  await Promise.race([exited, new Promise((resolveStop) => { timer = setTimeout(resolveStop, 5_000); })]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

try {
  const initialized = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'alethia-mcp-smoke', version: '1.0.0' },
  });
  assert.equal(initialized.result?.serverInfo?.name, '@vitronai/alethia');
  notify('notifications/initialized');

  const listed = await request('tools/list');
  const tools = listed.result?.tools?.map((tool) => tool.name) ?? [];
  assert.ok(tools.includes('alethia_serve_demo'), 'MCP server should expose alethia_serve_demo');
  assert.ok(tools.includes('alethia_tell'), 'MCP server should expose alethia_tell');

  const demoText = requireSuccess(
    await request('tools/call', { name: 'alethia_serve_demo', arguments: {} }),
    'Starting the bundled demo',
  );
  const demoUrl = demoText.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(demoUrl, 'Demo tool did not return a localhost URL: ' + demoText);

  const instructions = `navigate to ${demoUrl}/claude-code-app.html\nassert \"TaskFlow\" is visible`;
  const tellText = requireSuccess(
    await request('tools/call', {
      name: 'alethia_tell',
      arguments: { name: 'MCP bridge smoke', instructions },
    }, timeoutMs),
    'Running the Alethia MCP smoke flow',
  );
  const result = JSON.parse(tellText);
  const run = result.run && typeof result.run === 'object' ? result.run : result;
  assert.equal(run.ok, true, 'Alethia flow did not pass: ' + tellText);
  const steps = run.stepRuns ?? run.steps;
  assert.ok(Array.isArray(steps) && steps.length > 0, 'Smoke flow returned no step results');
  assert.ok(steps.every((step) => step.ok !== false), 'A smoke step failed: ' + tellText);

  console.log('PASS MCP initialize → tools/list → serve demo → tell (' + steps.length + ' steps)');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (stderr.trim()) console.error('\nBridge stderr:\n' + stderr.trim());
  process.exitCode = 1;
} finally {
  await stopBridge();
}
