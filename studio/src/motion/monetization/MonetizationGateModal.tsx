import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import type { AccountSummary } from '../../../../shared/provider-directory';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { useAccountSummary } from '../AccountSettings';
import { formatBalance, planLabel, quotaShare } from '../BalanceEntry';
import { BLACK_FRIDAY_CAMPAIGN, campaignPricingUrl, newCampaignEntryId, useBlackFridayActive } from '../campaignAttribution';
import { evaluateEntitlementRefresh, readAccountPlan } from '../entitlementAttribution';
import { gatewayRequest } from '../gatewayClient';
import { reportEntitlementModalClick, reportEntitlementModalView, reportEntitlementRefresh } from '../pageTracking';
import { notifyProvidersChanged } from '../useProviderDirectory';
import {
  closeMonetizationGate,
  openMonetizationGate,
  readPreviewGateFromSearch,
  useMonetizationGate,
  type MonetizationGateRequest,
} from './monetizationGateBus';
import './monetizationGate.css';

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 36; // 3 minutes

function parseBalanceNumber(balance: string | null | undefined): number | null {
  if (typeof balance !== 'string' || balance.trim() === '') return null;
  const num = Number(balance);
  return Number.isFinite(num) ? num : null;
}

function hasEntitlementImproved(
  prevPlan: string | undefined,
  prevBalance: number | null,
  updated: AccountSummary | null | undefined,
): boolean {
  if (!updated || updated.state !== 'signed-in' || updated.billingUnavailable) return false;
  const { planChanged } = evaluateEntitlementRefresh(prevPlan, updated);
  if (planChanged) return true;
  const nextBalance = parseBalanceNumber(updated.balance);
  if (prevBalance !== null && nextBalance !== null && nextBalance > prevBalance) return true;
  return false;
}

function gateHookId(kind: MonetizationGateRequest['kind']) {
  if (kind === 'balance') return 'balance_gate_topup' as const;
  if (kind === 'resolution') return 'studio_res_gate' as const;
  return 'concurrency_gate_upgrade' as const;
}

function gateEntrySource(kind: MonetizationGateRequest['kind']) {
  if (kind === 'balance') return 'opengame_balance_gate' as const;
  if (kind === 'resolution') return 'opengame_resolution_gate' as const;
  return 'opengame_concurrency_gate' as const;
}

/**
 * Global monetization gate modal for OpenGame (balance depleted / concurrency limit / 2K-4K resolution upgrade).
 * Opening checkout starts a 5s entitlement poll + focus refresh and auto-closes once credits or plan recover.
 */
