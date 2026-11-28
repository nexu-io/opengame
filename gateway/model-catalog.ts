import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { CatalogModel } from '../shared/model-catalog.ts';
import { ToolInputError } from '../shared/tool-input-error.ts';
import type { SuperAgentChat } from '../shared/super-agent.ts';
import type { WorkspaceStore } from '../workspace.ts';
import { openTaskWorkspaceFile, resolveBrowsableRoots } from './super-agent-workspace.ts';

const api = 'https://3d.shep.bot/v1';
const modelId = /^polyhaven:[a-z0-9][a-z0-9_-]{0,100}$/i;
const directGlbId = /^(polyfork|threedassets|grab3d|blenderkit):([a-z0-9][a-z0-9_-]{0,180})$/;
const maxGlb = 48 * 1024 * 1024;
const maxBytes = 64 * 1024 * 1024;
const maxMetadata = 2 * 1024 * 1024;
const modelHosts = new Map([
  ['polyhaven', ['polyhaven.com', 'cdn.polyhaven.com']], ['gazebofuel', ['app.gazebosim.org', 'fuel.gazebosim.org']],
  ['wikimediacommons', ['commons.wikimedia.org', 'thumb.wikimedia.org']], ['opengameart', ['opengameart.org', 'opengameart.org']],
]);
const downloadHosts = new Set(['dl.polyhaven.org']);
const ogaId = /^opengameart:[a-z0-9][a-z0-9_-]{0,150}$/;
const ogaHost = new Set(['opengameart.org']);
const maxPng = 8 * 1024 * 1024;
type Dimension = '2d' | '3d';
type Kind = 'sprite' | 'ui' | 'model';
type Listing = CatalogModel & { dimension: Dimension; kind: Kind; author?: string };

export function catalogDimension(input: unknown): Dimension {
  if (input == null) return '3d';
  const value = typeof input === 'string' && input.trim().toLowerCase();
  if (value === '3d' || value === '2d') return value;
  throw new ToolInputError('Choose 2d or 3d', 'dimension', 'invalid_format');
}

export function catalogQuery(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input !== 'string' || input.length > 200) throw new ToolInputError('Supply a search query of up to 200 characters', 'query', 'invalid_format');
  return input.trim();
}

function publicUrl(input: unknown, hosts: Set<string>) {
  if (typeof input !== 'string' || input.length > 2048) return;
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && hosts.has(url.hostname)) return url.href;
  } catch { /* Ignore malformed provider links. */ }
}

async function bytes(url: string, limit: number, signal: AbortSignal) {
  const response = await fetch(url, { redirect: 'error', signal });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty catalog response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error('Catalog resource unavailable or too large');
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Catalog size limit exceeded');
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } finally { await reader.cancel(); }
}

async function metadata(url: string, signal: AbortSignal) {
  return JSON.parse((await bytes(url, maxMetadata, signal)).toString('utf8'));
}

