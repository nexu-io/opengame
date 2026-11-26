/**
 * Lightweight event store for OpenGame monetization gate dialogs (balance depleted, concurrency limit).
 * Deliberately decoupled from multi-tenant WorkspaceCollabContext so it works cleanly in OpenGame Studio.
 */
import { useSyncExternalStore } from 'react';
import type { Fields } from '../reporting';

export type MonetizationGateKind = 'balance' | 'concurrency' | 'resolution';

export interface MonetizationGateRequest {
  kind: MonetizationGateKind;
  pageName?: NonNullable<Fields<'surface_view'>['page_name']>;
  studioId?: string;
  /** Optional contextual detail from a failed generation or publish call (never raw stack traces). */
  reason?: 'insufficient_balance' | 'quota_exceeded' | 'billing_past_due' | 'concurrency_limit' | 'high_resolution';
  activeCount?: number;
  limitCount?: number;
  /** Requested high resolution label such as "2K" or "4K" when `kind === 'resolution'`. */
  resolutionLabel?: string;
  /** Optional callback invoked once after polling detects an upgraded plan or increased balance. */
  onRecovered?: () => void | Promise<unknown>;
}

let currentGate: MonetizationGateRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeMonetizationGate(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getMonetizationGateSnapshot(): MonetizationGateRequest | null {
  return currentGate;
}

export function useMonetizationGate(): MonetizationGateRequest | null {
  return useSyncExternalStore(subscribeMonetizationGate, getMonetizationGateSnapshot, getMonetizationGateSnapshot);
}

export function openMonetizationGate(request: MonetizationGateRequest) {
  currentGate = request;
  emit();
}

export function openBalanceGate(options: Omit<MonetizationGateRequest, 'kind'> = {}) {
  openMonetizationGate({ kind: 'balance', pageName: 'creative_studio', studioId: 'game', ...options });
}

export function openConcurrencyGate(options: Omit<MonetizationGateRequest, 'kind'> = {}) {
  openMonetizationGate({ kind: 'concurrency', pageName: 'creative_studio', studioId: 'game', ...options });
}

export function openResolutionGate(options: Omit<MonetizationGateRequest, 'kind'> = {}) {
  openMonetizationGate({ kind: 'resolution', reason: 'high_resolution', pageName: 'creative_studio', ...options });
}

export function closeMonetizationGate() {
  if (!currentGate) return;
  currentGate = null;
  emit();
}

/**
 * Classifies an API/runtime error into a monetization gate request.
 * Never triggers a paywall on transient 5xx, network outages, or generic rate limits (503/502/504).
 */
export function detectMonetizationGateFromError(error: { status?: number; code?: string; message?: string } | null | undefined): MonetizationGateRequest | null {
  if (!error) return null;
  const status = typeof error.status === 'number' ? error.status : undefined;
  const code = (error.code ?? '').trim().toLowerCase();
  const message = (error.message ?? '').trim().toLowerCase();

  // Hard guard: never open a billing gate on upstream outages / transient server errors.
  if (status && status >= 500) return null;

  if (
    status === 402
    || code === 'insufficient_balance'
    || code === 'insufficient_credits'
    || code === 'credits_exhausted'
    || code === 'quota_exceeded'
    || code === 'billing_past_due'
    || message.includes('balance is too low')
    || message.includes('insufficient balance')
    || message.includes('insufficient credits')
    || message.includes('out of credits')
    || message.includes('quota depleted')
    || (message.includes('balance') && message.includes('top up'))
  ) {
    const reason = code === 'billing_past_due'
      ? 'billing_past_due'
      : code === 'quota_exceeded' || message.includes('quota')
        ? 'quota_exceeded'
        : 'insufficient_balance';
    return { kind: 'balance', reason, pageName: 'creative_studio', studioId: 'game' };
  }

  if (
    code === 'concurrency_limit'
    || code === 'concurrency_limit_exceeded'
    || code === 'too_many_concurrent_tasks'
    || message.includes('concurrency limit')
    || message.includes('concurrent tasks limit')
  ) {
    return { kind: 'concurrency', reason: 'concurrency_limit', pageName: 'creative_studio', studioId: 'game' };
  }

  return null;
}

/** Reads an optional `?previewGate=balance|concurrency|resolution` query parameter for QA and PM preview. */
export function readPreviewGateFromSearch(search: string): MonetizationGateRequest | null {
  const param = new URLSearchParams(search).get('previewGate');
  if (param === 'balance') {
    return { kind: 'balance', reason: 'insufficient_balance', pageName: 'creative_studio', studioId: 'game' };
  }
  if (param === 'concurrency') {
    return { kind: 'concurrency', reason: 'concurrency_limit', activeCount: 2, limitCount: 2, pageName: 'creative_studio', studioId: 'game' };
  }
  if (param === 'resolution') {
    return { kind: 'resolution', reason: 'high_resolution', resolutionLabel: '4K', pageName: 'creative_studio', studioId: 'design' };
  }
  return null;
}
