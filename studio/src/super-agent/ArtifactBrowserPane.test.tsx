// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_VIEWER_TAB_ID, type SuperAgentArtifact } from '../../../shared/super-agent';
import { I18nProvider } from '../i18n/I18n';
import * as diagnostics from '../motion/diagnostics';
import {
  ArtifactBrowserPane,
  EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS,
} from './ArtifactBrowserPane';

vi.mock('../components/WebPublishPopover', () => ({
  WebPublishPopover: () => null,
}));

vi.mock('../motion/ModelAssetPreview', () => ({
  ModelAssetPreview: ({ src, animation }: { src: string; animation?: string }) => <div data-model-source={src} data-animation={animation} />,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EXTERNAL_TENNIS: SuperAgentArtifact = {
  id: 'game:community-tennis-go-wild',
  kind: 'game-project',
  title: 'Tennis (Go Wild)',
  url: 'https://tennis.sixfingerpunch.com/',
  createdAt: 1000,
  updatedAt: 1000,
  presentedAt: 1000,
};

const EXTERNAL_EVENSONG: SuperAgentArtifact = {
  id: 'game:community-evensong',
  kind: 'game-project',
  title: 'Evensong',
  url: 'https://evensong-phi.vercel.app/',
  createdAt: 1001,
  updatedAt: 1001,
  presentedAt: 1001,
};

const LOCAL_GAME: SuperAgentArtifact = {
  id: 'game:ball-match',
  kind: 'game-project',
  projectId: 'ball-match',
  title: 'Ball Match',
  url: '/motion-api/games/ball-match/play/index.html',
  createdAt: 1002,
  updatedAt: 1002,
  presentedAt: 1002,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ games: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderViewer(artifacts: SuperAgentArtifact[], initialTabId = artifacts[0].id, onModelCatalogAction = vi.fn(async (_action: { query?: string } | { id: string }) => {})) {
  const noop = () => {};
  function Harness() {
    const [activeTabId, setActiveTabId] = useState(initialTabId);
    return (
      <ArtifactBrowserPane
        chatId={null}
        artifacts={artifacts}
        openTabIds={artifacts.map(item => item.id)}
        activeTabId={activeTabId}
        expanded={false}
        workspaceItems={[]}
        onSelectTab={setActiveTabId}
        onCloseTab={noop}
        onNewTab={() => setActiveTabId(NEW_VIEWER_TAB_ID)}
        onOpenWebUrl={noop}
        onOpenArtifact={setActiveTabId}
        onModelCatalogAction={onModelCatalogAction}
        onOpenResource={noop}
        onToggleExpand={noop}
        onClosePane={noop}
        onAttachArtifact={noop}
        onOpenInDesignStudio={noop}
        onOpenInMotionStudio={noop}
        onOpenInAssets={noop}
        onOpenInBrandKit={noop}
      />
    );
  }
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <Harness />
      </I18nProvider>,
    );
    await Promise.resolve();
  });
}

it('opens the catalog from a new tab and renders an Agent search with source-only and downloadable results', async () => {
  const catalog: SuperAgentArtifact = { id: 'catalog', kind: 'model-catalog', title: 'Free 3D models', catalogQuery: 'oak tree', createdAt: 1, updatedAt: 1 };
  const action = vi.fn(async (_action: { query?: string } | { id: string }) => {});
  let failSearch = true;
  vi.mocked(fetch).mockImplementation(async input => {
    if (!String(input).includes('model-catalog/search?q=oak%20tree')) return Response.json({ games: [] });
    if (failSearch) return Response.json({}, { status: 503 });
    return Response.json({ models: [
      { id: 'oak', title: 'Oak tree', provider: 'Library', license: 'CC0', downloadable: true },
      { id: 'trees', title: 'Tree collection', provider: 'Archive', sourceUrl: 'https://example.org/trees', downloadable: false },
    ] });
  });
  await renderViewer([catalog], NEW_VIEWER_TAB_ID, action);
  await act(async () => container.querySelector<HTMLButtonElement>('.om-sa-shortcut-item')!.click());
  expect(action).toHaveBeenCalledWith({});
  await act(async () => container.querySelector<HTMLButtonElement>('.om-sa-newtab-card')!.click());
  expect(container.textContent).toContain('Could not load assets');
  failSearch = false;
  const findButton = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label)!;
  await act(async () => findButton('Retry').click());
  expect(container.querySelector<HTMLInputElement>('.om-model-catalog input')?.value).toBe('oak tree');
  expect(container.querySelector('.om-model-credit a')?.getAttribute('href')).toBe('https://example.org/trees');
  expect(findButton('Ask Agent to download').disabled).toBe(true);
  expect(container.textContent).toContain('License not specified');
  expect(container.querySelectorAll('.om-model-grid button')).toHaveLength(2);
  await act(async () => findButton('Add to workspace').click());
  expect(action).toHaveBeenCalledWith({ id: 'oak' });
});

