/**
 * Builds real packages in the browser from the game's own files:
 *  - reads /motion-api/games/:id/play/index.html and inlines the local files it references;
 *  - single-file zips for itch.io and Douyin Interactive Space;
 *  - a Xiaohongshu zip with inline scripts moved into files;
 *  - playable ads per network (store button rewritten to the network CTA, network files added).
 * Every check result is measured on the file the user downloads.
 */
import { parse, type Literal, type Node } from 'acorn';
import { playableNetwork, type PlayableNetwork } from './playableNetworks';

export type GamePackageTarget = 'itch' | 'douyin' | 'xiaohongshu' | 'playable';

export interface GamePackageCheck {
  /** English source key. */
  label: string;
  /** English source key, translated with `vars`. */
  value: string;
  vars?: Record<string, string | number>;
  tone: 'ok' | 'warn' | 'fail';
}

export interface GamePackageResult {
  fileName: string;
  bytes: number;
  limitBytes?: number;
  checks: GamePackageCheck[];
  blob: Blob;
}

export interface LoadedGameHtml {
  html: string;
  /** Local files that were inlined. */
  inlined: number;
  /** Local references that could not be read. */
  missing: string[];
}

// ---- Zip (store, no compression) ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zip archive with stored (uncompressed) entries and UTF-8 names. */
export function zipStore(files: Array<{ name: string; data: Uint8Array | string }>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const entries = files.map(file => {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    return { name, data, crc: crc32(data) };
  });
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  for (const entry of entries) {
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, entry.crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, entry.name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), entry.name, entry.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, 0, true);
    dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, entry.crc, true);
    dir.setUint32(20, entry.data.length, true);
    dir.setUint32(24, entry.data.length, true);
    dir.setUint16(28, entry.name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), entry.name);
    offset += 30 + entry.name.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((sum, part) => sum + part.length, 0)));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// ---- Reading the game ----

const ASSET_REF = /(["'`(])((?:\.{1,2}\/)*[\w\-.]+(?:\/[\w\-.]+)*\.(?:png|jpe?g|gif|webp|svg|mp3|ogg|wav|m4a|json|woff2?|ttf|otf)(?:\?[^"'`()\s]*)?)(["'`)])/gi;
const MODULE_MAP = 'script[type="importmap"][data-game-package-modules]';
const MODULE_DATA_PREFIX = 'data:text/javascript;base64,';

/** Parse syntax, not text: comments, strings, regexes and template text are not imports. */
function moduleReferences(source: string): Array<{ start: number; end: number; ref: string }> {
  let program: Node;
  // A file that is not JavaScript (or uses syntax acorn does not know) keeps its text; it has no imports to follow.
  try { program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); } catch { return []; }
  const pending: Node[] = [program];
  const refs: Array<{ start: number; end: number; ref: string }> = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
      const literal = (node as Node & { source?: Literal }).source;
      if (literal?.type === 'Literal' && typeof literal.value === 'string') refs.push({ start: literal.start, end: literal.end, ref: literal.value });
    }
    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) if (child && typeof child === 'object' && typeof child.type === 'string') pending.push(child as Node);
    }
  }
  return refs.sort((a, b) => b.start - a.start);
}

const JSON_MODULE_DATA_PREFIX = 'data:application/json;base64,';

/** Where string and template text sit in a module, so paths written in comments are not treated as files. */
function stringRanges(source: string): Array<[number, number]> | null {
  let program: Node;
  try { program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); } catch { return null; }
  const ranges: Array<[number, number]> = [];
  const pending: Node[] = [program];
  while (pending.length) {
    const node = pending.pop()!;
    if ((node.type === 'Literal' && typeof (node as Literal).value === 'string') || node.type === 'TemplateElement') ranges.push([node.start, node.end]);
    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) if (child && typeof child === 'object' && typeof child.type === 'string') pending.push(child as Node);
    }
  }
  return ranges;
}

function encodeModule(source: string, id: string, json = false): string {
  // Distinct source URLs remain distinct modules even when their contents are identical.
  return (json ? JSON_MODULE_DATA_PREFIX : MODULE_DATA_PREFIX) + bytesToBase64(new TextEncoder().encode(source)) + `#${encodeURIComponent(id)}`;
}

function isJsonModuleUri(uri: string) { return uri.startsWith(JSON_MODULE_DATA_PREFIX); }

function decodeModule(uri: string): string {
  const prefix = isJsonModuleUri(uri) ? JSON_MODULE_DATA_PREFIX : MODULE_DATA_PREFIX;
  return new TextDecoder().decode(Uint8Array.from(atob(uri.slice(prefix.length).split('#')[0]), char => char.charCodeAt(0)));
}

/** Keep playable rewrites/checks aware of code that now lives inside data URLs. */
function mapEmbeddedModules(html: string, transform: (source: string) => string): string {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (tag, attrs: string, content: string) => {
    if (!/\bdata-game-package-modules(?:\s|=|$)/.test(attrs)) return tag;
    const map = JSON.parse(content) as { imports: Record<string, string> };
    for (const [id, uri] of Object.entries(map.imports)) if (!isJsonModuleUri(uri)) map.imports[id] = encodeModule(transform(decodeModule(uri)), id);
    return `<script${attrs}>${JSON.stringify(map)}</script>`;
  });
}

