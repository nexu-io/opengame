import { attributedEntryId, buildPlacementId, currentProductId } from '../../../shared/product-identity';
import type { Locale, Translate } from '../i18n/I18n';
import {
  BLACK_FRIDAY_CAMPAIGN,
  BLACK_FRIDAY_ENDS_AT,
  BLACK_FRIDAY_STARTS_AT,
  COUNTDOWN_CYCLE_SECONDS,
  blackFridayActive,
} from './campaignAttribution';

export const MAGI2_MODAL_CAMPAIGN_ID = BLACK_FRIDAY_CAMPAIGN;
export const MAGI2_MODAL_SEEN_COOKIE = 'od_bf_magi2_modal_seen';
export const MAGI2_MODAL_SEEN_PARAM = 'od_bf_seen';
export const MAGI2_MODAL_DISMISSED_STORAGE_NAME = 'od_bf_magi2_modal_seen';
export const MAGI2_MODAL_OPEN_EVENT = 'om:magi2-modal-change';
export const MAGI2_MODAL_VIDEO_URL = 'https://open-design.ai/black-friday-modal/magi2-planet-6s.mp4';
export const DEFAULT_CONSOLE_PLAN_URL = 'https://open-design.ai/cloud/dashboard?billing=plan';

const COUNTDOWN_CYCLE_MS = COUNTDOWN_CYCLE_SECONDS * 1000;

const CLOUD_QUERY_CONTROL_PARAMS = new Set([
  'billing', 'checkout', 'plan', 'interval', 'workspaceId', 'cloud_console_base',
  'od_origin', 'od_entry_id', 'od_entry_source', 'od_entry_at', 'od_conversion_source',
  'od_device_id', 'od_placement_id', 'od_campaign_id',
  'auth_token', 'token', 'access_token', 'id_token', 'code', 'state', 'od_auth', 'od_flow', 'od_flow_at',
  'redirect', 'return_to', 'email',
  MAGI2_MODAL_SEEN_PARAM, 'bf_modal_preview',
]);

export type ModalScriptKind = 'zh' | 'cjk' | 'latin';

export interface Magi2ModalDescSegment {
  text: string;
  strong?: boolean;
}

export interface Magi2ModalCopy {
  script: ModalScriptKind;
  dialogLabel: string;
  eyebrow: string;
  headline: string;
  description: readonly Magi2ModalDescSegment[];
  cta: string;
  countdownPrefix: string;
  closeLabel: string;
}

export const MAGI2_MODAL_DESCRIPTION_SOURCE =
  '1080p cinema video with native audio is live on OpenDesign. Unlock **7 days unlimited** on **any annual plan**, with Black Friday plans **up to 50% OFF**.';

export function modalScriptKind(locale: Locale): ModalScriptKind {
  if (locale.startsWith('zh')) return 'zh';
  if (locale === 'ja' || locale === 'ko') return 'cjk';
  return 'latin';
}

