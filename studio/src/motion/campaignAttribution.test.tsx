// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { studioEvents } from '../../../tracking/events.ts';
import { validProperties } from '../../../tracking/core.ts';
import { BlackFridayTopBanner, resetBlackFridayImpression } from './BlackFridayTopBanner';
import { ExploreBlackFridayHero } from './ExploreBlackFridayHero';
import campaignUi from '../i18n/campaign-ui.json';
import { BLACK_FRIDAY_ENDS_AT, BLACK_FRIDAY_HERO_ENDS_AT, BLACK_FRIDAY_HERO_STARTS_AT, BLACK_FRIDAY_STARTS_AT, bannerDismissedToday, blackFridayActive, blackFridayHeroActive, campaignPricingUrl, dismissBannerToday, readBlackFridayCountdown, resetBannerDismissal } from './campaignAttribution';
import { PricingEntry } from './PricingEntry';
import { loadReportingTransport } from './reporting';
import { trackMotion } from './tracking';

vi.mock('./tracking', () => ({ trackMotion: vi.fn(async () => 'queued') }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tracked = () => vi.mocked(trackMotion).mock.calls.map(([event, properties]) => ({ event, properties: properties as Record<string, unknown> }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  // Inside the campaign window unless a test moves the clock.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-25T12:00:00+08:00'));
  vi.mocked(trackMotion).mockClear();
  // Keep account status reads local to the test; individual cases override this response as needed.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state: 'signed-out' })));
  resetBlackFridayImpression();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); resetBannerDismissal(); });

const render = (node: React.ReactNode) => act(() => root.render(<I18nProvider initialLocale="zh-CN">{node}</I18nProvider>));
const params = (href: string) => new URL(href).searchParams;

it('builds a Pricing link that carries the OpenGame entry the website keeps through checkout', () => {
  const url = new URL(campaignPricingUrl('zh-CN', 'openmotion_bf_banner', '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11', new Date('2026-11-22T00:00:00Z')));
  expect(url.origin + url.pathname).toBe('https://open-design.ai/zh/pricing/');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    od_origin: 'openmotion', od_entry_source: 'openmotion_manage_subscription', od_entry_id: 'opengame-7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11', od_entry_at: '2026-11-22T00:00:00.000Z',
    utm_source: 'opengame', utm_medium: 'banner', utm_campaign: 'black_friday_2026',
  });
  expect(new URL(campaignPricingUrl('en', 'openmotion_header_pricing', 'x')).pathname).toBe('/pricing/');
  expect(params(campaignPricingUrl('en', 'openmotion_header_pricing', 'x')).get('utm_medium')).toBe('header');
});

