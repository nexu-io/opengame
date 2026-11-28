import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { superAgentConversations } from '../gateway/super-agent.ts';
import { pluginRoot } from '../hyperframes.ts';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';

const textLimit = 256 * 1024;
const jsonLimit = 4 * 1024 ** 2;
const map = '{"type":"map","layers":[],"tilesets":[]}';
const atlas = '{"frames":{},"meta":{"image":"hero.png"}}';

for (const [name, content, kind] of [
  ['hero.json', atlas.padStart(textLimit + 1), 'atlas'],
  ['level.json', map.padStart(jsonLimit), 'tilemap'],
  ['save.json', JSON.stringify({ nested: JSON.parse(map) }).padStart(textLimit + 1), null],
  ['incomplete.json', atlas.padEnd(textLimit) + '!', null],
  ['oversized.json', map.padEnd(jsonLimit + 1), null],
] as const) {
  test(`workspace metadata and present_asset classify ${name} from complete bounded JSON`, () => fixture(async store => {
    const chat = await superAgentConversations(store).create();
    const directory = path.join(store.directory, 'super-agent', 'work', chat.id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, name), content);
    const request = transport(store, { runtimeRoot: pluginRoot });
    const metadata = await request('/motion-api/super-agent/file-content?' + new URLSearchParams({ chatId: chat.id, path: name }));
    assert.equal(metadata.status, 200);
    const data = await metadata.json();
    assert.equal(data.content, content.slice(0, textLimit));
    assert.equal(data.previewKind, kind);
    const result = await request('/motion-api/phase1/call', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'openmotion_asset_manage', arguments: { action: 'present_asset', conversationId: chat.id, path: name } }),
    });
    if (kind) {
      assert.equal(result.status, 200);
      assert.equal((await result.json()).artifact.filePath, name);
      assert.equal(await (await request(data.previewUrl)).text(), content);
    } else {
      assert.match(await result.text(), /Unsupported workspace asset preview format/);
    }
  }, false));
}
