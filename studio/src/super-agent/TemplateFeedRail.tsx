import { Button } from 'open-design-ui/button';
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import {
  canScrollInside,
  createWheelPager,
  isEditableTarget,
  type TemplateFeedDirection,
  type TemplateFeedPosition,
} from './templateFeed';

export type TemplateFeedControls = {
  position: TemplateFeedPosition;
  placement: 'side' | 'bottom';
  onStep: (direction: TemplateFeedDirection) => void;
};

/**
 * Wraps the template game preview with a rail that never covers the game: previous / next with the
 * position, then the actions the pane passes in (like, Remix, Share). Wheel and trackpad gestures over the stage margins and the rail switch
 * templates; wheel and drag inside the game iframe never reach this document, so play is untouched.
 * The wrapper always renders (feed or not) so the game below keeps its place in the tree and is not
 * reloaded when the list stops containing it.
 */
export function TemplateFeedStage({ feed, actions, children }: {
  feed: TemplateFeedControls | null;
  /** Like / Remix / Share, shown under previous and next. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef(feed);
  feedRef.current = feed;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const pager = createWheelPager({
      onPage: direction => {
        const current = feedRef.current;
        if (current && (direction < 0 ? current.position.prevId : current.position.nextId)) current.onStep(direction);
      },
    });
    const onWheel = (event: WheelEvent) => {
      if (!feedRef.current || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (canScrollInside(event.target, root, event.deltaY)) return;
      event.preventDefault();
      pager.push(event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', onWheel);
      pager.dispose();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Portaled popovers (Share) bubble through React but live outside this element: leave their keys alone.
    if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) return;
    if (!feed || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
    const direction = event.key === 'ArrowUp' || event.key === 'PageUp' ? -1
      : event.key === 'ArrowDown' || event.key === 'PageDown' ? 1
        : 0;
    if (!direction) return;
    event.preventDefault();
    if (direction < 0 ? feed.position.prevId : feed.position.nextId) feed.onStep(direction);
  };

  const placement = feed?.placement;
  const tooltipSide = placement === 'side' ? 'left' : 'top';
  return (
    <div
      ref={rootRef}
      className="om-sa-template-feed"
      data-placement={placement}
      tabIndex={feed ? -1 : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="om-sa-template-feed-stage">{children}</div>
      {feed && (
        <div className="om-sa-template-feed-rail" role="toolbar" aria-label={t('Switch template')} aria-orientation={placement === 'side' ? 'vertical' : 'horizontal'}>
          <div className="om-sa-template-feed-nav">
            <TemplateFeedAction
              variant="circle"
              icon="arrow-down-s-line"
              iconStyle={{ transform: 'rotate(180deg)' }}
              label={t('Prev game')}
              ariaLabel={t('Previous template')}
              tooltip={t('Previous template (↑)')}
              tooltipSide={tooltipSide}
              disabled={!feed.position.prevId}
              onClick={() => feed.onStep(-1)}
            />
            <TemplateFeedAction
              variant="primary"
              icon="arrow-down-s-line"
              label={t('Next game')}
              ariaLabel={t('Next template')}
              tooltip={t('Next template (↓)')}
              tooltipSide={tooltipSide}
              disabled={!feed.position.nextId}
              onClick={() => feed.onStep(1)}
            />
            <span className="om-sa-template-feed-count" aria-live="polite">
              {t('{current} / {total}', { current: feed.position.index + 1, total: feed.position.total })}
            </span>
          </div>
          {actions && <div className="om-sa-template-feed-actions">{actions}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * A rail button with a short label under it, matching the community game feed:
 * `plain` is a bare icon, `circle` a dark round button, `primary` the green round button (Next, Remix).
 */
export function TemplateFeedAction({
  variant = 'plain',
  icon,
  iconStyle,
  label,
  ariaLabel,
  tooltip,
  tooltipSide = 'left',
  pressed,
  disabled,
  onClick,
}: {
  variant?: 'plain' | 'circle' | 'primary';
  icon: string;
  iconStyle?: CSSProperties;
  label: string;
  ariaLabel: string;
  tooltip?: string;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const button = (
    <Button
      variant="plain"
      type="button"
      className="om-sa-template-feed-action"
      data-variant={variant}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      data-active={pressed || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="om-sa-template-feed-action-icon" aria-hidden="true">
        <RemixIcon name={icon} size={variant === 'plain' ? 18 : 20} style={iconStyle} />
      </span>
      <span className="om-sa-template-feed-action-label">{label}</span>
    </Button>
  );
  return tooltip ? <Tooltip label={tooltip} side={tooltipSide}>{button}</Tooltip> : button;
}
