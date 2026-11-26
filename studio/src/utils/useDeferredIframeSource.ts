import { useEffect, useState, type RefObject } from 'react';

function hasBrowserLayoutEngine(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof ResizeObserver !== 'function' || typeof requestAnimationFrame !== 'function') return false;
  return document.documentElement.getBoundingClientRect().width > 0;
}

/**
 * Defer attaching `src` / `srcDoc` on a newly mounted `<iframe>` until one animation
 * frame after mount AND the frame has a non-zero layout box.
 *
 * Chromium runs sandboxed (opaque-origin) iframes as Out-of-Process Iframes (OOPIFs).
 * Navigating an OOPIF in the same commit as element insertion starts navigation before
 * the parent commits `FrameRect`, causing the child document to initialize with
 * `window.innerWidth === 0` and `window.innerHeight === 0`. Waiting one frame (plus
 * `ResizeObserver` when initially hidden) ensures non-zero `VisualProperties` arrive
 * before the game scripts run.
 *
 * In non-layout test environments (jsdom/happy-dom) where root bounds are always 0,
 * returns `true` immediately so existing synchronous tests keep observing `src` on mount.
 */
export function useDeferredIframeSource(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  frameKey: string,
  enabled: boolean,
): boolean {
  const layoutReady = hasBrowserLayoutEngine();
  const [readyKey, setReadyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setReadyKey(null);
      return;
    }
    if (!layoutReady) return;

    let cancelled = false;
    let rafId = 0;
    let observer: ResizeObserver | null = null;

    const hasNonZeroBox = () => {
      const el = iframeRef.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const scheduleCommit = () => {
      if (cancelled || rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (cancelled) return;
        if (hasNonZeroBox()) {
          observer?.disconnect();
          observer = null;
          setReadyKey(frameKey);
        } else if (!observer && iframeRef.current) {
          observer = new ResizeObserver(() => {
            if (!cancelled && hasNonZeroBox()) {
              observer?.disconnect();
              observer = null;
              scheduleCommit();
            }
          });
          observer.observe(iframeRef.current);
        }
      });
    };

    scheduleCommit();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [enabled, frameKey, iframeRef, layoutReady]);

  if (!enabled) return false;
  if (!layoutReady) return true;
  return readyKey === frameKey;
}