function isLocal(ref: string | null): ref is string {
  return Boolean(ref) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref!);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Reads the game's index.html and inlines the local files it references. */
export async function loadGameHtml(gameId: string, fetchImpl: typeof fetch = fetch): Promise<LoadedGameHtml> {
  const base = `/motion-api/games/${encodeURIComponent(gameId)}/play/`;
  const res = await fetchImpl(`${base}index.html`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read the game (${res.status})`);
  const source = await res.text();
  const pageUrl = new URL(`${base}index.html`, location.origin);
  const missing = new Set<string>();
  let inlined = 0;
  const fileName = (url: URL) => url.href.startsWith(new URL('.', pageUrl).href)
    ? url.href.slice(new URL('.', pageUrl).href.length) : url.href;
  const reads = new Map<string, Promise<Response | null>>();
  const read = (url: URL) => {
    // Fragments do not participate in HTTP requests; queries do.
    const request = new URL(url);
    request.hash = '';
    let result = reads.get(request.href);
    if (!result) {
      result = (async () => {
        try {
          const file = await fetchImpl(request.href);
          if (!file.ok) throw new Error(`HTTP ${file.status}`);
          // Buffer once so assets/modules shared by multiple references can reuse the response.
          const bytes = await file.arrayBuffer();
          inlined += 1;
          return new Response(bytes, { headers: file.headers });
        } catch {
          missing.add(fileName(request));
          return null;
        }
      })();
      reads.set(request.href, result);
    }
    return result;
  };
  const readText = async (ref: string, parent = pageUrl) => (await read(new URL(ref, parent)))?.clone().text() ?? null;
  const readDataUri = async (ref: string, parent = pageUrl) => {
    const file = (await read(new URL(ref, parent)))?.clone();
    if (!file) return null;
    const type = file.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    return `data:${type};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`;
  };
  const inlineAssets = async (text: string, parent = pageUrl, module = false) => {
    // In modules only paths inside strings count; a module acorn cannot read is scanned as plain text.
    const ranges = module ? stringRanges(text) : null;
    const matches = [...text.matchAll(ASSET_REF)].filter(match => !ranges
      || ranges.some(([start, end]) => match.index! >= start - 1 && match.index! + match[0].length <= end + 1));
    for (const match of matches.reverse()) {
      const uri = await readDataUri(match[2], parent);
      if (uri) text = text.slice(0, match.index) + match[1] + uri + match[3] + text.slice(match.index! + match[0].length);
    }
    return text;
  };

  const doc = new DOMParser().parseFromString(source, 'text/html');
  // Reserve identities before walking dependencies: cycles and shared imports keep native ESM semantics.
  let prefix = '@openmotion/game-package/';
  while (source.includes(prefix)) prefix += '_';
  const modules = new Map<string, { id: string; source: string; json: boolean }>();
  const rewriteModule = async (text: string, parent: URL): Promise<string> => {
    for (const { start, end, ref } of moduleReferences(text)) {
      // Bare specifiers (e.g. three) remain owned by the game's existing import map.
      if (!isLocal(ref) || !/^(?:\.{1,2}\/|\/)/.test(ref)) continue;
      const id = await addModule(new URL(ref, parent));
      text = text.slice(0, start) + JSON.stringify(id) + text.slice(end);
    }
    // Asset strings (image.src = 'assets/x.png') load against the page, not the module file.
    return inlineAssets(text, pageUrl, true);
  };
  const addModule = async (url: URL): Promise<string> => {
    const existing = modules.get(url.href);
    if (existing) return existing.id;
    const module = { id: `${prefix}${modules.size + 1}`, source: '', json: /\.json$/i.test(url.pathname) };
    modules.set(url.href, module);
    const text = await readText(url.href);
    // Missing files still get an identity so failed exports remain structurally inspectable.
    module.source = text == null ? '' : module.json ? text : await rewriteModule(text, url);
    return module.id;
  };
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    const src = script.getAttribute('src');
    if (script.getAttribute('type')?.toLowerCase() === 'module') {
      if (src && !isLocal(src)) continue;
      script.textContent = src
        ? `import ${JSON.stringify(await addModule(new URL(src, pageUrl)))};`
        : (await rewriteModule(script.textContent ?? '', pageUrl)).replace(/<\/script/gi, '<\\/script');
      script.removeAttribute('src');
      continue;
    }
    if (!isLocal(src)) continue;
    const text = await readText(src);
    if (text == null) continue;
    script.removeAttribute('src');
    script.textContent = text.replace(/<\/script/gi, '<\\/script');
  }
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href');
    if (!isLocal(href)) continue;
    const css = await readText(href);
    if (css == null) continue;
    const style = doc.createElement('style');
    style.textContent = css;
    link.replaceWith(style);
  }
  for (const element of Array.from(doc.querySelectorAll('img[src], audio[src], video[src], source[src], link[rel~="icon"][href]'))) {
    const attr = element.hasAttribute('src') ? 'src' : 'href';
    const ref = element.getAttribute(attr);
    if (!isLocal(ref)) continue;
    const uri = await readDataUri(ref);
    if (uri) element.setAttribute(attr, uri);
  }
  if (modules.size) {
    const map = doc.createElement('script');
    map.type = 'importmap';
    map.setAttribute('data-game-package-modules', '');
    map.textContent = JSON.stringify({ imports: Object.fromEntries([...modules.values()].map(module => [module.id, encodeModule(module.source, module.id, module.json)])) });
    // Import maps must precede every module entry, including entries in <head>.
    doc.head.prepend(map);
  }
  const html = await inlineAssets(`<!DOCTYPE html>\n${doc.documentElement.outerHTML}`);
  return { html, inlined, missing: [...missing] };
}

// ---- Playable ads ----

export interface PlayableBuildInput {
  html: string;
  network: PlayableNetwork;
  ios?: string;
  android?: string;
  orientation?: 'portrait' | 'landscape';
  /** Text of the download button added when the game has no store button of its own. */
  buttonText: string;
}

export interface PlayableRewrite {
  html: string;
  /** openStore / window.open calls routed to the network CTA. */
  rewrites: number;
  injectedButton: boolean;
}

const MRAID_REQUIRED = new Set(['mraid', 'applovin', 'liftoff']);
const GOOGLE_EXIT_API = 'https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js';

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
}

/** Routes the game's store button to the network CTA and adds the files the network asks for. */
export function rewritePlayableHtml(input: PlayableBuildInput): PlayableRewrite {
  const { network } = input;
  let rewrites = 0;
  const rewriteCalls = (source: string) => source
    .replace(/\bfunction\s+openStore\s*\(/g, () => { rewrites += 1; return 'function __omGameOpenStore('; })
    .replace(/\bwindow\.open\s*\(/g, () => { rewrites += 1; return 'window.__omCta('; });
  // In a module the declaration may be exported or imported elsewhere: keep the name and route it to the CTA.
  const rewriteModuleCalls = (source: string) => source
    .replace(/\b(async\s+)?function\s+openStore\s*\(/g, (_match, async = '') => { rewrites += 1; return `function openStore(){return window.__omCta();}\n${async}function __omGameOpenStore(`; })
    .replace(/\bwindow\.open\s*\(/g, () => { rewrites += 1; return 'window.__omCta('; });
  let html = rewriteCalls(mapEmbeddedModules(input.html, rewriteModuleCalls));

  const store = JSON.stringify({ ios: input.ios ?? '', android: input.android ?? '' }).replace(/</g, '\\u003c');
  const shim = `<script>(function(){var s=${store};window.__omStoreUrl=function(){return /android/i.test(navigator.userAgent)?(s.android||s.ios):(s.ios||s.android)};window.__omCta=function(){var url=window.__omStoreUrl();try{${network.ctaCode}}catch(e){}window.__omCtaCount=(window.__omCtaCount||0)+1;};window.openStore=function(){window.__omCta();};})();</script>`;
  const headParts: string[] = [];
  if (MRAID_REQUIRED.has(network.id)) headParts.push('<script src="mraid.js"></script>');
  if (network.id === 'google') {
    headParts.push(`<meta name="ad.orientation" content="${input.orientation ?? 'portrait'}">`);
    headParts.push(`<script type="text/javascript" src="${GOOGLE_EXIT_API}"></script>`);
  }
  headParts.push(shim);
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => `${match}${headParts.join('')}`) : `${headParts.join('')}${html}`;

  const injectedButton = rewrites === 0;
  if (injectedButton) {
    const button = `<button id="om-cta" type="button" style="position:fixed;left:50%;transform:translateX(-50%);bottom:max(48px,calc(env(safe-area-inset-bottom) + 36px));z-index:2147483647;min-height:44px;padding:12px 28px;border:0;border-radius:24px;font-weight:700" onclick="window.__omCta()">${escapeHtml(input.buttonText)}</button>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${button}</body>`) : `${html}${button}`;
  }
  return { html, rewrites, injectedButton };
}

function externalHosts(html: string, allowed: string[]): string[] {
  const hosts = new Set<string>();
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    if (allowed.includes(match[1])) continue;
    try { hosts.add(new URL(match[1]).host); } catch { hosts.add(match[1]); }
  }
  return [...hosts];
}

export function buildPlayable(loaded: LoadedGameHtml, input: Omit<PlayableBuildInput, 'html' | 'network'> & { networkName: string; slug: string }): GamePackageResult {
  const network = playableNetwork(input.networkName);
  if (!network) throw new Error('Unknown ad network');
  const rewrite = rewritePlayableHtml({ ...input, html: loaded.html, network });
  const html = rewrite.html;
  let inspectedSource = html;
  mapEmbeddedModules(html, source => { inspectedSource += `\n${source}`; return source; });
  const zipped = network.id === 'google' || network.id === 'tiktok';
  const files: Array<{ name: string; data: string }> = [{ name: 'index.html', data: html }];
  if (network.id === 'tiktok') files.push({ name: 'config.json', data: JSON.stringify({ playable_orientation: input.orientation === 'landscape' ? 2 : 1, playable_languages: ['zh', 'en'] }) });
  const data = zipped ? zipStore(files) : new TextEncoder().encode(html);
  const limitBytes = network.limitMb * 1024 * 1024;
  const hasMraidScript = /<script[^>]+src=["'][^"']*mraid\.js["']/i.test(html);
  const checks: GamePackageCheck[] = [
    { label: 'Package size', value: '{size} of {limit} MB', vars: { size: formatBytes(data.length), limit: network.limitMb }, tone: data.length <= limitBytes ? 'ok' : 'fail' },
    rewrite.injectedButton
      ? { label: 'Store button', value: 'The game had no store button; added one that calls {cta}', vars: { cta: network.cta }, tone: 'ok' }
      : { label: 'Store button', value: 'Routed {count} store call(s) to {cta}', vars: { count: rewrite.rewrites, cta: network.cta }, tone: 'ok' },
    { label: 'Store links', value: 'iOS: {ios} · Android: {android}', vars: { ios: input.ios || '—', android: input.android || '—' }, tone: input.ios && input.android ? 'ok' : 'warn' },
    loaded.missing.length
      ? { label: 'Local files', value: '{count} file(s) could not be read: {files}', vars: { count: loaded.missing.length, files: loaded.missing.join(', ') }, tone: 'fail' }
      : { label: 'Local files', value: 'Inlined {count} file(s) into the package', vars: { count: loaded.inlined }, tone: 'ok' },
  ];
  const external = externalHosts(html, network.id === 'google' ? [GOOGLE_EXIT_API] : []);
  checks.push(external.length
    ? { label: 'External resources', value: 'Still loads from {hosts}', vars: { hosts: external.join(', ') }, tone: 'fail' }
    : { label: 'External resources', value: network.id === 'google' ? 'None besides exitapi.js' : 'None', tone: 'ok' });
  if (MRAID_REQUIRED.has(network.id)) checks.push({ label: 'mraid.js', value: hasMraidScript ? 'Added as the first script' : 'Missing', tone: hasMraidScript ? 'ok' : 'fail' });
  else checks.push({ label: 'mraid.js', value: hasMraidScript ? 'Present, but this network does not allow it' : 'Not included', tone: hasMraidScript ? 'fail' : 'ok' });
  if (network.id === 'google') checks.push({ label: 'Google tags', value: 'Added ad.orientation and exitapi.js', tone: 'ok' });
  if (network.id === 'tiktok') {
    checks.push({ label: 'config.json', value: 'Included in the zip', tone: 'ok' });
    checks.push({ label: 'TikTok SDK', value: 'Not added; add it as the TikTok console asks', tone: 'warn' });
  }
  if (network.id === 'mintegral') {
    const hooks = ['gameReady', 'gameEnd', 'gameRetry'].filter(hook => !inspectedSource.includes(hook));
    checks.push(hooks.length
      ? { label: 'Mintegral hooks', value: 'Not called by the game: {hooks}', vars: { hooks: hooks.join(', ') }, tone: 'warn' }
      : { label: 'Mintegral hooks', value: 'gameReady, gameEnd and gameRetry are called', tone: 'ok' });
  }
  if (network.id === 'moloco') {
    const xhr = inspectedSource.includes('XMLHttpRequest');
    checks.push({ label: 'XMLHttpRequest', value: xhr ? 'Found; Moloco does not allow it' : 'Not used', tone: xhr ? 'fail' : 'ok' });
  }
  if (network.extra) checks.push({ label: 'Extra assets', value: '{asset} (upload it in the ad console)', vars: { asset: network.extra }, tone: 'warn' });
  const fileName = `${input.slug}-${network.id}.${zipped ? 'zip' : 'html'}`;
  return { fileName, bytes: data.length, limitBytes, checks, blob: new Blob([data], { type: zipped ? 'application/zip' : 'text/html' }) };
}

// ---- Platform zips ----

/** Moves inline scripts into files, as Xiaohongshu Mini Tools require. */
export function splitInlineScripts(html: string): { html: string; scripts: Array<{ name: string; data: string }>; inlineHandlers: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts: Array<{ name: string; data: string }> = [];
  const names = new Map<string, string>();
  const moduleSources = new Map<string, string>();
  for (const map of Array.from(doc.querySelectorAll(MODULE_MAP))) {
    const imports = JSON.parse(map.textContent ?? '{}').imports as Record<string, string>;
    for (const [id, uri] of Object.entries(imports)) {
      names.set(id, `./module-${names.size + 1}.${isJsonModuleUri(uri) ? 'json' : 'js'}`);
      moduleSources.set(id, decodeModule(uri));
    }
    // External import maps are not supported, and Xiaohongshu must not need inline maps.
    map.remove();
  }
  const rewriteImports = (source: string) => {
    for (const { start, end, ref } of moduleReferences(source)) {
      const name = names.get(ref);
      if (name) source = source.slice(0, start) + JSON.stringify(name) + source.slice(end);
    }
    return source;
  };
  for (const script of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const type = script.getAttribute('type');
    if (type && !/^(?:text\/javascript|module|application\/javascript)$/i.test(type)) continue;
    const name = `script-${scripts.length + 1}.js`;
    const source = script.textContent ?? '';
    scripts.push({ name, data: type?.toLowerCase() === 'module' ? rewriteImports(source) : source });
    script.textContent = '';
    script.setAttribute('src', name);
  }
  for (const [id, source] of moduleSources) scripts.push({ name: names.get(id)!.slice(2), data: rewriteImports(source) });
  const inlineHandlers = Array.from(doc.querySelectorAll('*')).reduce((sum, element) => sum + element.getAttributeNames().filter(name => /^on/i.test(name)).length, 0);
  return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, scripts, inlineHandlers };
}

const PLATFORM_LIMIT_MB: Partial<Record<GamePackageTarget, number>> = { douyin: 8, xiaohongshu: 8 };

export function buildPlatformZip(loaded: LoadedGameHtml, target: Exclude<GamePackageTarget, 'playable'>, slug: string): GamePackageResult {
  const checks: GamePackageCheck[] = [];
  let files: Array<{ name: string; data: string }> = [{ name: 'index.html', data: loaded.html }];
  if (target === 'xiaohongshu') {
    const split = splitInlineScripts(loaded.html);
    files = [{ name: 'index.html', data: split.html }, ...split.scripts];
    checks.push({ label: 'Inline scripts', value: 'Moved {count} script(s) into files', vars: { count: split.scripts.length }, tone: 'ok' });
    if (split.inlineHandlers) checks.push({ label: 'Inline event handlers', value: '{count} onclick-style attribute(s) left; Builder Hub may reject them', vars: { count: split.inlineHandlers }, tone: 'warn' });
    checks.push({ label: 'ES2017', value: 'Not converted; Builder Hub checks it on upload', tone: 'warn' });
  }
  const data = zipStore(files);
  const limitMb = PLATFORM_LIMIT_MB[target];
  checks.unshift(limitMb
    ? { label: 'Package size', value: '{size} of {limit} MB', vars: { size: formatBytes(data.length), limit: limitMb }, tone: data.length <= limitMb * 1024 * 1024 ? 'ok' : 'fail' }
    : { label: 'Package size', value: '{size}', vars: { size: formatBytes(data.length) }, tone: 'ok' });
  checks.splice(1, 0, { label: 'Entry', value: 'index.html at the root of the zip', tone: 'ok' });
  checks.push(loaded.missing.length
    ? { label: 'Local files', value: '{count} file(s) could not be read: {files}', vars: { count: loaded.missing.length, files: loaded.missing.join(', ') }, tone: 'fail' }
    : { label: 'Local files', value: 'Inlined {count} file(s) into the package', vars: { count: loaded.inlined }, tone: 'ok' });
  const external = externalHosts(loaded.html, []);
  checks.push(external.length
    ? { label: 'External resources', value: 'Still loads from {hosts}', vars: { hosts: external.join(', ') }, tone: target === 'itch' ? 'warn' : 'fail' }
    : { label: 'External resources', value: 'None', tone: 'ok' });
  return { fileName: `${slug}-${target}.zip`, bytes: data.length, limitBytes: limitMb ? limitMb * 1024 * 1024 : undefined, checks, blob: new Blob([data], { type: 'application/zip' }) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function gameSlug(title: string, gameId: string): string {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return ascii || `game-${gameId.slice(0, 8)}`;
}

/** Saves the package with the browser's download. */
export function downloadPackage(result: Pick<GamePackageResult, 'blob' | 'fileName'>) {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
