/**
 * Repository-agnostic product identity resolution.
 *
 * OpenMotion and OpenGame share identical source code; product identity is derived from the
 * distribution/runtime boundary rather than a hardcoded constant:
 *   Node:    OPENMOTION_PRODUCT env -> shared/build-info.json (`product`) -> GITHUB_REPOSITORY
 *            -> .git remote URL (origin, then upstream; supports git worktrees) -> 'openmotion'
 *   Browser: window.__OM_SOURCE_PRODUCT__ (injected by editor-server.ts) -> __OM_BUILD_PRODUCT__
 *            (defined by Vite from the Node resolver) -> 'openmotion'
 */
declare const __OM_BUILD_PRODUCT__: string | undefined;

export type ProductId = 'openmotion' | 'opengame';

const VALID_PRODUCTS = new Set<string>(['openmotion', 'opengame']);

export function parseProductId(value: unknown): ProductId | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return VALID_PRODUCTS.has(normalized) ? normalized as ProductId : undefined;
}

export function productIdFromRepositoryRef(value: string | null | undefined): ProductId | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withoutQueryOrHash = trimmed.split(/[?#]/, 1)[0] ?? '';
  const withoutTrailingSlash = withoutQueryOrHash.replace(/\/+$/, '');
  const withoutGitSuffix = withoutTrailingSlash.replace(/\.git$/i, '');
  const segment = withoutGitSuffix.split(/[/:]/).pop()?.trim().toLowerCase() ?? '';
  if (/^(?:agi-)?opengame$/.test(segment)) return 'opengame';
  if (/^(?:agi-)?openmotion$/.test(segment)) return 'openmotion';
  return undefined;
}

export function parseGitConfigRemoteUrls(configText: string): { origin?: string; upstream?: string } {
  const remotes: { origin?: string; upstream?: string } = {};
  let currentRemote: 'origin' | 'upstream' | undefined;
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      const match = /^\[remote\s+"([^"]+)"\]$/i.exec(line);
      const name = match?.[1]?.toLowerCase();
      currentRemote = name === 'origin' || name === 'upstream' ? name : undefined;
      continue;
    }
    if (!currentRemote) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim().toLowerCase();
    if (key !== 'url') continue;
    const url = line.slice(eqIndex + 1).trim();
    if (url && !remotes[currentRemote]) remotes[currentRemote] = url;
  }
  return remotes;
}

type NodeFsLike = {
  readFileSync(filePath: string, encoding: 'utf8'): string;
  statSync(filePath: string): { isDirectory(): boolean; isFile(): boolean };
};
type NodePathLike = {
  dirname(filePath: string): string;
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
};
type NodeUrlLike = {
  fileURLToPath(url: URL | string): string;
};
type NodeProcessLike = {
  env?: Record<string, string | undefined>;
  getBuiltinModule?: (specifier: string) => unknown;
};

function readNodeBuiltins(): { proc: NodeProcessLike; fs: NodeFsLike; path: NodePathLike; url: NodeUrlLike } | null {
  const proc = (globalThis as { process?: NodeProcessLike }).process;
  if (!proc || typeof proc.getBuiltinModule !== 'function') return null;
  const fs = proc.getBuiltinModule('node:fs') as NodeFsLike | undefined;
  const path = proc.getBuiltinModule('node:path') as NodePathLike | undefined;
  const url = proc.getBuiltinModule('node:url') as NodeUrlLike | undefined;
  if (!fs || !path || !url) return null;
  return { proc, fs, path, url };
}

function readGitConfigTexts(rootDir: string, fs: NodeFsLike, path: NodePathLike): string[] {
  const gitEntry = path.join(rootDir, '.git');
  let info: { isDirectory(): boolean; isFile(): boolean };
  try {
    info = fs.statSync(gitEntry);
  } catch {
    return [];
  }
  const candidates: string[] = [];
  if (info.isDirectory()) {
    candidates.push(path.join(gitEntry, 'config'));
  } else if (info.isFile()) {
    try {
      const pointer = fs.readFileSync(gitEntry, 'utf8');
      const match = /^gitdir:\s*(.+)$/im.exec(pointer);
      if (match?.[1]) {
        const gitDir = path.resolve(rootDir, match[1].trim());
        candidates.push(path.join(gitDir, 'config'));
        try {
          const commonDirRaw = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
          if (commonDirRaw) {
            candidates.push(path.join(path.resolve(gitDir, commonDirRaw), 'config'));
          }
        } catch { /* Standard non-worktree gitfile has no commondir. */ }
      }
    } catch { /* Ignore unreadable .git file. */ }
  }
  const contents: string[] = [];
  for (const configPath of candidates) {
    try {
      contents.push(fs.readFileSync(configPath, 'utf8'));
    } catch { /* Ignore missing config candidate. */ }
  }
  return contents;
}

