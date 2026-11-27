import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';

const failure = (code, message) => Object.assign(new Error(message), { code });

export function redact(message, environment = process.env) {
  let text = String(message ?? '');
  for (const [key, value] of Object.entries(environment)) {
    if (/token|secret|password|authorization|api.?key/i.test(key) && typeof value === 'string' && value.length >= 4) {
      text = text.replaceAll(value, '[redacted]');
    }
  }
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/([\w-]*(?:token|secret|password|authorization|api.?key)[\w-]*["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
    .slice(-1500);
}

export function validateOpenGameTransport(config) {
  if (!config) throw failure('MCP_NOT_REGISTERED', 'OpenGame MCP is not registered in this host. Run opengame setup for the selected host.');
  if (config.enabled === false) throw failure('MCP_DISABLED', 'OpenGame MCP is disabled. Enable it in the selected host before reconnecting.');
  if (config.transport?.type !== 'stdio') throw failure('MCP_CONFIG_INVALID', 'OpenGame requires a local stdio MCP connection.');
  const transport = config.transport;
  if (transport.cwd != null && typeof transport.cwd !== 'string') throw failure('MCP_CONFIG_INVALID', 'MCP working directory must be a string.');
  if (transport.env != null && (typeof transport.env !== 'object' || Array.isArray(transport.env) || Object.values(transport.env).some(value => typeof value !== 'string'))) {
    throw failure('MCP_CONFIG_INVALID', 'MCP environment overrides must contain string values.');
  }
  if (JSON.stringify([transport.command, transport.cwd, transport.args]).includes('${')) {
    throw failure('MCP_CONFIG_INVALID', 'The resolved MCP command contains an unexpanded placeholder. Fix the host configuration.');
  }
  if (typeof transport.command !== 'string' || !transport.command || !Array.isArray(transport.args) || transport.args.some(arg => typeof arg !== 'string')) {
    throw failure('MCP_CONFIG_INVALID', 'MCP requires an executable command and string arguments.');
  }
  if (transport.cwd && (!path.isAbsolute(transport.cwd) || !fs.existsSync(transport.cwd) || !fs.statSync(transport.cwd).isDirectory())) {
    throw failure('MCP_CONFIG_INVALID', 'The resolved MCP working directory does not exist or is not absolute.');
  }
  return transport;
}

export function checkOpenGameTransport(config, expectedVersion, { expectedTools, verifyResourceUri = 'openmotion://workflow/game/start', verifyGameId = null, timeoutMs = 20_000, env: extraEnv = {} } = {}) {
  const transport = validateOpenGameTransport(config);
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'opengame-install-check', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ];
  if (verifyResourceUri) {
    messages.push({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: verifyResourceUri } });
  }
  if (verifyGameId) {
    messages.push({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'opengame_get', arguments: { id: verifyGameId }, _meta: { 'openmotion/internalProbe': true } } });
  }
  const environment = { ...process.env, OPENMOTION_TELEMETRY: '0', OPENGAME_AUTO_UPDATE: '0', ...(transport.env || {}), ...extraEnv };
  const result = spawnSync(transport.command, transport.args, {
    cwd: transport.cwd, env: environment, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024,
    input: messages.map(message => JSON.stringify(message)).join('\n') + '\n',
  });
  if (result.error || result.status !== 0) {
    throw failure(result.error?.code === 'ETIMEDOUT' ? 'MCP_PROBE_TIMEOUT' : 'MCP_STARTUP_FAILED',
      'MCP probe failed: ' + redact(result.error?.message || result.stderr || `exit ${result.status}`, environment));
  }
  let responses;
  try {
    responses = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (responses.some(response => !response || response.jsonrpc !== '2.0')) throw new Error('Invalid MCP response');
  } catch {
    throw failure('MCP_PROTOCOL_INVALID', 'MCP stdout contains invalid JSON. Keep diagnostic logs on stderr.');
  }
  const initialization = responses.find(response => response.id === 1)?.result;
  const listed = responses.find(response => response.id === 2)?.result?.tools;
  if (!initialization?.serverInfo) throw failure('MCP_INITIALIZATION_FAILED', 'The OpenGame MCP process did not complete initialization.');
  if (initialization.serverInfo.name !== 'opengame') {
    throw failure('MCP_SERVER_MISMATCH', `Expected MCP serverInfo.name "opengame", got "${initialization.serverInfo.name}".`);
  }
  if (expectedVersion && initialization.serverInfo.version !== expectedVersion) {
    throw failure('MCP_VERSION_MISMATCH', `Expected OpenGame version ${expectedVersion}, got ${initialization.serverInfo.version}.`);
  }
  const names = Array.isArray(listed) ? listed.map(tool => tool?.name) : [];
  if (Array.isArray(expectedTools)) {
    if (names.length !== expectedTools.length || !expectedTools.every(name => names.includes(name))) {
      throw failure('MCP_TOOLS_MISMATCH', 'The OpenGame MCP tool list does not match the installed game profile.');
    }
  }
  if (verifyResourceUri) {
    const resource = responses.find(response => response.id === 3);
    if (!resource?.result?.contents?.[0]?.text || resource.error) {
      throw failure('MCP_RESOURCE_FAILED', `Resource read failed for ${verifyResourceUri}: ` + redact(JSON.stringify(resource?.error || 'empty'), environment));
    }
  }
  if (verifyGameId) {
    const read = responses.find(response => response.id === 4);
    if (!read?.result || read.error || read.result.isError) {
      throw failure('MCP_READ_FAILED', 'opengame_get probe failed: ' + redact(JSON.stringify(read?.error || read?.result?.structuredContent || read?.result?.content || 'No result'), environment));
    }
    if (read.result.structuredContent?.id !== verifyGameId) {
      throw failure('MCP_READ_MISMATCH', `opengame_get did not return expected game "${verifyGameId}".`);
    }
  }
  return { serverInfo: initialization.serverInfo, version: initialization.serverInfo.version, cwd: transport.cwd, tools: names };
}

