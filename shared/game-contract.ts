/**
 * Game Studio contract shared by Studio (studio/src/motion/game) and the local
 * service (game-projects.ts, mounted at /api/games/).
 *
 * Flow: pick genre / style / setting → one-line single-player brief → the Agent
 * interviews, fixes a style formula, writes the game and validates it → the game
 * is published to the local game market where anyone can play it and remix it.
 */

export const gameGenres = ['shooter', 'platformer', 'story', 'casual', 'racing', 'horror'] as const;
export const gameStyles = ['pixel', 'minimal', 'ascii', 'voxel', 'anime', '3d'] as const;
export const gameSettings = ['medieval', 'cyberpunk', 'retro', 'modern', 'space', 'fantasy'] as const;

export type GameGenre = typeof gameGenres[number];
export type GameStyle = typeof gameStyles[number];
export type GameSetting = typeof gameSettings[number];

export const gameGenreLabels: Record<GameGenre, string> = {
  shooter: 'Shooter',
  platformer: 'Platformer',
  story: 'Visual novel',
  casual: 'Casual',
  racing: 'Racing',
  horror: 'Horror',
};

/** Lifecycle of a game project. Only `published` games appear in Explore. */
export type GameStatus = 'draft' | 'building' | 'ready' | 'published' | 'failed';

export type GameBrief = {
  prompt: string;
  genre: GameGenre | null;
  style: GameStyle | null;
  setting: GameSetting | null;
  multiplayer: boolean;
  /** Screen shape the game is built for; portrait is a 9:16 phone layout. Defaults to landscape. */
  orientation?: 'landscape' | 'portrait';
  /** Portrait only: build a playable ad (instant play, hand tutorial, short levels, end card with a call to action) instead of a regular game. */
  playableAd?: boolean;
};

export type GameCard = {
  id: string;
  title: string;
  /** The workspace owner named the game explicitly. Keep it when the Agent revises the game. */
  titleCustomized?: boolean;
  description: string;
  genre: GameGenre;
  style: GameStyle | null;
  setting: GameSetting | null;
  multiplayer: boolean;
  /** Max players per room; 1 for single-player games. */
  maxPlayers: number;
  /** Portrait games are built for a phone held upright (9:16); the stage shows them in a phone-shaped frame. */
  orientation?: 'portrait' | 'landscape';
  /** True when the game was built as a playable ad. */
  playableAd?: boolean;
  status: GameStatus;
  /** Studio-relative or absolute URL of the cover image. */
  cover: string | null;
  /** URL that loads the playable game (an HTML page). */
  playUrl: string;
  plays: number;
  likes: number;
  dislikes: number;
  /** The current viewer's reaction and favourite state. */
  reaction: -1 | 0 | 1;
  favorite: boolean;
  /** `template` games ship with OpenMotion; `mine` games were made in this workspace; `community` games are external links. */
  source: 'template' | 'mine' | 'community';
  /** Community games open on the creator's own site and cannot be remixed here. */
  external?: { url: string; author: string; postUrl: string; model: string; embeddable: boolean };
  remixOf: string | null;
  controls: string;
  /** Optional per-locale title, description and controls shipped with the game (e.g. { 'zh-CN': { title, description } }). */
  i18n?: Record<string, { title?: string; description?: string; controls?: string }>;
  /** Optional featured curation tags (e.g. "TOP赚钱") exposed as visible card badges and market filters. */
  tags?: string[];
  /** Latest trailer job for this game, if one was started. */
  trailer?: GameTrailer;
  createdAt: string;
  updatedAt: string;
};

/**
 * Trailer pipeline: the server records gameplay headlessly, then composes a short trailer as an OpenMotion video
 * project (title card from the cover, gameplay highlights, controls/invite end card) and renders an MP4.
 * POST /api/games/:id/trailer starts or restarts it; GET /api/games/:id/trailer reads the latest job.
 */
export type GameTrailerStatus = 'recording' | 'composing' | 'rendering' | 'ready' | 'failed';
export type GameTrailer = {
  status: GameTrailerStatus;
  /** 0–1 overall progress, when known. */
  progress?: number;
  /** Served MP4 of the finished trailer (game-relative URL under /api/games/:id/play/). */
  videoUrl?: string;
  /** Raw gameplay clips recorded for the trailer. */
  clips?: string[];
  /** The OpenMotion video project, so the user can keep editing the trailer in the Motion editor. */
  projectId?: string;
  error?: string;
  updatedAt: string;
};

/** A game folder the catalog could not read (an interrupted create or a malformed game.json); the other games still load. */
export type GameCatalogIssue = { id: string; message: string };
export type GameCatalog = { games: GameCard[]; issues?: GameCatalogIssue[] };

