// @vitest-environment happy-dom
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountSummary } from '../../../shared/provider-directory';
import { I18nProvider, languages, translate, type Locale } from '../i18n/I18n';
import {
  MAGI2_MODAL_DISMISSED_STORAGE_NAME,
  MAGI2_MODAL_SEEN_COOKIE,
  MAGI2_MODAL_VIDEO_URL,
  buildMagi2ConsolePlanUrl,
  isMagi2ModalOpen,
  readMagi2CountdownParts,
  resolveMagi2ModalCopy,
  shouldSkipExploreHeroIntro,
} from './magi2LaunchModalConfig';

type TestAccount = Pick<AccountSummary, 'state' | 'plan' | 'billingUnavailable'> & {
  mediaEntitlement?: 'included' | 'not-included' | 'unknown';
};

const mockAccountState = vi.hoisted(() => ({
  account: null as TestAccount | null,
  error: false,
}));

vi.mock('./AccountSettings', () => ({
  useAccountSummary: () => ({
    account: mockAccountState.account,
    error: mockAccountState.error,
    refresh: vi.fn(),
    setAccount: vi.fn(),
  }),
}));
vi.mock('./tracking', () => ({ trackMotion: vi.fn() }));
vi.mock('./entitlementAttribution', async importOriginal => {
  const actual = await importOriginal<typeof import('./entitlementAttribution')>();
  return {
    ...actual,
    useCheckoutReturnRefresh: () => vi.fn(),
  };
});

