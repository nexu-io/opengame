// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attributedEntryId, PRODUCT_UTM_SOURCE } from '../../../../shared/product-identity';
import { validProperties } from '../../../../tracking/core.ts';
import { studioEvents } from '../../../../tracking/events.ts';
import { I18nProvider } from '../../i18n/I18n';
import { campaignPricingUrl } from '../campaignAttribution';
import {
  closeMonetizationGate,
  detectMonetizationGateFromError,
  openBalanceGate,
  openConcurrencyGate,
  readPreviewGateFromSearch,
} from './monetizationGateBus';
import { MonetizationGateModal } from './MonetizationGateModal';
import { trackMotion } from '../tracking';

vi.mock('../tracking', () => ({ trackMotion: vi.fn(async () => 'queued') }));
vi.mock('../gatewayClient', () => ({
  gatewayRequest: vi.fn(async () => ({ state: 'signed-in', plan: 'free', balance: '0.00' })),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tracked = () => vi.mocked(trackMotion).mock.calls.map(([event, properties]) => ({
  event,
  properties: properties as Record<string, unknown>,
}));

describe('OpenGame monetization attribution & gate hooks', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.mocked(trackMotion).mockClear();
    closeMonetizationGate();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    closeMonetizationGate();
  });

  it('carries OpenGame product attribution on checkout links while keeping raw click entry_id', () => {
    const id = '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11';
    const url = new URL(campaignPricingUrl('zh-CN', 'opengame_balance_gate', id));
    expect(url.searchParams.get('od_entry_id')).toBe(attributedEntryId(id));
    expect(url.searchParams.get('utm_source')).toBe(PRODUCT_UTM_SOURCE);
    expect(url.searchParams.get('utm_medium')).toBe('balance_gate');
    expect(url.searchParams.get('od_origin')).toBe('openmotion');
    expect(url.searchParams.get('od_entry_source')).toBe('openmotion_manage_subscription');
  });

  it('matches gateway balance-too-low and concurrency errors while ignoring 503 outages', () => {
    expect(detectMonetizationGateFromError({ status: 402 })).toMatchObject({ kind: 'balance', reason: 'insufficient_balance' });
    expect(detectMonetizationGateFromError({ message: 'Your OpenDesign balance is too low for this request. Top up, then try again.' }))
      .toMatchObject({ kind: 'balance', reason: 'insufficient_balance' });
    expect(detectMonetizationGateFromError({ code: 'quota_exceeded' })).toMatchObject({ kind: 'balance', reason: 'quota_exceeded' });
    expect(detectMonetizationGateFromError({ code: 'concurrency_limit' })).toMatchObject({ kind: 'concurrency', reason: 'concurrency_limit' });
    expect(detectMonetizationGateFromError({ code: 'video_concurrency_limit_exceeded' })).toMatchObject({ kind: 'concurrency', reason: 'concurrency_limit' });
    expect(detectMonetizationGateFromError({ status: 503, message: 'insufficient balance' })).toBeNull();
    expect(detectMonetizationGateFromError({ status: 502, message: 'Bad Gateway' })).toBeNull();
    expect(readPreviewGateFromSearch('?previewGate=balance')).toMatchObject({ kind: 'balance' });
    expect(readPreviewGateFromSearch('?previewGate=concurrency')).toMatchObject({ kind: 'concurrency' });
    expect(readPreviewGateFromSearch('?previewGate=resolution')).toMatchObject({ kind: 'resolution', resolutionLabel: '4K' });
    expect(readPreviewGateFromSearch('?mode=game')).toBeNull();
  });

  it('validates all active OpenGame monetization tracking events against the closed schema', () => {
    const id = '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11';
    for (const [event, props] of [
      ['surface_view', { page_name: 'creative_studio', area: 'entitlement_modal', element: 'modal', hook_id: 'balance_gate_topup', entry_id: id, studio_id: 'game' }],
      ['ui_click', { page_name: 'creative_studio', area: 'entitlement_modal', element: 'open_pricing', hook_id: 'balance_gate_topup', entry_id: id, studio_id: 'game' }],
      ['ui_click', { page_name: 'creative_studio', area: 'entitlement_modal', element: 'check_balance', hook_id: 'concurrency_gate_upgrade', entry_id: id, studio_id: 'game' }],
      ['surface_view', { page_name: 'creative_studio', area: 'entitlement_gate', element: 'gate_card', hook_id: 'game_publish_panel_signin', publish_target: 'game', studio_id: 'game' }],
      ['ui_click', { page_name: 'creative_studio', area: 'entitlement_gate', element: 'open_pricing', hook_id: 'game_publish_unlisted_upgrade', entry_id: id, publish_target: 'game', studio_id: 'game' }],
    ] as const) {
      expect(validProperties(studioEvents, event, props)).toBe(true);
    }
  });

  it('renders BalanceGateDialog, tracks impression & CTA click, and deduplicates focus+visibilitychange refresh', async () => {
    await act(async () => {
      root.render(<I18nProvider initialLocale="zh-CN"><MonetizationGateModal /></I18nProvider>);
    });
    expect(document.querySelector('[data-testid="balance-gate-dialog"]')).toBeNull();

    await act(async () => {
      openBalanceGate({ reason: 'insufficient_balance' });
    });

    const dialog = document.querySelector('[data-testid="balance-gate-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('需要补充额度以继续');

    const impression = tracked().find(item => item.event === 'surface_view');
    expect(impression?.properties).toMatchObject({
      page_name: 'creative_studio',
      area: 'entitlement_modal',
      element: 'modal',
      hook_id: 'balance_gate_topup',
      studio_id: 'game',
    });

    const cta = document.querySelector<HTMLAnchorElement>('[data-testid="monetization-gate-cta"]')!;
    cta.addEventListener('click', event => event.preventDefault());
    const url = new URL(cta.href);
    expect(url.searchParams.get('od_entry_id')).toBe(attributedEntryId(String(impression!.properties.entry_id)));

    await act(async () => {
      cta.click();
    });
    expect(document.querySelector('[data-testid="monetization-gate-polling"]')).not.toBeNull();

    // Simultaneous focus + visibilitychange should emit only one entitlement_refresh_result.
    vi.mocked(trackMotion).mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    const refreshes = tracked().filter(item => item.event === 'entitlement_refresh_result');
    expect(refreshes.length).toBe(1);
  });

  it('renders ConcurrencyGateDialog with counts and tracks dismiss', async () => {
    await act(async () => {
      root.render(<I18nProvider initialLocale="zh-CN"><MonetizationGateModal /></I18nProvider>);
      openConcurrencyGate({ activeCount: 2, limitCount: 2 });
    });

    const dialog = document.querySelector('[data-testid="concurrency-gate-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('2/2');

    const closeBtn = dialog!.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')
      ?? dialog!.querySelector<HTMLButtonElement>('.om-mg-close')!;
    await act(async () => {
      closeBtn.click();
    });
    expect(document.querySelector('[data-testid="concurrency-gate-dialog"]')).toBeNull();
    expect(tracked().some(item => item.event === 'ui_click' && item.properties.element === 'close_modal' && item.properties.hook_id === 'concurrency_gate_upgrade')).toBe(true);
  });

  it('invokes onRecovered once when balance increases after checkout check', async () => {
    const { gatewayRequest } = await import('../gatewayClient');
    const mockGateway = vi.mocked(gatewayRequest);
    mockGateway
      .mockResolvedValueOnce({ state: 'signed-in', plan: 'plus', balance: '0.00', billingUnavailable: false })
      .mockResolvedValueOnce({ state: 'signed-in', plan: 'plus', balance: '10.00', billingUnavailable: false });

    const onRecovered = vi.fn();
    await act(async () => {
      root.render(<I18nProvider initialLocale="en"><MonetizationGateModal /></I18nProvider>);
    });
    await act(async () => {
      openBalanceGate({ reason: 'insufficient_balance', onRecovered });
      await Promise.resolve();
    });

    const cta = document.querySelector<HTMLAnchorElement>('[data-testid="monetization-gate-cta"]')!;
    cta.addEventListener('click', event => event.preventDefault());
    await act(async () => {
      cta.click();
    });

    const checkBtn = document.querySelector<HTMLButtonElement>('.om-mg-inline-btn')!;
    expect(checkBtn).not.toBeNull();
    await act(async () => {
      checkBtn.click();
      await Promise.resolve();
    });

    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="monetization-gate-recovered"]')).not.toBeNull();
  });

  it('surfaces a failed onRecovered auto-resume with an alert and Retry action instead of silently closing', async () => {
    const { gatewayRequest } = await import('../gatewayClient');
    const mockGateway = vi.mocked(gatewayRequest);
    mockGateway
      .mockResolvedValueOnce({ state: 'signed-in', plan: 'plus', balance: '0.00', billingUnavailable: false })
      .mockResolvedValueOnce({ state: 'signed-in', plan: 'plus', balance: '10.00', billingUnavailable: false });

    const onRecovered = vi.fn()
      .mockRejectedValueOnce(new Error('Could not continue the conversation. Try again.'))
      .mockResolvedValueOnce(undefined);

    await act(async () => {
      root.render(<I18nProvider initialLocale="en"><MonetizationGateModal /></I18nProvider>);
    });
    await act(async () => {
      openBalanceGate({ reason: 'insufficient_balance', onRecovered });
      await Promise.resolve();
    });

    const cta = document.querySelector<HTMLAnchorElement>('[data-testid="monetization-gate-cta"]')!;
    cta.addEventListener('click', event => event.preventDefault());
    await act(async () => {
      cta.click();
    });

    const checkBtn = document.querySelector<HTMLButtonElement>('.om-mg-inline-btn')!;
    await act(async () => {
      checkBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRecovered).toHaveBeenCalledTimes(1);
    const errorBanner = document.querySelector('[data-testid="monetization-gate-resume-error"]');
    expect(errorBanner).not.toBeNull();
    expect(errorBanner?.textContent).toContain('Could not continue the conversation. Try again.');
    expect(document.querySelector('[data-testid="balance-gate-dialog"]')).not.toBeNull();

    // Clicking Try again retries onRecovered and clears the error banner
    const retryBtn = errorBanner!.querySelector<HTMLButtonElement>('button')!;
    await act(async () => {
      retryBtn.click();
      await Promise.resolve();
    });
    expect(onRecovered).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="monetization-gate-resume-error"]')).toBeNull();
    expect(document.querySelector('[data-testid="monetization-gate-recovered"]')).not.toBeNull();
  });
});