function listingLinks(row: any, kind: Kind) {
  if (kind === 'model' && directGlbId.test(row.id)) {
    const [, provider, slug] = directGlbId.exec(row.id)!;
    if (row.provider !== provider) return [];
    let page: string, imageHost: string;
    if (provider === 'blenderkit') {
      page = `https://www.blendkit.com/asset-gallery-detail/${slug}/`;
      imageHost = 'public.blenderkit.com';
    } else if (provider === 'polyfork') {
      page = `https://polyfork.dev/asset/${slug}`;
      imageHost = 'polyfork.dev';
    } else if (provider === 'threedassets') {
      page = `https://3dassets.dev/assets/${slug}`;
      imageHost = 'cdn.3dassets.dev';
    } else {
      page = publicUrl(row.url, new Set(['grab3d.com'])) ?? '';
      if (!new RegExp(`^https://grab3d\\.com/models/[a-z0-9_-]+/${slug}/$`).test(page)) return [];
      imageHost = 'grab3d.com';
    }
    return row.url === page ? [page, publicUrl(row.thumbnailUrl, new Set([imageHost]))] : [];
  }
  if (kind === 'model') {
    const hosts = modelHosts.get(row.provider);
    if (!hosts || !row.id.startsWith(`${row.provider}:`)) return [];
    if (row.provider === 'polyhaven' && (!modelId.test(row.id) || row.url !== `https://polyhaven.com/a/${row.id.slice(10)}`)) return [];
    return [publicUrl(row.url, new Set([hosts[0]])), publicUrl(row.thumbnailUrl, new Set([hosts[1]]))];
  }
  const [provider, nativeId] = row.id.split(':');
  if (provider !== row.provider || row.id !== `${provider}:${nativeId}`) return [];
  let page: string;
  let images: Set<string>;
  if (provider === 'opengameart' && ogaId.test(row.id)) {
    page = `https://opengameart.org/content/${nativeId}`;
    images = ogaHost;
  } else if (provider === 'kenney' && /^[a-z0-9][a-z0-9-]*$/.test(nativeId)) {
    page = `https://kenney.nl/assets/${nativeId}`;
    images = new Set(['kenney.nl']);
  } else if (provider === 'itchio' && /^[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]*$/.test(nativeId)) {
    const [creator, slug] = nativeId.split('/');
    page = `https://${creator}.itch.io/${slug}`;
    images = new Set(['img.itch.zone']);
  } else return [];
  return row.url === page ? [page, publicUrl(row.thumbnailUrl, images)] : [];
}

interface CatalogSource { query: string; kind: Kind; offset: number; provider?: string; providerIds?: Set<string>; emptyWindow?: boolean }
interface CatalogState { sources: CatalogSource[]; pending: Listing[]; seen: Set<string> }
interface CatalogPage { models: Listing[]; nextCursor: string | null }
const modelProviders = ['polyhaven', 'polyfork', 'threedassets', 'grab3d', 'blenderkit', 'gazebofuel', 'wikimediacommons', 'opengameart'];
const imageProviders = ['opengameart', 'kenney', 'itchio'];

async function fetchModels(source: CatalogSource, limit: number) {
  const { query, kind, provider, offset } = source;
  const supported = kind === 'model' ? modelProviders : imageProviders;
  const params = new URLSearchParams({ q: query, type: kind, free: 'true', limit: String(limit), offset: String(offset), providers: provider ?? supported.join(',') });
  if (kind === 'model') params.set('downloadable', 'true');
  const data = await metadata(`${api}/search?${params}`, AbortSignal.timeout(25_000));
  if (!Array.isArray(data.results)) throw new Error('Invalid catalog search response');
  const models: Listing[] = [];
  const raw = data.results.slice(0, limit);
  for (const row of raw) {
    if (row?.type !== kind || row.price?.free !== true || typeof row.id !== 'string' || row.id.length > 256 || typeof row.title !== 'string' || typeof row.provider !== 'string') continue;
    const [sourceUrl, thumbnailUrl] = listingLinks(row, kind);
    if (!thumbnailUrl || !sourceUrl) continue;
    models.push({ id: row.id, title: row.title.slice(0, 200), provider: row.provider.slice(0, 80),
      thumbnailUrl, sourceUrl, kind, dimension: kind === 'model' ? '3d' : '2d',
      author: typeof row.author === 'string' ? row.author.slice(0, 200) : undefined,
      license: typeof row.license?.name === 'string' ? row.license.name.slice(0, 120) : undefined,
      downloadable: kind === 'model' && row.downloadable === true && Array.isArray(row.formats) && (
        (row.provider === 'polyhaven' && modelId.test(row.id) && row.formats.some((format: string) => ['gltf', 'glb'].includes(format))) ||
        (directGlbId.test(row.id) && row.formats.includes('glb'))),
    });
  }
  const sources: CatalogSource[] = [];
  const statuses = Array.isArray(data.providers) ? data.providers.filter((p: any) => supported.includes(p?.provider) && (!provider || p.provider === provider)) : [];
  if (statuses.length && statuses.every((p: any) => p.status === 'error')) throw new Error('Catalog provider unavailable');
  for (const p of statuses) {
    if (p.status !== 'ok' || !Number.isSafeInteger(p.count) || p.count < 0) continue;
    const ids: string[] = raw.filter((row: any) => row?.provider === p.provider && typeof row.id === 'string').map((row: any) => row.id);
    // The combined list may hide any part of a provider's window. Replay that entire
    // window with one provider selected, then deduplicate the already visible IDs.
    const clipped = !provider && p.count > ids.length;
    const nextOffset = clipped ? offset : offset + limit;
    const knownTotal = Number.isSafeInteger(p.total) && p.total >= 0;
    const more = clipped || (knownTotal ? nextOffset < p.total : p.count > 0);
    const repeated = ids.length ? source.providerIds && ids.every(id => source.providerIds!.has(id)) : source.emptyWindow;
    if (more && !repeated && (p.count > 0 || knownTotal && nextOffset < p.total)) {
      const providerIds = clipped ? undefined : new Set(source.providerIds);
      for (const id of ids) providerIds?.add(id);
      sources.push({ query, kind, provider: p.provider, offset: nextOffset, providerIds, emptyWindow: !clipped && !ids.length });
    }
  }
  return { models: models.sort((a, b) => Number(b.downloadable) - Number(a.downloadable)), sources };
}

