import type { GameCard } from '../../../../shared/game-contract';
import { isTopEarningGame } from './gameCatalog';

export type TryGameReaction = 'like' | 'dislike';
export type TryGameDirection = 'up' | 'down';

export interface TryPlayedGameRecord {
  id: string;
  lastPlayedAt: number;
  playCount: number;
}

export interface TrySavedGameRecord {
  id: string;
  savedAt: number;
}

export interface TryGameFeedSession {
  seed: string;
  history: GameCard[];
  index: number;
  seenIds: string[];
  forwardRound: number;
  reverseRound: number;
}

const SEED_STORAGE_KEY = 'om.try-game-feed.seed.v1';
const REACTIONS_STORAGE_KEY = 'om.try-game-feed.reactions.v1';
const PLAYED_STORAGE_KEY = 'om.try-game-feed.played.v1';
const SAVED_STORAGE_KEY = 'om.try-game-feed.saved.v1';
const MAX_STORED_REACTIONS = 500;
const MAX_PLAYED_RECORDS = 100;
const MAX_SAVED_RECORDS = 160;
const MAX_COVER_CACHE = 24;

const coverImageCache = new Map<string, HTMLImageElement>();

function getSafeStorage(kind: 'local' | 'session' = 'local'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function warmTryGameCover(url: string | null | undefined): void {
  if (!url || typeof Image === 'undefined') return;
  if (coverImageCache.has(url)) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  if (typeof img.decode === 'function') {
    void img.decode().catch(() => {});
  }
  coverImageCache.set(url, img);
  if (coverImageCache.size > MAX_COVER_CACHE) {
    const oldest = coverImageCache.keys().next().value;
    if (oldest) coverImageCache.delete(oldest);
  }
}

/**
 * Merges top-earning playable-ad templates, existing built-in templates, and embeddable
 * viral community games into one deduplicated, immediately-playable trial pool.
 */
export function buildTryGamePool(
  catalogGames: readonly GameCard[],
  communityList: readonly GameCard[],
): GameCard[] {
  const byId = new Map<string, GameCard>();
  const isPlayableTrial = (game: GameCard): boolean => {
    if (!game.id?.trim()) return false;
    if (game.multiplayer) return false;
    if (game.source === 'mine') return false;
    if (game.external && !game.external.embeddable) return false;
    return true;
  };
  for (const game of catalogGames) {
    if (isPlayableTrial(game) && !byId.has(game.id)) {
      byId.set(game.id, game);
    }
  }
  for (const game of communityList) {
    if (isPlayableTrial(game) && !byId.has(game.id)) {
      byId.set(game.id, game);
    }
  }
  return [...byId.values()];
}

function hashFnv1a(input: string): number {
  let hash = 0x811c9dc5;
  const normalized = input.trim().toLowerCase() || 'game';
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic xoshiro128** PRNG seeded from a string via splitmix32. */
function createSeededRng(seed: string): () => number {
  let state = hashFnv1a(seed) || 0x9e3779b9;
  const splitmix32 = () => {
    state = (state + 0x9e3779b9) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b) >>> 0;
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
    return (t ^ (t >>> 16)) >>> 0;
  };
  let s0 = splitmix32();
  let s1 = splitmix32();
  let s2 = splitmix32();
  let s3 = splitmix32();
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

  return () => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result / 0x1_0000_0000;
  };
}