import { ExploreBlackFridayHero } from './ExploreBlackFridayHero';
import { Magi2LaunchModal } from './Magi2LaunchModal';
import { trackMotion } from './tracking';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function clearCookies() {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

function renderWithI18n(node: React.ReactNode, locale: Locale = 'zh-CN') {
  act(() => {
    root.render(<I18nProvider initialLocale={locale}>{node}</I18nProvider>);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-27T12:00:00+08:00'));
  vi.mocked(trackMotion).mockClear();
  clearCookies();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  delete document.documentElement.dataset.magi2ModalOpen;
  mockAccountState.account = null;
  mockAccountState.error = false;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearCookies();
  window.sessionStorage.clear();
  delete document.documentElement.dataset.magi2ModalOpen;
  vi.useRealTimers();
});

describe('OpenGame Magi2LaunchModal logic & assets', () => {
  it('provides complete localized copy across all 11 supported locales via i18n bundles', () => {
    expect(languages).toHaveLength(11);
    const en = resolveMagi2ModalCopy('en', (msg, values, context) => translate('en', msg, values, context));
    expect(en.eyebrow).toBe('7 Days Unlimited!');
    expect(en.headline).toBe('First Launch · MAGI-2');
    expect(en.cta).toBe('Start Unlimited');
    expect(en.countdownPrefix).toBe('Ends in');

    for (const { locale } of languages) {
      const copy = resolveMagi2ModalCopy(locale, (msg, values, context) => translate(locale, msg, values, context));
      expect(copy.eyebrow.trim().length, `empty eyebrow for ${locale}`).toBeGreaterThan(0);
      expect(copy.headline, `missing MAGI-2 in headline for ${locale}`).toContain('MAGI-2');
      expect(copy.description.some(s => s.strong), `missing bold segments for ${locale}`).toBe(true);
      expect(copy.cta.trim().length, `empty cta for ${locale}`).toBeGreaterThan(0);
      expect(copy.countdownPrefix.trim().length, `empty countdownPrefix for ${locale}`).toBeGreaterThan(0);
      expect(copy.closeLabel.trim().length, `empty closeLabel for ${locale}`).toBeGreaterThan(0);
      if (locale !== 'en') {
        expect(copy.eyebrow).not.toBe(en.eyebrow);
        expect(copy.headline).not.toBe(en.headline);
        expect(copy.cta).not.toBe(en.cta);
      }
    }

    // Verify MAGI-2 modal countdown prefix stays distinct from BlackFridayTopBanner "Ends in" in zh-CN.
    expect(translate('zh-CN', 'Ends in')).toBe('距结束');
    expect(translate('zh-CN', 'Ends in', undefined, 'MAGI-2 modal')).toBe('黑五限时');
  });

  it('computes 12-hour rolling countdown with centiseconds', () => {
    expect(readMagi2CountdownParts(Date.parse('2026-11-21T18:00:00.250+08:00'), false)).toEqual([11, 59, 59, 75]);
  });

  it('routes CTA directly to Cloud Console /cloud/dashboard?billing=plan while preserving UTMs and stripping control keys', () => {
    const url = new URL(
      buildMagi2ConsolePlanUrl('11111111-2222-3333-4444-555555555555', {
        locationHref: 'https://game.open-design.ai/explore?utm_source=twitter&gclid=abc&token=secret&redirect=https://evil.test&billing=hijack&partner=p1',
        at: new Date('2026-11-27T04:00:00.000Z'),
      }),
    );
    expect(url.origin).toBe('https://open-design.ai');
    expect(url.pathname).toBe('/cloud/dashboard');
    expect(url.searchParams.get('billing')).toBe('plan');
    expect(url.searchParams.get('od_entry_source')).toBe('bf_banner');
    expect(url.searchParams.get('gclid')).toBe('abc');
    expect(url.searchParams.get('utm_source')).toBe('twitter');
    expect(url.searchParams.get('partner')).toBe('p1');
    expect(url.searchParams.get('od_bf_placement')).toBe('black_friday_modal');
    expect(url.searchParams.has('token')).toBe(false);
    expect(url.searchParams.has('redirect')).toBe(false);
  });

  it('loads the modal video remotely over HTTPS and keeps the offline WebP poster lightweight', () => {
    const videoUrl = new URL(MAGI2_MODAL_VIDEO_URL);
    expect(videoUrl.protocol).toBe('https:');
    expect(videoUrl.href).toBe('https://open-design.ai/black-friday-modal/magi2-planet-6s.mp4');
    expect(existsSync(resolve(import.meta.dirname, './black-friday-modal/magi2-planet-6s.mp4'))).toBe(false);

    const posterBytes = statSync(resolve(import.meta.dirname, './black-friday-modal/magi2-planet-poster.webp')).size;
    expect(posterBytes).toBeLessThan(80 * 1024);
  });
});

describe('OpenGame Magi2LaunchModal runtime behavior', () => {
  it('opens for guests, writes shared od_bf_magi2_modal_seen cookie, uses remote video URL, and renders console plan CTA', () => {
    mockAccountState.account = { state: 'signed-out' };
    renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);
    const modal = document.querySelector('[data-testid="magi2-launch-modal"]');
    expect(modal).toBeTruthy();
    expect(document.querySelector('[data-testid="magi2-launch-modal-headline"]')?.textContent).toBe('全网首发 MAGI-2');
    const video = document.querySelector<HTMLVideoElement>('[data-testid="magi2-launch-modal-video"]');
    expect(video?.getAttribute('src')).toBe(MAGI2_MODAL_VIDEO_URL);
    const cta = document.querySelector<HTMLAnchorElement>('[data-testid="magi2-launch-modal-cta"]');
    expect(cta?.href).toContain('https://open-design.ai/cloud/dashboard?billing=plan');
    expect(document.cookie).toContain(`${MAGI2_MODAL_SEEN_COOKIE}=1`);
    expect(window.sessionStorage.getItem(MAGI2_MODAL_DISMISSED_STORAGE_NAME)).toBe('1');
  });

  it('opens for ALL user plans and account states without gating on tier or billing availability', () => {
    const scenarios: Array<{ label: string; account: TestAccount | null; error?: boolean }> = [
      { label: 'signed-out', account: { state: 'signed-out' } },
      { label: 'free', account: { state: 'signed-in', plan: 'free' } },
      { label: 'go', account: { state: 'signed-in', plan: 'go' } },
      { label: 'go_plus', account: { state: 'signed-in', plan: 'go_plus' } },
      { label: 'pro', account: { state: 'signed-in', plan: 'pro' } },
      { label: 'max', account: { state: 'signed-in', plan: 'max' } },
      { label: 'ultra', account: { state: 'signed-in', plan: 'ultra' } },
      { label: 'team', account: { state: 'signed-in', plan: 'team' } },
      { label: 'enterprise', account: { state: 'signed-in', plan: 'enterprise' } },
      { label: 'mediaEntitlement: included', account: { state: 'signed-in', plan: 'free', mediaEntitlement: 'included' } },
      { label: 'billingUnavailable: true', account: { state: 'signed-in', plan: 'pro', billingUnavailable: true } },
      { label: 'account: null (loading/unknown)', account: null },
      { label: 'account lookup error', account: null, error: true },
    ];

    for (const scenario of scenarios) {
      clearCookies();
      window.sessionStorage.clear();
      act(() => root.unmount());
      root = createRoot(host);

      mockAccountState.account = scenario.account;
      mockAccountState.error = Boolean(scenario.error);
      renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);

      expect(
        document.querySelector('[data-testid="magi2-launch-modal"]'),
        `expected modal to open for ${scenario.label}`,
      ).toBeTruthy();
      expect(document.cookie).toContain(`${MAGI2_MODAL_SEEN_COOKIE}=1`);
    }
  });

  it('stays closed outside the campaign window unless ?bf_modal_preview=1 forces preview', () => {
    vi.setSystemTime(new Date('2026-12-06T12:00:00+08:00'));
    renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeNull();

    // Force preview bypasses both campaign window and session dedup.
    document.cookie = `${MAGI2_MODAL_SEEN_COOKIE}=1; path=/`;
    window.sessionStorage.setItem(MAGI2_MODAL_DISMISSED_STORAGE_NAME, '1');
    window.history.replaceState({}, '', '/?bf_modal_preview=1');
    act(() => root.unmount());
    root = createRoot(host);

    renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);
    act(() => vi.advanceTimersByTime(150));
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeTruthy();
  });

  it('suppresses duplicate popup when od_bf_magi2_modal_seen cookie exists, but ignores legacy od_bf_home_modal_seen', () => {
    document.cookie = 'od_bf_home_modal_seen=1; path=/';
    mockAccountState.account = { state: 'signed-in', plan: 'free' };
    renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeTruthy();

    act(() => root.unmount());
    root = createRoot(host);
    renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeNull();
  });

  it('runs the 280ms exit transition on user close and unmounts immediately on external suppression', () => {
    mockAccountState.account = { state: 'signed-out' };
    renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);
    act(() => vi.advanceTimersToNextFrame());

    const modal = document.querySelector('[data-testid="magi2-launch-modal"]');
    expect(modal).toBeTruthy();
    expect(modal?.getAttribute('data-visible')).toBe('true');

    const closeBtn = document.querySelector<HTMLButtonElement>('[data-testid="magi2-launch-modal-close"]')!;
    act(() => closeBtn.click());

    // Still mounted during the 280ms exit transition with data-visible="false".
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')?.getAttribute('data-visible')).toBe('false');
    act(() => vi.advanceTimersByTime(150));
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeTruthy();

    // Unmounts once the 280ms transition finishes.
    act(() => vi.advanceTimersByTime(160));
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeNull();

    // Reset fatigue and verify external suppression unmounts immediately and pauses video.
    clearCookies();
    window.sessionStorage.clear();
    act(() => root.unmount());
    root = createRoot(host);

    renderWithI18n(<Magi2LaunchModal trackingPage="explore" suppressed={false} />);
    const video = document.querySelector<HTMLVideoElement>('[data-testid="magi2-launch-modal-video"]')!;
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});

    renderWithI18n(<Magi2LaunchModal trackingPage="explore" suppressed={true} />);
    expect(pauseSpy).toHaveBeenCalled();
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeNull();
  });

  it('closes via Base UI Dialog on Escape key and tracks keyboard dismissal', () => {
    mockAccountState.account = { state: 'signed-out' };
    renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);
    act(() => vi.advanceTimersToNextFrame());
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeTruthy();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')?.getAttribute('data-visible')).toBe('false');
    expect(vi.mocked(trackMotion)).toHaveBeenCalledWith(
      'ui_click',
      expect.objectContaining({
        element: 'close_banner',
        interaction_method: 'keyboard',
      }),
    );

    act(() => vi.advanceTimersByTime(320));
    expect(document.querySelector('[data-testid="magi2-launch-modal"]')).toBeNull();
  });

  it('updates countdown DOM segments only when their formatted value changes', () => {
    vi.setSystemTime(new Date('2026-11-27T12:00:05+08:00'));
    mockAccountState.account = { state: 'signed-out' };
    renderWithI18n(<Magi2LaunchModal trackingPage="explore" />);
    act(() => vi.advanceTimersToNextFrame());

    const clock = document.querySelector('[data-testid="magi2-launch-modal-clock"]')!;
    const segs = clock.querySelectorAll('span');
    const hrsSpan = Array.from(segs).find(el => el.textContent === '05')!;
    const msSpan = document.querySelector('[data-testid="magi2-launch-modal-ms"]')!;
    expect(hrsSpan).toBeTruthy();

    let hrsWrites = 0;
    let msWrites = 0;
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!;
    Object.defineProperty(hrsSpan, 'textContent', {
      configurable: true,
      get() { return descriptor.get!.call(this); },
      set(val: string) { hrsWrites += 1; descriptor.set!.call(this, val); },
    });
    Object.defineProperty(msSpan, 'textContent', {
      configurable: true,
      get() { return descriptor.get!.call(this); },
      set(val: string) { msWrites += 1; descriptor.set!.call(this, val); },
    });

    // Advance 200ms (5 ticks at 40ms): centiseconds change every tick, hours stay unchanged.
    act(() => vi.advanceTimersByTime(200));
    expect(hrsWrites).toBe(0);
    expect(msWrites).toBeGreaterThanOrEqual(4);
  });

  it('keeps ExploreBlackFridayHero intro intact when modal is suppressed/seen and collapses/resumes it when modal opens/closes', () => {
    // Before any modal opens, Hero intro is not preemptively skipped.
    expect(shouldSkipExploreHeroIntro()).toBe(false);

    // Externally suppressed host: modal stays closed and Hero renders expanded (intro intact).
    renderWithI18n(
      <>
        <ExploreBlackFridayHero />
        <Magi2LaunchModal trackingPage="explore" suppressed={true} />
      </>,
    );
    const suppressedHero = host.querySelector('section[data-bf-hero]')!;
    expect(suppressedHero.getAttribute('data-collapsed')).toBe('false');
    expect(isMagi2ModalOpen()).toBe(false);

    // Already seen in session: modal stays closed and Hero remains expanded.
    act(() => root.unmount());
    root = createRoot(host);
    document.cookie = `${MAGI2_MODAL_SEEN_COOKIE}=1; path=/`;
    renderWithI18n(
      <>
        <ExploreBlackFridayHero />
        <Magi2LaunchModal trackingPage="explore" />
      </>,
    );
    const seenHero = host.querySelector('section[data-bf-hero]')!;
    expect(seenHero.getAttribute('data-collapsed')).toBe('false');
    expect(isMagi2ModalOpen()).toBe(false);

    // Fresh session (even for a paid plan): modal opens and MAGI2_MODAL_OPEN_EVENT collapses the Hero.
    clearCookies();
    window.sessionStorage.clear();
    act(() => root.unmount());
    root = createRoot(host);
    mockAccountState.account = { state: 'signed-in', plan: 'ultra' };
    renderWithI18n(
      <>
        <ExploreBlackFridayHero />
        <Magi2LaunchModal trackingPage="explore" />
      </>,
    );
    const activeHero = host.querySelector('section[data-bf-hero]')!;
    expect(isMagi2ModalOpen()).toBe(true);
    expect(shouldSkipExploreHeroIntro()).toBe(true);
    expect(activeHero.getAttribute('data-collapsed')).toBe('true');

    const closeBtn = document.querySelector<HTMLButtonElement>('[data-testid="magi2-launch-modal-close"]')!;
    act(() => closeBtn.click());
    act(() => vi.advanceTimersByTime(320));
    expect(isMagi2ModalOpen()).toBe(false);
    expect(shouldSkipExploreHeroIntro()).toBe(false);
  });
});