it('clears Agent and category searches to discovery and restores the latest search after viewing a model', async () => {
  const catalog: SuperAgentArtifact = { id: 'catalog', kind: 'model-catalog', title: 'Free 3D models', catalogQuery: 'wooden chair', createdAt: 1, updatedAt: 1 };
  const model: SuperAgentArtifact = { id: 'preview', kind: 'asset-3d', title: 'Model preview', url: '/sample.glb', createdAt: 2, updatedAt: 2 };
  const queries: string[] = [];
  let resolveHome: () => void = () => {};
  vi.mocked(fetch).mockImplementation(async input => {
    const url = new URL(String(input), 'https://example.org');
    if (!url.pathname.endsWith('/model-catalog/search')) return Response.json({ games: [] });
    const query = url.searchParams.get('q')!;
    queries.push(query);
    if (query === '') await new Promise<void>(resolve => { resolveHome = resolve; });
    return Response.json({ models: [{ id: 'item', title: query || 'Mixed shelf model', provider: 'Library', downloadable: false }] });
  });
  await renderViewer([catalog, model]);
  const input = () => container.querySelector<HTMLInputElement>('.om-model-catalog input')!;
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)!;
  const click = async (label: string) => act(async () => button(label).click());
  expect(input().value).toBe('wooden chair');
  await type('');
  await click('Search');
  expect(queries.at(-1)).toBe('');
  expect(container.querySelector('.om-model-grid li:not([aria-hidden])')).toBeNull();
  expect(button('Discover').getAttribute('aria-pressed')).toBe('true');
  await act(async () => resolveHome());
  expect(container.textContent).toContain('Mixed shelf model');
  await click('Animals');
  expect(button('Animals').getAttribute('aria-pressed')).toBe('true');
  await click('Clear search');
  await act(async () => resolveHome());
  expect(input().value).toBe('');
  expect(button('Discover').getAttribute('aria-pressed')).toBe('true');
  await type('stone bridge');
  await click('Search');
  await click('Model preview');
  await click('Back to asset catalog');
  expect(input().value).toBe('stone bridge');
  expect(queries).toEqual(['wooden chair', '', 'animal', '', 'stone bridge', 'stone bridge']);
});