const searches = new Map<string, Promise<CatalogPage>>();
const results = new Map<string, { page: CatalogPage; expiresAt: number }>();
interface Continuation { key: string; state?: CatalogState; page?: CatalogPage; expiresAt: number }
const continuations = new Map<string, Continuation>();

function topicsFor(query: string, dimension: Dimension): [string, Kind][] {
  if (dimension === '3d') return (query ? [query] : ['plant', 'building', 'character', 'vehicle']).map(q => [q, 'model']);
  if (!query) return [['sprite', 'sprite'], ['tileset', 'sprite'], ['effects', 'sprite'], ['icons', 'ui']];
  const ui = /\b(ui|hud|icons?|buttons?|cursors?|interfaces?|menus?)\b/i.test(query);
  const sprite = /\b(sprites?|tiles?(?:sets?)?|effects?|vfx|animations?|characters?)\b/i.test(query);
  if (ui !== sprite) return [[query, ui ? 'ui' : 'sprite']];
  return [[query, 'sprite'], [query, 'ui']];
}

async function browseModels(query: string, dimension: Dimension, key: string, initial?: CatalogState): Promise<CatalogPage> {
  const sources: CatalogSource[] = initial ? [...initial.sources] : topicsFor(query, dimension).map(([q, kind]) => ({ query: q, kind, offset: 0 }));
  const pending = initial ? [...initial.pending] : [];
  const seen = new Set(initial?.seen);
  if (pending.length < 24 && sources.length) {
    const batch = sources.splice(0, 4);
    const limit = !initial && !query ? 8 : 24;
    const fetched = await Promise.allSettled(batch.map(source => fetchModels(source, limit)));
    const shelves = fetched.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!shelves.length && !pending.length) throw new Error('Model catalog unavailable');
    for (let i = 0; i < Math.max(...shelves.map(shelf => shelf.sources.length)); i++) {
      for (const shelf of shelves) if (shelf.sources[i]) sources.push(shelf.sources[i]);
    }
    // A failed request keeps its original offset for retry on a later page.
    fetched.forEach((result, index) => { if (result.status === 'rejected') sources.push(batch[index]); });
    for (let i = 0; i < Math.max(...shelves.map(shelf => shelf.models.length)); i++) {
      for (const shelf of shelves) {
        const item = shelf.models[i];
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        pending.push(item);
      }
    }
  }
  const models = pending.splice(0, 24);
  if (dimension === '3d') {
    const candidates = models.filter(item => directGlbId.test(item.id) && item.downloadable);
    for (const item of candidates) item.downloadable = false;
    await Promise.all(candidates.slice(0, 8).map(async item => {
      try {
        const detail = await originalGlb(item.id, AbortSignal.timeout(8_000));
        if (detail.sourceUrl !== item.sourceUrl) return;
        item.downloadable = true;
        item.author = detail.author;
        item.license = detail.license.name;
      } catch { /* Keep the provider page available. */ }
    }));
    if (query) models.sort((a, b) => Number(b.downloadable) - Number(a.downloadable));
  }
  if (dimension === '2d') {
    // Verify a bounded set of candidates. Unverified listings keep their source links.
    await Promise.all(models.filter(item => ogaId.test(item.id)).slice(0, 4).map(async item => {
      try {
        const original = await originalPng(item.id, AbortSignal.timeout(8_000));
        item.downloadable = true;
        item.author = original.author ?? item.author;
        item.license = original.license.name;
      } catch { /* The listing can still be browsed at the provider. */ }
    }));
    if (query) models.sort((a, b) => Number(b.downloadable) - Number(a.downloadable));
  }
  const nextCursor = pending.length || sources.length ? randomUUID() : null;
  if (nextCursor) {
    if (continuations.size >= 256) continuations.delete(continuations.keys().next().value!);
    continuations.set(nextCursor, { key, state: { sources, pending, seen }, expiresAt: Date.now() + 30 * 60_000 });
  }
  return { models, nextCursor };
}

