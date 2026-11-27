import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import type { GameCard } from '../../../shared/game-contract';
import { Popover } from '../components/ui/Popover';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { coverUrl, gameApi, genreLabels, isTopEarningGame, TOP_EARNING_TAG } from '../motion/game/gameCatalog';
import { localizedGameControls, localizedGameDescription, localizedGameTitle } from '../motion/game/gameSuperAgent';
import {
  clearTryPlayedGames,
  createTryGameSession,
  formatCompactLikeCount,
  getSimulatedGameLikeCount,
  isTryGameSaved,
  jumpTryGame,
  peekTryGameNeighbors,
  readAllTryGameReactions,
  readTryGameReaction,
  readTryPlayedGames,
  readTrySavedGames,
  recordTryPlayedGame,
  stepTryGameNext,
  stepTryGamePrev,
  toggleTryGameReaction,
  toggleTryGameSaved,
  warmTryGameCover,
  writeTryGameReaction,
  type TryGameDirection,
  type TryGameFeedSession,
  type TryGameReaction,
} from '../motion/game/gameTryFeed';
import './tryGameFeed.css';

const SWIPE_COMMIT_PX = 68;
const MAX_DRAG_PX = 180;
const TRANSITION_MS = 380;
const warmedGameBundles = new Set<string>();

type HistoryTab = 'recent' | 'liked' | 'saved';

export interface TryGameFeedOverlayProps {
  activeGame: GameCard;
  pool: readonly GameCard[];
  onNavigateGame: (game: GameCard) => void;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
  children: ReactNode;
}

