import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HostedGameTemplates } from '../shared/hosted-game-templates.ts';

for (const failure of ['invalid JSON', 'unreadable index'] as const) {
  test(`template loading retries after an ${failure} is repaired`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'opengame-index-retry-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const index = path.join(root, 'game-downloads.json');
    const installed = path.join(root, 'games', 'demo');
    if (failure === 'invalid JSON') await writeFile(index, '{');
    else await mkdir(index);
    const templates = new HostedGameTemplates(index, path.join(root, 'cache'));

    const failures = await Promise.allSettled([
      templates.directory('demo', installed),
      templates.directory('demo', installed),
    ]);
    assert(failures.every(result => result.status === 'rejected'));

    await rm(index, { recursive: true });
    await writeFile(index, JSON.stringify({ schemaVersion: 1, games: {} }));
    assert.equal(await templates.directory('demo', installed), installed);
    assert.equal(await templates.directory('demo', installed), installed);
  });
}
