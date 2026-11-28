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

async function renderViewer(artifacts: SuperAgentArtifact[], initialTabId = artifacts[0].id) {
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
