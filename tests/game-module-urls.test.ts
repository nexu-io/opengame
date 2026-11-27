import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { GameProjects, gameHttp } from '../game-projects.ts';

async function fixture(t: TestContext, files: { path: string; content: string }[], entrySrc = './src/main.js', options: { baseHref?: string; inlineSource?: string } = {}) {
  const entry = (options.baseHref === undefined ? '' : `<base href="${options.baseHref}">`) + '<canvas></canvas>'
    + (entrySrc ? `<script type="module" src="${entrySrc}"></script>` : '')
    + (options.inlineSource ? `<script type="module">${options.inlineSource}</script>` : '');
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-module-urls-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  // HTML parsing is not under test: expose only the nodes authored above.
  // Exercise the real module parser, file resolution and public service.
  service.runtimeRoot = path.join(workspace, 'runtime');
  const packages = path.join(service.runtimeRoot, 'node_modules');
  await mkdir(path.join(packages, '@hyperframes/parsers'), { recursive: true });
  await mkdir(path.join(packages, 'linkedom'), { recursive: true });
  await writeFile(path.join(packages, '@hyperframes/parsers/package.json'), '{"name":"@hyperframes/parsers"}');
  await writeFile(path.join(packages, 'linkedom/package.json'), '{"name":"linkedom","main":"index.cjs"}');
  await writeFile(path.join(packages, 'linkedom/index.cjs'), `
    exports.parseHTML = source => {
      if (source !== ${JSON.stringify(entry)}) throw Error('Unexpected HTML fixture');
      const script = { localName: 'script', closest: () => null,
        getAttribute: name => ({ type: 'module', src: ${JSON.stringify(entrySrc)} })[name] ?? null };
      const inline = { localName: 'script', closest: () => null,
        getAttribute: name => name === 'type' ? 'module' : null, textContent: ${JSON.stringify(options.inlineSource ?? '')} };
      const baseHref = ${JSON.stringify(options.baseHref ?? null)};
      return { document: {
        querySelector: selector => selector === 'base[href]' && baseHref !== null ? { getAttribute: () => baseHref } : null,
        querySelectorAll: selector => selector === 'script[src], link[href]' ? (${JSON.stringify(Boolean(entrySrc))} ? [script] : [])
          : selector === 'script:not([src])' && inline.textContent ? [inline] : [],
      } };
    };
  `);
  const { game } = await service.create({ prompt: 'Module URLs', multiplayer: false, genre: 'racing', style: null, setting: null });
  await service.write(game.id, [{ path: 'index.html', content: entry }, ...files]);
  return { workspace, service, id: game.id };
}

async function serve(t: TestContext, workspace: string, service: GameProjects, id: string) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void gameHttp(req, res, new URL(req.url!, 'http://localhost'), workspace, async () => ({}), service.runtimeRoot);
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return new URL(`http://127.0.0.1:${address.port}/api/games/${id}/play/index.html`);
}

for (const [specifier, filename] of [
  ['./first%20level.js?version=1#start', 'src/first level.js'],
  ['./a//b.js', 'src/a/b.js'],
]) test(`validation accepts the module URL ${specifier} served by the game endpoint`, async t => {
  const source = 'export const name = "First level";';
  const { workspace, service, id } = await fixture(t, [
    { path: 'src/main.js', content: `import ${JSON.stringify(specifier)};` },
    { path: filename, content: source },
  ]);
  const entry = await serve(t, workspace, service, id);
  const response = await fetch(new URL(specifier, new URL('./src/main.js', entry)));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), source);
  assert.deepEqual((await service.validate(id)).diagnostics, []);
  assert.equal((await service.publish(id)).game.status, 'published');
});

test('encoded imports retain their real parent path and are decoded exactly once', async t => {
  const { service, id } = await fixture(t, [
    { path: 'src/main.js', content: 'import "./level%23%3F/%E9%9B%AA.js";' },
    { path: 'src/level#?/雪.js', content: 'export { value } from "../value%2520literal.js";' },
    { path: 'src/value%20literal.js', content: 'export const value = 1;' },
  ]);
  assert.deepEqual((await service.validate(id)).diagnostics, []);
});

test('validation inspects syntax in transitively imported encoded module files', async t => {
  const { service, id } = await fixture(t, [
    { path: 'src/main.js', content: 'export * from "./first%20level.js";' },
    { path: 'src/first level.js', content: 'import("./broken%23module.js");' },
    { path: 'src/broken#module.js', content: 'export const = ;' },
  ]);
  const result = await service.validate(id);
  assert.equal(result.passed, false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].path, 'src/broken#module.js');
  assert.match(result.diagnostics[0].message, /JavaScript syntax error/);
});

