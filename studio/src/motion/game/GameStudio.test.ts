import { describe, expect, it } from 'vitest';
import { CURATED_TOP_EARNING_ORDER } from '../../../../shared/game-contract';
import { trailerProjectHref } from './GameStudio';
import { bundledGames, communityGames, FABLE_TAG, isFableGame, isLocalOnly, isTopEarningGame, needsGameService, TOP_EARNING_TAG } from './gameCatalog';

describe('trailerProjectHref', () => {
  it('routes to the canonical /editor/:projectId URL instead of reusing the Game Studio pathname', () => {
    expect(trailerProjectHref('trailer-proj-1', '?game=space-shooter')).toBe(
      '/editor/trailer-proj-1#project/trailer-proj-1',
    );
  });

  it('preserves orthogonal presentation and tracking query params while dropping Game Studio params', () => {
    const trackingId = '11111111-2222-3333-4444-555555555555';
    expect(
      trailerProjectHref(
        'proj with space',
        `?game=space-shooter&embed=1&sidebar=0&conversation=0&tracking_context=${trackingId}`,
      ),
    ).toBe(
      `/editor/proj%20with%20space?embed=1&sidebar=0&conversation=0&tracking_context=${trackingId}#project/proj%20with%20space`,
    );
  });
});

describe('gameCatalog multi-file detection and internal tags', () => {
  it('omits withdrawn templates from the offline catalogue', () => {
    const ids = bundledGames.map(game => game.id);
    expect(ids).toContain('tidebreaker');
    for (const id of ['school-tycoon-3d', 'arrow-pop-clear', 'shaman-block-pop']) {
      expect(ids).not.toContain(id);
    }
  });

  it('keeps isolated game preview links local when copied', () => {
    expect(isLocalOnly('http://opengame-preview-0123456789abcdef01234567.localhost:54123/api/games/tidebreaker/play/index.html')).toBe(true);
  });

  it('requires the local game service for sibling assets, src bundles, and relative script/style files', () => {
    expect(needsGameService('<script src="src/system.bundle.js"></script>')).toBe(true);
    expect(needsGameService('<link rel="stylesheet" href="style.css">')).toBe(true);
    expect(needsGameService('<script>fetch("./assets/app.part0.js")</script>')).toBe(true);
    expect(needsGameService('<script>fetch("./app.part0.js")</script>')).toBe(true);
    expect(needsGameService('<!doctype html><script>console.log("inline")</script>')).toBe(false);
  });

  it('exposes the featured TOP赚钱 tag helper and marks all curated uploaded templates', () => {
    expect(isTopEarningGame({ tags: ['TOP赚钱'] })).toBe(true);
    expect(isTopEarningGame({ tags: ['top赚钱'] })).toBe(true);
    expect(isTopEarningGame({ tags: [] })).toBe(false);
    expect(isTopEarningGame({})).toBe(false);
    const tagged = bundledGames.filter(isTopEarningGame).map(game => game.id).sort();
    expect(tagged).toEqual(expect.arrayContaining([
      '3d-mahjong',
      'backpack-hero',
      'ball-match',
      'block-blast',
      'breakout-fire',
      'candy-match',
      'catch-fish',
      'catch-piggy',
      'chubby-bird-gym',
      'doomsday-survivor',
      'escape-match',
      'gold-miner',
      'hanzi-meme',
      'mahjong-pairs',
      'ocean-fish-match',
      'plants-vs-zombies',
      'screw-puzzle',
      'tile-stack',
      'village-defense',
    ]));
    for (const colleagueId of ['kazehane', 'shanghai-vice', 'vice-beach-golf-club', 'vice-beach-motor-club']) {
      expect(tagged).not.toContain(colleagueId);
    }
    for (const game of bundledGames.filter(isTopEarningGame)) {
      expect(game.tags).toContain(TOP_EARNING_TAG);
    }
  });

  it('orders the Top-100 curated flagship TOP赚钱 hits uniquely ahead of alphabetical uncurated ties', () => {
    expect(CURATED_TOP_EARNING_ORDER).toHaveLength(100);
    expect(new Set(CURATED_TOP_EARNING_ORDER).size).toBe(CURATED_TOP_EARNING_ORDER.length);
    const topIds = bundledGames.filter(isTopEarningGame).map(game => game.id);
    expect(topIds.slice(0, CURATED_TOP_EARNING_ORDER.length)).toEqual([...CURATED_TOP_EARNING_ORDER]);
  });
});

describe('Fable 5.2 community games', () => {
  it('tags only playable community games whose creator credits Fable 5.2', () => {
    const fable = communityGames.filter(isFableGame);
    expect(fable.length).toBeGreaterThanOrEqual(50);
    for (const game of fable) {
      expect(game.external?.embeddable).toBe(true);
      expect(game.external?.model).toContain(FABLE_TAG);
      expect(game.external?.url).toMatch(/^https:\/\//);
      expect(game.external?.postUrl).toMatch(/^https:\/\/x\.com\//);
      expect(game.cover).toBeTruthy();
    }
  });

  it('matches the tag case-insensitively and ignores untagged games', () => {
    expect(isFableGame({ tags: [' fable 5.2 '] })).toBe(true);
    expect(isFableGame({ tags: [TOP_EARNING_TAG] })).toBe(false);
    expect(isFableGame({})).toBe(false);
  });
});
