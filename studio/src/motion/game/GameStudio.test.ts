import { describe, expect, it } from 'vitest';
import { trailerProjectHref } from './GameStudio';
import { bundledGames, isTopEarningGame, needsGameService, TOP_EARNING_TAG } from './gameCatalog';

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

  it('orders curated flagship TOP赚钱 hits ahead of alphabetical uncurated ties', () => {
    const topIds = bundledGames.filter(isTopEarningGame).map(game => game.id);
    expect(topIds.slice(0, 6)).toEqual([
      'catch-goose-3d',
      'plants-vs-zombies',
      'archero-bow-legend',
      'billiards-3d-pro',
      'screw-puzzle',
      'fruit-slash-frenzy',
    ]);
  });
});
