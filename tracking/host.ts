export const hostAgents = [
  'codex', 'claude', 'deepseek', 'cursor', 'opencode', 'gemini', 'workbuddy', 'chatgpt',
  'antigravity', 'hermes', 'qoder', 'trae', 'copilot',
  'kimi', 'qwen', 'pi', 'kiro', 'kilo', 'vibe', 'amp', 'devin', 'grok-build',
  'codebuddy', 'mimo', 'aider', 'atomcode', 'reasonix', 'openclaude', 'cline', 'bob',
  'other', 'unknown',
] as const;
export type HostContext = { host_agent: typeof hostAgents[number]; host_agent_source: 'mcp_client_info' | 'launch_environment' | 'unknown'; mcp_client_name?: string; mcp_client_version?: string };
export const unknownHost: HostContext = { host_agent: 'unknown', host_agent_source: 'unknown' };
const clientNames = /^[A-Za-z0-9_.-]{1,64}$/;
const versions = /^\d{1,6}(?:\.\d{1,6}){0,3}(?:[-+][A-Za-z0-9.-]{1,48})?$/;
const names: Record<string, HostContext['host_agent']> = {
  codex: 'codex', 'codex-mcp-client': 'codex', codex_cli_rs: 'codex', 'codex-local-openmotion': 'codex', 'codex-openmotion-local': 'codex', 'codex-openmotion-local-check': 'codex',
  'dsh-mcp-client': 'deepseek', 'dsh-mcp-probe': 'deepseek', dsh: 'deepseek', deepseek: 'deepseek', codewhale: 'deepseek', 'deepseek-harness': 'deepseek', 'dsh-probe': 'deepseek', 'dsh-agent': 'deepseek', 'dsh-export': 'deepseek', 'dsh-lead-mcp-bridge': 'deepseek',
  claude: 'claude', 'claude-code': 'claude', 'claude-ai': 'claude', 'claude-desktop': 'claude', 'claude-code-direct': 'claude', 'claude-code-stdio': 'claude',
  cursor: 'cursor', 'cursor-vscode': 'cursor', 'cursor-agent': 'cursor', opencode: 'opencode',
  gemini: 'gemini', 'gemini-cli': 'gemini', 'google-gemini-cli': 'gemini',
  workbuddy: 'workbuddy', 'workbuddy-desktop': 'workbuddy', 'workbuddy-cli': 'workbuddy', 'workbuddy-direct': 'workbuddy', 'workbuddy-verify': 'workbuddy', 'workbuddy-export': 'workbuddy', 'workbuddy-flow': 'workbuddy', 'workbuddy-agent': 'workbuddy', wb: 'workbuddy', 'wb-cli': 'workbuddy',
  chatgpt: 'chatgpt',
  antigravity: 'antigravity', 'antigravity-client': 'antigravity', agy: 'antigravity',
  hermes: 'hermes', 'hermes-agent': 'hermes', 'hermes-script': 'hermes',
  qoder: 'qoder', qodercli: 'qoder', qoderclicn: 'qoder', 'qoder-desktop-mcp-host': 'qoder',
  trae: 'trae', 'trae-cli': 'trae', traecli: 'trae',
  copilot: 'copilot', 'copilot-cli': 'copilot', 'github-copilot': 'copilot', 'vscode-agent-host': 'copilot',
  kimi: 'kimi', 'kimi-code': 'kimi', 'kimi-cli': 'kimi',
  qwen: 'qwen', 'qwen-code': 'qwen', 'qwen-cli': 'qwen',
  pi: 'pi',
  kiro: 'kiro', 'kiro-cli': 'kiro',
  kilo: 'kilo', 'kilo-code': 'kilo', kilocode: 'kilo',
  vibe: 'vibe', 'mistral-vibe': 'vibe',
  amp: 'amp',
  devin: 'devin',
  'grok-build': 'grok-build', grok: 'grok-build',
  codebuddy: 'codebuddy', 'codebuddy-code': 'codebuddy', 'codebuddy-cli': 'codebuddy',
  mimo: 'mimo', 'mimo-code': 'mimo',
  aider: 'aider',
  atomcode: 'atomcode',
  reasonix: 'reasonix',
  openclaude: 'openclaude',
  cline: 'cline',
  bob: 'bob',
};
// Clients whose declared `clientInfo.name` is a bridge or server-key placeholder rather than the true host product.
// For example, `openmotion-cli` bridges shell invocations and WorkBuddy desktop sends the MCP server key (`openmotion` / `opengame`).
const envFallbackClients = new Set(['openmotion-cli', 'om-cli', 'openmotion', 'opengame', 'opengame-cli']);