it('reports one banner impression per page load and joins each claim click to its Pricing link', async () => {
  const onClose = vi.fn();
  render(<BlackFridayTopBanner trackingPage="explore" onClose={onClose} />);
  render(<BlackFridayTopBanner trackingPage="explore" onClose={onClose} />);
  expect(tracked().filter(row => row.event === 'surface_view')).toEqual([
    { event: 'surface_view', properties: { page_name: 'explore', area: 'campaign_banner', element: 'banner', campaign_id: 'black_friday_2026', hook_id: 'bf_banner' } },
  ]);

  const cta = container.querySelector<HTMLAnchorElement>('a[href*="pricing"]')!;
  cta.addEventListener('click', event => event.preventDefault());
  const firstEntry = params(cta.href).get('od_entry_id');
  expect(firstEntry).toMatch(/^opengame-[0-9a-f-]{36}$/);
  expect(params(cta.href).get('utm_source')).toBe('opengame');
  expect(params(cta.href).get('od_entry_source')).toBe('openmotion_manage_subscription');
  expect(params(cta.href).get('utm_medium')).toBe('banner');
  await act(async () => { cta.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  const click = tracked().find(row => row.event === 'ui_click')!.properties;
  expect(click).toMatchObject({ page_name: 'explore', area: 'campaign_banner', element: 'claim_offer', campaign_id: 'black_friday_2026', entry_id: firstEntry!.slice('opengame-'.length) });
  expect(params(cta.href).get('od_entry_id')).not.toBe(firstEntry);

  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="关闭活动 Banner"]')!.click());
  expect(tracked().at(-1)).toMatchObject({ event: 'ui_click', properties: { area: 'campaign_banner', element: 'close_banner' } });
  expect(onClose).toHaveBeenCalledOnce();
});

it('reports the header Pricing click with the entry id on its link', async () => {
  render(<PricingEntry trackingPage="studio" />);
  const link = container.querySelector<HTMLAnchorElement>('a')!;
  link.addEventListener('click', event => event.preventDefault());
  const entry = params(link.href).get('od_entry_id');
  expect(entry).toMatch(/^opengame-[0-9a-f-]{36}$/);
  expect(params(link.href).get('utm_source')).toBe('opengame');
  expect(params(link.href).get('od_entry_source')).toBe('openmotion_manage_subscription');
  await act(async () => { link.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(tracked()).toEqual([{ event: 'ui_click', properties: expect.objectContaining({ page_name: 'studio', area: 'header', element: 'open_pricing', campaign_id: 'black_friday_2026', entry_id: entry!.slice('opengame-'.length) }) }]);
});

it('registers every reported campaign event in the closed schema', () => {
  const id = '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11';
  for (const [event, properties] of [
    ['surface_view', { page_name: 'explore', area: 'campaign_banner', element: 'banner', campaign_id: 'black_friday_2026' }],
    ['ui_click', { page_name: 'explore', area: 'campaign_banner', element: 'claim_offer', campaign_id: 'black_friday_2026', entry_id: id, interaction_method: 'pointer' }],
    ['ui_click', { page_name: 'studio', area: 'campaign_banner', element: 'close_banner', campaign_id: 'black_friday_2026', interaction_method: 'keyboard' }],
    ['ui_click', { page_name: 'studio', area: 'header', element: 'open_pricing', campaign_id: 'black_friday_2026', entry_id: id, interaction_method: 'pointer' }],
  ] as const) expect(validProperties(studioEvents, event, properties)).toBe(true);
  expect(validProperties(studioEvents, 'ui_click', { page_name: 'studio', area: 'header', element: 'open_pricing', campaign_id: 'cyber_monday' })).toBe(false);
});

it('shows the campaign only inside its window and drops campaign fields afterwards', async () => {
  expect(BLACK_FRIDAY_STARTS_AT).toBe(Date.parse('2026-11-21T18:00:00+08:00'));
  expect(blackFridayActive(BLACK_FRIDAY_STARTS_AT - 1)).toBe(false);
  expect(blackFridayActive(BLACK_FRIDAY_STARTS_AT)).toBe(true);
  expect(blackFridayActive(Date.parse('2026-11-25T12:00:00+08:00'))).toBe(true);
  expect(blackFridayActive(BLACK_FRIDAY_ENDS_AT - 1)).toBe(true);
  expect(blackFridayActive(BLACK_FRIDAY_ENDS_AT)).toBe(false);
  expect(params(campaignPricingUrl('en', 'openmotion_header_pricing', 'x', new Date(BLACK_FRIDAY_ENDS_AT))).has('utm_campaign')).toBe(false);

  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BLACK_FRIDAY_ENDS_AT + 60_000);
  render(<PricingEntry trackingPage="studio" />);
  const link = container.querySelector<HTMLAnchorElement>('a')!;
  link.addEventListener('click', event => event.preventDefault());
  expect(container.textContent).not.toContain('50% OFF');
  expect(link.getAttribute('aria-label')).toBe('定价');
  await act(async () => { link.click(); });
  expect(tracked().at(-1)?.properties).not.toHaveProperty('campaign_id');
  expect(params(link.href).get('od_entry_source')).toBe('openmotion_manage_subscription');
});

it('keeps a dismissed banner hidden for the rest of the local day only', () => {
  const evening = new Date(2026, 10, 25, 23, 30);
  expect(bannerDismissedToday(evening)).toBe(false);
  dismissBannerToday(evening);
  expect(bannerDismissedToday(new Date(2026, 10, 25, 23, 59))).toBe(true);
  expect(bannerDismissedToday(new Date(2026, 10, 26, 0, 1))).toBe(false);
});

it('localizes the banner and the Pricing label in every supported language', () => {
  for (const locale of ['zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr'] as const) {
    const messages = campaignUi[locale];
    act(() => root.render(<I18nProvider key={locale} initialLocale={locale}><BlackFridayTopBanner trackingPage="explore" onClose={() => {}} /><PricingEntry trackingPage="studio" /></I18nProvider>));
    expect(container.textContent).toContain(messages['Claim offer']);
    expect(container.textContent).toContain(messages['7-day unlimited image gen']);
    expect(container.querySelector('aside')!.getAttribute('aria-label')).toBe(messages['Black Friday campaign banner']);
    // Signed out (the account request fails here): the entry is the localized Pricing label.
    const pricing = [...container.querySelectorAll('a[href*="pricing"]')].at(-1)!;
    expect(pricing.textContent).toContain(messages.Pricing);
    expect(pricing.getAttribute('aria-label')).toBe(messages['Pricing · Black Friday up to 50% off'].replace(/^Pricing/, messages.Pricing));
  }
});

it('drops the Pricing badge and campaign fields when the campaign ends while the page stays open', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(BLACK_FRIDAY_ENDS_AT - 30_000);
  render(<PricingEntry trackingPage="studio" />);
  expect(container.textContent).toContain('50% OFF');
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(container.textContent).not.toContain('50% OFF');
  const link = container.querySelector<HTMLAnchorElement>('a')!;
  link.addEventListener('click', event => event.preventDefault());
  await act(async () => { link.click(); });
  expect(tracked().at(-1)?.properties).not.toHaveProperty('campaign_id');
});

it('keeps a dismissal for the day in the page when storage is unavailable', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  const noon = new Date(2026, 10, 25, 12);
  dismissBannerToday(noon);
  expect(bannerDismissedToday(noon)).toBe(true);
  expect(bannerDismissedToday(new Date(2026, 10, 26, 9))).toBe(false);
  setItem.mockRestore();
});