it('restores 2D topics across preview tabs and distinguishes source pages, preview images and original files', async () => {
  const catalog: SuperAgentArtifact = { id: 'catalog', kind: 'model-catalog', title: 'Game asset catalog', catalogQuery: 'icon', catalogDimension: '2d', createdAt: 1, updatedAt: 1 };
  const file: SuperAgentArtifact = { id: 'png-file', kind: 'workspace-file', title: 'run.png', filePath: 'run.png', createdAt: 2, updatedAt: 2 };
  const sprite = { id: 'sprite', title: 'Run cycle', provider: 'OpenGameArt', thumbnailUrl: 'https://opengameart.org/preview.png', sourceUrl: 'https://opengameart.org/content/run', license: 'CC-BY', downloadable: true };
  const requests: string[] = [];
  vi.mocked(fetch).mockImplementation(async input => {
    const url = new URL(String(input), 'https://example.org');
    if (!url.pathname.endsWith('/model-catalog/search')) return Response.json({ games: [] });
    requests.push(url.search);
    return Response.json({ models: [sprite, { ...sprite, id: 'pack', title: 'Sprite pack', sourceUrl: 'https://artist.itch.io/pack', downloadable: false }] });
  });
  const action = vi.fn(async () => {});
  await renderViewer([catalog, file], catalog.id, action);
  const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)!;
  const click = (label: string) => act(async () => button(label).click());
  expect(requests.at(-1)).toBe('?q=icon&dimension=2d');
  expect(button('UI icons').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.om-model-grid li a')?.getAttribute('href')).toBe(sprite.sourceUrl);
  expect(container.querySelector('.om-model-grid li:nth-child(2)')?.textContent).toContain('itch.io');
  expect(container.querySelector('.om-model-grid li:nth-child(2)')?.textContent).not.toContain('Add to workspace');
  const frame = container.querySelector('.om-model-thumbnail')!;
  const image = frame.querySelector('img')!;
  let finishDecode!: () => void;
  Object.defineProperty(image, 'decode', { value: () => new Promise<void>(resolve => { finishDecode = resolve; }) });
  await act(async () => { image.dispatchEvent(new Event('load')); });
  expect(frame.querySelector('.om-model-image-placeholder')).toBeTruthy();
  await act(async () => finishDecode());
  expect(frame.querySelector('.om-model-image-placeholder')).toBeNull();
  expect(image.dataset.ready).toBe('true');
  const secondFrame = container.querySelector('.om-model-grid li:nth-child(2) .om-model-thumbnail')!;
  await act(async () => { secondFrame.querySelector('img')!.dispatchEvent(new Event('error')); });
  expect(secondFrame.textContent).toContain('Preview unavailable');
  expect(secondFrame.querySelector('.om-model-image-placeholder')).toBeNull();
  await click('Preview image');
  expect(document.querySelector('.om-sa-lightbox-stage img')?.getAttribute('src')).toBe(sprite.thumbnailUrl);
  await act(async () => document.querySelector<HTMLButtonElement>('.om-sa-lightbox-head button')!.click());
  expect(action).not.toHaveBeenCalled();
  await click('Add to workspace');
  expect(action).toHaveBeenCalledWith({ id: sprite.id });
  await click('3D');
  expect(requests.at(-1)).toBe('?q=');
  expect(button('Animation')).toBeTruthy();
  await click('2D');
  await click('Animation frames');
  await click('run.png');
  await click('Back to asset catalog');
  expect(requests.at(-1)).toBe('?q=sprite%20animation&dimension=2d');
  expect(button('2D').getAttribute('aria-pressed')).toBe('true');
  expect(button('Animation frames').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector<HTMLInputElement>('.om-sa-address-form input')?.value).toBe('catalog://sprites?q=sprite%20animation');
  await click('Clear search');
  expect(requests.at(-1)).toBe('?q=&dimension=2d');
  expect(button('Discover').getAttribute('aria-pressed')).toBe('true');
});

