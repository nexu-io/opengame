import { describe, expect, it } from 'vitest';
import type { GameCard } from '../../../../shared/game-contract';
import { TOP_EARNING_TAG } from './gameCatalog';
import {
  buildTryGamePool,
  clearTryPlayedGames,
  createTryGameSession,
  formatCompactLikeCount,
  getSimulatedGameLikeCount,
  isTryGameSaved,
  jumpTryGame,
  peekTryGameNeighbors,
  readTryGameReaction,
  readTryPlayedGames,
  readTrySavedGames,
  recordTryPlayedGame,
  stepTryGameNext,
  stepTryGamePrev,
  toggleTryGameReaction,
  toggleTryGameSaved,
  writeTryGameReaction,
} from './gameTryFeed';

function makeGame(id: string, overrides: Partial<GameCard> = {}): GameCard {
  return {
    id,
    title: `Game ${id}`,
    description: `Description for ${id}`,
    genre: 'casual',
    style: '3d',
    setting: null,
    orientation: 'portrait',
    multiplayer: false,
    maxPlayers: 1,
    status: 'published',
    cover: `cover-${id}.png`,
    playUrl: `/api/games/${id}/play/index.html`,
    plays: 0,
    likes: 0,
    dislikes: 0,
    reaction: 0,
    favorite: false,
    source: 'template',
    remixOf: null,
    controls: 'Tap to play',
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k: string) { return map.get(k) ?? null; },
    key(i: number) { return [...map.keys()][i] ?? null; },
    removeItem(k: string) { map.delete(k); },
    setItem(k: string, v: string) { map.set(k, v); },
  };
}

describe('gameTryFeed', () => {
  it('merges top-earning templates, existing templates, and embeddable community games while excluding mine, multiplayer, and non-embeddable entries', () => {
    const topEarning = makeGame('top-archer', { tags: [TOP_EARNING_TAG], genre: 'shooter' });
    const classicTemplate = makeGame('classic-drift', { genre: 'racing' });
    const mineDraft = makeGame('my-wip', { source: 'mine', status: 'draft' });
    const multiGame = makeGame('party-arena', { multiplayer: true, maxPlayers: 4 });
    const embedCommunity = makeGame('community-little-prince', {
      source: 'community',
      external: { url: 'https://littleprince.dev/', author: '@Saccc_c', postUrl: 'https://x.com/1', model: 'Opus', embeddable: true },
    });
    const blockedCommunity = makeGame('community-blocked', {
      source: 'community',
      external: { url: 'https://claude.ai/artifact/1', author: '@a', postUrl: 'https://x.com/2', model: 'Opus', embeddable: false },
    });

    const pool = buildTryGamePool(
      [topEarning, classicTemplate, mineDraft, multiGame],
      [embedCommunity, blockedCommunity, topEarning],
    );

    expect(pool.map(item => item.id)).toEqual([
      'top-archer',
      'classic-drift',
      'community-little-prince',
    ]);
  });

  it('supports bidirectional seeded PRNG switching without immediate repeats, deterministic back/forward history, and round wrap-around', () => {
    const pool = [
      makeGame('g1', { genre: 'shooter', tags: [TOP_EARNING_TAG] }),
      makeGame('g2', { genre: 'racing' }),
      makeGame('g3', { genre: 'casual', tags: [TOP_EARNING_TAG] }),
      makeGame('g4', { genre: 'platformer', source: 'community' }),
    ];

    let session = createTryGameSession(pool[0], 'seed-alpha');
    const seen = new Set<string>([pool[0].id]);

    // Step through remaining 3 games in the pool without repeats.
    for (let i = 0; i < 3; i += 1) {
      const step = stepTryGameNext(session, pool);
      expect(step.game).not.toBeNull();
      expect(step.cycled).toBe(false);
      expect(seen.has(step.game!.id)).toBe(false);
      seen.add(step.game!.id);
      session = step.session;
    }
    expect(seen.size).toBe(4);

    // Exhausting the pool wraps to a new round and flags cycled=true.
    const wrapped = stepTryGameNext(session, pool);
    expect(wrapped.cycled).toBe(true);
    expect(wrapped.game).not.toBeNull();
    expect(wrapped.game!.id).not.toBe(session.history[session.index].id);

    // Stepping Prev returns deterministically along visited history.
    const back1 = stepTryGamePrev(wrapped.session, pool);
    expect(back1.game?.id).toBe(session.history[session.index].id);
    const forward1 = stepTryGameNext(back1.session, pool);
    expect(forward1.game?.id).toBe(wrapped.game?.id);

    // At index 0 on game #1, Prev draws an unseen game from the reverse PRNG deck.
    const fresh = createTryGameSession(pool[0], 'seed-beta');
    const reverseStep = stepTryGamePrev(fresh, pool);
    expect(reverseStep.game).not.toBeNull();
    expect(reverseStep.game!.id).not.toBe(pool[0].id);
    expect(reverseStep.session.index).toBe(0);
    expect(reverseStep.session.history[1].id).toBe(pool[0].id);

    // Peek matches the exact upcoming next/prev games.
    const neighbors = peekTryGameNeighbors(fresh, pool);
    expect(neighbors.prev?.id).toBe(reverseStep.game?.id);
    expect(neighbors.next?.id).toBe(stepTryGameNext(fresh, pool).game?.id);

    // Jumping to an arbitrary game updates history cleanly.
    const jumped = jumpTryGame(fresh, pool[3]);
    expect(jumped.history[jumped.index].id).toBe('g4');
  });

  it('computes deterministic simulated like counts with live +1 toggle and persists reactions, played, and saved state', () => {
    const storage = makeMemoryStorage();
    const baseFeatured = getSimulatedGameLikeCount('archero-bow-legend', { featured: true });
    expect(baseFeatured).toBeGreaterThanOrEqual(1240);
    expect(getSimulatedGameLikeCount('archero-bow-legend', { featured: true, userReaction: 'like' }))
      .toBe(baseFeatured + 1);
    expect(formatCompactLikeCount(995)).toBe('995');
    expect(formatCompactLikeCount(1420)).toBe('1.4K');
    expect(formatCompactLikeCount(12_000)).toBe('12K');

    expect(readTryGameReaction('g1', storage)).toBeNull();
    const liked = toggleTryGameReaction(null, 'like');
    expect(liked).toBe('like');
    writeTryGameReaction('g1', liked, storage);
    expect(readTryGameReaction('g1', storage)).toBe('like');
    expect(toggleTryGameReaction('like', 'like')).toBeNull();

    recordTryPlayedGame('g1', storage, 100);
    recordTryPlayedGame('g2', storage, 200);
    recordTryPlayedGame('g1', storage, 300);
    const played = readTryPlayedGames(storage);
    expect(played.map(p => [p.id, p.playCount])).toEqual([['g1', 2], ['g2', 1]]);

    expect(isTryGameSaved('g1', storage)).toBe(false);
    expect(toggleTryGameSaved('g1', storage, 400).saved).toBe(true);
    expect(isTryGameSaved('g1', storage)).toBe(true);
    expect(readTrySavedGames(storage).map(s => s.id)).toEqual(['g1']);
    expect(toggleTryGameSaved('g1', storage, 500).saved).toBe(false);

    clearTryPlayedGames(storage);
    expect(readTryPlayedGames(storage)).toEqual([]);
  });
});
