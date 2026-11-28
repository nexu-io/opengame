// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { ModelCatalogView } from './ModelCatalogView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const card = (id: string) => ({ id, title: id, provider: 'Example', downloadable: false });
const page = (ids: string[], nextCursor: string | null) => Response.json({ models: ids.map(card), nextCursor });

afterEach(() => vi.unstubAllGlobals());

it('auto-loads in the scrolling container, preserves cards on retry and discards stale query results', async () => {
  const host = document.createElement('div');
  host.style.overflowY = 'auto';
  document.body.append(host);
  const root = createRoot(host);
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  const observers: { show: () => void; options: IntersectionObserverInit }[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      observers.push({ show: () => callback([{ isIntersecting: true, boundingClientRect: { height: 32 } } as IntersectionObserverEntry], this as unknown as IntersectionObserver), options });
    }
    observe() {}
    disconnect() {}
  });
  let later!: (response: Response) => void;
  const fetch = vi.fn().mockResolvedValueOnce(page(['first'], 'two'))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page(['first', 'second'], 'three'))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { later = resolve; }))
    .mockResolvedValueOnce(page(['forest'], null));
  vi.stubGlobal('fetch', fetch);
  const render = async (query: string, dimension: '2d' | '3d') => act(async () => root.render(<I18nProvider initialLocale="en"><ModelCatalogView
    query={query} dimension={dimension} onQuery={() => {}} onDimension={() => {}} acquire={async () => {}} reloadKey={0} /></I18nProvider>));
  const cards = () => Array.from(host.querySelectorAll('li strong'), node => node.textContent);
  try {
    await render('chair', '3d');
    expect(observers.at(-1)?.options).toEqual({ root: host, rootMargin: '0px 0px 720px 0px' });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await act(async () => observers.at(-1)!.show());
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { hidden.mockRestore(); }
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { observers.at(-1)!.show(); observers.at(-1)!.show(); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cards()).toEqual(['first']);
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Retry')!.click());
    expect(cards()).toEqual(['first', 'second']);
    await act(async () => observers.at(-1)!.show());
    await render('forest', '2d');
    await act(async () => later(page(['stale'], 'old')));
    expect(cards()).toEqual(['forest']);
    expect(host.textContent).not.toContain('Load more');
    expect(fetch.mock.calls.map(args => String(args[0]))).toEqual([
      '/motion-api/model-catalog/search?q=chair', '/motion-api/model-catalog/search?q=chair&cursor=two', '/motion-api/model-catalog/search?q=chair&cursor=two',
      '/motion-api/model-catalog/search?q=chair&cursor=three', '/motion-api/model-catalog/search?q=forest&dimension=2d',
    ]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(['paper', 'dark'])('replaces full-card skeletons in place through loading, failure and retry in %s', async theme => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', undefined);
  const host = document.createElement('div');
  host.setAttribute('data-motion-ui', '');
  host.setAttribute('data-motion-studio', '');
  if (theme === 'paper') host.dataset.theme = theme;
  document.body.append(host);
  const root = createRoot(host);
  let finish!: (response: Response) => void;
  let fail!: (error: Error) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve, reject) => { finish = resolve; fail = reject; })));
  const placeholders = () => host.querySelectorAll('.om-model-grid > li[aria-hidden="true"]');
  const footerButton = () => host.querySelector<HTMLButtonElement>('.om-model-catalog > div:last-child button')!;
  try {
    await act(async () => root.render(<I18nProvider initialLocale="en"><ModelCatalogView dimension={theme === 'paper' ? '2d' : '3d'} query="" onQuery={() => {}} onDimension={() => {}} acquire={async () => {}} reloadKey={0} /></I18nProvider>));
    expect(host.querySelector('.om-model-grid[data-discovery][aria-busy="true"]')).toBeTruthy();
    expect(placeholders()).toHaveLength(6);
    expect(placeholders()[0].querySelectorAll('span[aria-hidden="true"]')).toHaveLength(4);
    await act(async () => finish(page(['first'], 'next')));
    const first = host.querySelector('li');
    const next = footerButton();
    next.focus();
    await act(async () => next.click());
    expect(placeholders()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(150));
    expect(placeholders().length).toBeGreaterThan(0);
    expect(host.querySelector('li')).toBe(first);
    expect(document.activeElement).toBe(next);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading…');
    await act(async () => fail(new Error('offline')));
    expect(placeholders()).toHaveLength(0);
    expect(footerButton().textContent).toBe('Retry');
    await act(async () => footerButton().click());
    await act(async () => vi.advanceTimersByTime(150));
    expect(placeholders().length).toBeGreaterThan(0);
    await act(async () => finish(page(['second'], null)));
    expect(placeholders()).toHaveLength(0);
    expect(host.querySelector('li')).toBe(first);
    expect(Array.from(host.querySelectorAll('li strong'), title => title.textContent)).toEqual(['first', 'second']);
    expect(footerButton()).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});

it('keeps Load more keyboard-accessible without an observer and stops on a repeated cursor', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const fetch = vi.fn().mockResolvedValueOnce(page(['first'], 'cursor')).mockResolvedValueOnce(page(['first'], 'cursor'));
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<I18nProvider initialLocale="en"><ModelCatalogView dimension="3d" query="" onQuery={() => {}} onDimension={() => {}} acquire={async () => {}} reloadKey={0} /></I18nProvider>));
    const next = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Load more');
    expect(next?.disabled).toBe(false);
    await act(async () => next!.click());
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.textContent).not.toContain('Load more');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); }
});