it('reads workspace model bytes from the authorized preview URL and changes the clip on the same stage', async () => {
  const previewUrl = '/motion-api/super-agent/file-content?rootKey=game&path=assets%2Fhero.glb&raw=1';
  const model: SuperAgentArtifact = {
    id: 'first', kind: 'workspace-file', title: 'Hero idle', filePath: 'assets/hero.glb', rootKey: 'game',
    url: 'https://example.org/ignored.glb', animation: 'Idle', createdAt: 1, updatedAt: 1,
  };
  vi.mocked(fetch).mockImplementation(async input => String(input).includes('/file-content?')
    ? Response.json({ path: 'assets/hero.glb', binary: true, sizeBytes: 100, mimeType: 'model/gltf-binary', previewUrl })
    : Response.json({ games: [] }));
  await renderViewer([model, { ...model, id: 'second', title: 'Hero run', animation: 'Run' }]);
  const stage = container.querySelector('[data-model-source]');
  expect(stage?.getAttribute('data-model-source')).toBe(previewUrl);
  expect(stage?.getAttribute('data-animation')).toBe('Idle');
  const runTab = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-viewer-tab button')].find(button => button.textContent?.includes('Hero run'))!;
  await act(async () => runTab.click());
  expect(container.querySelector('[data-model-source]')).toBe(stage);
  expect(stage?.getAttribute('data-animation')).toBe('Run');
});

it.each(['atlas', 'tilemap', null])('uses the workspace metadata kind %s for a truncated JSON excerpt', async previewKind => {
  const path = 'assets/level.json';
  const previewUrl = `/motion-api/super-agent/file-content?rootKey=game&path=${path}&raw=1`;
  const artifact: SuperAgentArtifact = { id: 'json', kind: 'workspace-file', title: path, filePath: path, rootKey: 'game', createdAt: 1, updatedAt: 1 };
  // For a rejected document, the excerpt alone looks like a complete map.
  const content = (previewKind ? '' : '{"type":"map","layers":[],"tilesets":[]}').padEnd(256 * 1024);
  vi.stubGlobal('IntersectionObserver', undefined);
  try {
    vi.mocked(fetch).mockImplementation(async input => {
      if (String(input) === previewUrl) return new Response('{}');
      return Response.json({ path, binary: false, sizeBytes: content.length + 100, mimeType: 'application/json', previewUrl, previewKind, content });
    });
    await renderViewer([artifact]);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === previewUrl)).toBe(Boolean(previewKind));
    expect(Boolean(container.querySelector('.om-game-asset-preview'))).toBe(Boolean(previewKind));
  } finally {
    vi.unstubAllGlobals();
  }
});

it('waits for the isolated trial origin before navigating the game iframe', async () => {
  let resolvePreview: (response: Response) => void = () => {};
  const previewResponse = new Promise<Response>(resolve => { resolvePreview = resolve; });
  vi.mocked(fetch).mockImplementation(async input => {
    if (String(input).endsWith('/games/ball-match/preview-url')) return previewResponse;
    return Response.json({ games: [] });
  });

  await renderViewer([LOCAL_GAME]);
  expect(container.querySelector('iframe')?.getAttribute('src') ?? null).toBeNull();

  const previewUrl = 'http://opengame-preview-0123456789abcdef01234567.localhost:4000/api/games/ball-match/play/index.html';
  await act(async () => { resolvePreview(Response.json({ url: previewUrl })); });
  const iframe = container.querySelector('iframe')!;
  expect(iframe.getAttribute('src')).toContain(previewUrl + '?');
  expect(iframe.getAttribute('src')).toContain('gameStartup=1');
  expect(iframe.getAttribute('sandbox')?.split(' ')).toContain('allow-same-origin');
});

