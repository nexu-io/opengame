// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildPlatformZip, buildPlayable, loadGameHtml, rewritePlayableHtml, splitInlineScripts, zipStore } from './gamePackage';
import { PLAYABLE_NETWORKS, playableNetwork } from './playableNetworks';

const GAME = '<!DOCTYPE html><html><head><title>t</title></head><body><button onclick="openStore(1)">x</button><script>function openStore(s){window.mraid&&mraid.open("a")}</script></body></html>';
const loaded = { html: GAME, inlined: 2, missing: [] };

function moduleFixture(absent?: string) {
  const files: Record<string, string> = {
    'index.html': '<html><head></head><body><script type="module" src="./client.js?v=1"></script></body></html>',
    'client.js?v=1': `import { value } from './logic.js'; import './art.js'; import './logic.js';
      window.moduleResult = value; window.lazyResult = import('./nested/lazy.js').then(m => m.lazy);
      window.open('https://store.example');`,
    'logic.js': `export { value } from './nested/value.js'; export * from './nested/extra.js';`,
    'art.js': `import './nested/value.js'; window.moduleAsset = 'assets/x.png';`,
    'nested/value.js': `import '../logic.js'; export const value = 42;`,
    'nested/extra.js': 'export const extra = 1;',
    'nested/lazy.js': `export { value as lazy } from '../nested/value.js';`,
    'assets/x.png': 'fake image',
  };
  const reads: string[] = [];
  const fetcher: typeof fetch = async input => {
    const path = String(input).split('/play/')[1];
    reads.push(path);
    if (path === absent) throw new TypeError('File unavailable');
    return path in files ? new Response(files[path], { headers: { 'content-type': path.endsWith('.png') ? 'image/png' : 'text/javascript' } }) : new Response('', { status: 404 });
  };
  return { files, reads, fetcher };
}

function embeddedModules(html: string): Record<string, string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imports = JSON.parse(doc.querySelector('script[type="importmap"]')!.textContent!).imports as Record<string, string>;
  return Object.fromEntries(Object.entries(imports).map(([id, url]) => [id, new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1].split('#')[0]), char => char.charCodeAt(0)))]));
}

async function unzip(blob: Blob): Promise<Record<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameSize = view.getUint16(at + 26, true);
    const extraSize = view.getUint16(at + 28, true);
    const start = at + 30 + nameSize + extraSize;
    files[decoder.decode(bytes.subarray(at + 30, at + 30 + nameSize))] = decoder.decode(bytes.subarray(start, start + size));
    at = start + size;
  }
  return files;
}

