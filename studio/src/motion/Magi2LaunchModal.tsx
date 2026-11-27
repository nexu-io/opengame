import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import magi2PosterUrl from './black-friday-modal/magi2-planet-poster.webp';
import { blackFridayActive, newCampaignEntryId, pricingLinkTargetProps } from './campaignAttribution';
import { useCheckoutReturnRefresh } from './entitlementAttribution';
import type { CreativePage } from './exploreTracking';
import {
  MAGI2_MODAL_CAMPAIGN_ID,
  MAGI2_MODAL_VIDEO_URL,
  buildMagi2ConsolePlanUrl,
  isMagi2PreviewForced,
  isMagi2SuppressedByFatigue,
  markMagi2ModalSeen,
  readMagi2CountdownParts,
  resolveMagi2ModalCopy,
  setMagi2ModalOpenSignal,
} from './magi2LaunchModalConfig';
import styles from './Magi2LaunchModal.module.css';
import { trackMotion } from './tracking';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function Magi2LaunchModal({
  trackingPage,
  suppressed = false,
}: {
  trackingPage: CreativePage;
  suppressed?: boolean;
}) {
  const { locale, t } = useI18n();
  const forcePreview = isMagi2PreviewForced();
  const [initiallySuppressed] = useState(() => (forcePreview ? false : isMagi2SuppressedByFatigue()));
  const [dismissed, setDismissed] = useState(initiallySuppressed);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [entryId, setEntryId] = useState(newCampaignEntryId);

  const externallySuppressed = suppressed || (!forcePreview && !blackFridayActive());
  const canOpen = !dismissed && !externallySuppressed;
  const markCheckoutReturn = useCheckoutReturnRefresh(trackingPage, 'bf_banner');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hrsRef = useRef<HTMLSpanElement | null>(null);
  const minRef = useRef<HTMLSpanElement | null>(null);
  const secRef = useRef<HTMLSpanElement | null>(null);
  const msRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const settledRef = useRef(false);
  const initialCountdownRef = useRef<readonly [number, number, number, number] | null>(null);

  const unmountImmediately = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closingRef.current = false;
    setOpen(false);
    setPlaying(false);
    try { videoRef.current?.pause(); } catch { /* ignore */ }
    setMounted(false);
  }, []);

  const closeModal = useCallback(
    (trackClose = false, method: 'pointer' | 'keyboard' = 'pointer') => {
      if (closingRef.current) return;
      closingRef.current = true;
      setDismissed(true);
      if (!forcePreview) markMagi2ModalSeen();
      setOpen(false);
      setPlaying(false);
      try { videoRef.current?.pause(); } catch { /* ignore */ }
      if (trackClose) {
        void trackMotion('ui_click', {
          page_name: trackingPage,
          area: 'campaign_banner',
          element: 'close_banner',
          campaign_id: MAGI2_MODAL_CAMPAIGN_ID,
          hook_id: 'bf_banner',
          interaction_method: method,
        });
      }
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(
        () => {
          closeTimerRef.current = null;
          closingRef.current = false;
          setMounted(false);
        },
        prefersReducedMotion() ? 0 : 280,
      );
    },
    [forcePreview, trackingPage],
  );

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // External suppression unmounts immediately and pauses video, distinct from user-initiated exit transitions.
  useEffect(() => {
    if (externallySuppressed && mounted) {
      unmountImmediately();
    }
  }, [externallySuppressed, mounted, unmountImmediately]);

  // Open for all users whenever the campaign is active (or preview-forced), not suppressed, and not yet seen in this session.
  useEffect(() => {
    if (!canOpen) return;

    if (forcePreview) {
      if (mounted) return;
      const timer = window.setTimeout(() => {
        settledRef.current = true;
        closingRef.current = false;
        setMounted(true);
      }, 120);
      return () => window.clearTimeout(timer);
    }

    if (!settledRef.current) {
      settledRef.current = true;
      closingRef.current = false;
      markMagi2ModalSeen();
      setMounted(true);
      void trackMotion('surface_view', {
        page_name: trackingPage,
        area: 'campaign_banner',
        element: 'modal',
        campaign_id: MAGI2_MODAL_CAMPAIGN_ID,
        hook_id: 'bf_banner',
      });
    }
  }, [canOpen, forcePreview, mounted, trackingPage]);

  useEffect(() => {
    setMagi2ModalOpenSignal(mounted);
    return () => setMagi2ModalOpenSignal(false);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    const initial = initialCountdownRef.current;
    let prevH = initial ? String(initial[0]).padStart(2, '0') : '';
    let prevM = initial ? String(initial[1]).padStart(2, '0') : '';
    let prevS = initial ? String(initial[2]).padStart(2, '0') : '';
    let prevCs = initial ? String(initial[3]).padStart(2, '0') : '';

    const renderCountdown = () => {
      const [h, m, s, cs] = readMagi2CountdownParts(Date.now(), forcePreview);
      const nextH = String(h).padStart(2, '0');
      const nextM = String(m).padStart(2, '0');
      const nextS = String(s).padStart(2, '0');
      const nextCs = String(cs).padStart(2, '0');
      if (hrsRef.current && nextH !== prevH) {
        prevH = nextH;
        hrsRef.current.textContent = nextH;
      }
      if (minRef.current && nextM !== prevM) {
        prevM = nextM;
        minRef.current.textContent = nextM;
      }
      if (secRef.current && nextS !== prevS) {
        prevS = nextS;
        secRef.current.textContent = nextS;
      }
      if (msRef.current && nextCs !== prevCs) {
        prevCs = nextCs;
        msRef.current.textContent = nextCs;
      }
    };

    const playVideoIfAllowed = () => {
      const video = videoRef.current;
      if (!video || prefersReducedMotion() || document.hidden) return;
      try {
        const result = video.play();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch { /* ignore */ }
    };

    renderCountdown();

    const rafId = window.requestAnimationFrame(() => {
      if (closingRef.current) return;
      const reduced = prefersReducedMotion();
      setOpen(true);
      setPlaying(!reduced && !document.hidden);
      playVideoIfAllowed();
    });

    const intervalMs = prefersReducedMotion() ? 1000 : 40;
    const clockTimer = window.setInterval(() => {
      if (document.hidden) return;
      if (!forcePreview && !blackFridayActive()) {
        unmountImmediately();
        return;
      }
      renderCountdown();
    }, intervalMs);

    const onVisibilityChange = () => {
      const video = videoRef.current;
      if (document.hidden) {
        setPlaying(false);
        try { video?.pause(); } catch { /* ignore */ }
      } else if (!closingRef.current) {
        setPlaying(!prefersReducedMotion());
        playVideoIfAllowed();
        renderCountdown();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(clockTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      try { videoRef.current?.pause(); } catch { /* ignore */ }
    };
  }, [mounted, forcePreview, unmountImmediately]);

  if (!mounted || typeof document === 'undefined') {
    initialCountdownRef.current = null;
    return null;
  }

  const copy = resolveMagi2ModalCopy(locale, t);
  const ctaHref = buildMagi2ConsolePlanUrl(entryId);
  if (!initialCountdownRef.current) {
    initialCountdownRef.current = readMagi2CountdownParts(Date.now(), forcePreview);
  }
  const [initH, initM, initS, initCs] = initialCountdownRef.current;

  const handleCtaClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const clickedEntryId = entryId;
    const method = event.detail === 0 ? ('keyboard' as const) : ('pointer' as const);
    markCheckoutReturn(clickedEntryId);
    void trackMotion('ui_click', {
      page_name: trackingPage,
      area: 'campaign_banner',
      element: 'claim_offer',
      campaign_id: MAGI2_MODAL_CAMPAIGN_ID,
      entry_id: clickedEntryId,
      hook_id: 'bf_banner',
      interaction_method: method,
    });
    event.currentTarget.href = buildMagi2ConsolePlanUrl(clickedEntryId);
    window.setTimeout(() => setEntryId(newCampaignEntryId()), 0);
    closeModal(false);
  };

  return (
    <Dialog.Root
      open={mounted}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen) {
          closeModal(true, eventDetails.reason === 'escape-key' ? 'keyboard' : 'pointer');
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={styles.backdrop}
          data-visible={open ? 'true' : 'false'}
          data-testid="magi2-launch-modal-backdrop"
        />
        <Dialog.Viewport
          className={styles.viewport}
          data-visible={open ? 'true' : 'false'}
        >
          <Dialog.Popup
            className={styles.modal}
            data-visible={open ? 'true' : 'false'}
            data-script={copy.script}
            data-playing={playing ? 'true' : 'false'}
            data-testid="magi2-launch-modal"
            aria-label={copy.dialogLabel}
          >
            <div className={styles.mediaPane}>
              <div className={styles.videoStage}>
                <video
                  ref={videoRef}
                  className={styles.video}
                  data-testid="magi2-launch-modal-video"
                  src={MAGI2_MODAL_VIDEO_URL}
                  poster={magi2PosterUrl}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  tabIndex={-1}
                />
                <div className={styles.videoScrim} aria-hidden="true" />
              </div>
            </div>

            <div className={styles.contentPane}>
              <Button
                variant="plain"
                type="button"
                className={styles.close}
                aria-label={copy.closeLabel}
                data-testid="magi2-launch-modal-close"
                onClick={event => closeModal(true, event.detail === 0 ? 'keyboard' : 'pointer')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </Button>

              <div className={styles.heroCopy}>
                <div className={styles.eyebrow} data-testid="magi2-launch-modal-eyebrow">
                  {copy.eyebrow}
                </div>
                <Dialog.Title className={styles.headline} data-testid="magi2-launch-modal-headline">
                  {copy.headline}
                </Dialog.Title>
                <p className={styles.desc} data-testid="magi2-launch-modal-desc">
                  {copy.description.map((segment, index) =>
                    segment.strong ? (
                      <strong key={`${index}-${segment.text}`}>{segment.text}</strong>
                    ) : (
                      <Fragment key={`${index}-${segment.text}`}>{segment.text}</Fragment>
                    ),
                  )}
                </p>
              </div>

              <div className={styles.actionGroup}>
                <div className={styles.ctaStack}>
                  <a
                    className={styles.cta}
                    href={ctaHref}
                    data-testid="magi2-launch-modal-cta"
                    {...pricingLinkTargetProps()}
                    onClick={handleCtaClick}
                    onAuxClick={event => {
                      if (event.button === 1) handleCtaClick(event);
                    }}
                  >
                    <span className={styles.ctaText}>{copy.cta}</span>
                    <svg
                      className={styles.ctaArrow}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14m-6-6 6 6-6 6" />
                    </svg>
                  </a>
                </div>

                <time
                  className={styles.countdown}
                  data-testid="magi2-launch-modal-clock"
                  role="timer"
                  aria-live="off"
                >
                  <span className={styles.countdownLabel}>{copy.countdownPrefix}</span>
                  <span className={styles.countdownTime}>
                    <span className={styles.digitSeg} ref={hrsRef}>{String(initH).padStart(2, '0')}</span>
                    <span className={styles.colon} aria-hidden="true">:</span>
                    <span className={styles.digitSeg} ref={minRef}>{String(initM).padStart(2, '0')}</span>
                    <span className={styles.colon} aria-hidden="true">:</span>
                    <span className={styles.digitSeg} ref={secRef}>{String(initS).padStart(2, '0')}</span>
                    <span className={styles.msGroup}>
                      <span className={styles.dot} aria-hidden="true">.</span>
                      <span className={styles.digitSeg} ref={msRef} data-testid="magi2-launch-modal-ms">{String(initCs).padStart(2, '0')}</span>
                    </span>
                  </span>
                </time>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