export function resolveNodeProductId(options: {
  env?: Record<string, string | undefined>;
  rootDir?: string;
} = {}): ProductId {
  const builtins = readNodeBuiltins();
  const env = options.env ?? builtins?.proc.env ?? {};

  const fromEnv = parseProductId(env.OPENMOTION_PRODUCT);
  if (fromEnv) return fromEnv;

  const rootDir = options.rootDir
    ?? (builtins ? builtins.path.resolve(builtins.path.dirname(builtins.url.fileURLToPath(import.meta.url)), '..') : undefined);

  if (builtins && rootDir) {
    try {
      const buildInfo = JSON.parse(builtins.fs.readFileSync(builtins.path.join(rootDir, 'shared', 'build-info.json'), 'utf8')) as { product?: unknown };
      const fromBuildInfo = parseProductId(buildInfo?.product);
      if (fromBuildInfo) return fromBuildInfo;
    } catch { /* Build metadata is optional during local development. */ }
  }

  const fromGithubRepo = productIdFromRepositoryRef(env.GITHUB_REPOSITORY);
  if (fromGithubRepo) return fromGithubRepo;

  if (builtins && rootDir) {
    for (const configText of readGitConfigTexts(rootDir, builtins.fs, builtins.path)) {
      const remotes = parseGitConfigRemoteUrls(configText);
      const fromOrigin = productIdFromRepositoryRef(remotes.origin);
      if (fromOrigin) return fromOrigin;
      const fromUpstream = productIdFromRepositoryRef(remotes.upstream);
      if (fromUpstream) return fromUpstream;
    }
  }

  return 'openmotion';
}

let cachedNodeProductId: ProductId | undefined;

export function currentProductId(): ProductId {
  if (typeof window !== 'undefined') {
    const injected = parseProductId((globalThis as { __OM_SOURCE_PRODUCT__?: unknown }).__OM_SOURCE_PRODUCT__);
    if (injected) return injected;
    const fromBuild = typeof __OM_BUILD_PRODUCT__ !== 'undefined' ? parseProductId(__OM_BUILD_PRODUCT__) : undefined;
    if (fromBuild) return fromBuild;
    return 'openmotion';
  }
  const proc = (globalThis as { process?: NodeProcessLike }).process;
  const fromEnv = parseProductId(proc?.env?.OPENMOTION_PRODUCT);
  if (fromEnv) return fromEnv;
  if (!cachedNodeProductId) cachedNodeProductId = resolveNodeProductId();
  return cachedNodeProductId;
}

export const PRODUCT_ID: ProductId = currentProductId();
export const PRODUCT_UTM_SOURCE: ProductId = PRODUCT_ID;

export type MonetizationShortlinkTarget = 'd' | 'r' | 'p';
export type MonetizationModality = 'image' | 'video' | 'audio' | 'all';

export type MonetizationShortlinkInput = {
  target: MonetizationShortlinkTarget;
  entryId: string;
  product?: ProductId;
  channel?: string | null;
  host?: string | null;
  touchpoint?: string | null;
  studioId?: string | null;
  modality?: string | null;
};

export type DecodedMonetizationShortlink = {
  version: 'v1';
  target: MonetizationShortlinkTarget;
  entryId: string;
  product: ProductId;
  channel: string;
  host: string;
  touchpoint: string;
  studioId: string;
  modality: MonetizationModality;
  placementId: string;
  destinationUrl: string;
};

const SHORTLINK_ORIGIN = 'https://open-design.ai';
const SHORTLINK_PREFIX = `${SHORTLINK_ORIGIN}/t/`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL_DECODE = new Int16Array(128).fill(-1);
for (let i = 0; i < B64URL_ALPHABET.length; i++) {
  B64URL_DECODE[B64URL_ALPHABET.charCodeAt(i)] = i;
}

