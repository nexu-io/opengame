// Swipe-to-switch for the game template preview: the right-hand viewer can step through the
// templates in the order the showcase currently lists them (active tab, search and sort).
// The ends stop instead of wrapping so players always know where the list begins and ends.

export type TemplateFeedDirection = -1 | 1;

export type TemplateFeedPosition = {
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
};

export function templateFeedPosition(ids: readonly string[], currentId: string | null): TemplateFeedPosition | null {
  if (!currentId || ids.length < 2) return null;
  const index = ids.indexOf(currentId);
  if (index < 0) return null;
  return {
    index,
    total: ids.length,
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

export type WheelPagerOptions = {
  /** Accumulated deltaY (px) needed before one page turn. */
  threshold?: number;
  /** A gesture ends after this long without wheel events; only then can the next turn fire. */
  idleMs?: number;
  onPage: (direction: TemplateFeedDirection) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

/**
 * Turns wheel / trackpad input into at most one page turn per gesture. Trackpad momentum keeps
 * emitting wheel events for a second or more, so the pager stays locked until the stream goes
 * quiet for `idleMs`, then accepts the next gesture.
 */
export function createWheelPager({
  threshold = 60,
  idleMs = 260,
  onPage,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id as ReturnType<typeof setTimeout>),
}: WheelPagerOptions) {
  let accumulated = 0;
  let locked = false;
  let idleTimer: unknown = null;

  const reset = () => {
    accumulated = 0;
    locked = false;
    idleTimer = null;
  };

  return {
    /** Returns true when this event turned the page. */
    push(deltaY: number): boolean {
      if (idleTimer !== null) clearTimer(idleTimer);
      idleTimer = setTimer(reset, idleMs);
      if (locked || !Number.isFinite(deltaY) || deltaY === 0) return false;
      // A reversal inside one gesture starts counting again from zero.
      if (accumulated !== 0 && Math.sign(accumulated) !== Math.sign(deltaY)) accumulated = 0;
      accumulated += deltaY;
      if (Math.abs(accumulated) < threshold) return false;
      locked = true;
      const direction: TemplateFeedDirection = accumulated > 0 ? 1 : -1;
      accumulated = 0;
      onPage(direction);
      return true;
    },
    dispose() {
      if (idleTimer !== null) clearTimer(idleTimer);
      reset();
    },
  };
}

/** True when `target` sits inside a scroll container (below `boundary`) that can still scroll that way. */
export function canScrollInside(target: EventTarget | null, boundary: Element, deltaY: number): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== boundary) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 1) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        if (deltaY < 0 && node.scrollTop > 0) return true;
        if (deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'IFRAME';
}