describe('ArtifactBrowserPane external game iframe reveal', () => {
  it('reveals slow external game iframes after timeout, shows background progress, logs diagnostic, and clears on load', async () => {
    vi.spyOn(diagnostics, 'diagnosticsActive').mockReturnValue(true);
    const recordSpy = vi.spyOn(diagnostics, 'recordBrowserDiagnostic').mockImplementation(() => {});

    await renderViewer([EXTERNAL_TENNIS]);

    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).not.toBeNull();
    expect(container.querySelector('.om-sa-viewer-progress')).toBeNull();

    // Still covered just before the reveal timeout.
    act(() => {
      vi.advanceTimersByTime(EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS - 100);
    });
    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).not.toBeNull();
    expect(container.querySelector('.om-sa-viewer-progress')).toBeNull();
    expect(recordSpy).not.toHaveBeenCalled();

    // Cover dismisses at timeout so already-painted frames become interactive while toolbar progress stays visible.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).toBeNull();
    expect(container.querySelector('.om-sa-viewer-progress')).not.toBeNull();
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(
      'activity_iframe_slow',
      `game=community-tennis-go-wild host=tennis.sixfingerpunch.com revealAfterMs=${EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS}`,
      '',
      expect.stringContaining('iframe-slow:'),
    );

    // Late window.load clears the toolbar progress bar.
    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="Tennis (Go Wild)"]')!;
    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
    expect(container.querySelector('.om-sa-viewer-progress')).toBeNull();
  });

  it('cancels the reveal timeout and skips slow diagnostics when an external game loads promptly', async () => {
    vi.spyOn(diagnostics, 'diagnosticsActive').mockReturnValue(true);
    const recordSpy = vi.spyOn(diagnostics, 'recordBrowserDiagnostic').mockImplementation(() => {});

    await renderViewer([EXTERNAL_EVENSONG]);

    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="Evensong"]')!;
    act(() => {
      vi.advanceTimersByTime(500);
      iframe.dispatchEvent(new Event('load'));
    });

    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).toBeNull();
    expect(container.querySelector('.om-sa-viewer-progress')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS * 2);
    });
    expect(container.querySelector('.om-sa-viewer-progress')).toBeNull();
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('resets the loading cover and timer when reloading the same external game URL', async () => {
    await renderViewer([EXTERNAL_TENNIS]);

    act(() => {
      vi.advanceTimersByTime(EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS);
    });
    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).toBeNull();
    expect(container.querySelector('.om-sa-viewer-progress')).not.toBeNull();

    const reloadBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Reload"]')!;
    act(() => {
      reloadBtn.click();
    });

    // Reload mounts a fresh iframe with the same URL: cover returns and background progress resets.
    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).not.toBeNull();
    expect(container.querySelector('.om-sa-viewer-progress')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS);
    });
    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).toBeNull();
    expect(container.querySelector('.om-sa-viewer-progress')).not.toBeNull();
  });

  it('clears background progress when switching away from a slow external game tab', async () => {
    await renderViewer([EXTERNAL_TENNIS, EXTERNAL_EVENSONG]);

    act(() => {
      vi.advanceTimersByTime(EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS);
    });
    expect(container.querySelector('.om-sa-viewer-progress')).not.toBeNull();

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    act(() => {
      tabs[1].click();
    });
    expect(container.querySelector('.om-sa-viewer-progress')).toBeNull();
    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).not.toBeNull();
  });

  it('does not apply the external reveal timeout to local workspace games', async () => {
    await renderViewer([LOCAL_GAME]);

    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS * 3);
    });
    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).not.toBeNull();
    expect(container.querySelector('.om-sa-viewer-progress')).toBeNull();

    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="Ball Match"]')!;
    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
    expect(container.querySelector('.om-sa-frame-skeleton[data-game-loading]')).toBeNull();
  });

  it('keeps the branded loader until the local game scene is ready and allows retry after failure', async () => {
    await renderViewer([LOCAL_GAME]);
    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="Ball Match"]')!;
    const signal = (state: string) => window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow, data: { type: 'opengame:startup', state },
    }));
    act(() => { signal('loading'); iframe.dispatchEvent(new Event('load')); });
    expect(container.querySelector('[data-game-loading]')).not.toBeNull();
    act(() => { signal('failed'); });
    const retry = container.querySelector<HTMLButtonElement>('[data-game-failed] button');
    expect(retry?.textContent).toBe('Retry');
    act(() => { retry!.click(); });
    expect(container.querySelector('[data-game-failed]')).toBeNull();
    act(() => { signal('loading'); iframe.dispatchEvent(new Event('load')); signal('ready'); });
    expect(container.querySelector('[data-game-loading]')).toBeNull();
  });
});