it('keeps the Pricing entry with localized Free credits badge before the campaign starts', () => {
  vi.setSystemTime(BLACK_FRIDAY_STARTS_AT - 60_000);
  render(<PricingEntry trackingPage="studio" />);
  expect(container.textContent).not.toContain('50% OFF');
  expect(container.textContent).toContain(campaignUi['zh-CN']['Free credits']);
  expect(params(container.querySelector<HTMLAnchorElement>('a')!.href).has('utm_campaign')).toBe(false);
  act(() => root.render(<I18nProvider key="en" initialLocale="en"><PricingEntry trackingPage="studio" /></I18nProvider>));
  expect(container.textContent).toContain('Free credits');
  for (const locale of ['zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr'] as const) {
    act(() => root.render(<I18nProvider key={locale} initialLocale={locale}><PricingEntry trackingPage="studio" /></I18nProvider>));
    expect(container.textContent).toContain(campaignUi[locale]['Free credits']);
  }
});
it('repeats a 12-hour countdown anchored at 2026-11-21 18:00 +08:00 and expires after 2026-12-04 23:59:59 +08:00', async () => {
  expect(readBlackFridayCountdown(Date.parse('2026-11-21T18:00:00+08:00'))).toEqual({
    hours: '11', minutes: '59', seconds: '59', datetime: 'PT11H59M59S',
  });
  expect(readBlackFridayCountdown(Date.parse('2026-11-22T00:00:00+08:00'))).toEqual({
    hours: '05', minutes: '59', seconds: '59', datetime: 'PT05H59M59S',
  });
  expect(readBlackFridayCountdown(Date.parse('2026-11-22T05:59:59+08:00'))).toEqual({
    hours: '00', minutes: '00', seconds: '00', datetime: 'PT00H00M00S',
  });
  expect(readBlackFridayCountdown(Date.parse('2026-11-22T06:00:00+08:00'))).toEqual({
    hours: '11', minutes: '59', seconds: '59', datetime: 'PT11H59M59S',
  });
  expect(readBlackFridayCountdown(Date.parse('2026-11-22T18:00:00+08:00'))).toEqual({
    hours: '11', minutes: '59', seconds: '59', datetime: 'PT11H59M59S',
  });
  expect(readBlackFridayCountdown(Date.parse('2026-12-04T18:00:00+08:00'))).toEqual({
    hours: '05', minutes: '59', seconds: '59', datetime: 'PT05H59M59S',
  });
  expect(readBlackFridayCountdown(Date.parse('2026-12-04T23:59:59+08:00'))).toEqual({
    hours: '00', minutes: '00', seconds: '00', datetime: 'PT00H00M00S',
  });

  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.parse('2026-12-04T23:59:58+08:00'));
  const onExpire = vi.fn();
  render(<BlackFridayTopBanner trackingPage="explore" onClose={() => {}} onExpire={onExpire} />);
  const timeEl = container.querySelector('time')!;
  expect(timeEl.getAttribute('datetime')).toBe('PT00H00M01S');
  expect(timeEl.textContent).toBe('00:00:01');

  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(timeEl.textContent).toBe('00:00:00');
  expect(onExpire).not.toHaveBeenCalled();

  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(onExpire).toHaveBeenCalledOnce();
});

