import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { GameError, GameProjects } from '../game-projects.ts';

type Script = { source: string; type?: string; inert?: boolean; nomodule?: boolean };

async function fixture(t: TestContext, scripts: Script[], files: { path: string; content: string }[] = []) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-inline-scripts-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const html = '<canvas></canvas>' + scripts.map(script => {
    const tag = `<script${script.type ? ` type="${script.type}"` : ''}${script.nomodule ? ' nomodule' : ''}>${script.source}</script>`;
    return script.inert ? `<template>${tag}</template>` : tag;
  }).join('');
  // Supply known DOM nodes for this exact fixture. JavaScript parsing,
  // dependency inspection, validation and publication use production code.
  // The H1 integration regression also covers the installed HTML parser.
  service.runtimeRoot = path.join(workspace, 'runtime');
  const packages = path.join(service.runtimeRoot, 'node_modules');
  await mkdir(path.join(packages, '@hyperframes/parsers'), { recursive: true });
  await mkdir(path.join(packages, 'linkedom'), { recursive: true });
  await writeFile(path.join(packages, '@hyperframes/parsers/package.json'), '{"name":"@hyperframes/parsers"}');
  await writeFile(path.join(packages, 'linkedom/package.json'), '{"name":"linkedom","main":"index.cjs"}');
  await writeFile(path.join(packages, 'linkedom/index.cjs'), `
    exports.parseHTML = source => {
      if (source !== ${JSON.stringify(html)}) throw Error('Unexpected HTML fixture');
      const scripts = ${JSON.stringify(scripts)}.map(script => ({
        textContent: script.source, closest: () => script.inert ? {} : null,
        getAttribute: name => name === 'type' ? script.type ?? null : null,
        hasAttribute: name => name === 'nomodule' && script.nomodule === true,
      }));
      return { document: { querySelector: () => null,
        querySelectorAll: selector => selector === 'script:not([src])' ? scripts : [] } };
    };
  `);
  const { game } = await service.create({ prompt: 'Inline game scripts', multiplayer: false });
  await service.write(game.id, [{ path: 'index.html', content: html }, ...files]);
  return { service, id: game.id, html };
}

for (const [name, script] of [
  ['classic syntax errors', { source: 'const score = ;' }],
  ['module syntax errors', { source: 'export const score = ;', type: 'module' }],
  ['module declarations in classic scripts', { source: 'import "./rules.js";' }],
  ['classic-only syntax in modules', { source: 'with ({ score: 1 }) { score; }', type: 'module' }],
] as const) {
  test(`inline validation rejects ${name} before publication`, async t => {
    const { service, id, html } = await fixture(t, [script], [{ path: 'rules.js', content: 'export const score = 1;' }]);
    const result = await service.validate(id);
    if (result.passed) {
      const published = await service.publish(id);
      assert.fail(`Invalid inline JavaScript passed validation and publication (${published.game.status})`);
    }
    assert.equal(result.passed, false);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].path, 'index.html');
    assert.match(result.diagnostics[0].message, /JavaScript syntax error/);
    const before = await readFile(path.join(service.root, id, 'game.json'), 'utf8');
    await assert.rejects(service.publish(id), error => error instanceof GameError && error.status === 409 && /Game validation failed/.test(error.message));
    assert.equal(await readFile(path.join(service.root, id, 'game.json'), 'utf8'), before);
    assert.equal((await service.read(id, 'index.html')).content, html);
  });
}

test('valid classic and module scripts keep their own parse goals', async t => {
  const { service, id } = await fixture(t, [
    { source: 'with ({ score: 1 }) { score; }', type: 'text/javascript' },
    { source: 'await Promise.resolve(); export const score = 1;', type: 'module' },
    { source: '{ "title": "Game data" }', type: 'application/json' },
    { source: 'const invalid = ;', inert: true },
    { source: 'const invalid = ;', nomodule: true },
  ]);
  assert.deepEqual((await service.validate(id)).diagnostics, []);
  assert.equal((await service.publish(id)).game.status, 'published');
});

test('inline modules still inspect their local dependency graph', async t => {
  const { service, id } = await fixture(t, [{ source: 'import "./rules.js";', type: 'module' }], [
    { path: 'rules.js', content: 'export const score = ;' },
  ]);
  const result = await service.validate(id);
  assert.equal(result.passed, false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].path, 'rules.js');
  assert.match(result.diagnostics[0].message, /JavaScript syntax error/);
});
