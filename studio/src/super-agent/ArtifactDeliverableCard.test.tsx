// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SuperAgentArtifact } from '../../../shared/super-agent';
import { I18nProvider } from '../i18n/I18n';
import { bundledGames } from '../motion/game/gameCatalog';
import { ArtifactDeliverableCard, SupportingAssetRow } from './ArtifactDeliverableCard';
import { gamePublishActions, gamePublishSessionFor, resetGamePublishStore } from './gamePublish/gamePublishStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}

afterEach(() => {
  resetGamePublishStore();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function renderCard(artifact: SuperAgentArtifact, handlers: Partial<Parameters<typeof ArtifactDeliverableCard>[0]> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenArtifactId = handlers.onOpenArtifactId ?? vi.fn();
  const onCopyText = handlers.onCopyText ?? vi.fn();
  const onNotify = handlers.onNotify ?? vi.fn();
  const onOpenInDesignStudio = handlers.onOpenInDesignStudio ?? vi.fn();
  const onOpenInMotionStudio = handlers.onOpenInMotionStudio ?? vi.fn();
  const onOpenInAssets = handlers.onOpenInAssets ?? vi.fn();
  const onOpenInBrandKit = handlers.onOpenInBrandKit ?? vi.fn();

  act(() => {
    root.render(
      <I18nProvider>
        <ArtifactDeliverableCard
          artifact={artifact}
          chatId={handlers.chatId}
          layout={handlers.layout}
          isActiveInViewer={handlers.isActiveInViewer}
          onOpenArtifactId={onOpenArtifactId}
          onCopyText={onCopyText}
          onNotify={onNotify}
          onOpenInDesignStudio={onOpenInDesignStudio}
          onOpenInMotionStudio={onOpenInMotionStudio}
          onOpenInAssets={onOpenInAssets}
          onOpenInBrandKit={onOpenInBrandKit}
        />
      </I18nProvider>,
    );
  });

  return {
    container,
    root,
    onOpenArtifactId,
    onCopyText,
    onNotify,
    onOpenInDesignStudio,
    onOpenInMotionStudio,
    onOpenInAssets,
    onOpenInBrandKit,
  };
}

describe('ArtifactDeliverableCard', () => {
  it('renders Play, Cloud deploy, and Export ZIP for game-project without eager account fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x50, 0x4b, 0x05, 0x06]), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="voxel-musou.zip"',
        },
      }),
    );
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-game-zip');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const gameArtifact: SuperAgentArtifact = {
      id: 'game:g-42',
      kind: 'game-project',
      title: 'Voxel Musou',
      subtitle: '3D Action',
      projectId: 'g-42',
      url: '/motion-api/games/g-42/play/index.html',
      createdAt: 1,
      updatedAt: 2,
    };
    const { container, onOpenArtifactId, onNotify, root } = renderCard(gameArtifact);
    await flush();

    // Lazy WebPublishPopover must not fire background account/status fetches on card mount
    expect(fetchSpy).not.toHaveBeenCalled();

    const text = container.querySelector('.om-sa-deliverable-actions')?.textContent ?? '';
    expect(text).toContain('Play');
    expect(text).toContain('Publish');
    expect(text).toContain('Share');
    expect(text).toContain('Export ZIP');

    // Primary Play button opens the artifact in the viewer
    const playBtn = container.querySelector<HTMLButtonElement>('.om-sa-deliverable-btn[data-primary]')!;
    await act(async () => playBtn.click());
    expect(onOpenArtifactId).toHaveBeenCalledWith('game:g-42');

    // Export ZIP hits /motion-api/games/g-42/export and notifies user
    const exportBtn = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-deliverable-btn')].find(b =>
      b.textContent?.includes('Export ZIP'),
    )!;
    await act(async () => exportBtn.click());
    await flush();
    expect(fetchSpy).toHaveBeenCalledWith('/motion-api/games/g-42/export');
    expect(createUrlSpy).toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith('Exported voxel-musou.zip', 'info');

    act(() => root.unmount());
  });

  it('provides tailored share/export actions across design, motion, asset, brand-kit, and web artifacts', async () => {
    const cases: { artifact: SuperAgentArtifact; expected: string[] }[] = [
      {
        artifact: {
          id: 'design:d-1',
          kind: 'design-project',
          title: 'Launch Deck',
          scenario: 'deck',
          projectId: 'd-1',
          createdAt: 1,
          updatedAt: 2,
        },
        expected: ['Open editor', 'Share', 'Export'],
      },
      {
        artifact: {
          id: 'motion:m-1',
          kind: 'motion-project',
          title: 'Product Reel',
          projectId: 'm-1',
          createdAt: 1,
          updatedAt: 2,
        },
        expected: ['Open editor', 'Share'],
      },
      {
        artifact: {
          id: 'export:e-1',
          kind: 'motion-export',
          title: 'Product Reel.mp4',
          downloadUrl: '/api/exports/e-1/file',
          createdAt: 1,
          updatedAt: 2,
        },
        expected: ['Play', 'Download'],
      },
      {
        artifact: {
          id: 'asset:a-1',
          kind: 'asset-image',
          title: 'Hero Poster',
          assetId: 'a-1',
          versionId: 'v-1',
          url: '/motion-api/assets/a-1/versions/v-1/media',
          createdAt: 1,
          updatedAt: 2,
        },
        expected: ['Preview', 'Download', 'Open in Assets'],
      },
      {
        artifact: {
          id: 'brand:b-1',
          kind: 'brand-kit',
          title: 'OpenDesign Brand',
          kitId: 'b-1',
          createdAt: 1,
          updatedAt: 2,
        },
        expected: ['Preview', 'Export ZIP', 'Open in Brand Kit'],
      },
      {
        artifact: {
          id: 'web:w-1',
          kind: 'web',
          title: 'OpenDesign Docs',
          url: 'https://open-design.app/docs',
          createdAt: 1,
          updatedAt: 2,
        },
        expected: ['Preview', 'Copy link', 'Open in browser'],
      },
    ];

    for (const item of cases) {
      const { container, root } = renderCard(item.artifact);
      await flush();
      const actionText = container.querySelector('.om-sa-deliverable-actions')?.textContent ?? '';
      for (const label of item.expected) {
        expect(actionText).toContain(label);
      }
      if (item.artifact.kind === 'design-project') {
        expect(actionText).not.toContain('Edit in Studio');
      }
      if (item.artifact.kind === 'motion-project') {
        expect(actionText).not.toContain('Export video');
      }
      act(() => root.unmount());
      container.remove();
    }
  });

  it('strips internal routing prefixes from model subtitles, frames portrait covers, and reflects active Viewer state', async () => {
    let allowManualError = false;
    const imgErrorSpy = vi.spyOn(HTMLImageElement.prototype, 'dispatchEvent').mockImplementation(function (this: HTMLImageElement, ev: Event) {
      if (ev.type === 'error' && !allowManualError) return false;
      return EventTarget.prototype.dispatchEvent.call(this, ev);
    });
    const portraitGame: SuperAgentArtifact = {
      id: 'game:fruit-stack',
      kind: 'game-project',
      title: '叠叠果摊',
      subtitle: 'casual · Playable ad',
      playableAd: true,
      scenario: 'portrait',
      projectId: 'fruit-stack',
      url: '/motion-api/games/fruit-stack/play/index.html',
      createdAt: 1,
      updatedAt: 2,
    };
    const { container, root } = renderCard(portraitGame, { layout: 'hero', isActiveInViewer: true });

    const card = container.querySelector('.om-sa-deliverable-card')!;
    expect(card.getAttribute('data-layout')).toBe('hero');
    expect(card.getAttribute('data-has-stage')).toBe('true');
    expect(card.getAttribute('data-portrait-cover')).toBe('true');
    expect(card.getAttribute('data-viewer-active')).toBe('true');
    expect(card.querySelector('.om-sa-deliverable-stage')?.getAttribute('data-stage-mode')).toBe('portrait-frame');
    expect(card.querySelector('.om-sa-deliverable-stage-phone')).toBeTruthy();
    expect(card.querySelector('.om-sa-deliverable-stage-play')).toBeNull();
    expect(card.querySelector('.om-sa-deliverable-open-cue')).toBeNull();
    expect(card.textContent).toContain('Portrait 9:16');
    expect(card.querySelector('.om-sa-deliverable-btn[data-primary]')?.textContent).toContain('Playing in Viewer');

    act(() => root.unmount());
    container.remove();

    // Built-in remix cover (cover.webp) renders full-bleed stage and omits "HTML Game" jargon when genre exists
    const remixGame: SuperAgentArtifact = {
      id: 'game:mahjong-3d',
      kind: 'game-project',
      title: '3D 物理麻将',
      subtitle: 'casual · Game Studio',
      playableAd: false,
      scenario: 'portrait',
      projectId: 'mahjong-3d',
      previewUrl: '/motion-api/games/mahjong-3d/play/cover.webp',
      url: '/motion-api/games/mahjong-3d/play/index.html',
      createdAt: 1,
      updatedAt: 2,
    };
    const remixRender = renderCard(remixGame, { layout: 'hero', isActiveInViewer: false });
    const remixCard = remixRender.container.querySelector('.om-sa-deliverable-card')!;
    expect(remixCard.getAttribute('data-has-stage')).toBe('true');
    expect(remixCard.querySelector('.om-sa-deliverable-stage')?.getAttribute('data-stage-mode')).toBe('full-bleed');
    expect(remixCard.querySelector<HTMLImageElement>('.om-sa-deliverable-stage-img')?.src).toContain('/play/cover.webp');
    expect(remixCard.querySelector('.om-sa-deliverable-stage-play')).toBeTruthy();
    expect(remixCard.textContent).toContain('Casual');
    expect(remixCard.textContent).toContain('Portrait 9:16');
    expect(remixCard.textContent).not.toContain('HTML Game');
    act(() => remixRender.root.unmount());
    remixRender.container.remove();

    // Legacy remix artifact without previewUrl falls back from assets/cover.png to cover.webp on image error
    const legacyRemix: SuperAgentArtifact = {
      id: 'game:legacy-remix',
      kind: 'game-project',
      title: '3D 物理麻将',
      subtitle: 'casual · Game Studio',
      scenario: 'portrait',
      projectId: 'legacy-remix',
      url: '/motion-api/games/legacy-remix/play/index.html',
      createdAt: 1,
      updatedAt: 2,
    };
    const legacyRender = renderCard(legacyRemix, { layout: 'hero' });
    const firstImg = legacyRender.container.querySelector<HTMLImageElement>('.om-sa-deliverable-stage-phone-img')!;
    expect(firstImg.src).toContain('/play/assets/cover.png');
    await act(async () => {
      allowManualError = true;
      firstImg.dispatchEvent(new Event('error'));
      allowManualError = false;
    });
    const fallbackImg = legacyRender.container.querySelector<HTMLImageElement>('.om-sa-deliverable-stage-img');
    expect(fallbackImg?.src).toContain('/play/cover.webp');
    expect(legacyRender.container.querySelector('.om-sa-deliverable-stage')?.getAttribute('data-stage-mode')).toBe('full-bleed');
    act(() => legacyRender.root.unmount());
    legacyRender.container.remove();
    imgErrorSpy.mockRestore();

    const imageAsset: SuperAgentArtifact = {
      id: 'asset:img-1',
      kind: 'asset-image',
      title: '果摊晨市背景',
      subtitle: 'account:gpt-image-2',
      assetId: 'img-1',
      versionId: 'v-1',
      url: '/motion-api/assets/img-1/versions/v-1/media',
      createdAt: 1,
      updatedAt: 2,
    };
    const imgRender = renderCard(imageAsset);
    await flush();
    expect(imgRender.container.textContent).toContain('GPT Image 2');
    expect(imgRender.container.textContent).not.toContain('account:');
    act(() => imgRender.root.unmount());
    imgRender.container.remove();
  });

  it('plays supporting audio inline and previews supporting images in a lightbox without switching the Viewer', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('pause'));
    });

    const onOpenArtifactId = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const audioArtifact: SuperAgentArtifact = {
      id: 'asset:bgm-1',
      kind: 'asset-audio',
      title: '果摊晨曲',
      subtitle: 'account:elevenlabs-music-v2',
      assetId: 'bgm-1',
      versionId: 'v-1',
      url: '/motion-api/assets/bgm-1/versions/v-1/media',
      createdAt: 1,
      updatedAt: 2,
    };
    const imgArtifact: SuperAgentArtifact = {
      id: 'asset:bg-1',
      kind: 'asset-image',
      title: '果摊晨市背景',
      subtitle: 'account:gpt-image-2',
      assetId: 'bg-1',
      versionId: 'v-1',
      url: '/motion-api/assets/bg-1/versions/v-1/media',
      createdAt: 1,
      updatedAt: 2,
    };

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <div>
            <SupportingAssetRow artifact={audioArtifact} onOpenArtifactId={onOpenArtifactId} onOpenInAssets={vi.fn()} />
            <SupportingAssetRow artifact={imgArtifact} onOpenArtifactId={onOpenArtifactId} onOpenInAssets={vi.fn()} />
          </div>
        </I18nProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('Eleven Music v2');
    expect(container.textContent).toContain('GPT Image 2');
    expect(container.textContent).not.toContain('account:');

    // Audio plays inline without invoking onOpenArtifactId
    const audioMain = container.querySelector<HTMLButtonElement>('.om-sa-supporting-row[data-kind="asset-audio"] .om-sa-supporting-main')!;
    await act(async () => audioMain.click());
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(onOpenArtifactId).not.toHaveBeenCalled();

    // Image opens lightbox without invoking onOpenArtifactId
    const imgMain = container.querySelector<HTMLButtonElement>('.om-sa-supporting-row[data-kind="asset-image"] .om-sa-supporting-main')!;
    await act(async () => imgMain.click());
    await flush();
    expect(document.querySelector('.om-sa-lightbox-popup')).toBeTruthy();
    expect(document.querySelector<HTMLImageElement>('.om-sa-lightbox-img')?.src).toContain('/motion-api/assets/bg-1/versions/v-1/media');
    expect(onOpenArtifactId).not.toHaveBeenCalled();

    act(() => root.unmount());
    expect(pauseSpy).toHaveBeenCalled();
    container.remove();
  });

  it('opens and toggles the game publish wizard from the game deliverable card, and hides Publish on bundled templates', async () => {
    const gameArtifact: SuperAgentArtifact = {
      id: 'game:gold-jar',
      kind: 'game-project',
      title: 'Gold Jar',
      subtitle: 'casual · Playable ad',
      playableAd: true,
      scenario: 'portrait',
      projectId: 'gold-jar',
      entry: 'index.html',
      url: '/motion-api/games/gold-jar/play/index.html',
      createdAt: 1,
      updatedAt: 2,
    };

    const onOpenArtifactId = vi.fn();
    const { container, root } = renderCard(gameArtifact, {
      chatId: 'chat-game-1',
      layout: 'hero',
      isActiveInViewer: false,
      onOpenArtifactId,
    });
    await flush();

    const publishBtn = () => container.querySelector<HTMLButtonElement>('.om-sa-deliverable-publish-btn');
    expect(publishBtn()).toBeTruthy();
    expect(publishBtn()?.textContent).toContain('Publish');
    expect(publishBtn()?.getAttribute('aria-pressed')).toBe('false');
    expect(publishBtn()?.hasAttribute('data-active')).toBe(false);

    // Clicking Publish when viewer is closed opens the publish session and opens the game artifact in the viewer
    await act(async () => publishBtn()!.click());
    expect(onOpenArtifactId).toHaveBeenCalledWith('game:gold-jar');
    expect(gamePublishSessionFor('game:gold-jar')).toMatchObject({
      open: true,
      chatId: 'chat-game-1',
      gameId: 'gold-jar',
      gameTitle: 'Gold Jar',
      orientation: 'portrait',
      link: { targetId: 'gold-jar', filePath: 'index.html', title: 'Gold Jar' },
    });

    // When viewer is still closed (isActiveInViewer=false), clicking Publish keeps the session open and re-opens the viewer
    onOpenArtifactId.mockClear();
    await act(async () => publishBtn()!.click());
    expect(onOpenArtifactId).toHaveBeenCalledWith('game:gold-jar');
    expect(gamePublishSessionFor('game:gold-jar')?.open).toBe(true);

    // Once active in viewer with publish session open, button reflects active state and toggles the panel closed on click
    act(() => {
      root.render(
        <I18nProvider>
          <ArtifactDeliverableCard
            artifact={gameArtifact}
            chatId="chat-game-1"
            layout="hero"
            isActiveInViewer
            onOpenArtifactId={onOpenArtifactId}
          />
        </I18nProvider>,
      );
    });
    expect(publishBtn()?.getAttribute('aria-pressed')).toBe('true');
    expect(publishBtn()?.hasAttribute('data-active')).toBe(true);

    onOpenArtifactId.mockClear();
    await act(async () => publishBtn()!.click());
    expect(gamePublishSessionFor('game:gold-jar')?.open).toBe(false);
    expect(publishBtn()?.getAttribute('aria-pressed')).toBe('false');
    expect(onOpenArtifactId).not.toHaveBeenCalled();

    // Closing or reopening externally via store keeps the card button synced
    await act(async () => gamePublishActions.reopen('game:gold-jar'));
    expect(publishBtn()?.getAttribute('aria-pressed')).toBe('true');

    act(() => root.unmount());
    container.remove();

    // Bundled template games are trial-only and must not expose Publish
    const bundled = bundledGames[0];
    if (bundled) {
      const templateRender = renderCard({
        id: `game:${bundled.id}`,
        kind: 'game-project',
        title: bundled.title,
        projectId: bundled.id,
        url: `/motion-api/games/${bundled.id}/play/index.html`,
        createdAt: 1,
        updatedAt: 2,
      }, { layout: 'hero' });
      expect(templateRender.container.querySelector('.om-sa-deliverable-publish-btn')).toBeNull();
      act(() => templateRender.root.unmount());
      templateRender.container.remove();
    }
  });
});