const VALID_MODALITIES = new Set<string>(['image', 'video', 'audio', 'all']);
const VALID_TARGETS = new Set<string>(['d', 'r', 'p']);
const SAFE_SHORTLINK_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (has1) out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (has2) out += B64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function base64UrlToBytes(input: string): Uint8Array | null {
  if (!input || input.length % 4 === 1) return null;
  const fullGroups = Math.floor(input.length / 4);
  const rem = input.length % 4;
  const byteLength = fullGroups * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(byteLength);
  let outIdx = 0;
  for (let i = 0; i < input.length; i += 4) {
    const c0 = input.charCodeAt(i);
    const c1 = input.charCodeAt(i + 1);
    const v0 = c0 < 128 ? B64URL_DECODE[c0] : -1;
    const v1 = c1 < 128 ? B64URL_DECODE[c1] : -1;
    if (v0 < 0 || v1 < 0) return null;
    const remaining = input.length - i;
    if (remaining === 2) {
      if ((v1 & 0x0f) !== 0) return null;
      out[outIdx++] = (v0 << 2) | (v1 >> 4);
      break;
    }
    const c2 = input.charCodeAt(i + 2);
    const v2 = c2 < 128 ? B64URL_DECODE[c2] : -1;
    if (v2 < 0) return null;
    if (remaining === 3) {
      if ((v2 & 0x03) !== 0) return null;
      out[outIdx++] = (v0 << 2) | (v1 >> 4);
      out[outIdx++] = ((v1 & 0x0f) << 4) | (v2 >> 2);
      break;
    }
    const c3 = input.charCodeAt(i + 3);
    const v3 = c3 < 128 ? B64URL_DECODE[c3] : -1;
    if (v3 < 0) return null;
    out[outIdx++] = (v0 << 2) | (v1 >> 4);
    out[outIdx++] = ((v1 & 0x0f) << 4) | (v2 >> 2);
    out[outIdx++] = ((v2 & 0x03) << 6) | v3;
  }
  return out;
}

function uuidToBase64Url(entryId: string): string {
  if (!UUID_PATTERN.test(entryId)) {
    throw new Error('INVALID_ENTRY_UUID');
  }
  const hex = entryId.replace(/-/g, '').toLowerCase();
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytesToBase64Url(bytes);
}

function base64UrlToUuid(encoded: string): string | null {
  if (encoded.length !== 22) return null;
  const bytes = base64UrlToBytes(encoded);
  if (!bytes || bytes.length !== 16) return null;
  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sanitizeSegment(raw: string | undefined | null, fallback: string, maxLength: number): string {
  const cleaned = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, maxLength)
    .replace(/[^a-z0-9]+$/g, '');
  return cleaned || fallback;
}

function normalizeModality(raw: string | undefined | null): MonetizationModality {
  const cleaned = (raw ?? '').trim().toLowerCase();
  return VALID_MODALITIES.has(cleaned) ? cleaned as MonetizationModality : 'all';
}

export function attributedEntryIdFor(product: ProductId, uuid: string): string {
  return product === 'openmotion' ? uuid : `${product}-${uuid}`;
}

export function attributedEntryId(uuid: string): string {
  return attributedEntryIdFor(currentProductId(), uuid);
}

export function buildPlacementId(
  channel?: string | null,
  hostOrSurface?: string | null,
  studioId?: string | null,
  modality?: string | null,
): string {
  const joined = [
    sanitizeSegment(channel, 'unknown', 31),
    sanitizeSegment(hostOrSurface, 'unknown', 31),
    sanitizeSegment(studioId, 'unknown', 31),
    sanitizeSegment(modality, 'all', 31),
  ].join('__');
  return joined.length <= 128 ? joined : joined.slice(0, 128).replace(/[^a-z0-9]+$/g, '');
}

export function cleanBillingUrl(target: MonetizationShortlinkTarget): string {
  if (target === 'd') return 'https://open-design.ai/cloud/dashboard?billing=plan';
  if (target === 'r') return 'https://open-design.ai/cloud/dashboard?billing=recharge';
  return 'https://open-design.ai/pricing/';
}

