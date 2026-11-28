// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SimpleMarkdown } from './SimpleMarkdown';
import { PreviewLink, PreviewLinkContext } from './PreviewLink';
import type { DesktopBridgeApi } from '../../../shared/platform-host';

it('opens local game asset references through the file viewer and preserves web links and other text', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const onOpenFilePath = vi.fn();
  const onOpenWebUrl = vi.fn();
  const formats = ['atlas.json', 'rig.fbx', 'body.obj', 'helmet.gltf', 'run.bvh', 'map.ply', 'mesh.stl', 'sprite.webp', 'theme.ogg', 'intro.webm'];
  const content = ['`assets/hero.glb`', '[Hero](<assets/Hero One.glb>)', 'C:\\game\\hero.glb', '/project/hero.glb', ...formats.map(file => `assets/${file}.`),
    'unknown.blob', '`unrelated.ts`', '`https://example.org/m.glb`', '`//example.org/m.glb`', 'https://example.org/other.glb'].join('\n\n');
  await act(async () => root.render(<SimpleMarkdown content={content} onOpenFilePath={onOpenFilePath} onOpenWebUrl={onOpenWebUrl} />));
  try {
    for (const button of host.querySelectorAll<HTMLButtonElement>('button')) button.click();
    expect(onOpenFilePath.mock.calls.map(([path]) => path)).toEqual(['assets/hero.glb', 'assets/Hero One.glb', 'C:\\game\\hero.glb', '/project/hero.glb', ...formats.map(file => `assets/${file}`)]);
    expect(host.querySelector('a')?.href).toBe('https://example.org/other.glb');
    expect(onOpenWebUrl).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it.each(['ctrlKey', 'metaKey'] as const)('keeps %s navigation outside the right pane for web, workspace and pinned links', async modifier => {
  const parent = document.createElement('div');
  const host = document.createElement('div');
  parent.appendChild(host);
  const root = createRoot(host);
  const onPane = vi.fn();
  const openLocalPreviewFile = vi.fn(async () => {});
  const originalBridge = window.__OPENMOTION_DESKTOP__;
  const selected = { id: 'run', kind: 'asset-3d' as const, assetId: 'hero', versionId: 'v2', animation: 'Run', title: 'Hero', createdAt: 1, updatedAt: 1 };
  const click = (link: HTMLAnchorElement, modified: boolean) => {
    let prevented = false;
    parent.addEventListener('click', event => { prevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: modified }));
    return prevented;
  };
  try {
    await act(async () => root.render(<PreviewLinkContext.Provider value={{ chatId: 'my-chat', rootKey: 'game:hero' }}>
      <SimpleMarkdown content={'[Asset notes](./notes.txt) [site](https://example.org/play) [Game](/motion-api/games/hero/play/index.html)'} onOpenWebUrl={onPane} onOpenFilePath={onPane} />
      <PreviewLink artifact={selected} onOpen={() => onPane(selected.id)}>{selected.animation}</PreviewLink>
    </PreviewLinkContext.Provider>));
    const [workspace, website, game, pinned] = [...host.querySelectorAll('a')];
    for (const link of [workspace, website, game]) {
      expect(link.className).toBe('om-sa-link');
      expect(link.querySelector('svg')).toBeNull();
    }
    const raw = new URL(workspace.href);
    expect(raw.pathname).toBe('/motion-api/super-agent/file-content');
    expect(Object.fromEntries(raw.searchParams)).toEqual({ path: 'notes.txt', raw: '1', chatId: 'my-chat', rootKey: 'game:hero' });
    expect(pinned.getAttribute('href')).toBe('/motion-api/assets/hero/versions/v2/file');
    for (const bridge of [undefined, {} as DesktopBridgeApi]) {
      window.__OPENMOTION_DESKTOP__ = bridge;
      for (const link of [workspace, website, game, pinned]) {
        expect(link.target).toBe('_blank');
        expect(click(link, true)).toBe(false);
      }
    }
    window.__OPENMOTION_DESKTOP__ = { openLocalPreviewFile } as unknown as DesktopBridgeApi;
    expect(click(website, true)).toBe(false);
    expect(click(game, true)).toBe(false);
    expect(click(workspace, true)).toBe(true);
    expect(click(pinned, true)).toBe(true);
    expect(openLocalPreviewFile.mock.calls).toEqual([
      [{ kind: 'workspace-file', conversationId: 'my-chat', rootKey: 'game:hero', path: 'notes.txt' }],
      [{ kind: 'library-asset', assetId: 'hero', versionId: 'v2' }],
    ]);
    expect(onPane).not.toHaveBeenCalled();
    for (const link of [workspace, website, game, pinned]) expect(click(link, false)).toBe(true);
    expect(onPane.mock.calls).toEqual([['./notes.txt', 'Asset notes'], ['https://example.org/play'], ['/motion-api/games/hero/play/index.html'], ['run']]);
  } finally {
    window.__OPENMOTION_DESKTOP__ = originalBridge;
    await act(async () => root.unmount());
  }
});