/** Optional metadata overrides applied when remixing an existing local game or template. */
export type GameRemixOptions = {
  genre?: GameGenre | null;
  style?: GameStyle | null;
  setting?: GameSetting | null;
  orientation?: 'landscape' | 'portrait' | null;
};

/** True when a game is a complete, playable built-in local template eligible for zero-rebuild remix delivery. */
export function isReadyBuiltInTemplate(
  game: Pick<GameCard, 'source' | 'status'> & { external?: unknown },
): boolean {
  return !game.external && game.source === 'template' && (game.status === 'ready' || game.status === 'published');
}

/**
 * Curated default display order for flagship TOP赚钱 mini-game templates when play counts are tied.
 * Balances high-recognition viral genres across landscape and portrait masonry cards so first-fold
 * discovery leads with proven hits instead of arbitrary A-Z folder names.
 */
export const CURATED_TOP_EARNING_ORDER: readonly string[] = [
  'catch-goose-3d',
  'plants-vs-zombies',
  'archero-bow-legend',
  'billiards-3d-pro',
  'screw-puzzle',
  'fruit-slash-frenzy',
  'tile-stack',
  'dream-kitchen-chef',
  'watermelon-merge-3d',
  'beach-soccer-pro',
  'haunted-dorm-clash',
  'big-hero-squad',
  'backpack-hero',
  'bear-dash-runner',
  'arrow-out-3d',
  'hoop-dunk-master',
  '3d-mahjong',
  'zuma-marble-blast',
  'bus-queue-sort',
  'heroes-tactics-war',
  'block-blast',
  'billiards-trick-shot',
  'monkey-mart-idle',
  'assault-duel-combat',
  'parking-jam-hero',
  'battle-cats-clash',
  'knit-yarn-unravel',
  'human-cannon-blast',
  'dungeon-escape-horde',
  'apex-drift-3d',
];

const curatedOrderIndex = new Map(CURATED_TOP_EARNING_ORDER.map((id, index) => [id, index]));

/** Canonical catalog sort: published first, then play count descending, then curated flagship order, then id. */
export function compareGameCatalogOrder(
  a: Pick<GameCard, 'id' | 'plays'> & { status?: GameStatus },
  b: Pick<GameCard, 'id' | 'plays'> & { status?: GameStatus },
): number {
  const pubDiff = Number(b.status === 'published') - Number(a.status === 'published');
  if (pubDiff !== 0) return pubDiff;
  const playDiff = (b.plays ?? 0) - (a.plays ?? 0);
  if (playDiff !== 0) return playDiff;
  const rankA = curatedOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const rankB = curatedOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return a.id.localeCompare(b.id);
}

const PORTRAIT_BRIEF_MARKER = 'Layout: portrait 9:16 phone game.';
const PORTRAIT_BRIEF_SUFFIX = `${PORTRAIT_BRIEF_MARKER} Design every screen, HUD and control for a phone held upright (390×844); in a landscape window, centre the 9:16 play area and letterbox the sides.`;
const PLAYABLE_AD_BRIEF_MARKER = 'Format: playable ad. Follow the playable-ad recipe';
const PLAYABLE_AD_BRIEF_SUFFIX = `${PLAYABLE_AD_BRIEF_MARKER} in the openmotion-game skill (references/game-playable-ad.md): interactive on the first frame with a hand tutorial, no title screen, 3–8 short progressive levels, and a fail or win end card with Play again and a call-to-action button (keep visuals clean and snappy; standard OpenMotion runtime and generated media such as BGM are supported).`;

/** Strip auto-appended portrait layout / playable-ad paragraphs from a Game Studio brief prompt. */
export function stripGameBriefPromptSuffixes(prompt: string): string {
  let result = prompt;
  for (const marker of [PORTRAIT_BRIEF_MARKER, PLAYABLE_AD_BRIEF_MARKER]) {
    const idx = result.indexOf(`\n\n${marker}`);
    if (idx >= 0) result = result.slice(0, idx);
  }
  return result.trim();
}

/** Append canonical portrait layout and playable-ad paragraphs onto a base Game Studio prompt. */
export function formatGameBriefPrompt(
  prompt: string,
  options: { orientation?: 'landscape' | 'portrait'; playableAd?: boolean },
): string {
  const base = stripGameBriefPromptSuffixes(prompt);
  const withLayout = options.orientation === 'portrait' ? `${base}\n\n${PORTRAIT_BRIEF_SUFFIX}` : base;
  return options.playableAd ? `${withLayout}\n\n${PLAYABLE_AD_BRIEF_SUFFIX}` : withLayout;
}

/** POST /api/games and POST /api/games/:id/remix return the new project and the Agent brief. */
export type GameCreated = { game: GameCard; agentInstruction: string };
/** GET /api/games/:id/handoff — the full instruction to give the user's Agent for a workspace draft. */
export type GameHandoff = { gameId: string; status: GameStatus; agentInstruction: string };