export async function searchModels(input: unknown, dimensionInput?: unknown, cursor?: unknown) {
  const query = catalogQuery(input);
  const dimension = catalogDimension(dimensionInput);
  const key = JSON.stringify([dimension, query]);
  let continuation: Continuation | undefined;
  if (cursor != null) {
    continuation = typeof cursor === 'string' ? continuations.get(cursor) : undefined;
    if (!continuation || continuation.key !== key || continuation.expiresAt <= Date.now()) throw new ToolInputError('Catalog cursor expired or invalid. Restart this search.', 'cursor', 'invalid_format');
    if (continuation.page) return continuation.page;
  } else {
    const cached = results.get(key);
    if (cached && cached.expiresAt > Date.now() && (!cached.page.nextCursor || continuations.has(cached.page.nextCursor))) return cached.page;
  }
  const requestKey = typeof cursor === 'string' ? cursor : key;
  const existing = searches.get(requestKey);
  if (existing) return existing;
  if (searches.size >= 8) throw new Error('Too many catalog searches in progress');
  const pending = browseModels(query, dimension, key, continuation?.state).then(result => {
    if (continuation) { continuation.page = result; delete continuation.state; }
    else {
      if (results.size >= 32) results.delete(results.keys().next().value!);
      results.set(key, { page: result, expiresAt: Date.now() + 60_000 });
    }
    return result;
  }).finally(() => searches.delete(requestKey));
  searches.set(requestKey, pending);
  return pending;
}

function localPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 220 && value.split('/').every(part => /^[a-z0-9_-][a-z0-9_.-]*$/i.test(part) && !part.endsWith('.') && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part));
}

interface ModelFile { path: string; url: string; size: number }

function modelFile(entry: any, name: unknown, primary: boolean): ModelFile {
  const url = publicUrl(entry?.url, downloadHosts);
  if (!localPath(name) || !(primary ? /^[^/]+\.(glb|gltf)$/i : /\.(bin|png|jpe?g|webp)$/i).test(name) || !url || !new URL(url).pathname.startsWith('/file/ph-assets/Models/') || basename(new URL(url).pathname) !== basename(name) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0 || entry.sizeBytes > 48 * 1024 * 1024) throw new Error('Invalid model file manifest or file size');
  return { path: name, url, size: entry.sizeBytes };
}