describe('gamePackage', () => {
  it('embeds the complete module graph, cycles, re-exports, literal dynamic imports and assets once', async () => {
    const fixture = moduleFixture();
    const result = await loadGameHtml('modules', fixture.fetcher);
    expect(result.missing).toEqual([]);
    const modules = Object.values(embeddedModules(result.html));
    expect(modules).toHaveLength(6);
    expect(modules.join('\n')).toContain('export const value = 42');
    expect(modules.join('\n')).toContain('data:image/png;base64,');
    expect(modules.join('\n')).not.toMatch(/["']\.{1,2}\/[^"']*\.js/);
    expect(result.html).not.toMatch(/src=["'][^"']*\.js/);
    expect(fixture.reads.filter(path => path === 'nested/value.js')).toHaveLength(1);
    expect(fixture.reads.filter(path => path === 'logic.js')).toHaveLength(1);
    expect(result.inlined).toBe(7);
  });

  it('paths written in module comments are not files to read', async () => {
    const fixture = moduleFixture();
    fixture.files['client.js?v=1'] = `// resource '../textures/texture.png' loads from a CDN
      /* see 'docs/example.png' */ window.icon = 'assets/x.png';`;
    const result = await loadGameHtml('modules', fixture.fetcher);
    expect(result.missing).toEqual([]);
    expect(fixture.reads).not.toContain('textures/texture.png');
    expect(Object.values(embeddedModules(result.html)).join('\n')).toContain('data:image/png;base64,');
  });

  it('asset strings in a nested module load against the page, as the browser does', async () => {
    const fixture = moduleFixture();
    fixture.files['client.js?v=1'] = `import './nested/main.js';`;
    fixture.files['nested/main.js'] = `window.icon = 'assets/x.png';`;
    fixture.files['nested/assets/x.png'] = 'wrong image';
    const result = await loadGameHtml('modules', fixture.fetcher);
    expect(fixture.reads).toContain('assets/x.png');
    expect(fixture.reads).not.toContain('nested/assets/x.png');
    expect(result.missing).toEqual([]);
  });

  it('an async openStore in a module stays async after the CTA rewrite', async () => {
    const fixture = moduleFixture();
    fixture.files['client.js?v=1'] = `export async function openStore() { await Promise.resolve(); window.open('https://store.example'); }`;
    const result = await loadGameHtml('modules', fixture.fetcher);
    const rewrite = rewritePlayableHtml({ html: result.html, network: playableNetwork('applovin')!, ios: 'https://apps.apple.com/app/id1' });
    const source = Object.values(embeddedModules(rewrite.html)).find(text => text.includes('__omGameOpenStore'))!;
    expect(source).toContain('export function openStore(){return window.__omCta();}');
    expect(source).toContain('async function __omGameOpenStore(');
  });

  it('keeps JSON modules as JSON and does not fail on them', async () => {
    const fixture = moduleFixture();
    fixture.files['client.js?v=1'] = `import config from './config.json' with { type: 'json' }; window.speed = config.speed;`;
    fixture.files['config.json'] = '{"speed":3}';
    const result = await loadGameHtml('modules', fixture.fetcher);
    expect(result.missing).toEqual([]);
    const doc = new DOMParser().parseFromString(result.html, 'text/html');
    const imports = JSON.parse(doc.querySelector('script[type="importmap"]')!.textContent!).imports as Record<string, string>;
    const json = Object.values(imports).filter(uri => uri.startsWith('data:application/json;base64,'));
    expect(json).toHaveLength(1);
    expect(Object.values(embeddedModules(result.html))).toContain('{"speed":3}');
    const zip = await unzip(buildPlatformZip(result, 'xiaohongshu', 'modules').blob);
    expect(Object.entries(zip).find(([name]) => name.endsWith('.json'))?.[1]).toBe('{"speed":3}');
  });

  it('a module that exports openStore keeps the export and routes it to the network CTA', async () => {
    const fixture = moduleFixture();
    fixture.files['client.js?v=1'] = `import { openStore } from './store.js'; window.tap = () => openStore();`;
    fixture.files['store.js'] = `export function openStore() { window.open('https://store.example'); }`;
    const result = await loadGameHtml('modules', fixture.fetcher);
    const rewrite = rewritePlayableHtml({ html: result.html, network: playableNetwork('applovin')!, ios: 'https://apps.apple.com/app/id1' });
    const store = Object.values(embeddedModules(rewrite.html)).find(source => source.includes('__omGameOpenStore'))!;
    expect(store).toContain('export function openStore(){return window.__omCta();}');
    expect(store).not.toContain('window.open(');
  });

  it('handles inline entries, URL normalization, queries and identical modules without matching import-like text', async () => {
    const fixture = moduleFixture();
    fixture.files['index.html'] = `<html><head><script type="module">import './nested/../logic.js'; import './duplicate.js?v=1'; import './duplicate.js?v=2';</script></head>
      <body><script type="module" src="./logic.js"></script><script src="classic.js"></script></body></html>`;
    fixture.files['duplicate.js?v=1'] = fixture.files['duplicate.js?v=2'] = `window.executions = (window.executions || 0) + 1;
      const text = "import './not-a-module.js'"; const template = \`export * from './also-not-a-module.js'\`;
      // import './comment.js';
      /* export { x } from './comment-export.js'; */
      window.unicode = '游戏';`;
    fixture.files['classic.js'] = 'window.classic = true;';
    const result = await loadGameHtml('modules', fixture.fetcher);
    expect(result.missing).toEqual([]);
    const doc = new DOMParser().parseFromString(result.html, 'text/html');
    const imports = JSON.parse(doc.querySelector('script[type="importmap"]')!.textContent!).imports;
    expect(new Set(Object.values(imports)).size).toBe(Object.keys(imports).length);
    expect(Object.values(embeddedModules(result.html)).join('\n')).toContain("window.unicode = '游戏'");
    expect(fixture.reads.filter(path => path === 'logic.js')).toHaveLength(1);
    expect(fixture.reads).toContain('duplicate.js?v=1');
    expect(fixture.reads).toContain('duplicate.js?v=2');
    expect(doc.head.firstElementChild?.getAttribute('type')).toBe('importmap');
    expect(result.html).toContain('window.classic = true;');
  });

  it('reports HTTP errors and lists every missing module in both Local files checks', async () => {
    const fixture = moduleFixture();
    fixture.files['client.js?v=1'] = `import './a.js'; import './b.js'; import './c.js'; import './d.js'; import './a.js';`;
    const result = await loadGameHtml('modules', fixture.fetcher);
    expect(result.missing.sort()).toEqual(['a.js', 'b.js', 'c.js', 'd.js']);
    expect(fixture.reads.filter(path => path === 'a.js')).toHaveLength(1);
    for (const pkg of [buildPlatformZip(result, 'itch', 'g'), buildPlayable(result, { networkName: 'meta', slug: 'g', buttonText: 'Download' })]) {
      expect(pkg.checks.find(check => check.label === 'Local files')).toMatchObject({ tone: 'fail', vars: { count: 4, files: 'a.js, b.js, c.js, d.js' } });
    }
  });

  it('inlines resources named in nested modules (page-relative, as the browser loads them) before encoding', async () => {
    const fixture = moduleFixture();
    fixture.files['nested/extra.js'] = `export const image = 'assets/x.png';`;
    const result = await loadGameHtml('modules', fixture.fetcher);
    expect(result.missing).toEqual([]);
    expect(Object.values(embeddedModules(result.html)).join('\n')).toContain('export const image = \'data:image/png;base64,');
    expect(fixture.reads.filter(path => path === 'assets/x.png')).toHaveLength(1);
  });

  it('reports failed module reads in missing and fails Local files for every export path', async () => {
    const result = await loadGameHtml('modules', moduleFixture('nested/value.js').fetcher);
    expect(result.missing).toEqual(['nested/value.js']);
    const packages = [
      ...(['itch', 'douyin', 'xiaohongshu'] as const).map(target => buildPlatformZip(result, target, 'g')),
      ...PLAYABLE_NETWORKS.map(network => buildPlayable(result, { networkName: network.id, slug: 'g', buttonText: 'Download' })),
    ];
    for (const pkg of packages) expect(pkg.checks).toContainEqual(expect.objectContaining({ label: 'Local files', tone: 'fail', vars: { count: 1, files: 'nested/value.js' } }));
  });

  it('packs every Xiaohongshu module as a real file with resolvable imports and no inline importmap', async () => {
    const result = await loadGameHtml('modules', moduleFixture().fetcher);
    const files = await unzip(buildPlatformZip(result, 'xiaohongshu', 'g').blob);
    const doc = new DOMParser().parseFromString(files['index.html'], 'text/html');
    expect(doc.querySelector('script[type="importmap"]')).toBeNull();
    expect(doc.querySelectorAll('script:not([src])')).toHaveLength(0);
    expect(doc.querySelector('script[type="module"]')).not.toBeNull();
    const pending = Array.from(doc.querySelectorAll('script[src]')).map(script => script.getAttribute('src')!);
    const visited = new Set<string>();
    while (pending.length) {
      const name = pending.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      expect(files[name], name).toBeDefined();
      expect(files[name]).not.toContain('data:text/javascript');
      for (const match of files[name].matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
        const dependency = new URL(match[1], `https://package.test/${name}`);
        pending.push(dependency.pathname.slice(1));
      }
    }
    expect(visited.size).toBe(7); // Entry wrapper and six shared modules.
    expect(Object.values(files).join('\n')).toContain('data:image/png;base64,');
  });

  it('preserves embedded modules in itch, Douyin and all playable networks, including CTA rewrites', async () => {
    const result = await loadGameHtml('modules', moduleFixture().fetcher);
    for (const target of ['itch', 'douyin'] as const) {
      const files = await unzip(buildPlatformZip(result, target, 'g').blob);
      expect(Object.keys(files)).toEqual(['index.html']);
      expect(embeddedModules(files['index.html'])).toEqual(embeddedModules(result.html));
    }
    for (const network of PLAYABLE_NETWORKS) {
      const pkg = buildPlayable(result, { networkName: network.id, slug: 'g', buttonText: 'Download' });
      const html = pkg.fileName.endsWith('.zip') ? (await unzip(pkg.blob))['index.html'] : await pkg.blob.text();
      const modules = Object.values(embeddedModules(html));
      expect(modules).toHaveLength(6);
      expect(modules.join('\n')).toContain('window.__omCta(');
      expect(modules.join('\n')).not.toContain('window.open(');
    }
  });
  it('writes a valid stored zip', () => {
    const zip = zipStore([{ name: 'index.html', data: 'hello' }, { name: 'config.json', data: '{}' }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(2);
    // CRC-32 of "hello"
    expect(view.getUint32(14, true)).toBe(0x3610a686);
  });

  it('routes the store button to each network CTA', () => {
    for (const network of PLAYABLE_NETWORKS) {
      const { html, rewrites, injectedButton } = rewritePlayableHtml({ html: GAME, network, ios: 'https://apps.apple.com/app/id1', buttonText: 'Download' });
      expect(rewrites).toBe(1);
      expect(injectedButton).toBe(false);
      expect(html).toContain(network.ctaCode);
      expect(html).not.toContain('function openStore(');
      const hasMraid = html.includes('<script src="mraid.js"></script>');
      expect(hasMraid).toBe(['mraid', 'applovin', 'liftoff'].includes(network.id));
    }
  });

  it('adds a store button when the game has none', () => {
    const { html, injectedButton } = rewritePlayableHtml({ html: '<html><head></head><body></body></html>', network: playableNetwork('meta')!, buttonText: 'Download' });
    expect(injectedButton).toBe(true);
    expect(html).toContain('id="om-cta"');
  });

  it('measures the real file and flags a package over the limit', () => {
    const big = { ...loaded, html: GAME.replace('<title>t</title>', `<title>${'x'.repeat(2.2 * 1024 * 1024)}</title>`) };
    const meta = buildPlayable(big, { networkName: 'Meta (≤2 MB)', slug: 'g', ios: 'https://a', android: 'https://b', buttonText: 'Download' });
    expect(meta.checks[0]).toMatchObject({ label: 'Package size', tone: 'fail' });
    expect(meta.bytes).toBe(meta.blob.size);
    const tiktok = buildPlayable(loaded, { networkName: 'TikTok / Pangle', slug: 'g', ios: 'https://a', buttonText: 'Download' });
    expect(tiktok.fileName).toBe('g-tiktok.zip');
    expect(tiktok.checks.find(check => check.label === 'config.json')?.tone).toBe('ok');
  });

  it('moves inline scripts into files for Xiaohongshu and counts inline handlers', () => {
    const split = splitInlineScripts(GAME);
    expect(split.scripts).toHaveLength(1);
    expect(split.html).toContain('src="script-1.js"');
    expect(split.inlineHandlers).toBe(1);
    const zip = buildPlatformZip(loaded, 'douyin', 'g');
    expect(zip.limitBytes).toBe(8 * 1024 * 1024);
    expect(zip.checks[0]).toMatchObject({ label: 'Package size', tone: 'ok' });
  });

  it.each(['xiaohongshu', 'douyin'] as const)('flags actual %s archives exceeding 8 MB', target => {
    const normal = buildPlatformZip(loaded, target, 'g');
    expect(normal.limitBytes).toBe(8 * 1024 * 1024);
    // Multi-byte text and ZIP entry headers count towards the downloaded size.
    const oversized = buildPlatformZip({ ...loaded, html: `<html><body>${'月'.repeat(3 * 1024 * 1024)}</body></html>` }, target, 'g');
    expect(oversized.bytes).toBe(oversized.blob.size);
    expect(oversized.bytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(oversized.checks[0]).toMatchObject({ label: 'Package size', tone: 'fail' });
  });

  it('inlines the actual local game scripts, styles and images and reports missing files', async () => {
    const source = '<html><head><link rel="stylesheet" href="style.css"></head><body><img src="assets/icon.svg"><script src="client.js"></script><audio src="missing.mp3"></audio></body></html>';
    const files: Record<string, [string, string]> = {
      'index.html': [source, 'text/html'],
      'style.css': ['canvas { display: block; }', 'text/css'],
      'client.js': ['window.gameLoaded = true;', 'text/javascript'],
      'assets/icon.svg': ['<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
    };
    const result = await loadGameHtml('game-id', async input => {
      const file = String(input).split('/play/')[1];
      const value = files[file];
      return value ? new Response(value[0], { headers: { 'content-type': value[1] } }) : new Response('', { status: 404 });
    });
    expect(result.inlined).toBe(3);
    expect(result.missing).toEqual(['missing.mp3']);
    expect(result.html).toContain('<style>canvas { display: block; }</style>');
    expect(result.html).toContain('window.gameLoaded = true;');
    expect(result.html).toContain('data:image/svg+xml;base64,');
    expect(result.html).not.toContain('src="client.js"');
    expect(buildPlatformZip(result, 'itch', 'g').checks).toContainEqual(expect.objectContaining({ label: 'Local files', tone: 'fail' }));
  });
});