/**
 * Server-authoritative multiplayer rules (logic.js). The room server calls these;
 * the client only sends inputs (about 10 per second) and draws `viewFor` results.
 * logic.js must be deterministic: no imports, no Math.random, no Date.now —
 * use ctx.random() and ctx.now instead.
 */
export type GameLogicModule<State = unknown, Action = unknown, View = unknown> = {
  meta: { minPlayers: number; maxPlayers: number; tickRate?: number };
  setup(ctx: GameLogicContext, players: string[]): State;
  validateAction(state: State, playerId: string, action: Action, ctx: GameLogicContext): boolean;
  applyAction(state: State, playerId: string, action: Action, ctx: GameLogicContext): State;
  isGameOver(state: State, ctx: GameLogicContext): { over: boolean; winners?: string[] };
  viewFor(state: State, playerId: string, ctx: GameLogicContext): View;
};

export type GameLogicContext = { random(): number; now: number; tick: number };

/** Room socket: ws(s)://<host>/api/games/:id/rooms/:room */
export type RoomClientMessage =
  | { type: 'join'; name?: string; /** Returned in 'joined'; reclaims the same player within 30 s after a refresh. */ reconnectToken?: string }
  | { type: 'input'; action: unknown }
  | { type: 'start' };
export type RoomServerMessage =
  | { type: 'joined'; playerId: string; room: string; players: { id: string; name: string }[]; maxPlayers: number; reconnectToken: string }
  | { type: 'state'; view: unknown; tick: number }
  | { type: 'over'; winners?: string[] }
  | { type: 'error'; message: string };

export const gameAssetInstructions = 'Follow openmotion-media routing in openmotion://workflow/game/start for every Game Studio project unless the user explicitly requested pure-code / zero-asset output: even when the user does not explicitly mention AI assets, default to elevating game quality with multimodal models (focal images, sprites/portraits, seamless PBR textures, looping BGM/voice/signature SFX audio, and for 3D briefs clean isolated concept or orthographic 3-view turnaround images into Image-to-3D when live 3D capability is available — prioritizing P0 near-camera focal subjects such as player hero/vehicle, primary boss/rival, signature weapon, plus 1–2 reusable foreground props over peripheral background decor). Always run read-only live capability discovery first via openmotion_capability_discover (including sound-effects, 3d-asset, 3d-world when active) or openmotion_media_use (action="inspect" passing modality for each planned asset type — e.g. "image" for visuals/textures/3-view sheets and "audio" for BGM/SFX/voice — then models with refresh:true and reference, including checking live "3d" capability on 3D briefs). Prefer usable signed-in OpenDesign models (mediaEntitlement "included" or signed-in "unknown", not "not-included") or configured BYOK providers. When planned image, audio, or video generation has no fitting usable provider for that modality (even if the user did not explicitly ask for AI assets): if the user is signed out with no usable API key (agent_media_signed_out), you MUST call openmotion_open_preview with the modality-scoped settingsHandoff from openmotion_media_use(action="inspect", modality=...) to open/return the OpenDesign sign-in page and guide the user to sign in (or configure an API key); if the user is signed in without a multimodal subscription (Free/Go mediaEntitlement "not-included", entry agent_media_upgrade_free / agent_media_upgrade_go), you MUST call openmotion_open_preview with that settingsHandoff (and present upgrade.url if returned) and explicitly inform the user that multimodal generation requires subscribing to OpenDesign Plus (or saving an API key); if a saved API key was rejected (agent_media_key_rejected), call openmotion_open_preview with settingsHandoff and ask them to replace the key. Pause in one turn with two clear choices: (1) sign in / subscribe to OpenDesign Plus (or save an API key) and reply to continue with AI multimodal assets, or (2) build a playable code-placeholder prototype first (procedural visuals plus WebAudio SFX/BGM). Fall back to procedural/CC0 art and WebAudio BGM/SFX only if the user chooses option (2), declines generation, or explicitly requested pure-code output (or for the 3D mesh step alone when no live 3D model is yet available on the platform, while still running image/audio discovery and onboarding normally). Do not pre-block Plus+ accounts on cached hasBalance; if a real generation request fails with insufficient balance / balance is too low, stop without retrying, call openmotion_open_preview(target="providers", entry="agent_media_balance_low"), and ask the user to top up and reply to resume. When usable models are ready, obtain one batched spend-consent check when required (skip if already granted or managed by Studio/host generation consent settings; stop after PLAN + that consent question if waiting), submit concurrently via openmotion_capability_run or openmotion_assets_use(action="generate") for planned focal visuals, textures/3-view sheets, 3D assets, and looping BGM/SFX, author game logic/UI while jobs run, inspect via batch read, and embed literal /motion-api/assets/<assetId>/versions/<versionId>/media URLs (or import local .glb models into the asset library).';