function verifyModel(main: ModelFile, body: Buffer, companions: ModelFile[]) {
  let json = body;
  let binarySize = 0;
  const glb = /\.glb$/i.test(main.path);
  if (glb) {
    if (body.length < 20 || body.toString('ascii', 0, 4) !== 'glTF' || body.readUInt32LE(4) !== 2 || body.readUInt32LE(8) !== body.length || body.toString('ascii', 16, 20) !== 'JSON') throw new Error('Invalid GLB header');
    const jsonSize = body.readUInt32LE(12);
    const end = 20 + jsonSize;
    if (end > body.length || jsonSize % 4) throw new Error('Invalid GLB JSON chunk');
    json = body.subarray(20, end);
    if (end !== body.length) {
      if (end + 8 > body.length || body.readUInt32LE(end + 4) !== 0x004e4942) throw new Error('Invalid GLB binary chunk');
      binarySize = body.readUInt32LE(end);
      if (binarySize % 4 || end + 8 + binarySize !== body.length) throw new Error('Invalid GLB binary length');
    }
  }
  if (json.length > 8 * 1024 * 1024) throw new Error('Model metadata too large');
  const doc = JSON.parse(json.toString('utf8'));
  if (doc?.asset?.version !== '2.0' || !Array.isArray(doc.meshes) || !doc.meshes.length || !Array.isArray(doc.buffers) || !doc.buffers.length) throw new Error('Invalid glTF model');
  const files = new Map(companions.map(file => [file.path, file]));
  const used = new Set<string>();
  // Reject unrecognized URI-bearing extensions as well as external buffer/image URLs.
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uri' || key === 'url') {
        if (!localPath(value) || !files.has(value)) throw new Error('Unlisted model resource');
        used.add(value);
      } else visit(value);
    }
  };
  visit(doc);
  if (!glb && doc.extensionsUsed?.some((name: string) => /draco|meshopt|basisu/i.test(name))) throw new Error('Unsupported model compression');
  if (!Array.isArray(doc.accessors) || !Array.isArray(doc.bufferViews) || !doc.meshes.every((mesh: any) => Array.isArray(mesh?.primitives) && mesh.primitives.length && mesh.primitives.every((p: any) => doc.accessors[p?.attributes?.POSITION]?.type === 'VEC3'))) throw new Error('Missing model geometry');
  for (const view of doc.bufferViews) {
    const offset = view.byteOffset ?? 0;
    if (!Number.isSafeInteger(view.buffer) || !doc.buffers[view.buffer] || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(view.byteLength) || view.byteLength <= 0 || offset + view.byteLength > doc.buffers[view.buffer].byteLength) throw new Error('Invalid model buffer view');
  }
  for (const accessor of doc.accessors) {
    if (!Number.isSafeInteger(accessor.count) || accessor.count <= 0 || accessor.count > 4_000_000) throw new Error('Invalid model accessor count');
  }
  for (const [index, buffer] of doc.buffers.entries()) {
    const size = buffer.uri === undefined && glb && index === 0 ? binarySize : files.get(buffer.uri)?.size;
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || size === undefined || buffer.byteLength > size || size - buffer.byteLength > (buffer.uri === undefined ? 3 : 0)) throw new Error('Invalid model buffer length');
  }
  if (used.size !== companions.length) throw new Error('Unreferenced files in model manifest');
}