test('module URL resolution keeps unsafe and malformed paths inside validation diagnostics', async t => {
  const { service, id } = await fixture(t, [
    { path: 'src/main.js', content: [
      'import "../../outside.js";',
      'import "./bad%ZZ.js";',
      'import "./nested%2f..%2fexisting.js";',
      'import "./nested%2f%2fexisting.js";',
      'import "./%2e%2e/%2e%2e/outside.js";',
    ].join('\n') },
    { path: 'src/existing.js', content: 'export const value = 1;' },
    { path: 'src/nested/existing.js', content: 'export const value = 2;' },
  ]);
  const result = await service.validate(id);
  assert.equal(result.passed, false);
  assert.equal(result.diagnostics.length, 5);
  assert.ok(result.diagnostics.every(row => row.path === 'src/main.js' && /Imported module/.test(row.message)));
});

test('ordinary relative module imports still resolve parent directories', async t => {
  const { service, id } = await fixture(t, [
    { path: 'src/main.js', content: 'import "./nested/module.js";' },
    { path: 'src/nested/module.js', content: 'export * from "../value.js?cache=1";' },
    { path: 'src/value.js', content: 'export const value = 1;' },
  ]);
  assert.deepEqual((await service.validate(id)).diagnostics, []);
});

for (const [name, entrySrc, moduleUrl, moduleFile, childSpecifier, childFile] of [
  ['imported encoded separator', './src/main.js', './src/nested%2Fmodule.js', 'src/nested/module.js', './c.js', 'src/c.js'],
  ['entry encoded separator', './src/nested%2Fmodule.js', './src/nested%2Fmodule.js', 'src/nested/module.js', './c.js', 'src/c.js'],
  ['entry literal empty segment', './src/a//module.js', './src/a//module.js', 'src/a/module.js', '../c.js', 'src/a/c.js'],
  ['encoded reserved characters', './src/main.js', './src/level%23%3F%2Fone%252F.js', 'src/level#?/one%2F.js', './sibling%23%3F%25.js', 'src/sibling#?%.js'],
]) test(`nested imports retain the browser URL base for ${name}`, async t => {
  const moduleSource = `import ${JSON.stringify(childSpecifier)};`;
  const childSource = 'export const value = 1;';
  const { workspace, service, id } = await fixture(t, [
    ...(entrySrc === './src/main.js' ? [{ path: 'src/main.js', content: `import ${JSON.stringify(moduleUrl.replace('./src/', './'))};` }] : []),
    { path: moduleFile, content: moduleSource },
    { path: childFile, content: childSource },
  ], entrySrc);
  const entry = await serve(t, workspace, service, id);
  for (const prefix of ['/api/games/', '/motion-api/games/']) {
    const base = new URL(entry);
    base.pathname = base.pathname.replace('/api/games/', prefix);
    const importedUrl = new URL(moduleUrl, base);
    const imported = await fetch(importedUrl);
    assert.equal(imported.status, 200);
    assert.equal(await imported.text(), moduleSource);
    const child = await fetch(new URL(childSpecifier, importedUrl));
    assert.equal(child.status, 200);
    assert.equal(await child.text(), childSource);
  }
  assert.deepEqual((await service.validate(id)).diagnostics, []);
  assert.equal((await service.publish(id)).game.status, 'published');
});

test('one file loaded through distinct URL bases inspects both dependency graphs', async t => {
  const { workspace, service, id } = await fixture(t, [
    { path: 'src/main.js', content: 'import "./nested/module.js"; import "./nested%2Fmodule.js";' },
    { path: 'src/nested/module.js', content: 'import "./c.js";' },
    { path: 'src/nested/c.js', content: 'export const valid = 1;' },
    { path: 'src/c.js', content: 'export const = ;' },
  ]);
  const entry = await serve(t, workspace, service, id);
  const ordinary = new URL('./src/nested/module.js', entry);
  const encoded = new URL('./src/nested%2Fmodule.js', entry);
  assert.equal(await (await fetch(ordinary)).text(), await (await fetch(encoded)).text());
  assert.equal(await (await fetch(new URL('./c.js', encoded))).text(), 'export const = ;');
  const result = await service.validate(id);
  assert.equal(result.passed, false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].path, 'src/c.js');
  assert.match(result.diagnostics[0].message, /JavaScript syntax error/);
  await assert.rejects(service.publish(id), /Game validation failed/);
});

