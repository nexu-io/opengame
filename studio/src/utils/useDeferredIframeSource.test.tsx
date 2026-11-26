// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDeferredIframeSource } from './useDeferredIframeSource';

function makeRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('useDeferredIframeSource', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function Harness({ frameKey, url, enabled = true }: { frameKey: string; url: string; enabled?: boolean }) {
    const ref = useRef<HTMLIFrameElement | null>(null);
    const ready = useDeferredIframeSource(ref, frameKey, enabled);
    return <iframe ref={ref} key={frameKey} title="preview" {...(ready ? { src: url } : {})} />;
  }

  it('attaches src immediately in non-layout test environments (root width = 0)', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(<Harness frameKey="k1" url="/motion-api/games/test/play/index.html" />);
    });

    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe('/motion-api/games/test/play/index.html');
  });

  it('defers src until one animation frame after mount when browser layout is active', () => {
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue(makeRect(1280, 800));
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });

    vi.spyOn(HTMLIFrameElement.prototype, 'getBoundingClientRect').mockReturnValue(makeRect(800, 600));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(<Harness frameKey="k1" url="/motion-api/games/shanghai-vice/play/index.html" />);
    });

    // Render 1: iframe is mounted without src so the browser commits its FrameRect first.
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('src')).toBeNull();
    expect(rafQueue.length).toBe(1);

    act(() => {
      rafQueue.shift()!(16);
    });

    // After 1 rAF with a non-zero box, src is attached on the same iframe element.
    expect(container.querySelector('iframe')).toBe(iframe);
    expect(iframe.getAttribute('src')).toBe('/motion-api/games/shanghai-vice/play/index.html');

    // Changing frameKey resets readiness until the new iframe element commits a frame.
    act(() => {
      root!.render(<Harness frameKey="k2" url="/motion-api/games/kazehane/play/index.html" />);
    });
    const nextIframe = container.querySelector('iframe')!;
    expect(nextIframe).not.toBe(iframe);
    expect(nextIframe.getAttribute('src')).toBeNull();

    act(() => {
      rafQueue.shift()!(32);
    });
    expect(nextIframe.getAttribute('src')).toBe('/motion-api/games/kazehane/play/index.html');
  });

  it('waits via ResizeObserver when the iframe box starts at 0x0 until it becomes visible', () => {
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue(makeRect(1280, 800));
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    let observerCallback: ResizeObserverCallback | null = null;
    const disconnectSpy = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) {
        observerCallback = cb;
      }
      observe() {}
      disconnect() {
        disconnectSpy();
      }
    });

    let currentRect = makeRect(0, 0);
    vi.spyOn(HTMLIFrameElement.prototype, 'getBoundingClientRect').mockImplementation(() => currentRect);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(<Harness frameKey="hidden-k1" url="/motion-api/games/shanghai-vice/play/index.html" />);
    });

    // Frame 1 fires while iframe is still 0x0 -> stays deferred and registers ResizeObserver.
    act(() => {
      rafQueue.shift()!(16);
    });
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('src')).toBeNull();
    expect(observerCallback).not.toBeNull();

    // Container becomes visible -> ResizeObserver schedules commit -> next rAF attaches src.
    currentRect = makeRect(760, 720);
    act(() => {
      observerCallback!([], {} as ResizeObserver);
    });
    expect(iframe.getAttribute('src')).toBeNull();
    expect(disconnectSpy).toHaveBeenCalled();

    act(() => {
      rafQueue.shift()!(32);
    });
    expect(iframe.getAttribute('src')).toBe('/motion-api/games/shanghai-vice/play/index.html');
  });
});