function protocolClient(transport, env, timeout) {
  const child = spawn(transport.command, transport.args, { cwd: transport.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let seq = 0, stderr = '';
  const pending = new Map();
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const failPending = error => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  };
  child.on('error', failPending);
  child.on('close', code => failPending(new Error(`MCP exited ${code}: ${stderr}`)));
  child.stdin.on('error', failPending);
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const value = JSON.parse(line);
      if (value.jsonrpc !== '2.0') throw new Error('Invalid MCP response');
      pending.get(value.id)?.resolve(value);
    } catch (error) { failPending(error); }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed) return reject(new Error('MCP transport is closed'));
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out; an operation may still be running. ${stderr}`));
    }, timeout);
    pending.set(id, {
      reject, timer,
      resolve: reply => { clearTimeout(timer); pending.delete(id); reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply.result); },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { child, rpc };
}

export async function callInstalledOpenGameTool(state, connection, name, args = {}, timeout = 180_000) {
  assert(args && typeof args === 'object' && !Array.isArray(args), 'Tool arguments must be a JSON object');
  const transport = validateOpenGameTransport(connection);
  const appRoot = state.current?.appRoot || state.appRoot;
  const expectedVersion = state.current?.version || state.version;
  const expected = JSON.parse(await readFile(path.join(appRoot, 'shared/mcp-profiles.json'), 'utf8')).game.tools;
  const normalizedName = typeof name === 'string' && name.startsWith('openmotion_game_') ? 'opengame_' + name.slice(16) : name;
  const allowed = tool => (!connection.enabled_tools || connection.enabled_tools.includes(tool)) && !connection.disabled_tools?.includes(tool);
  assert(name === undefined || (expected.includes(normalizedName) && allowed(normalizedName)), 'MCP_TOOL_NOT_EXPOSED: ' + name);
  const env = { ...process.env, ...(transport.env || {}) };
  const { child, rpc } = protocolClient(transport, env, timeout);
  try {
    const hello = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'opengame-cli', version: '1' } });
    assert.equal(hello.serverInfo?.name, 'opengame', 'Installed MCP server identity mismatch');
    assert.equal(hello.serverInfo?.version, expectedVersion, 'Installed MCP version mismatch');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { tools } = await rpc('tools/list', {});
    assert(Array.isArray(tools) && tools.length === expected.length && expected.every(t => tools.some(tool => tool.name === t)), 'Installed OpenGame MCP tool contract mismatch');
    if (name === undefined) return { serverInfo: hello.serverInfo, dataDirectory: state.dataDirectory, tools: tools.filter(tool => allowed(tool.name)) };
    return await rpc('tools/call', { name, arguments: args });
  } catch (error) {
    throw new Error(redact(error.message, env));
  } finally {
    const timer = setTimeout(() => child.kill(), 2000);
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('close', resolve));
    clearTimeout(timer);
  }
}