export function createTryFeedSeed(storage: Storage | null = getSafeStorage('session')): string {
  if (storage) {
    try {
      const existing = storage.getItem(SEED_STORAGE_KEY)?.trim();
      if (existing) return existing;
    } catch {
      /* ignore storage errors */
    }
  }
  let generated = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint32Array(2);
      crypto.getRandomValues(bytes);
      generated = `try-${bytes[0].toString(36)}-${bytes[1].toString(36)}`;
    }
  } catch {
    /* fallback below */
  }
  if (!generated) {
    generated = `try-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  if (storage) {
    try {
      storage.setItem(SEED_STORAGE_KEY, generated);
    } catch {
      /* ignore storage errors */
    }
  }
  return generated;
}

function buildRoundSeed(baseSeed: string, round: number, salt?: 'prev'): string {
  return salt ? `${baseSeed}:${salt}:r${round}` : `${baseSeed}:r${round}`;
}

function gameWeight(game: GameCard): number {
  if (game.source === 'community') return 1.35;
  if (isTopEarningGame(game)) return 1.25;
  return 1.0;
}

/**
 * Produces a deterministic pseudo-random deck from the combined pool with weighted
 * anti-clump ordering (blending top-earning templates, existing templates, and viral
 * community games while avoiding consecutive identical genres when possible).
 */
export function rankTryGameDeck(
  pool: readonly GameCard[],
  seed: string,
  excludeIds: ReadonlySet<string>,
  anchorGame?: GameCard | null,
): GameCard[] {
  const candidates = pool.filter(item => !excludeIds.has(item.id));
  if (candidates.length <= 1) return candidates;

  const rng = createSeededRng(seed);
  const scored = candidates.map(game => {
    const u = Math.max(1e-7, rng());
    const key = Math.pow(u, 1 / gameWeight(game));
    return { game, key };
  });
  scored.sort((a, b) => b.key - a.key);

  const ordered: GameCard[] = [];
  const remaining = scored.map(entry => entry.game);
  let lastGenre: string | null = anchorGame?.genre ?? null;
  let lastSource: string | null = anchorGame?.source ?? null;

  while (remaining.length > 0) {
    // Look ahead within a small window to avoid genre clumps while preserving randomness.
    const windowSize = Math.min(remaining.length, 6);
    let pickIdx = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const candidate = remaining[i];
      if (candidate.genre !== lastGenre && candidate.source !== lastSource) {
        pickIdx = i;
        break;
      }
      if (candidate.genre !== lastGenre && pickIdx === 0) {
        pickIdx = i;
      }
    }
    const [picked] = remaining.splice(pickIdx, 1);
    ordered.push(picked);
    lastGenre = picked.genre;
    lastSource = picked.source;
  }

  return ordered;
}

export function createTryGameSession(
  initialGame: GameCard,
  seed: string = createTryFeedSeed(),
): TryGameFeedSession {
  return {
    seed,
    history: [initialGame],
    index: 0,
    seenIds: [initialGame.id],
    forwardRound: 0,
    reverseRound: 0,
  };
}

function appendSeen(seenIds: readonly string[], id: string): string[] {
  return seenIds.includes(id) ? [...seenIds] : [...seenIds, id];
}

export function stepTryGameNext(
  session: TryGameFeedSession,
  pool: readonly GameCard[],
): { session: TryGameFeedSession; game: GameCard | null; cycled: boolean } {
  if (session.index < session.history.length - 1) {
    const nextIndex = session.index + 1;
    const game = session.history[nextIndex] ?? null;
    return {
      session: { ...session, index: nextIndex },
      game,
      cycled: false,
    };
  }

  const current = session.history[session.index] ?? null;
  const exclude = new Set(session.seenIds);
  let forwardRound = session.forwardRound;
  let seenIds = session.seenIds;
  let cycled = false;

  let deck = rankTryGameDeck(pool, buildRoundSeed(session.seed, forwardRound), exclude, current);
  if (deck.length === 0 && pool.length > 1) {
    forwardRound += 1;
    cycled = true;
    const resetExclude = new Set(current ? [current.id] : []);
    seenIds = current ? [current.id] : [];
    deck = rankTryGameDeck(pool, buildRoundSeed(session.seed, forwardRound), resetExclude, current);
  }

  const nextGame = deck[0] ?? null;
  if (!nextGame) {
    return { session, game: null, cycled: false };
  }

  const history = [...session.history, nextGame];
  return {
    session: {
      ...session,
      history,
      index: history.length - 1,
      seenIds: appendSeen(seenIds, nextGame.id),
      forwardRound,
    },
    game: nextGame,
    cycled,
  };
}

export function stepTryGamePrev(
  session: TryGameFeedSession,
  pool: readonly GameCard[],
): { session: TryGameFeedSession; game: GameCard | null; cycled: boolean } {
  if (session.index > 0) {
    const prevIndex = session.index - 1;
    const game = session.history[prevIndex] ?? null;
    return {
      session: { ...session, index: prevIndex },
      game,
      cycled: false,
    };
  }

  const current = session.history[0] ?? null;
  const exclude = new Set(session.seenIds);
  let reverseRound = session.reverseRound;
  let seenIds = session.seenIds;
  let cycled = false;

  let deck = rankTryGameDeck(pool, buildRoundSeed(session.seed, reverseRound, 'prev'), exclude, current);
  if (deck.length === 0 && pool.length > 1) {
    reverseRound += 1;
    cycled = true;
    const resetExclude = new Set(current ? [current.id] : []);
    seenIds = current ? [current.id] : [];
    deck = rankTryGameDeck(pool, buildRoundSeed(session.seed, reverseRound, 'prev'), resetExclude, current);
  }

  const prevGame = deck[0] ?? null;
  if (!prevGame) {
    return { session, game: null, cycled: false };
  }

  return {
    session: {
      ...session,
      history: [prevGame, ...session.history],
      index: 0,
      seenIds: appendSeen(seenIds, prevGame.id),
      reverseRound,
    },
    game: prevGame,
    cycled,
  };
}

export function jumpTryGame(
  session: TryGameFeedSession,
  targetGame: GameCard,
): TryGameFeedSession {
  const current = session.history[session.index];
  if (current?.id === targetGame.id) return session;
  const existingIdx = session.history.findIndex(item => item.id === targetGame.id);
  if (existingIdx >= 0) {
    return {
      ...session,
      index: existingIdx,
      seenIds: appendSeen(session.seenIds, targetGame.id),
    };
  }
  const head = session.history.slice(0, session.index + 1);
  const history = [...head, targetGame];
  return {
    ...session,
    history,
    index: history.length - 1,
    seenIds: appendSeen(session.seenIds, targetGame.id),
  };
}

export function peekTryGameNeighbors(
  session: TryGameFeedSession,
  pool: readonly GameCard[],
): { next: GameCard | null; prev: GameCard | null } {
  const nextStep = stepTryGameNext(session, pool);
  const prevStep = stepTryGamePrev(session, pool);
  return {
    next: nextStep.game,
    prev: prevStep.game,
  };
}

/**
 * Deterministic simulated community like count per game ID (placeholder until
 * aggregate community reaction counters are exposed). Ticks +1 live when liked.
 */
export function getSimulatedGameLikeCount(
  gameId: string,
  options?: { featured?: boolean; userReaction?: TryGameReaction | null },
): number {
  const h = hashFnv1a(gameId);
  const unit = (h % 10_000) / 10_000;
  let base: number;
  if (options?.featured) {
    base = Math.round(1_240 + unit * unit * 16_800);
  } else if (h % 7 === 0) {
    base = Math.round(1_080 + unit * 3_420);
  } else {
    base = Math.round(92 + unit * 876);
  }
  return base + (options?.userReaction === 'like' ? 1 : 0);
}

export function formatCompactLikeCount(count: number): string {
  const safe = Math.max(0, Math.round(count));
  if (safe < 1_000) return String(safe);
  if (safe < 1_000_000) {
    const rounded = Math.round((safe / 1_000) * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}K` : `${rounded.toFixed(1)}K`;
  }
  const rounded = Math.round((safe / 1_000_000) * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}M` : `${rounded.toFixed(1)}M`;
}

export function readAllTryGameReactions(
  storage: Storage | null = getSafeStorage('local'),
): Record<string, TryGameReaction> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(REACTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, TryGameReaction> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k && (v === 'like' || v === 'dislike')) clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

export function readTryGameReaction(
  gameId: string,
  storage: Storage | null = getSafeStorage('local'),
): TryGameReaction | null {
  const key = gameId.trim();
  if (!key) return null;
  return readAllTryGameReactions(storage)[key] ?? null;
}

export function writeTryGameReaction(
  gameId: string,
  reaction: TryGameReaction | null,
  storage: Storage | null = getSafeStorage('local'),
): void {
  const key = gameId.trim();
  if (!key || !storage) return;
  try {
    const map = readAllTryGameReactions(storage);
    delete map[key];
    if (reaction) map[key] = reaction;
    const entries = Object.entries(map);
    const trimmed = entries.length > MAX_STORED_REACTIONS
      ? Object.fromEntries(entries.slice(-MAX_STORED_REACTIONS))
      : map;
    storage.setItem(REACTIONS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* best-effort persistence */
  }
}

export function toggleTryGameReaction(
  current: TryGameReaction | null,
  target: TryGameReaction,
): TryGameReaction | null {
  return current === target ? null : target;
}

export function readTryPlayedGames(
  storage: Storage | null = getSafeStorage('local'),
): TryPlayedGameRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PLAYED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is TryPlayedGameRecord => (
        Boolean(entry)
        && typeof entry === 'object'
        && typeof (entry as TryPlayedGameRecord).id === 'string'
        && (entry as TryPlayedGameRecord).id.trim().length > 0
        && typeof (entry as TryPlayedGameRecord).lastPlayedAt === 'number'
        && typeof (entry as TryPlayedGameRecord).playCount === 'number'
      ))
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
      .slice(0, MAX_PLAYED_RECORDS);
  } catch {
    return [];
  }
}

export function recordTryPlayedGame(
  gameId: string,
  storage: Storage | null = getSafeStorage('local'),
  now: number = Date.now(),
): TryPlayedGameRecord[] {
  const clean = gameId.trim();
  if (!clean) return readTryPlayedGames(storage);
  const existing = readTryPlayedGames(storage);
  const prev = existing.find(item => item.id === clean);
  const updated: TryPlayedGameRecord = {
    id: clean,
    lastPlayedAt: now,
    playCount: (prev?.playCount ?? 0) + 1,
  };
  const next = [updated, ...existing.filter(item => item.id !== clean)].slice(0, MAX_PLAYED_RECORDS);
  if (storage) {
    try {
      storage.setItem(PLAYED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* best-effort persistence */
    }
  }
  return next;
}

export function clearTryPlayedGames(
  storage: Storage | null = getSafeStorage('local'),
): void {
  if (!storage) return;
  try {
    storage.removeItem(PLAYED_STORAGE_KEY);
  } catch {
    /* best-effort persistence */
  }
}

export function readTrySavedGames(
  storage: Storage | null = getSafeStorage('local'),
): TrySavedGameRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is TrySavedGameRecord => (
        Boolean(entry)
        && typeof entry === 'object'
        && typeof (entry as TrySavedGameRecord).id === 'string'
        && (entry as TrySavedGameRecord).id.trim().length > 0
        && typeof (entry as TrySavedGameRecord).savedAt === 'number'
      ))
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX_SAVED_RECORDS);
  } catch {
    return [];
  }
}

export function isTryGameSaved(
  gameId: string,
  storage: Storage | null = getSafeStorage('local'),
): boolean {
  const clean = gameId.trim();
  if (!clean) return false;
  return readTrySavedGames(storage).some(item => item.id === clean);
}

export function toggleTryGameSaved(
  gameId: string,
  storage: Storage | null = getSafeStorage('local'),
  now: number = Date.now(),
): { saved: boolean; items: TrySavedGameRecord[] } {
  const clean = gameId.trim();
  const existing = readTrySavedGames(storage);
  if (!clean) return { saved: false, items: existing };
  const already = existing.some(item => item.id === clean);
  const next = already
    ? existing.filter(item => item.id !== clean)
    : [{ id: clean, savedAt: now }, ...existing].slice(0, MAX_SAVED_RECORDS);
  if (storage) {
    try {
      storage.setItem(SAVED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* best-effort persistence */
    }
  }
  return { saved: !already, items: next };
}
