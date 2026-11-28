import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogDownloadPrompt } from '../shared/model-catalog.ts';

const pack = {
  title: 'Game Icons', id: 'kenney:game-icons', provider: 'kenney', license: 'CC0',
  sourceUrl: 'https://kenney.nl/assets/game-icons', thumbnailUrl: 'https://kenney.nl/preview.png', downloadable: false,
};

test('catalog guide carries the selected pack and conversation into the original-file handoff', () => {
  const chat = '5dc3519d-505d-447f-9f9a-f4b3a1d3673e';
  const prompt = catalogDownloadPrompt(pack, { dimension: '2d', locale: 'zh-CN', conversationId: chat });
  assert.ok(prompt.includes(pack.sourceUrl));
  assert.ok(prompt.includes(pack.id));
  assert.ok(prompt.includes(pack.license));
  assert.ok(prompt.includes(chat));
  assert.match(prompt, /原始压缩包/);
  assert.match(prompt, /PNG/);
  assert.match(prompt, /present_asset/);
  assert.ok(!prompt.includes(pack.thumbnailUrl));
});

test('standalone model handoff preserves glTF dependencies and returns a relative link', () => {
  const prompt = catalogDownloadPrompt({ ...pack, provider: 'blenderkit' }, { dimension: '3d' });
  assert.match(prompt, /GLB/);
  assert.match(prompt, /textures and materials/);
  assert.match(prompt, /workspace-relative link/);
  assert.doesNotMatch(prompt, /conversationId=/);
});
