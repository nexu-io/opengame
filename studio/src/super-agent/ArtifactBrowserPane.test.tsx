// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_VIEWER_TAB_ID, type SuperAgentArtifact } from '../../../shared/super-agent';
import type { GameCard } from '../../../shared/game-contract';
import { I18nProvider } from '../i18n/I18n';
import * as diagnostics from '../motion/diagnostics';
import { TOP_EARNING_TAG } from '../motion/game/gameCatalog';
import { toGameArtifact } from '../motion/game/gameSuperAgent';
import {
  ArtifactBrowserPane,
  EXTERNAL_IFRAME_REVEAL_TIMEOUT_MS,
} from './ArtifactBrowserPane';

vi.mock('../components/WebPublishPopover', () => ({
  WebPublishPopover: () => null,
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

describe('ArtifactBrowserPane integrated Try Game Feed', () => {
  const POOL: GameCard[] = [
    {
      id: 'archero-bow-legend',
      title: 'Archero Bow Legend',
      description: 'Dodge arrows and clear waves',
      genre: 'shooter',
      style: '3d',
      setting: 'fantasy',
      orientation: 'portrait',
      multiplayer: false,
      maxPlayers: 1,
      status: 'published',
      cover: 'cover.png',
      playUrl: '/api/games/archero-bow-legend/play/index.html',
      plays: 0,
      likes: 0,
      dislikes: 0,
      reaction: 0,
      favorite: false,
      source: 'template',
      remixOf: null,
      controls: 'Drag to move, release to shoot',
      tags: [TOP_EARNING_TAG],
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
    },
    {
      id: 'apex-drift-3d',
      title: 'Apex Drift 3D',
      description: 'High-speed arcade drifting',
      genre: 'racing',
      style: '3d',
      setting: 'modern',
      orientation: 'landscape',
      multiplayer: false,
      maxPlayers: 1,
      status: 'published',
      cover: 'cover.png',
      playUrl: '/api/games/apex-drift-3d/play/index.html',
      plays: 0,
      likes: 0,
      dislikes: 0,
      reaction: 0,
      favorite: false,
      source: 'template',
      remixOf: null,
      controls: 'Steer left and right',
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
    },
    {
      id: 'community-little-prince',
      title: 'The Little Prince',
      description: 'Explore watercolour 3D planets',
      genre: 'story',
      style: '3d',
      setting: 'space',
      orientation: 'landscape',
      multiplayer: false,
      maxPlayers: 1,
      status: 'published',
      cover: 'cover.jpg',
      playUrl: 'https://littleprince.dev/',
      plays: 0,
      likes: 0,
      dislikes: 0,
      reaction: 0,
      favorite: false,
      source: 'community',
      external: {
        url: 'https://littleprince.dev/',
        author: '@Saccc_c',
        postUrl: 'https://x.com/Saccc_c/status/1',
        model: 'Opus',
        embeddable: true,
      },
      remixOf: null,
      controls: '',
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
    },
  ];

  function toArtifact(game: GameCard): SuperAgentArtifact {
    const patch = toGameArtifact(game, game.title);
    return {
      id: patch.id!,
      kind: 'game-project',
      title: patch.title!,
      subtitle: patch.subtitle,
      ...(patch.projectId ? { projectId: patch.projectId } : {}),
      scenario: patch.scenario,
      revision: patch.revision,
      url: patch.url,
      createdAt: 1000,
      updatedAt: 1000,
      presentedAt: 1000,
    };
  }

  it('switches games in-place via desktop right rail Next/Prev buttons, Alt+Arrow shortcuts, Like +1, and mobile browse-mode tap', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const noop = () => {};

    function FeedHarness() {
      const [artifacts, setArtifacts] = useState<SuperAgentArtifact[]>([toArtifact(POOL[0])]);
      const [openTabIds, setOpenTabIds] = useState<string[]>([`game:${POOL[0].id}`]);
      const [activeTabId, setActiveTabId] = useState<string>(`game:${POOL[0].id}`);

      const handleNavigateTrialGame = (nextGame: GameCard, replaceTabId: string) => {
        const nextArtifact = toArtifact(nextGame);
        setArtifacts(prev => [...prev.filter(a => a.id !== replaceTabId && a.id !== nextArtifact.id), nextArtifact]);
        setOpenTabIds(prev => prev.map(id => (id === replaceTabId ? nextArtifact.id : id)));
        setActiveTabId(nextArtifact.id);
      };

      return (
        <ArtifactBrowserPane
          chatId={null}
          artifacts={artifacts}
          openTabIds={openTabIds}
          activeTabId={activeTabId}
          expanded={false}
          workspaceItems={[]}
          tryGamePool={POOL}
          onNavigateTrialGame={handleNavigateTrialGame}
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
          <FeedHarness />
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    // Right rail mounts with Next, Prev, and simulated Like counter.
    expect(container.querySelector('[data-try-game-feed]')).not.toBeNull();
    const nextBtn = container.querySelector<HTMLButtonElement>('[data-try-game-next]');
    const prevBtn = container.querySelector<HTMLButtonElement>('[data-try-game-prev]');
    const likeBtn = container.querySelector<HTMLButtonElement>('[data-try-game-like]');
    expect(nextBtn).not.toBeNull();
    expect(prevBtn).not.toBeNull();
    expect(likeBtn).not.toBeNull();
    expect(container.querySelectorAll('[role="tab"]').length).toBe(1);

    // Clicking Like updates pressed state and triggers burst feedback.
    act(() => { likeBtn!.click(); });
    expect(likeBtn!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-try-game-like-burst]')).not.toBeNull();

    // Clicking Next replaces the active tab in-place (still 1 tab) with a different game from the pool.
    const initialTitle = container.querySelector('[role="tab"] span')?.textContent;
    act(() => { nextBtn!.click(); });
    const nextTitle = container.querySelector('[role="tab"] span')?.textContent;
    expect(container.querySelectorAll('[role="tab"]').length).toBe(1);
    expect(nextTitle).not.toBe(initialTitle);

    // Clicking Prev returns deterministically to the initial game.
    act(() => { prevBtn!.click(); });
    expect(container.querySelector('[role="tab"] span')?.textContent).toBe(initialTitle);

    // Alt+ArrowDown advances cleanly via keyboard shortcut.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true }));
    });
    expect(container.querySelector('[role="tab"] span')?.textContent).toBe(nextTitle);

    // Mobile Next button enters Card Browse mode, and tapping the swipe shield returns to Play mode.
    const mobileNext = container.querySelector<HTMLButtonElement>('[data-try-game-mobile-next]')!;
    act(() => { mobileNext.click(); });
    expect(container.querySelector('[data-try-game-feed]')?.getAttribute('data-mobile-mode')).toBe('browse');
    const shield = container.querySelector<HTMLButtonElement>('[data-try-game-swipe-shield]')!;
    expect(shield).not.toBeNull();
    act(() => { shield.click(); });
    expect(container.querySelector('[data-try-game-feed]')?.getAttribute('data-mobile-mode')).toBe('play');
  });

  it('uses a single-bar full-viewport header without tab chrome in mobileFullscreenGameTrial mode', async () => {
    const noop = () => {};
    const onClosePane = vi.fn();
    const gameArtifact: SuperAgentArtifact = {
      id: 'game:coin-dash',
      kind: 'game-project',
      title: 'Coin Dash',
      scenario: 'portrait',
      url: '/api/games/coin-dash/play/index.html',
      createdAt: 1,
      updatedAt: 1,
      presentedAt: 1,
    };

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ArtifactBrowserPane
            chatId={null}
            artifacts={[gameArtifact]}
            openTabIds={[gameArtifact.id]}
            activeTabId={gameArtifact.id}
            expanded={false}
            mobileFullscreenGameTrial
            workspaceItems={[]}
            tryGamePool={[{
              id: 'coin-dash',
              title: 'Coin Dash',
              description: 'Portrait runner',
              genre: 'arcade',
              source: 'template',
              orientation: 'portrait',
              updatedAt: '2026-11-27T00:00:00.000Z',
            }]}
            onNavigateTrialGame={noop}
            onSelectTab={noop}
            onCloseTab={noop}
            onNewTab={noop}
            onOpenWebUrl={noop}
            onOpenArtifact={noop}
            onOpenResource={noop}
            onToggleExpand={noop}
            onClosePane={onClosePane}
            onAttachArtifact={noop}
            onOpenInDesignStudio={noop}
            onOpenInMotionStudio={noop}
            onOpenInAssets={noop}
            onOpenInBrandKit={noop}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector('.om-sa-viewer-tabs-bar')).toBeNull();
    expect(container.querySelector('[data-try-game-mobile-title]')?.textContent).toContain('Coin Dash');
    const closeBtn = container.querySelector<HTMLButtonElement>('[data-try-game-mobile-close]');
    expect(closeBtn).not.toBeNull();
    act(() => { closeBtn!.click(); });
    expect(onClosePane).toHaveBeenCalledTimes(1);
  });
});