export function MonetizationGateModal() {
  const { locale, t } = useI18n();
  const gate = useMonetizationGate();
  const { account, refresh } = useAccountSummary({ eager: false });
  const campaign = useBlackFridayActive();
  const [entryId, setEntryId] = useState(newCampaignEntryId);
  const [polling, setPolling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [retryingResume, setRetryingResume] = useState(false);

  const baselineRef = useRef<{ plan: string | undefined; balance: number | null }>({ plan: undefined, balance: null });
  const pollAttemptsRef = useRef(0);
  const checkInFlightRef = useRef(false);
  const lastReturnCheckAtRef = useRef(0);
  const recoveredNotifiedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const activeGateRef = useRef<MonetizationGateRequest | null>(null);
  activeGateRef.current = gate;

  // Allow QA / PM preview via `?previewGate=balance` or `?previewGate=concurrency`.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const preview = readPreviewGateFromSearch(window.location.search);
    if (preview) openMonetizationGate(preview);
  }, []);

  // Reset state & record impression whenever a gate opens.
  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!gate) {
      setPolling(false);
      setChecking(false);
      setRecovered(false);
      setResumeError(null);
      setRetryingResume(false);
      pollAttemptsRef.current = 0;
      return;
    }
    const nextEntryId = newCampaignEntryId();
    setEntryId(nextEntryId);
    setPolling(false);
    setRecovered(false);
    setResumeError(null);
    setRetryingResume(false);
    recoveredNotifiedRef.current = false;
    pollAttemptsRef.current = 0;

    const hookId = gateHookId(gate.kind);
    reportEntitlementModalView(gate.pageName ?? 'creative_studio', hookId, {
      ...(gate.studioId ? { studio_id: gate.studioId } : {}),
      entry_id: nextEntryId,
      ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}),
    });

    void refresh(true).then(summary => {
      baselineRef.current = {
        plan: readAccountPlan(summary),
        balance: parseBalanceNumber(summary?.balance),
      };
    });
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [gate, campaign, refresh]);

  const runOnRecovered = useCallback(async (target: MonetizationGateRequest) => {
    const scheduleClose = () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        if (activeGateRef.current === target) closeMonetizationGate();
      }, 900);
    };
    if (!target.onRecovered) {
      scheduleClose();
      return;
    }
    setResumeError(null);
    setRetryingResume(true);
    try {
      await target.onRecovered();
      if (activeGateRef.current === target) {
        scheduleClose();
      }
    } catch (error) {
      if (activeGateRef.current === target) {
        setResumeError(
          error instanceof Error && error.message
            ? error.message
            : t('Could not continue the conversation. Try again.'),
        );
      }
    } finally {
      if (activeGateRef.current === target) {
        setRetryingResume(false);
      }
    }
  }, [t]);

  const checkEntitlementNow = useCallback(async (fromPoll = false) => {
    const current = activeGateRef.current;
    if (!current || checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    const hookId = gateHookId(current.kind);
    const pageName = current.pageName ?? 'creative_studio';
    if (!fromPoll) setChecking(true);
    try {
      const updated = await gatewayRequest<AccountSummary>('settings/account?refresh=true');
      const { billingOk, planChanged } = evaluateEntitlementRefresh(baselineRef.current.plan, updated);
      const improved = hasEntitlementImproved(baselineRef.current.plan, baselineRef.current.balance, updated);
      if (!fromPoll || improved) {
        reportEntitlementRefresh(pageName, hookId, entryId, billingOk ? 'success' : 'failure', planChanged || improved);
      }
      if (billingOk) {
        notifyProvidersChanged();
        window.dispatchEvent(new Event('motion:account-changed'));
      }
      if (improved) {
        setPolling(false);
        setRecovered(true);
        if (!recoveredNotifiedRef.current) {
          recoveredNotifiedRef.current = true;
          void runOnRecovered(current);
        }
      }
    } catch {
      if (!fromPoll) {
        reportEntitlementRefresh(pageName, hookId, entryId, 'failure', false);
      }
    } finally {
      checkInFlightRef.current = false;
      if (!fromPoll) setChecking(false);
    }
  }, [entryId, runOnRecovered]);

  // 5s background polling after user opens checkout.
  useEffect(() => {
    if (!gate || !polling) return;
    const timer = window.setInterval(() => {
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
        setPolling(false);
        return;
      }
      void checkEntitlementNow(true);
    }, POLL_INTERVAL_MS);

    const onReturn = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastReturnCheckAtRef.current < 1500) return;
      lastReturnCheckAtRef.current = now;
      void checkEntitlementNow(false);
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [gate, polling, checkEntitlementNow]);

  if (!gate) return null;

  const isBalance = gate.kind === 'balance';
  const isResolution = gate.kind === 'resolution';
  const hookId = gateHookId(gate.kind);
  const source = gateEntrySource(gate.kind);
  const pageName = gate.pageName ?? 'creative_studio';
  const pricingHref = campaignPricingUrl(locale, source, entryId);
  const currentPlan = account?.state === 'signed-in' && account.plan ? planLabel(account.plan, t) : t('Free plan');
  const balanceText = account?.state === 'signed-in' && account.balance != null ? formatBalance(account.balance) : null;
  const quotaPercent = account?.state === 'signed-in' ? quotaShare(account.quota) : null;
  const isPastDue = gate.reason === 'billing_past_due';
  const tone = isPastDue ? 'danger' : isResolution ? 'accent' : 'warning';
  const resLabel = gate.resolutionLabel?.toUpperCase() || '2K / 4K';

  const title = isBalance
    ? isPastDue
      ? t('Billing needs attention')
      : t('Credits required to continue')
    : isResolution
      ? t('Upgrade to unlock {resolution} output', { resolution: resLabel })
      : t('Concurrency limit reached');

  const description = isBalance
    ? isPastDue
      ? t('Your OpenDesign billing needs attention before generating new 3D assets, SFX, or game builds.')
      : t('Your available credits or weekly quota are depleted. Add credits or upgrade to keep generating 3D models, game art, SFX, and builds.')
    : isResolution
      ? t('{resolution} high-resolution image and video generation requires OpenDesign Pro or above. Your current resolution stays selected until you upgrade.', { resolution: resLabel })
      : gate.activeCount != null && gate.limitCount != null
        ? t('You have {active} of {limit} concurrent tasks running. Wait for a task to finish or upgrade for higher concurrency.', {
            active: gate.activeCount,
            limit: gate.limitCount,
          })
        : t('Your current plan reached its concurrent task limit. Wait a moment or upgrade for more parallel builds.');

  function handleDismiss() {
    reportEntitlementModalClick(pageName, 'close_modal', hookId, {
      ...(gate?.studioId ? { studio_id: gate.studioId } : {}),
      entry_id: entryId,
      ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}),
    });
    setPolling(false);
    closeMonetizationGate();
  }

  function handleOpenPricing() {
    reportEntitlementModalClick(pageName, 'open_pricing', hookId, {
      ...(gate?.studioId ? { studio_id: gate.studioId } : {}),
      entry_id: entryId,
      ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}),
    });
    setPolling(true);
  }

  function handleManualCheck() {
    reportEntitlementModalClick(pageName, 'check_balance', hookId, {
      ...(gate?.studioId ? { studio_id: gate.studioId } : {}),
      entry_id: entryId,
    });
    void checkEntitlementNow(false);
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) handleDismiss(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="om-mg-backdrop" />
        <Dialog.Popup className="om-mg-popup" data-testid={isBalance ? 'balance-gate-dialog' : isResolution ? 'resolution-gate-dialog' : 'concurrency-gate-dialog'}>
          <header className="om-mg-head">
            <Dialog.Title className="om-mg-title">{title}</Dialog.Title>
            <Button variant="plain" type="button" className="om-mg-close" aria-label={t('Close')} onClick={handleDismiss}>
              <RemixIcon name="close-line" size={16} />
            </Button>
          </header>

          <div className="om-mg-body">
            <div className="om-mg-card" data-tone={tone}>
              <div className="om-mg-meta">
                <span className="om-mg-pill" data-tone={tone}>
                  <RemixIcon name={isBalance ? (isPastDue ? 'lock-line' : 'flashlight-line') : isResolution ? 'image-line' : 'stack-line'} size={13} />
                  <span>{isBalance ? t('OpenGame Credits') : isResolution ? t('High Resolution') : t('Parallel Builds')}</span>
                </span>
                <span className="om-mg-pill">{currentPlan}</span>
                {campaign && (
                  <span className="om-mg-pill" data-tone="accent">
                    <RemixIcon name="sparkling-fill" size={12} />
                    <span>{t('Black Friday 50% OFF')}</span>
                  </span>
                )}
              </div>

              <p className="om-mg-copy">{description}</p>

              {(balanceText !== null || quotaPercent !== null) && (
                <div className="om-mg-metrics">
                  {balanceText !== null && (
                    <div className="om-mg-metric">
                      <span>{t('Available balance')}</span>
                      <strong>{balanceText}</strong>
                    </div>
                  )}
                  {quotaPercent !== null && (
                    <div className="om-mg-metric">
                      <span>{t('Plan quota')}</span>
                      <strong>{Math.round(quotaPercent * 100)}%</strong>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="om-mg-perks">
              <p className="om-mg-perks-title">{t(isResolution ? 'Included with OpenDesign Pro & above' : 'Included with OpenDesign Plus & above')}</p>
              <ul className="om-mg-perks-list">
                <li><RemixIcon name="checkbox-circle-fill" size={14} /><span>{t('3D models, game sprites, SFX, and music bundled in one plan')}</span></li>
                <li><RemixIcon name="checkbox-circle-fill" size={14} /><span>{t('Higher weekly quota and parallel builds with zero API key setup')}</span></li>
                <li><RemixIcon name="checkbox-circle-fill" size={14} /><span>{t('Unlisted game links and faster cloud publishing')}</span></li>
              </ul>
            </div>

            {recovered && !resumeError && (
              <div className="om-mg-status" data-tone="success" role="status" data-testid="monetization-gate-recovered">
                <RemixIcon name="checkbox-circle-fill" size={15} />
                <span>{t('Plan updated! Returning to your workspace…')}</span>
              </div>
            )}

            {resumeError && (
              <div className="om-mg-status" data-tone="danger" role="alert" data-testid="monetization-gate-resume-error">
                <RemixIcon name="error-warning-line" size={15} />
                <span>{resumeError}</span>
                {gate.onRecovered && (
                  <Button
                    variant="plain"
                    type="button"
                    className="om-mg-inline-btn"
                    disabled={retryingResume}
                    onClick={() => void runOnRecovered(gate)}
                  >
                    {t('Try again')}
                  </Button>
                )}
              </div>
            )}

            {polling && !recovered && (
              <div className="om-mg-status" data-tone="accent" role="status" data-testid="monetization-gate-polling">
                <RemixIcon name="loader-4-line" size={15} className="animate-spin motion-reduce:animate-none" />
                <span>{t('Checking every 5s. Returning after checkout resumes automatically.')}</span>
                <Button variant="plain" type="button" className="om-mg-inline-btn" disabled={checking} onClick={handleManualCheck}>
                  {t('Check now')}
                </Button>
              </div>
            )}
          </div>

          <footer className="om-mg-foot">
            <Button variant="plain" type="button" className="om-mg-secondary" onClick={handleDismiss}>
              {t('Not now')}
            </Button>
            <a
              className="om-mg-primary"
              href={pricingHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenPricing}
              data-testid="monetization-gate-cta"
            >
              <RemixIcon name="sparkling-line" size={15} />
              <span>{isBalance ? t('Top up or upgrade') : t('Upgrade plan')}</span>
              <RemixIcon name="external-link-line" size={14} />
            </a>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