export function TryGameFeedOverlay({
  activeGame,
  pool,
  onNavigateGame,
  onNotify,
  children,
}: TryGameFeedOverlayProps) {
  const { t, locale } = useI18n();
  const [session, setSession] = useState<TryGameFeedSession>(() => createTryGameSession(activeGame));
  const [reaction, setReaction] = useState<TryGameReaction | null>(() => readTryGameReaction(activeGame.id));
  const [saved, setSaved] = useState<boolean>(() => isTryGameSaved(activeGame.id));
  const [likeBurstKey, setLikeBurstKey] = useState(0);
  const [railHistoryOpen, setRailHistoryOpen] = useState(false);
  const [railInfoOpen, setRailInfoOpen] = useState(false);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('recent');
  const [historyVersion, setHistoryVersion] = useState(0);

  // Smooth directional slide feedback when stepping between games
  const [transitionBanner, setTransitionBanner] = useState<{
    seq: number;
    game: GameCard;
    dir: TryGameDirection;
  } | null>(null);
  const transitionSeqRef = useRef(0);

  // Explicit mobile dual-state: starts in 'play' for the game the user tapped,
  // switches to 'browse' when swiping / stepping on narrow touch viewports.
  const [mobileMode, setMobileMode] = useState<'play' | 'browse'>('play');
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchOriginRef = useRef<{ x: number; y: number; moved: boolean; source: 'shield' | 'bar' } | null>(null);

  const canSwitch = pool.length > 1;
  const effectivePool = useMemo(
    () => (pool.some(item => item.id === activeGame.id) ? pool : [activeGame, ...pool]),
    [pool, activeGame],
  );
  const poolById = useMemo(
    () => new Map(effectivePool.map(item => [item.id, item])),
    [effectivePool],
  );

  // Keep PRNG history session, reaction, saved state, and played log synced when activeGame changes.
  useEffect(() => {
    setSession(prev => jumpTryGame(prev, activeGame));
    setReaction(readTryGameReaction(activeGame.id));
    setSaved(isTryGameSaved(activeGame.id));
    recordTryPlayedGame(activeGame.id);
    setHistoryVersion(v => v + 1);
    setRailHistoryOpen(false);
    setRailInfoOpen(false);
    setMobileHistoryOpen(false);
    setMobileInfoOpen(false);
  }, [activeGame.id, activeGame]);

  const neighbors = useMemo(
    () => (canSwitch ? peekTryGameNeighbors(session, effectivePool) : { next: null, prev: null }),
    [canSwitch, session, effectivePool],
  );

  // Pre-warm covers for next and previous games so transitions never flash blank.
  useEffect(() => {
    if (neighbors.next) warmTryGameCover(coverUrl(neighbors.next));
    if (neighbors.prev) warmTryGameCover(coverUrl(neighbors.prev));
  }, [neighbors.next, neighbors.prev]);

  // Quietly pre-warm the next local template bundle after settling so clicking Next opens fast.
  useEffect(() => {
    const next = neighbors.next;
    if (!next || next.external || next.source !== 'template' || warmedGameBundles.has(next.id)) return;
    if (typeof window === 'undefined' || !/^https?:$/i.test(window.location.protocol)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      warmedGameBundles.add(next.id);
      void fetch(`/motion-api/games/${encodeURIComponent(next.id)}/play/index.html`, {
        signal: controller.signal,
        credentials: 'same-origin',
      }).catch(() => {
        warmedGameBundles.delete(next.id);
      });
    }, 1200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [neighbors.next]);

  useEffect(() => {
    if (!transitionBanner) return;
    const timer = window.setTimeout(() => setTransitionBanner(null), TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [transitionBanner]);

  const triggerStep = useCallback(
    (direction: TryGameDirection, options?: { enterMobileBrowse?: boolean }) => {
      if (!canSwitch) return;
      const result = direction === 'down'
        ? stepTryGameNext(session, effectivePool)
        : stepTryGamePrev(session, effectivePool);
      if (!result.game || result.game.id === activeGame.id) return;
      setSession(result.session);
      if (options?.enterMobileBrowse) {
        setMobileMode('browse');
      }
      transitionSeqRef.current += 1;
      setTransitionBanner({
        seq: transitionSeqRef.current,
        game: result.game,
        dir: direction,
      });
      if (result.cycled) {
        onNotify?.(t('Shuffled a fresh round of games.'), 'info');
      }
      onNavigateGame(result.game);
    },
    [canSwitch, session, effectivePool, activeGame.id, onNavigateGame, onNotify, t],
  );

  // Alt+ArrowDown / Alt+ArrowUp keyboard navigation (never hijacks game arrow keys).
  useEffect(() => {
    if (!canSwitch) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const target = event.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      triggerStep(event.key === 'ArrowDown' ? 'down' : 'up');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSwitch, triggerStep]);

  const isFeatured = isTopEarningGame(activeGame) || activeGame.source === 'community';
  const likeCount = useMemo(
    () => getSimulatedGameLikeCount(activeGame.id, { featured: isFeatured, userReaction: reaction }),
    [activeGame.id, isFeatured, reaction],
  );
  const formattedLikes = useMemo(() => formatCompactLikeCount(likeCount), [likeCount]);

  const handleToggleLike = useCallback(() => {
    const next = toggleTryGameReaction(reaction, 'like');
    setReaction(next);
    writeTryGameReaction(activeGame.id, next);
    setHistoryVersion(v => v + 1);
    if (next === 'like') {
      setLikeBurstKey(k => k + 1);
    }
    if (activeGame.source === 'template') {
      void gameApi.react(activeGame.id, next === 'like' ? 1 : 0).catch(() => {});
    }
  }, [reaction, activeGame.id, activeGame.source]);

  const handleToggleSave = useCallback(() => {
    const res = toggleTryGameSaved(activeGame.id);
    setSaved(res.saved);
    setHistoryVersion(v => v + 1);
    onNotify?.(t(res.saved ? 'Saved to favorites' : 'Removed from favorites'), 'info');
    if (activeGame.source === 'template') {
      void gameApi.favorite(activeGame.id, res.saved).catch(() => {});
    }
  }, [activeGame.id, activeGame.source, onNotify, t]);

  const handleJumpToGame = useCallback(
    (target: GameCard) => {
      setRailHistoryOpen(false);
      setRailInfoOpen(false);
      setMobileHistoryOpen(false);
      setMobileInfoOpen(false);
      setMobileMode('play');
      if (target.id === activeGame.id) return;
      setSession(prev => jumpTryGame(prev, target));
      onNavigateGame(target);
    },
    [activeGame.id, onNavigateGame],
  );

  // Touch drag handling for mobile Card Browse shield & bottom bar swipe.
  const handleTouchStart = (source: 'shield' | 'bar') => (event: TouchEvent) => {
    if (!canSwitch || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchOriginRef.current = { x: touch.clientX, y: touch.clientY, moved: false, source };
    setIsDragging(true);
    setDragY(0);
  };

  const handleTouchMove = (event: TouchEvent) => {
    const origin = touchOriginRef.current;
    if (!origin || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dy = touch.clientY - origin.y;
    const dx = touch.clientX - origin.x;
    if (!origin.moved && Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
      origin.moved = true;
    }
    if (origin.moved) {
      const clamped = Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, dy));
      setDragY(clamped);
    }
  };

  const handleTouchEnd = () => {
    const origin = touchOriginRef.current;
    touchOriginRef.current = null;
    setIsDragging(false);
    if (!origin) return;
    const finalDy = dragY;
    setDragY(0);
    if (origin.moved && Math.abs(finalDy) >= SWIPE_COMMIT_PX) {
      triggerStep(finalDy < 0 ? 'down' : 'up', { enterMobileBrowse: true });
      return;
    }
    if (!origin.moved && origin.source === 'shield') {
      setMobileMode('play');
    }
  };

  const historyItems = useMemo(() => {
    void historyVersion;
    if (historyTab === 'recent') {
      return readTryPlayedGames()
        .map(record => poolById.get(record.id))
        .filter((item): item is GameCard => Boolean(item));
    }
    if (historyTab === 'liked') {
      const reactions = readAllTryGameReactions();
      return Object.entries(reactions)
        .filter(([, value]) => value === 'like')
        .reverse()
        .map(([id]) => poolById.get(id))
        .filter((item): item is GameCard => Boolean(item));
    }
    return readTrySavedGames()
      .map(record => poolById.get(record.id))
      .filter((item): item is GameCard => Boolean(item));
  }, [historyTab, historyVersion, poolById]);

  const activeTitle = localizedGameTitle(activeGame, locale);
  const activeDesc = localizedGameDescription(activeGame, locale);
  const activeControls = localizedGameControls(activeGame, locale);
  const activeCover = coverUrl(activeGame);
  const nextTitle = neighbors.next ? localizedGameTitle(neighbors.next, locale) : '';
  const prevTitle = neighbors.prev ? localizedGameTitle(neighbors.prev, locale) : '';
  const nextCover = neighbors.next ? coverUrl(neighbors.next) : null;
  const dragPeekDir: TryGameDirection | null = isDragging && Math.abs(dragY) > 18
    ? (dragY < 0 ? 'down' : 'up')
    : null;
  const dragPeekGame = dragPeekDir === 'down' ? neighbors.next : dragPeekDir === 'up' ? neighbors.prev : null;

  const historyPopoverContent = (
    <div className="om-try-feed-popover" data-try-game-history-panel="">
      <div className="om-try-feed-popover-head">
        <div>
          <div className="om-try-feed-popover-title">{t('Game history')}</div>
          <div className="om-try-feed-popover-sub">
            {t('{count} games in shuffle pool', { count: effectivePool.length })}
          </div>
        </div>
        {historyTab === 'recent' && historyItems.length > 0 && (
          <Button
            variant="plain"
            type="button"
            className="om-try-feed-filter-pill"
            onClick={() => {
              clearTryPlayedGames();
              setHistoryVersion(v => v + 1);
            }}
          >
            {t('Clear')}
          </Button>
        )}
      </div>

      <div className="om-try-feed-filter-row" role="tablist" aria-label={t('Game history')}>
        {(['recent', 'liked', 'saved'] as const).map(tab => (
          <Button
            key={tab}
            variant="plain"
            type="button"
            role="tab"
            aria-selected={historyTab === tab}
            data-active={historyTab === tab || undefined}
            data-try-game-history-tab={tab}
            className="om-try-feed-filter-pill"
            onClick={() => setHistoryTab(tab)}
          >
            {tab === 'recent' ? t('Played') : tab === 'liked' ? t('Liked') : t('Favorited')}
          </Button>
        ))}
      </div>

      <div className="om-try-feed-history-list">
        {historyItems.length === 0 ? (
          <div className="om-try-feed-empty">
            {historyTab === 'liked'
              ? t('No liked games yet.')
              : historyTab === 'saved'
                ? t('No saved games yet.')
                : t('No played games yet.')}
          </div>
        ) : (
          historyItems.map(item => {
            const thumb = coverUrl(item);
            const title = localizedGameTitle(item, locale);
            const isCurrent = item.id === activeGame.id;
            return (
              <Button
                key={item.id}
                variant="plain"
                type="button"
                className="om-try-feed-history-item"
                data-current={isCurrent || undefined}
                data-try-game-history-item={item.id}
                onClick={() => handleJumpToGame(item)}
              >
                {thumb ? (
                  <img className="om-try-feed-history-thumb" src={thumb} alt="" loading="lazy" />
                ) : (
                  <span className="om-try-feed-history-thumb" aria-hidden="true" />
                )}
                <span className="om-try-feed-history-meta">
                  <span className="om-try-feed-history-name">{title}</span>
                  <span className="om-try-feed-history-detail">
                    {t(genreLabels[item.genre] ?? item.genre)}
                    {isCurrent ? ` · ${t('Playing')}` : ''}
                  </span>
                </span>
              </Button>
            );
          })
        )}
      </div>
    </div>
  );

  const infoPopoverContent = (
    <div className="om-try-feed-popover" data-try-game-info-panel="">
      <div className="om-try-feed-info-hero">
        {activeCover ? (
          <img className="om-try-feed-info-thumb" src={activeCover} alt="" />
        ) : (
          <span className="om-try-feed-info-thumb" aria-hidden="true" />
        )}
        <div className="om-try-feed-history-meta">
          <div className="om-try-feed-popover-title">{activeTitle}</div>
          <div className="om-try-feed-transition-tags">
            {isTopEarningGame(activeGame) && (
              <span className="om-try-feed-chip" data-tone="brand">{TOP_EARNING_TAG}</span>
            )}
            <span className="om-try-feed-chip">{t(genreLabels[activeGame.genre] ?? activeGame.genre)}</span>
            <span className="om-try-feed-chip">
              {activeGame.orientation === 'portrait' ? '9:16' : '16:9'}
            </span>
          </div>
        </div>
      </div>

      {activeDesc && <p className="om-try-feed-info-desc">{activeDesc}</p>}

      {activeControls && (
        <div className="om-try-feed-info-row">
          <span className="om-try-feed-info-label">{t('Controls')}</span>
          <span className="om-try-feed-info-desc">{activeControls}</span>
        </div>
      )}

      <div className="om-try-feed-info-row">
        <span className="om-try-feed-popover-sub">
          {t('{likes} likes · {count} games in shuffle pool', {
            likes: formattedLikes,
            count: effectivePool.length,
          })}
        </span>
        {activeGame.external?.postUrl && (
          <a
            className="om-try-feed-info-link"
            href={activeGame.external.postUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('Original author · {author}', { author: activeGame.external.author })}
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="om-try-feed-shell"
      data-try-game-feed=""
      data-mobile-mode={mobileMode}
      data-dragging={isDragging ? 'true' : undefined}
    >
      <div className="om-try-feed-stage-wrap">
        <div className="om-try-feed-card-wrap">
          <div
            className="om-try-feed-card-inner"
            style={dragY !== 0 ? ({ '--try-feed-drag-y': `${dragY}px` } as React.CSSProperties) : undefined}
          >
            {children}

            {transitionBanner && (
              <div
                key={transitionBanner.seq}
                className="om-try-feed-transition"
                data-dir={transitionBanner.dir}
                data-try-game-transition=""
                aria-hidden="true"
              >
                {coverUrl(transitionBanner.game) && (
                  <img
                    className="om-try-feed-transition-cover"
                    src={coverUrl(transitionBanner.game)!}
                    alt=""
                  />
                )}
                <div className="om-try-feed-transition-meta">
                  <span className="om-try-feed-transition-title">
                    {localizedGameTitle(transitionBanner.game, locale)}
                  </span>
                  <div className="om-try-feed-transition-tags">
                    {isTopEarningGame(transitionBanner.game) && (
                      <span className="om-try-feed-chip" data-tone="brand">{TOP_EARNING_TAG}</span>
                    )}
                    <span className="om-try-feed-chip">
                      {t(genreLabels[transitionBanner.game.genre] ?? transitionBanner.game.genre)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {mobileMode === 'browse' && canSwitch && (
              <Button
                variant="plain"
                type="button"
                className="om-try-feed-swipe-shield"
                data-try-game-swipe-shield=""
                aria-label={t('Tap to play, or swipe for next game')}
                onClick={() => setMobileMode('play')}
                onTouchStart={handleTouchStart('shield')}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              />
            )}
          </div>

          {dragPeekGame && dragPeekDir && (
            <div className="om-try-feed-drag-peek" data-dir={dragPeekDir} aria-hidden="true">
              {coverUrl(dragPeekGame) && <img src={coverUrl(dragPeekGame)!} alt="" />}
              <div className="om-try-feed-drag-peek-content">
                <span className="om-try-feed-drag-badge">
                  {Math.abs(dragY) >= SWIPE_COMMIT_PX
                    ? t(dragPeekDir === 'down' ? 'Release for next game' : 'Release for previous game')
                    : t(dragPeekDir === 'down' ? 'Next game' : 'Previous game')}
                </span>
                <span className="om-try-feed-transition-title">
                  {localizedGameTitle(dragPeekGame, locale)}
                </span>
              </div>
            </div>
          )}

          {nextCover && mobileMode === 'browse' && (
            <div className="om-try-feed-stack-peek" data-try-game-stack-peek="" aria-hidden="true">
              <img src={nextCover} alt="" />
            </div>
          )}
        </div>

        {likeBurstKey > 0 && (
          <div key={likeBurstKey} className="om-try-feed-like-burst" data-try-game-like-burst="" aria-hidden="true">
            <RemixIcon name="thumb-up-fill" size={16} />
            <span>+1</span>
          </div>
        )}

        {/* Desktop right-side vertical arcade rail */}
        <aside className="om-try-feed-rail" data-try-game-rail="" aria-label={t('Game actions')}>
          {canSwitch && (
            <div className="om-try-feed-rail-group">
              <Tooltip label={prevTitle ? `${t('Previous game')}: ${prevTitle} (Alt+↑)` : `${t('Previous game')} (Alt+↑)`}>
                <IconButton
                  variant="plain"
                  className="om-try-feed-nav-btn"
                  data-try-game-prev=""
                  aria-label={t('Previous game')}
                  onClick={() => triggerStep('up')}
                  icon={<RemixIcon name="arrow-down-s-line" size={20} className="om-try-feed-chevron-up" />}
                />
              </Tooltip>
              <Tooltip label={nextTitle ? `${t('Next game')}: ${nextTitle} (Alt+↓)` : `${t('Next game')} (Alt+↓)`}>
                <IconButton
                  variant="plain"
                  className="om-try-feed-nav-btn"
                  data-primary="true"
                  data-try-game-next=""
                  aria-label={t('Next game')}
                  onClick={() => triggerStep('down')}
                  icon={<RemixIcon name="arrow-down-s-line" size={20} />}
                />
              </Tooltip>
            </div>
          )}

          <div className="om-try-feed-rail-group">
            <Tooltip label={t('Like')}>
              <Button
                variant="plain"
                type="button"
                className="om-try-feed-rail-btn"
                data-liked={reaction === 'like' ? 'true' : undefined}
                data-try-game-like=""
                aria-label={t('Like')}
                aria-pressed={reaction === 'like'}
                onClick={handleToggleLike}
              >
                <RemixIcon name={reaction === 'like' ? 'thumb-up-fill' : 'thumb-up-line'} size={18} />
                <span className="om-try-feed-rail-count" data-try-game-like-count="">{formattedLikes}</span>
              </Button>
            </Tooltip>

            <Tooltip label={t(saved ? 'Remove from favorites' : 'Add to favorites')}>
              <Button
                variant="plain"
                type="button"
                className="om-try-feed-rail-btn"
                data-active={saved ? 'true' : undefined}
                data-try-game-save=""
                aria-label={t(saved ? 'Remove from favorites' : 'Add to favorites')}
                aria-pressed={saved}
                onClick={handleToggleSave}
              >
                <RemixIcon name={saved ? 'bookmark-fill' : 'bookmark-line'} size={18} />
                <span>{t(saved ? 'Favorited' : 'Favorite')}</span>
              </Button>
            </Tooltip>

            <Popover
              open={railHistoryOpen}
              onOpenChange={setRailHistoryOpen}
              side="left"
              align="center"
              initialFocus={false}
              aria-label={t('Game history')}
              tooltip={t('Game history')}
              trigger={
                <Button
                  variant="plain"
                  type="button"
                  className="om-try-feed-rail-btn"
                  data-active={railHistoryOpen ? 'true' : undefined}
                  data-try-game-history=""
                  aria-label={t('Game history')}
                  aria-expanded={railHistoryOpen}
                >
                  <RemixIcon name="history-line" size={18} />
                  <span>{t('Played')}</span>
                </Button>
              }
            >
              {historyPopoverContent}
            </Popover>

            <Popover
              open={railInfoOpen}
              onOpenChange={setRailInfoOpen}
              side="left"
              align="end"
              initialFocus={false}
              aria-label={t('Game details')}
              tooltip={t('Game details')}
              trigger={
                <Button
                  variant="plain"
                  type="button"
                  className="om-try-feed-rail-btn"
                  data-active={railInfoOpen ? 'true' : undefined}
                  data-try-game-info=""
                  aria-label={t('Game details')}
                  aria-expanded={railInfoOpen}
                >
                  <RemixIcon name="information-line" size={18} />
                  <span>{t('Info')}</span>
                </Button>
              }
            >
              {infoPopoverContent}
            </Popover>
          </div>
        </aside>
      </div>

      {/* Narrow / mobile single-row bottom action bar with vertical swipe-to-browse */}
      <div
        className="om-try-feed-mobile-bar"
        data-try-game-mobile-bar=""
        onTouchStart={handleTouchStart('bar')}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <span className="om-try-feed-grabber" aria-hidden="true" />
        <div className="om-try-feed-mobile-row">
          <div className="om-try-feed-mobile-nav">
            {canSwitch && (
              <>
                <Button
                  variant="plain"
                  type="button"
                  className="om-try-feed-mobile-next"
                  data-try-game-mobile-next=""
                  aria-label={t('Next game')}
                  onClick={() => triggerStep('down', { enterMobileBrowse: true })}
                >
                  <RemixIcon name="arrow-down-s-line" size={16} />
                  <span>{t('Next game')}</span>
                </Button>
                <IconButton
                  variant="plain"
                  className="om-try-feed-mobile-icon-btn"
                  data-try-game-mobile-prev=""
                  aria-label={t('Previous game')}
                  onClick={() => triggerStep('up', { enterMobileBrowse: true })}
                  icon={<RemixIcon name="arrow-down-s-line" size={16} className="om-try-feed-chevron-up" />}
                />
              </>
            )}
          </div>

          <div className="om-try-feed-mobile-actions">
            <Button
              variant="plain"
              type="button"
              className="om-try-feed-mobile-icon-btn"
              data-liked={reaction === 'like' ? 'true' : undefined}
              data-try-game-mobile-like=""
              aria-label={t('Like')}
              aria-pressed={reaction === 'like'}
              onClick={handleToggleLike}
            >
              <RemixIcon name={reaction === 'like' ? 'thumb-up-fill' : 'thumb-up-line'} size={15} />
              <span>{formattedLikes}</span>
            </Button>

            <IconButton
              variant="plain"
              className="om-try-feed-mobile-icon-btn"
              data-active={saved ? 'true' : undefined}
              data-try-game-mobile-save=""
              aria-label={t(saved ? 'Remove from favorites' : 'Add to favorites')}
              aria-pressed={saved}
              onClick={handleToggleSave}
              icon={<RemixIcon name={saved ? 'bookmark-fill' : 'bookmark-line'} size={15} />}
            />

            <Popover
              open={mobileHistoryOpen}
              onOpenChange={setMobileHistoryOpen}
              side="top"
              align="end"
              initialFocus={false}
              aria-label={t('Game history')}
              trigger={
                <IconButton
                  variant="plain"
                  className="om-try-feed-mobile-icon-btn"
                  data-active={mobileHistoryOpen ? 'true' : undefined}
                  aria-label={t('Game history')}
                  icon={<RemixIcon name="history-line" size={15} />}
                />
              }
            >
              {historyPopoverContent}
            </Popover>

            <Popover
              open={mobileInfoOpen}
              onOpenChange={setMobileInfoOpen}
              side="top"
              align="end"
              initialFocus={false}
              aria-label={t('Game details')}
              trigger={
                <IconButton
                  variant="plain"
                  className="om-try-feed-mobile-icon-btn"
                  data-active={mobileInfoOpen ? 'true' : undefined}
                  aria-label={t('Game details')}
                  icon={<RemixIcon name="information-line" size={15} />}
                />
              }
            >
              {infoPopoverContent}
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}