it('activates the Explore Black Friday hero from 2026-11-25 20:00 +08:00 until 2026-12-04 23:59:59 +08:00 with a 12h rolling countdown', async () => {
  expect(BLACK_FRIDAY_HERO_STARTS_AT).toBe(Date.parse('2026-11-25T20:00:00+08:00'));
  expect(BLACK_FRIDAY_HERO_ENDS_AT).toBe(Date.parse('2026-12-05T00:00:00+08:00'));
  expect(blackFridayHeroActive(BLACK_FRIDAY_HERO_STARTS_AT - 1)).toBe(false);
  expect(blackFridayHeroActive(BLACK_FRIDAY_HERO_STARTS_AT)).toBe(true);
  expect(blackFridayHeroActive(Date.parse('2026-12-04T23:59:59+08:00'))).toBe(true);
  expect(blackFridayHeroActive(BLACK_FRIDAY_HERO_ENDS_AT)).toBe(false);

  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.parse('2026-12-04T23:59:58+08:00'));
  const onExpire = vi.fn();
  render(<ExploreBlackFridayHero onExpire={onExpire} />);
  const timeEl = container.querySelector('time')!;
  expect(timeEl.getAttribute('datetime')).toBe('PT00H00M01S');

  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(timeEl.getAttribute('datetime')).toBe('PT00H00M00S');
  expect(onExpire).not.toHaveBeenCalled();

  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(onExpire).toHaveBeenCalledOnce();
});

