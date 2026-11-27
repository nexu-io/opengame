// @vitest-environment happy-dom
import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { createWheelPager, templateFeedPosition } from './templateFeed';
import { TemplateFeedAction, TemplateFeedStage } from './TemplateFeedRail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('templateFeedPosition', () => {
  const ids = ['a', 'b', 'c'];

  it('finds neighbours in the listed order and stops at both ends', () => {
    expect(templateFeedPosition(ids, 'b')).toEqual({ index: 1, total: 3, prevId: 'a', nextId: 'c' });
    expect(templateFeedPosition(ids, 'a')).toMatchObject({ prevId: null, nextId: 'b' });
    expect(templateFeedPosition(ids, 'c')).toMatchObject({ prevId: 'b', nextId: null });
  });

  it('has no feed for games outside the list or a single-item list', () => {
    expect(templateFeedPosition(ids, 'mine-1')).toBeNull();
    expect(templateFeedPosition(['a'], 'a')).toBeNull();
    expect(templateFeedPosition(ids, null)).toBeNull();
  });
});

describe('createWheelPager', () => {
  it('turns one page per gesture, even with trackpad momentum', () => {
    vi.useFakeTimers();
    const onPage = vi.fn();
    const pager = createWheelPager({ onPage, threshold: 60, idleMs: 200 });

    for (let i = 0; i < 30; i += 1) {
      pager.push(25);
      vi.advanceTimersByTime(16);
    }
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenLastCalledWith(1);

    vi.advanceTimersByTime(250);
    pager.push(-80);
    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenLastCalledWith(-1);
    pager.dispose();
    vi.useRealTimers();
  });

  it('ignores small nudges below the threshold', () => {
    vi.useFakeTimers();
    const onPage = vi.fn();
    const pager = createWheelPager({ onPage, threshold: 60, idleMs: 200 });
    pager.push(20);
    pager.push(-20);
    pager.push(30);
    expect(onPage).not.toHaveBeenCalled();
    pager.dispose();
    vi.useRealTimers();
  });
});

describe('TemplateFeedStage', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  function render(position: { index: number; total: number; prevId: string | null; nextId: string | null } | null) {
    const onStep = vi.fn();
    const onLike = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <I18nProvider>
          <TemplateFeedStage
            feed={position ? { position, placement: 'side', onStep } : null}
            actions={<TemplateFeedAction icon="thumb-up-line" label="Like" ariaLabel="Like" onClick={onLike} />}
          >
            <iframe title="game" />
          </TemplateFeedStage>
        </I18nProvider>,
      );
    });
    return { onStep, onLike, stage: host.querySelector<HTMLElement>('.om-sa-template-feed')! };
  }

  it('steps with the rail buttons and arrow keys, and disables the end of the list', () => {
    const { onStep, onLike, stage } = render({ index: 0, total: 3, prevId: null, nextId: 'b' });
    const [prev, next, like] = Array.from(stage.querySelectorAll<HTMLButtonElement>('.om-sa-template-feed-action'));
    act(() => like.click());
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(onStep).not.toHaveBeenCalled();
    expect(prev.disabled).toBe(true);
    expect(stage.textContent).toContain('1 / 3');

    act(() => next.click());
    expect(onStep).toHaveBeenLastCalledWith(1);

    act(() => { stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(onStep).toHaveBeenCalledTimes(2);
    act(() => { stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('switches on a wheel over the stage margin but not on keys sent from inside the game', () => {
    const { onStep, stage } = render({ index: 1, total: 3, prevId: 'a', nextId: 'c' });
    act(() => { stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); });
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenLastCalledWith(1);

    const frame = stage.querySelector('iframe')!;
    act(() => { frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it('keeps the game mounted with no rail and ignores wheel and keys when the template leaves the list', () => {
    const { onStep, stage } = render(null);
    expect(stage.querySelector('iframe')).not.toBeNull();
    expect(stage.querySelector('.om-sa-template-feed-rail')).toBeNull();
    act(() => { stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); });
    act(() => { stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('ignores arrow keys from a portaled popover such as Share', () => {
    const onStep = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <I18nProvider>
          <TemplateFeedStage
            feed={{ position: { index: 1, total: 3, prevId: 'a', nextId: 'c' }, placement: 'side', onStep }}
            actions={createPortal(<button type="button" className="portaled-share">Share</button>, document.body)}
          >
            <iframe title="game" />
          </TemplateFeedStage>
        </I18nProvider>,
      );
    });
    const portaled = document.body.querySelector('.portaled-share')!;
    act(() => { portaled.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(onStep).not.toHaveBeenCalled();
  });
});