export function directAttributedBillingUrl(
  input: MonetizationShortlinkInput,
  nowIso: string = new Date().toISOString(),
): string {
  if (!VALID_TARGETS.has(input.target)) {
    throw new Error('INVALID_SHORTLINK_TARGET');
  }
  if (!UUID_PATTERN.test(input.entryId)) {
    throw new Error('INVALID_ENTRY_UUID');
  }
  const product: ProductId = input.product && VALID_PRODUCTS.has(input.product) ? input.product : currentProductId();
  const normalizedEntryId = input.entryId.toLowerCase();
  const url = new URL(cleanBillingUrl(input.target));
  url.searchParams.set('od_origin', product);
  url.searchParams.set('od_entry_id', attributedEntryIdFor(product, normalizedEntryId));
  url.searchParams.set('od_entry_source', sanitizeSegment(input.touchpoint, 'unknown', 64));
  url.searchParams.set('od_entry_at', nowIso);
  url.searchParams.set(
    'od_placement_id',
    buildPlacementId(input.channel, input.host, input.studioId, input.modality),
  );
  return url.toString();
}

export function encodeMonetizationShortlink(input: MonetizationShortlinkInput): string {
  if (!VALID_TARGETS.has(input.target)) {
    throw new Error('INVALID_SHORTLINK_TARGET');
  }
  const product: ProductId = input.product && VALID_PRODUCTS.has(input.product) ? input.product : currentProductId();
  const uuidB64Url = uuidToBase64Url(input.entryId);
  const channel = sanitizeSegment(input.channel, 'unknown', 31);
  const host = sanitizeSegment(input.host, 'unknown', 31);
  const touchpoint = sanitizeSegment(input.touchpoint, 'unknown', 64);
  const studioId = sanitizeSegment(input.studioId, 'unknown', 31);
  const modality = normalizeModality(input.modality);
  const plaintext = ['v1', input.target, uuidB64Url, product, channel, host, touchpoint, studioId, modality].join('|');
  const encoded = bytesToBase64Url(new TextEncoder().encode(plaintext));
  return `${SHORTLINK_PREFIX}${encoded}`;
}

export function decodeMonetizationShortlink(tokenOrUrl: string): DecodedMonetizationShortlink | null {
  if (typeof tokenOrUrl !== 'string' || !tokenOrUrl) return null;
  let token = tokenOrUrl;
  if (tokenOrUrl.startsWith('https://') || tokenOrUrl.startsWith('http://')) {
    try {
      const parsed = new URL(tokenOrUrl);
      if (parsed.origin !== SHORTLINK_ORIGIN || parsed.search || parsed.hash || !parsed.pathname.startsWith('/t/')) {
        return null;
      }
      token = parsed.pathname.slice(3);
      if (!token || token.includes('/')) return null;
    } catch {
      return null;
    }
  }
  const bytes = base64UrlToBytes(token);
  if (!bytes) return null;
  let plaintext: string;
  try {
    plaintext = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const parts = plaintext.split('|');
  if (parts.length !== 9) return null;
  const [version, target, uuidB64Url, product, channel, host, touchpoint, studioId, modality] = parts;
  if (version !== 'v1') return null;
  if (!VALID_TARGETS.has(target)) return null;
  const entryId = base64UrlToUuid(uuidB64Url);
  if (!entryId) return null;
  if (!VALID_PRODUCTS.has(product)) return null;
  if (!SAFE_SHORTLINK_SEGMENT.test(channel) || !SAFE_SHORTLINK_SEGMENT.test(host) || !SAFE_SHORTLINK_SEGMENT.test(touchpoint) || !SAFE_SHORTLINK_SEGMENT.test(studioId)) {
    return null;
  }
  if (!VALID_MODALITIES.has(modality)) return null;
  const typedTarget = target as MonetizationShortlinkTarget;
  return {
    version: 'v1',
    target: typedTarget,
    entryId,
    product: product as ProductId,
    channel,
    host,
    touchpoint,
    studioId,
    modality: modality as MonetizationModality,
    placementId: buildPlacementId(channel, host, studioId, modality),
    destinationUrl: cleanBillingUrl(typedTarget),
  };
}