test('entry URL decoding still rejects encoded traversal and empty segments', async t => {
  for (const entrySrc of ['./src/nested%2F..%2Fmain.js', './src/nested%2F%2Fmain.js']) {
    const { service, id } = await fixture(t, [
      { path: 'src/main.js', content: 'export const valid = 1;' },
      { path: 'src/nested/main.js', content: 'export const valid = 2;' },
    ], entrySrc);
    const result = await service.validate(id);
    assert.equal(result.passed, false);
    assert.ok(result.diagnostics.some(row => row.path === 'index.html' && /Referenced script not readable/.test(row.message)));
  }
});

for (const [baseHref, specifier, filename] of [
  ['./src/?version=1#chapter', './main.js', 'src/main.js'],
  ['./src/nested%2Fbase.html', './c.js', 'src/c.js'],
]) test(`inline imports resolve against the authored base ${baseHref}`, async t => {
  const source = 'export const value = 1;';
  const { workspace, service, id } = await fixture(t, [{ path: filename, content: source }], '', {
    baseHref, inlineSource: `import ${JSON.stringify(specifier)};`,
  });
  const entry = await serve(t, workspace, service, id);
  const response = await fetch(new URL(specifier, new URL(baseHref, entry)));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), source);
  assert.deepEqual((await service.validate(id)).diagnostics, []);
  assert.equal((await service.publish(id)).game.status, 'published');
});

test('inline imports validate the base target instead of a same-named entry-directory file', async t => {
  const { service, id } = await fixture(t, [
    { path: 'main.js', content: 'export const decoy = 1;' },
    { path: 'src/main.js', content: 'export const = ;' },
  ], '', { baseHref: './src/', inlineSource: 'import "./main.js";' });
  const result = await service.validate(id);
  if (result.passed) {
    const published = await service.publish(id);
    assert.fail(`Broken base-resolved module passed validation and publication (${published.game.status})`);
  }
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.some(row => row.path === 'src/main.js' && /JavaScript syntax error/.test(row.message)));
  await assert.rejects(service.publish(id), /Game validation failed/);
});

test('remote inline bases retain host checks without local file lookups', async t => {
  const { service, id } = await fixture(t, [], '', {
    baseHref: 'https://cdn.jsdelivr.net/npm/example/', inlineSource: 'import "./main.js";',
  });
  assert.deepEqual((await service.validate(id)).diagnostics, []);
  const blocked = await fixture(t, [], '', {
    baseHref: 'https://untrusted.invalid/modules/', inlineSource: 'import "./main.js";',
  });
  const result = await blocked.service.validate(blocked.id);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.some(row => row.path === 'index.html' && /External network host is not allowed: untrusted.invalid/.test(row.message)));
});

test('inline bases outside this game fail with an entry diagnostic', async t => {
  for (const baseHref of ['../', 'mailto:example@example.com']) {
    const { service, id } = await fixture(t, [{ path: 'main.js', content: 'export const decoy = 1;' }], '', {
      baseHref, inlineSource: 'import "./main.js";',
    });
    const result = await service.validate(id);
    assert.equal(result.passed, false, baseHref);
    assert.ok(result.diagnostics.some(row => row.path === 'index.html' && /Imported module/.test(row.message)));
  }
});

test('data and javascript base URLs retain the document fallback base', async t => {
  for (const baseHref of ['data:text/html,example', 'javascript:void(0)']) {
    const { service, id } = await fixture(t, [{ path: 'main.js', content: 'export const value = 1;' }], '', {
      baseHref, inlineSource: 'import "./main.js";',
    });
    assert.deepEqual((await service.validate(id)).diagnostics, []);
  }
});

test('root-relative module URLs inspect the same game files as the HTTP route', async t => {
  const { workspace, service, id } = await fixture(t, [
    { path: 'src/main.js', content: '' },
    { path: 'src/broken.js', content: 'export const = ;' },
  ]);
  const urlPath = `/motion-api/games/${id}/play/src/broken.js`;
  await service.write(id, [{ path: 'src/main.js', content: `import ${JSON.stringify(urlPath)};` }]);
  const entry = await serve(t, workspace, service, id);
  const response = await fetch(new URL(urlPath, entry));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'export const = ;');
  const result = await service.validate(id);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.some(row => row.path === 'src/broken.js' && /JavaScript syntax error/.test(row.message)));
  for (const unsafe of [`/motion-api/games/${id}/play/src/nested%2F..%2Fmain.js`, '/motion-api/games/another-game/play/main.js']) {
    await service.write(id, [{ path: 'src/main.js', content: `import ${JSON.stringify(unsafe)};` }]);
    const rejected = await service.validate(id);
    assert.equal(rejected.passed, false);
    assert.ok(rejected.diagnostics.some(row => row.path === 'src/main.js' && /Imported module not readable/.test(row.message)));
  }
});