export function parseMagi2ModalDescription(text: string): Magi2ModalDescSegment[] {
  const segments: Magi2ModalDescSegment[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    segments.push({ text: match[1], strong: true });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments;
}

export function resolveMagi2ModalCopy(locale: Locale, t: Translate): Magi2ModalCopy {
  return {
    script: modalScriptKind(locale),
    dialogLabel: t('MAGI-2 first launch 7 days unlimited Black Friday offer'),
    eyebrow: t('7 Days Unlimited!'),
    headline: t('First Launch · MAGI-2'),
    description: parseMagi2ModalDescription(t(MAGI2_MODAL_DESCRIPTION_SOURCE)),
    cta: t('Start Unlimited'),
    countdownPrefix: t('Ends in', undefined, 'MAGI-2 modal'),
    closeLabel: t('Close MAGI-2 launch popup'),
  };
}

export function isMagi2PreviewForced(search?: string): boolean {
  try {
    const raw = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    return new URLSearchParams(raw).get('bf_modal_preview') === '1';
  } catch {
    return false;
  }
}

export function readMagi2CountdownParts(
  nowMs = Date.now(),
  forcePreview = false,
): readonly [number, number, number, number] {
  const totalLeftMs = Math.max(0, BLACK_FRIDAY_ENDS_AT - nowMs);
  const elapsedMs = Math.max(0, nowMs - BLACK_FRIDAY_STARTS_AT);
  let remMs = COUNTDOWN_CYCLE_MS - (elapsedMs % COUNTDOWN_CYCLE_MS);
  if (remMs <= 0) remMs = COUNTDOWN_CYCLE_MS;
  if (!forcePreview && totalLeftMs > 0) {
    remMs = Math.min(remMs, totalLeftMs);
  }
  const totalSec = Math.floor(remMs / 1000);
  return [
    Math.floor(totalSec / 3600),
    Math.floor((totalSec % 3600) / 60),
    totalSec % 60,
    Math.floor((remMs % 1000) / 10),
  ] as const;
}

export function readMagi2SeenCookie(cookieSource?: string): boolean {
  try {
    const raw = cookieSource ?? (typeof document !== 'undefined' ? document.cookie || '' : '');
    return new RegExp(`(?:^|;\\s*)${MAGI2_MODAL_SEEN_COOKIE}=1(?:;|$)`).test(raw);
  } catch {
    return false;
  }
}

export function writeMagi2SeenCookie(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  try {
    const host = window.location.hostname || '';
    const domainAttr = /(^|\.)open-design\.ai$/i.test(host) ? '; domain=.open-design.ai' : '';
    const secureAttr = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${MAGI2_MODAL_SEEN_COOKIE}=1; path=/${domainAttr}; SameSite=Lax${secureAttr}`;
  } catch {
    // Ignore cookie write errors in restricted browser contexts.
  }
}

export function isMagi2SuppressedByFatigue(): boolean {
  if (typeof window === 'undefined') return false;
  let fromParam = false;
  try {
    const here = new URL(window.location.href);
    if (here.searchParams.get(MAGI2_MODAL_SEEN_PARAM) === '1') {
      fromParam = true;
      here.searchParams.delete(MAGI2_MODAL_SEEN_PARAM);
      window.history.replaceState(window.history.state, '', here.pathname + here.search + here.hash);
    }
  } catch {
    // Ignore URL/history failures.
  }
  if (fromParam) {
    writeMagi2SeenCookie();
    try { window.sessionStorage.setItem(MAGI2_MODAL_DISMISSED_STORAGE_NAME, '1'); } catch { /* ignore */ }
    return true;
  }
  if (readMagi2SeenCookie()) return true;
  try {
    if (window.sessionStorage.getItem(MAGI2_MODAL_DISMISSED_STORAGE_NAME) === '1') return true;
  } catch {
    // Ignore storage unavailability.
  }
  return false;
}

export function markMagi2ModalSeen(): void {
  writeMagi2SeenCookie();
  try { window.sessionStorage.setItem(MAGI2_MODAL_DISMISSED_STORAGE_NAME, '1'); } catch { /* ignore */ }
}

export function isMagi2ModalOpen(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.magi2ModalOpen === 'true';
}

export function setMagi2ModalOpenSignal(open: boolean): void {
  if (typeof document !== 'undefined') {
    if (open) document.documentElement.dataset.magi2ModalOpen = 'true';
    else delete document.documentElement.dataset.magi2ModalOpen;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MAGI2_MODAL_OPEN_EVENT, { detail: { open } }));
  }
}

/**
 * Only skip the Explore Black Friday Hero intro when the MAGI-2 modal is already open
 * or explicitly preview-forced; otherwise let the Hero play and collapse via MAGI2_MODAL_OPEN_EVENT
 * if/when the modal actually opens so already-dismissed sessions and externally suppressed hosts
 * keep the Hero intro intact.
 */
export function shouldSkipExploreHeroIntro(): boolean {
  return isMagi2ModalOpen() || isMagi2PreviewForced();
}

/**
 * Build the direct Cloud Console plan URL (`https://open-design.ai/cloud/dashboard?billing=plan`)
 * carrying OpenGame attribution + incoming marketing query parameters while stripping protocol control params.
 */
export function buildMagi2ConsolePlanUrl(
  entryId: string,
  options?: {
    at?: Date;
    locationHref?: string;
    campaign?: boolean;
  },
): string {
  const at = options?.at ?? new Date();
  const campaign = options?.campaign ?? blackFridayActive(at.getTime());
  const target = new URL(DEFAULT_CONSOLE_PLAN_URL);

  target.searchParams.set('billing', 'plan');
  target.searchParams.set('od_origin', currentProductId());
  target.searchParams.set('od_entry_source', 'bf_banner');
  target.searchParams.set('od_entry_id', attributedEntryId(entryId));
  target.searchParams.set('od_entry_at', at.toISOString());
  target.searchParams.set('od_placement_id', buildPlacementId('gui', 'studio', 'explore', 'all'));
  if (campaign) {
    target.searchParams.set('od_campaign_id', BLACK_FRIDAY_CAMPAIGN);
  }

  const rawHref = options?.locationHref ?? (typeof window !== 'undefined' ? window.location.href : undefined);
  if (rawHref) {
    try {
      const current = new URL(rawHref);
      const owned = new Set([...target.searchParams.keys(), ...CLOUD_QUERY_CONTROL_PARAMS]);
      for (const [key, value] of current.searchParams) {
        if (!owned.has(key)) target.searchParams.append(key, value);
      }
      target.searchParams.set('od_bf_source_origin', current.origin);
      target.searchParams.set('od_bf_source_path', current.pathname);
      target.searchParams.set('od_bf_placement', 'black_friday_modal');
    } catch {
      // Ignore malformed locationHref.
    }
  }

  return target.toString();
}