function verifyTexture(name: string, data: Buffer) {
  if ((/\.jpe?g$/i.test(name) && !data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
      (/\.png$/i.test(name) && !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (/\.webp$/i.test(name) && (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP'))) throw new Error('Invalid model texture');
}

async function originalPng(id: string, signal: AbortSignal) {
  const detail = await metadata(`${api}/assets/${encodeURIComponent(id)}`, signal);
  const sourceUrl = `https://opengameart.org/content/${id.slice('opengameart:'.length)}`;
  if (detail?.id !== id || detail.provider !== 'opengameart' || !['sprite', 'ui'].includes(detail.type) || detail.url !== sourceUrl || detail.price?.free !== true || detail.downloadable !== true || !Array.isArray(detail.files) || detail.files.length !== 1) throw new Error('No supported single PNG download');
  const file = detail.files[0];
  const url = publicUrl(file?.url, ogaHost);
  const name = file?.filename;
  if (!url || !localPath(name) || !/^[^/]+\.png$/i.test(name) || url !== `https://opengameart.org/sites/default/files/${name}` || file.format !== 'png' || file.group !== 'files' || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > maxPng) throw new Error('Invalid original PNG manifest');
  const license = detail.license;
  if (typeof license?.name !== 'string' || !license.name.trim() || license.name.length > 120) throw new Error('Missing PNG license');
  return { sourceUrl, author: typeof detail.author === 'string' ? detail.author.slice(0, 200) : undefined,
    license: { name: license.name, url: publicUrl(license.url, new Set(['creativecommons.org', 'www.gnu.org', 'opengameart.org'])),
      commercialUse: typeof license.commercialUse === 'boolean' ? license.commercialUse : undefined,
      attributionRequired: typeof license.attributionRequired === 'boolean' ? license.attributionRequired : undefined },
    file: { path: name, url, sizeBytes: file.sizeBytes as number } };
}

function verifyPng(data: Buffer) {
  verifyTexture('original.png', data);
  if (data.length < 45 || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid PNG header');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) throw new Error('Unsupported PNG dimensions');
  let imageData = false;
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > data.length || crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw new Error('Invalid PNG chunk');
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT' && length) imageData = true;
    if (type === 'IEND' && !length && imageData && end === data.length) return;
    offset = end;
  }
  throw new Error('Incomplete PNG image');
}

async function pngBundle(id: string, signal: AbortSignal) {
  const { file, ...details } = await originalPng(id, signal);
  const body = await bytes(file.url, file.sizeBytes, signal);
  if (body.length !== file.sizeBytes) throw new Error('Incomplete PNG download');
  verifyPng(body);
  const provenance = Buffer.from(JSON.stringify({ id, provider: 'opengameart', ...details, files: [file] }, null, 2) + '\n');
  const hash = createHash('sha256').update(provenance).update(body).digest('hex');
  return { folder: `image-${hash.slice(0, 32)}`, name: file.path, contents: new Map([['provenance.json', provenance], [file.path, body]]) };
}

function glbFile(files: any, provider: string, slug: string, thumbnailUrl: string) {
  const entries = Array.isArray(files) ? files.filter(file => file?.format === 'glb' && (provider !== 'blenderkit' || file.group === 'gltf')) : [];
  const file = entries[0];
  if (entries.length !== 1 || (file.requiresAuth ?? false) !== false || (file.includes != null && !(Array.isArray(file.includes) && file.includes.length === 0))) throw new Error('No supported public GLB file');
  const name = file.filename;
  if (!localPath(name) || !(provider === 'blenderkit' ? /^[^/]+_gltf\.glb$/.test(name) : name === `${slug}.glb`)) throw new Error('Invalid GLB filename');
  let url: string, stableUrl: string | undefined;
  if (provider === 'blenderkit') {
    const assetKey = /^https:\/\/public\.blenderkit\.com\/thumbnails\/assets\/([a-f0-9]{32})\/files\//.exec(thumbnailUrl)?.[1];
    url = publicUrl(file.url, new Set(['assets.blendkit.com'])) ?? '';
    if (!url || !assetKey) throw new Error('Invalid GLB source');
    const link = new URL(url);
    if (!new RegExp(`^/assets/${assetKey}/files/gltf_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\\.glb$`).test(link.pathname) || link.hash || [...link.searchParams.keys()].some(key => key !== 'verify')) throw new Error('Invalid GLB download URL');
    stableUrl = link.origin + link.pathname;
  } else if (provider === 'threedassets') {
    // The numeric CDN asset and version are shared by the thumbnail and original.
    const match = /^https:\/\/cdn\.3dassets\.dev(\/assets\/\d+\/v\d+)\/thumb\.webp$/.exec(thumbnailUrl);
    if (!match) throw new Error('Invalid GLB source');
    url = `https://cdn.3dassets.dev${match[1]}/model.glb`;
  } else if (provider === 'polyfork') url = `https://polyfork.dev/cdn/${name}`;
  else url = `https://grab3d.com/dl/${slug}/${name}`;
  if (file.url !== url) throw new Error('Invalid GLB download URL');
  const size = file.sizeBytes;
  if (!(size === undefined && provider === 'polyfork') && (!Number.isSafeInteger(size) || size <= 0 || size > maxGlb)) throw new Error('Invalid GLB file size');
  return { path: name, url, stableUrl: stableUrl ?? url, size: size as number | undefined };
}

async function originalGlb(id: string, signal: AbortSignal) {
  const [, provider, slug] = directGlbId.exec(id)!;
  const detail = await metadata(`${api}/assets/${encodeURIComponent(id)}`, signal);
  if (detail?.id !== id || detail.provider !== provider || detail.nativeId !== slug || detail.type !== 'model' || detail.price?.free !== true || detail.downloadable !== true || !Array.isArray(detail.formats) || !detail.formats.includes('glb')) throw new Error('No supported free GLB download');
  const [sourceUrl, thumbnailUrl] = listingLinks(detail, 'model');
  if (!sourceUrl || !thumbnailUrl) throw new Error('Invalid GLB source');
  const license = detail.license;
  if (typeof license?.name !== 'string' || !license.name.trim() || license.name.length > 120) throw new Error('Missing GLB license');
  const file = glbFile(detail.files, provider, slug, thumbnailUrl);
  return { provider, slug, sourceUrl, thumbnailUrl, file, author: typeof detail.author === 'string' ? detail.author.slice(0, 200) : undefined,
    license: { name: license.name, url: publicUrl(license.url, new Set(['creativecommons.org', new URL(sourceUrl).hostname]))?.split(/[?#]/)[0],
      commercialUse: typeof license.commercialUse === 'boolean' ? license.commercialUse : undefined,
      attributionRequired: typeof license.attributionRequired === 'boolean' ? license.attributionRequired : undefined } };
}

async function directGlbBundle(id: string, signal: AbortSignal) {
  const { provider, slug, sourceUrl, thumbnailUrl, author, license, file } = await originalGlb(id, signal);
  const manifest = await metadata(`${api}/assets/${encodeURIComponent(id)}/files?format=glb`, signal);
  if (manifest?.id !== id || manifest.license?.name !== license.name) throw new Error('GLB manifest mismatch');
  const original = glbFile(manifest.files, provider, slug, thumbnailUrl);
  if (file.size !== original.size || file.path !== original.path || file.stableUrl !== original.stableUrl) throw new Error('GLB manifest mismatch');
  // Grab3D publishes a rounded estimate. The stream cap and GLB header bound the actual bytes.
  const exactSize = provider === 'grab3d' ? undefined : file.size;
  const body = await bytes(original.url, exactSize ?? maxGlb, signal);
  if (exactSize !== undefined && body.length !== exactSize) throw new Error('Incomplete GLB download');
  verifyModel({ ...file, size: body.length }, body, []);
  const provenance = Buffer.from(JSON.stringify({ id, provider, sourceUrl, author, license,
    files: [{ path: file.path, url: file.stableUrl, sizeBytes: body.length }] }, null, 2) + '\n');
  const hash = createHash('sha256').update(provenance).update(body).digest('hex');
  return { folder: `model-${hash.slice(0, 32)}`, name: file.path, contents: new Map([['provenance.json', provenance], [file.path, body]]) };
}

async function modelBundle(id: string, signal: AbortSignal) {
  if (directGlbId.test(id)) return directGlbBundle(id, signal);
  const detail = await metadata(`${api}/assets/${encodeURIComponent(id)}`, signal);
  const sourceUrl = `https://polyhaven.com/a/${id.slice('polyhaven:'.length)}`;
  if (detail?.id !== id || detail.provider !== 'polyhaven' || detail.url !== sourceUrl || detail.type !== 'model' || detail.price?.free !== true || detail.downloadable !== true) throw new Error('No supported free Poly Haven model');
  const manifest = await metadata(`${api}/assets/${encodeURIComponent(id)}/files?format=gltf&resolution=1k`, signal);
  const primary = Array.isArray(manifest.files) && manifest.files.find((file: any) => /\.(glb|gltf)$/i.test(file?.filename));
  if (manifest.id !== id || !primary || !Array.isArray(primary.includes ?? []) || (primary.includes?.length ?? 0) > 48) throw new Error('No supported model download');
  const main = modelFile(primary, primary.filename, true);
  const companions: ModelFile[] = (primary.includes ?? []).map((file: any) => modelFile(file, file?.path, false));
  const files = [main, ...companions];
  if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length || files.reduce((sum, file) => sum + file.size, 0) > maxBytes) throw new Error('Invalid model bundle size or duplicate paths');
  const contents = new Map<string, Buffer>();
  const hash = createHash('sha256');
  hash.update(id);
  const license = detail.license;
  if (typeof license?.name !== 'string' || !license.name.trim() || license.name.length > 120 || license.name !== manifest.license?.name) throw new Error('Missing or inconsistent model license');
  const provenance = Buffer.from(JSON.stringify({
    id, provider: 'polyhaven', sourceUrl,
    author: typeof detail.author === 'string' ? detail.author.slice(0, 200) : undefined,
    license: { name: license.name, url: publicUrl(license.url, new Set(['creativecommons.org'])),
      commercialUse: typeof license.commercialUse === 'boolean' ? license.commercialUse : undefined,
      attributionRequired: typeof license.attributionRequired === 'boolean' ? license.attributionRequired : undefined },
    files: files.map(file => ({ path: file.path, url: file.url, sizeBytes: file.size })),
  }, null, 2) + '\n');
  contents.set('provenance.json', provenance);
  hash.update(provenance);
  for (const file of files) {
    const body = await bytes(file.url, file.size, signal);
    if (body.length !== file.size) throw new Error('Incomplete model download');
    if (file === main) verifyModel(main, body, companions);
    else verifyTexture(file.path, body);
    contents.set(file.path, body);
    hash.update(JSON.stringify([file.path, file.size])).update(body);
  }
  const folder = `model-${hash.digest('hex').slice(0, 32)}`;
  return { folder, name: main.path, contents };
}

async function downloadModel(store: WorkspaceStore, chat: SuperAgentChat, id: string) {
  const roots = await resolveBrowsableRoots(store.directory, chat);
  const root = roots.find(item => item.key === (chat.workingDir ? `custom:${chat.workingDir}` : `workspace:${chat.id}`));
  if (!root) throw new Error('Conversation workspace unavailable');
  if (!chat.workingDir) await store.safePath(`super-agent/work/${chat.id}`, store.directory);
  const cwd = await realpath(root.dir);
  const signal = AbortSignal.timeout(60_000);
  const { contents, folder, name } = await (ogaId.test(id) ? pngBundle(id, signal) : modelBundle(id, signal));
  if (await realpath(root.dir) !== cwd) throw new Error('Conversation workspace changed during download');
  const stage = await mkdtemp(join(cwd, '.model-download-'));
  try {
    for (const [relative, body] of contents) {
      const filename = join(stage, relative);
      await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
      if (await realpath(dirname(filename)) !== dirname(filename)) throw new Error('Invalid model destination');
      await writeFile(filename, body, { flag: 'wx', mode: 0o600 });
    }
    try { await rename(stage, join(cwd, folder)); }
    catch (error) {
      if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      for (const [name, body] of contents) {
        const target = join(cwd, folder, name);
        if (await realpath(target) !== target) throw new Error('Invalid model destination');
        const existing = await openTaskWorkspaceFile([root], root.key, `${folder}/${name}`);
        try {
          if (existing.sizeBytes !== body.length || !(await existing.handle.readFile()).equals(body)) throw new Error('Existing model files have changed');
        } finally { await existing.handle.close(); }
      }
    }
    return `${folder}/${name}`;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

const downloads = new Map<string, Promise<string>>();

export function acquireCatalogFile(store: WorkspaceStore, chat: SuperAgentChat, id: unknown) {
  if (typeof id !== 'string' || !(modelId.test(id) || directGlbId.test(id) || ogaId.test(id))) throw new ToolInputError('Choose a downloadable catalog model or OpenGameArt PNG ID', 'id', 'invalid_format');
  const key = JSON.stringify([store.directory, chat.id, chat.workingDir, id]);
  const existing = downloads.get(key);
  if (existing) return existing;
  if (downloads.size >= 4) throw new Error('Too many model downloads in progress');
  const pending = downloadModel(store, chat, id).finally(() => downloads.delete(key));
  downloads.set(key, pending);
  return pending;
}