function normalizeClientName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Map a local Agent engine id (e.g. `deepseek-harness`, `cursor-agent`, `trae-cli`) onto the closed `hostAgents` enum. */
export function normalizeEngineToHostAgent(engine: unknown): HostContext['host_agent'] {
  if (typeof engine !== 'string' || !engine.trim()) return 'unknown';
  const normalized = normalizeClientName(engine);
  if (Object.hasOwn(names, normalized)) return names[normalized];
  if ((hostAgents as readonly string[]).includes(normalized)) return normalized as HostContext['host_agent'];
  return 'other';
}

function resolveEnvHost(env: Record<string, string | undefined>): HostContext['host_agent'] | undefined {
  const rawExplicit = env.OPENMOTION_HOST_AGENT;
  if (typeof rawExplicit === 'string' && rawExplicit.trim()) {
    const normalized = normalizeClientName(rawExplicit);
    if (Object.hasOwn(names, normalized)) return names[normalized];
    if ((hostAgents as readonly string[]).includes(normalized) && normalized !== 'other' && normalized !== 'unknown') {
      return normalized as HostContext['host_agent'];
    }
  }
  if (env.CODEX_THREAD_ID) return 'codex';
  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_SESSION_ID) return 'claude';
  if (env.CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS || env.WORKBUDDY_GPU_DEVICE_NAME) return 'workbuddy';
  if (env.DSH_WEB_URL) return 'deepseek';
  if (env.CURSOR_TRACE_ID || env.CURSOR_AGENT) return 'cursor';
  if (env.ANTIGRAVITY_AGENT) return 'antigravity';
  if (env.GEMINI_SESSION_ID || env.GEMINI_CLI) return 'gemini';
  if (env.OPENCODE || env.OPENCODE_CLIENT) return 'opencode';
  return undefined;
}

export function identifyHost(clientInfo: unknown, env: Record<string, string | undefined> = {}): HostContext {
  if (clientInfo && typeof clientInfo === 'object' && 'name' in clientInfo && typeof clientInfo.name === 'string' && clientInfo.name.trim().length) {
    const name = normalizeClientName(clientInfo.name), version = 'version' in clientInfo ? clientInfo.version : undefined;
    const nameField = clientNames.test(name) ? { mcp_client_name: name } : {};
    const versionField = typeof version === 'string' && versions.test(version) ? { mcp_client_version: version } : {};
    if (envFallbackClients.has(name)) {
      const bridged = resolveEnvHost(env);
      if (bridged) return { host_agent: bridged, host_agent_source: 'launch_environment', ...nameField, ...versionField };
    }
    return { host_agent: Object.hasOwn(names, name) ? names[name] : 'other', host_agent_source: 'mcp_client_info', ...nameField, ...versionField };
  }
  const explicit = env.OPENMOTION_HOST_AGENT;
  const agent = resolveEnvHost(env) ?? (explicit && (hostAgents as readonly string[]).includes(explicit) ? explicit as HostContext['host_agent'] : undefined);
  return agent ? { host_agent: agent, host_agent_source: 'launch_environment' } : { ...unknownHost };
}
export function validHostContext(raw: unknown): raw is HostContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const host = raw as HostContext;
  return Object.keys(raw).every(key => ['host_agent', 'host_agent_source', 'mcp_client_name', 'mcp_client_version'].includes(key))
    && (hostAgents as readonly unknown[]).includes(host.host_agent)
    && ['mcp_client_info', 'launch_environment', 'unknown'].includes(host.host_agent_source)
    && (host.mcp_client_name === undefined || typeof host.mcp_client_name === 'string' && clientNames.test(host.mcp_client_name))
    && (host.mcp_client_version === undefined || typeof host.mcp_client_version === 'string' && versions.test(host.mcp_client_version));
}

/** Attribute a page to its opening link, never the last Agent using a shared backend. */
export function previewTrackingContext(value: any, origin: string, token: string): any {
  if (Array.isArray(value)) return value.map(item => previewTrackingContext(item, origin, token));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (['previewUrl', 'sessionUrl', 'embeddedPreviewUrl', 'url'].includes(key) && typeof child === 'string') {
      try {
        const url = new URL(child);
        if (
          url.origin === origin
          && (
            url.pathname === '/'
            || url.pathname.startsWith('/sessions/')
            || url.pathname === '/settings'
            || url.pathname.startsWith('/settings/')
          )
        ) {
          url.searchParams.set('tracking_context', token); return [key, url.href];
        }
      } catch { /* Other handoff values are not URLs. */ }
    }
    return [key, ['previewHandoff', 'nextAction', 'codex', 'arguments', 'target'].includes(key)
      ? previewTrackingContext(child, origin, token) : child];
  }));
}
