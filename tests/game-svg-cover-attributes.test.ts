import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertGameCoverSize, gameCoverDimensions, GameProjects } from '../game-projects.ts';

const examples = [
  ['stroke width', 'stroke-width="2" width="1280" height="720"'],
  ['data dimensions', 'data-width="320" data-height="200" width="1280" height="720"'],
  ['quoted attribute text', 'data-note="width=\'1\' height=\'1\'" width="1280" height="720"'],
  ['quoted greater-than sign', 'aria-label="Score > 0" width="1280" height="720"'],
  ['data view box', 'data-viewBox="0 0 1 1" viewBox="0 0 1280 720"'],
] as const;

function svg(attributes: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="100%" height="100%" fill="blue"/></svg>`;
}

for (const [label, attributes] of examples) {
  test(`SVG cover dimensions ignore ${label}`, () => {
    const dimensions = gameCoverDimensions(Buffer.from(svg(attributes)), '.svg');
    assert.deepEqual(dimensions, { width: 1280, height: 720 });
    assertGameCoverSize(dimensions);
  });
}

test('data attributes cannot provide nonexistent SVG viewport dimensions', () => {
  assert.throws(() => gameCoverDimensions(Buffer.from(svg('data-width="1280" data-height="720"')), '.svg'), /Cannot read cover dimensions/);
});

test('qualified SVG roots preserve their dimensions', () => {
  const source = '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="1280" height="720"><svg:rect width="100%" height="100%"/></svg:svg>';
  assert.deepEqual(gameCoverDimensions(Buffer.from(source), '.svg'), { width: 1280, height: 720 });
});

test('SVG pixel dimensions and comma-separated view boxes retain their behavior', () => {
  for (const attributes of ["width='1280px' height='720px'", 'viewBox="0,0,1280,720"', 'width="100%" height="100%" viewBox="0 0 1280 720"']) {
    assert.deepEqual(gameCoverDimensions(Buffer.from(svg(attributes)), '.SVG'), { width: 1280, height: 720 });
  }
  assert.throws(() => assertGameCoverSize(gameCoverDimensions(Buffer.from(svg('width="320" height="180"')), '.svg')), /960x540/);
});

test('metadata accepts valid SVG covers and rejects data-only dimensions without replacing the cover', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-svg-cover-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const { game } = await service.create({ prompt: 'An SVG cover game', genre: 'racing', multiplayer: false });
  for (let i = 0; i < examples.length; i++) {
    const cover = `cover-${i}.svg`;
    await writeFile(path.join(service.root, game.id, cover), svg(examples[i][1]));
    const updated = await service.updateMeta(game.id, { cover });
    assert.equal(updated.cover, `/api/games/${game.id}/play/${cover}`);
  }
  const before = (await service.get(game.id)).cover;
  await writeFile(path.join(service.root, game.id, 'invalid.svg'), svg('data-width="1280" data-height="720"'));
  await assert.rejects(service.updateMeta(game.id, { cover: 'invalid.svg' }), /Cannot read cover dimensions/);
  assert.equal((await service.get(game.id)).cover, before);
});
