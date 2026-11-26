import { existsSync } from 'node:fs';

export const modernMcpVersion = '2026-07-28';
const protocolVersionKey = 'io.modelcontextprotocol/protocolVersion';

export function hasMcpEnvelope(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('params' in message)) return false;
  const params = message.params;
  if (!params || typeof params !== 'object' || !('_meta' in params)) return false;
  return Boolean(params._meta && typeof params._meta === 'object' && Object.hasOwn(params._meta, protocolVersionKey));
}

export type ModernMcpSdk = typeof import('./mcp-modern-sdk.ts');
const bundle = new URL('./mcp-modern-sdk.cjs', import.meta.url);
let sdk: Promise<ModernMcpSdk> | undefined;

export function loadModernMcpSdk(): Promise<ModernMcpSdk> {
  return sdk ??= existsSync(bundle)
    ? import(bundle.href).then(module => module.default)
    : import('./mcp-modern-sdk.ts');
}