it('localizes the Explore Black Friday hero across all 10 non-English locales with script-aware layout hooks', () => {
  vi.setSystemTime(BLACK_FRIDAY_HERO_STARTS_AT);
  for (const locale of ['zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr'] as const) {
    const messages = campaignUi[locale];
    act(() => root.render(<I18nProvider key={locale} initialLocale={locale}><ExploreBlackFridayHero /></I18nProvider>));
    const section = container.querySelector('section[data-bf-hero]')!;
    expect(section.getAttribute('aria-label')).toBe(messages['Black Friday flagship image 7 days unlimited hero']);
    expect(section.getAttribute('data-script')).toBe(locale === 'zh-CN' ? 'zh' : (locale === 'ja' || locale === 'ko') ? 'cjk' : 'latin');
    expect(container.textContent).toContain(messages['Flagship Image · 7 Days Unlimited']);
    expect(container.textContent).toContain(messages['Claim 50% Off']);
    expect(container.textContent).toContain(messages['Annual Pro & Max']);
    expect(container.textContent).toContain(messages['API Supported']);
    expect(container.textContent).toContain(messages['Up to 50% off annual']);
  }
});

it('reports checkout-return plan upgrades and billing failures for PricingEntry and BlackFridayTopBanner', async () => {
  await loadReportingTransport();
  const responses: Record<string, unknown>[] = [
    { state: 'signed-in', plan: 'free' },
    { state: 'signed-in', plan: 'plus' },
    { state: 'signed-in', plan: 'free' },
    { state: 'signed-in', billingUnavailable: true },
  ];
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(responses.shift() ?? { state: 'signed-out' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  try {
    render(<PricingEntry trackingPage="studio" />);
    const link = container.querySelector<HTMLAnchorElement>('a')!;
    link.addEventListener('click', event => event.preventDefault());
    const pricingEntryId = params(link.href).get('od_entry_id');
    await act(async () => { link.click(); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(tracked().filter(row => row.event === 'entitlement_refresh_result')).toEqual([
      { event: 'entitlement_refresh_result', properties: { page_name: 'studio', hook_id: 'header_pricing', entry_id: pricingEntryId!.slice('opengame-'.length), outcome: 'success', plan_changed: true } },
    ]);

    vi.mocked(trackMotion).mockClear();
    render(<BlackFridayTopBanner trackingPage="explore" onClose={() => {}} />);
    const bannerLink = container.querySelector<HTMLAnchorElement>('a[href*="pricing"]')!;
    bannerLink.addEventListener('click', event => event.preventDefault());
    const bannerEntryId = params(bannerLink.href).get('od_entry_id');
    await act(async () => { bannerLink.click(); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(tracked().filter(row => row.event === 'entitlement_refresh_result')).toEqual([
      { event: 'entitlement_refresh_result', properties: { page_name: 'explore', hook_id: 'bf_banner', entry_id: bannerEntryId!.slice('opengame-'.length), outcome: 'failure', plan_changed: false } },
    ]);
  } finally {
    fetchSpy.mockRestore();
  }
});

it('reads Upgrade once the visitor is signed in, on any plan', async () => {
  for (const plan of ['free', 'plus']) {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state: 'signed-in', plan, user: { email: 'ada@example.com' } })));
    await act(async () => { root.render(<I18nProvider key={plan} initialLocale="zh-CN"><PricingEntry trackingPage="explore" /></I18nProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const link = container.querySelector('a')!;
    expect(link.textContent).toContain('升级');
    expect(link.getAttribute('aria-label')).toBe('升级 · 黑五特惠年付低至 5 折');
    vi.unstubAllGlobals();
  }
});

it('navigates Pricing links in the same tab in a top-level browser and uses _blank in the desktop app', () => {
  render(<PricingEntry trackingPage="studio" />);
  expect(container.querySelector('a')?.getAttribute('target')).toBeNull();

  const bridge = { getChromeState: vi.fn() };
  (window as unknown as { __OPENMOTION_DESKTOP__?: unknown }).__OPENMOTION_DESKTOP__ = bridge;
  try {
    render(<BlackFridayTopBanner trackingPage="explore" onClose={() => {}} />);
    expect(container.querySelector('a[href*="pricing"]')?.getAttribute('target')).toBe('_blank');
  } finally {
    delete (window as unknown as { __OPENMOTION_DESKTOP__?: unknown }).__OPENMOTION_DESKTOP__;
  }
});
