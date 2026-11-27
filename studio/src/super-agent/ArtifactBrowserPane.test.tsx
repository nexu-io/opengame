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
import { GAME_STUDIO_TAB_REGISTRY } from './GameStudioTopbar';

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

async function renderViewer(
  artifacts: SuperAgentArtifact[],
  initialTabId = artifacts[0].id,
  options?: {
    studioMode?: 'default' | 'game';
    onOpenWebUrl?: (url: string) => void;
    onCloseTab?: (tabId: string) => void;
  },
) {
  const noop = () => {};
  function Harness() {
    const [activeTabId, setActiveTabId] = useState(initialTabId);
    return (
      <ArtifactBrowserPane
        studioMode={options?.studioMode}
        chatId="chat-game-1"
        artifacts={artifacts}
        openTabIds={artifacts.map(item => item.id)}
        activeTabId={activeTabId}
        expanded={false}
        workspaceItems={[]}
        onSelectTab={setActiveTabId}
        onCloseTab={options?.onCloseTab ?? noop}
        onNewTab={() => setActiveTabId(NEW_VIEWER_TAB_ID)}
        onOpenWebUrl={options?.onOpenWebUrl ?? noop}
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

describe('ArtifactBrowserPane Game Studio mode', () => {
  const MY_GAME: SuperAgentArtifact = {
    id: 'game:my-custom-game',
    kind: 'game-project',
    projectId: 'my-custom-game',
    title: 'My Custom Game',
    url: '/motion-api/games/my-custom-game/play/index.html',
    createdAt: 1002,
    updatedAt: 1002,
    presentedAt: 1002,
  };
  const WEB_REF_ARTIFACT: SuperAgentArtifact = {
    id: 'web:ref-1',
    kind: 'web',
    title: 'Game Design Ref',
    url: 'https://example.com/docs',
    createdAt: 1003,
    updatedAt: 1003,
  };

  it('renders a single-row Game Studio header with direct Preview/Code/Publish tabs and reserved Cloud registry slot', async () => {
    await renderViewer([MY_GAME], MY_GAME.id, { studioMode: 'game' });

    const viewer = container.querySelector('.om-sa-viewer')!;
    expect(viewer.getAttribute('data-studio-mode')).toBe('game');
    expect(viewer.querySelector('.om-sa-viewer-tabs-bar')).toBeNull();
    expect(viewer.querySelector('.om-sa-game-studio-bar')).not.toBeNull();

    // Direct tabs: Preview, Code, Publish (Cloud is registered as a disabled extension slot)
    const tabs = [...viewer.querySelectorAll<HTMLButtonElement>('.om-sa-game-studio-tabs [role="tab"]')];
    expect(tabs.map(tab => tab.dataset.tabId)).toEqual(['preview', 'code', 'publish']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(GAME_STUDIO_TAB_REGISTRY.some(item => item.id === 'cloud' && item.enabled === false)).toBe(true);

    // Switching to Publish renders GamePublishPanel as full-stage studio view
    const publishTab = tabs.find(tab => tab.dataset.tabId === 'publish')!;
    await act(async () => publishTab.click());
    expect(publishTab.getAttribute('aria-selected')).toBe('true');
    const stage = viewer.querySelector('.om-sa-viewer-stage')!;
    expect(stage.getAttribute('data-publish-studio')).toBe('true');
    const publishPanel = viewer.querySelector('aside[aria-label="Publish panel"]');
    expect(publishPanel?.getAttribute('data-presentation')).toBe('studio');

    // Switching back to Preview closes the full-stage publish view
    const previewTab = tabs.find(tab => tab.dataset.tabId === 'preview')!;
    await act(async () => previewTab.click());
    expect(stage.getAttribute('data-publish-studio')).toBeNull();
    expect(viewer.querySelector('aside[aria-label="Publish panel"]')).toBeNull();
  });

  it('integrates browser URL navigation, multi-tab switching, and web history controls inside Preview mode', async () => {
    const onOpenWebUrl = vi.fn();
    const onCloseTab = vi.fn();
    await renderViewer([MY_GAME, WEB_REF_ARTIFACT], MY_GAME.id, {
      studioMode: 'game',
      onOpenWebUrl,
      onCloseTab,
    });

    const viewer = container.querySelector('.om-sa-viewer')!;
    // While viewing the game tab, Back/Forward stay hidden; Reload and switcher are inside the browser capsule
    expect(viewer.querySelector('.om-sa-game-browser-bar button[aria-label="Back"]')).toBeNull();
    expect(viewer.querySelector('.om-sa-game-browser-bar button[aria-label="Reload"]')).not.toBeNull();

    const switcher = viewer.querySelector<HTMLButtonElement>('button[aria-label="Switch preview tab or enter URL"]')!;
    expect(switcher.textContent).toContain('My Custom Game');
    expect(switcher.querySelector('.om-sa-game-tab-count')?.textContent).toBe('2');

    await act(async () => switcher.click());
    const popover = document.querySelector('.om-sa-game-switcher-popover')!;
    expect(popover).not.toBeNull();

    // Switch to the open web reference tab
    const tabOptions = [...popover.querySelectorAll<HTMLButtonElement>('.om-sa-game-tab-select')];
    expect(tabOptions).toHaveLength(2);
    await act(async () => tabOptions[1].click());

    // Now on the web tab, Back/Forward browser controls appear inside the integrated capsule
    expect(viewer.querySelector('.om-sa-game-browser-bar button[aria-label="Back"]')).not.toBeNull();
    expect(viewer.querySelector('.om-sa-game-browser-bar button[aria-label="Forward"]')).not.toBeNull();
    expect(viewer.querySelector('.om-sa-game-studio-tabs [role="tab"][data-tab-id="code"]')).toBeNull();
    expect(viewer.querySelector('.om-sa-game-studio-tabs [role="tab"][data-tab-id="publish"]')).toBeNull();

    // Open switcher again to test live tab filtering, URL navigation, and tab close
    await act(async () => switcher.click());
    const urlInput = document.querySelector<HTMLInputElement>('.om-sa-game-switcher-popover input[aria-label="Artifact address bar"]')!;
    expect(urlInput.hasAttribute('data-panel-search-input')).toBe(true);
    const form = urlInput.closest('form')!;
    const setInputValue = (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(urlInput, value);
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // Typing filters open tabs live while also offering web search / URL navigation
    await act(async () => setInputValue('Design Ref'));
    const filteredTabRows = document.querySelectorAll('.om-sa-game-switcher-popover .om-sa-game-tab-row');
    expect(filteredTabRows).toHaveLength(1);
    expect(filteredTabRows[0].textContent).toContain('Game Design Ref');

    await act(async () => setInputValue('localhost:5173'));
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onOpenWebUrl).toHaveBeenCalledWith('http://localhost:5173');

    await act(async () => switcher.click());
    expect(switcher.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.om-sa-game-switcher-popover')).not.toBeNull();
    // Clicking into an iframe blurs the parent window and dismisses the switcher popover
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      vi.runAllTimers();
    });
    expect(switcher.getAttribute('aria-expanded')).toBe('false');

    await act(async () => switcher.click());
    const closeBtn = document.querySelector<HTMLButtonElement>('.om-sa-game-tab-close')!;
    await act(async () => closeBtn.click());
    expect(onCloseTab).toHaveBeenCalledWith(MY_GAME.id);
  });

  it('omits Code and Publish tabs for trial/external games while keeping Preview and Viewport presets', async () => {
    await renderViewer([EXTERNAL_TENNIS], EXTERNAL_TENNIS.id, { studioMode: 'game' });

    const viewer = container.querySelector('.om-sa-viewer')!;
    const tabs = [...viewer.querySelectorAll<HTMLButtonElement>('.om-sa-game-studio-tabs [role="tab"]')];
    expect(tabs.map(tab => tab.dataset.tabId)).toEqual(['preview']);
    expect(viewer.querySelector('button[aria-label="Viewport presets"]')).not.toBeNull();
    expect(viewer.querySelector('button[aria-label="Open external"]')).not.toBeNull();
    // External cross-origin games cannot be injected, so the root-level audio button is omitted
    expect(viewer.querySelector('.om-sa-game-audio-btn')).toBeNull();
  });

  it('controls local game audio at the root level via mute toggle and iframe postMessage handshake', async () => {
    await renderViewer([MY_GAME], MY_GAME.id, { studioMode: 'game' });

    const viewer = container.querySelector('.om-sa-viewer')!;
    const iframe = viewer.querySelector<HTMLIFrameElement>('iframe[title="My Custom Game"]')!;
    const postSpy = vi.spyOn(iframe.contentWindow!, 'postMessage');

    const muteBtn = viewer.querySelector<HTMLButtonElement>('.om-sa-game-audio-btn')!;
    expect(muteBtn).not.toBeNull();
    expect(muteBtn.getAttribute('aria-pressed')).toBe('false');

    await act(async () => muteBtn.click());
    expect(muteBtn.getAttribute('aria-pressed')).toBe('true');
    expect(muteBtn.hasAttribute('data-muted')).toBe(true);
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'om:preview-audio', token: expect.any(String), muted: true, volume: 1 }),
      '*',
    );

    postSpy.mockClear();
    // When the injected audio guard signals ready, parent immediately re-syncs muted state
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        data: { type: 'om:audio-guard-ready' },
      }));
    });
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'om:preview-audio', token: expect.any(String), muted: true, volume: 1 }),
      '*',
    );
  });

  it('reconciles Game Studio active tab to Preview when switching from game Code view to a web artifact', async () => {
    const webArtifact: SuperAgentArtifact = {
      id: 'web:docs',
      kind: 'web',
      title: 'Example Docs',
      url: 'https://example.com',
      updatedAt: 101,
    };
    await renderViewer([MY_GAME, webArtifact], MY_GAME.id, { studioMode: 'game' });

    const codeTab = container.querySelector<HTMLButtonElement>('.om-sa-game-studio-tab[data-tab-id="code"]')!;
    expect(codeTab).not.toBeNull();
    await act(async () => codeTab.click());
    expect(codeTab.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.om-sa-game-browser-bar')).toBeNull();

    // Switching to a web artifact (no Code view) must fall back to Preview so the browser bar stays visible
    await renderViewer([MY_GAME, webArtifact], webArtifact.id, { studioMode: 'game' });

    const previewTab = container.querySelector<HTMLButtonElement>('.om-sa-game-studio-tab[data-tab-id="preview"]')!;
    expect(previewTab.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.om-sa-game-browser-bar')).not.toBeNull();
  });
});
