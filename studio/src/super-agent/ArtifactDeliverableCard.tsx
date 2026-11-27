import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useRef, useState } from 'react';
import type { DesignExportFormat } from '../../../shared/design-project';
import { gameGenreLabels, type GameGenre } from '../../../shared/game-contract';
import { isPlayableAdArtifact, type SuperAgentArtifact } from '../../../shared/super-agent';
import type { WebPublishTargetKind } from '../../../shared/web-publish';
import { Popover } from '../components/ui/Popover';
import { WebPublishPopover } from '../components/WebPublishPopover';
import { designClient } from '../design/designClient';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { bundledGames } from '../motion/game/gameCatalog';
import { modelDisplayLabel } from '../motion/generationLabels';
import { gamePublishActions, useGamePublishSession } from './gamePublish/gamePublishStore';

export type DeliverableTone = 'agent' | 'coding' | 'image' | 'video' | 'audio';

export type ArtifactDeliverableMeta = {
  icon: string;
  tone: DeliverableTone;
  typeLabel: string;
  primaryActionLabel: string;
  primaryActionIcon: string;
};

export type ArtifactCloudTarget = {
  targetKind: WebPublishTargetKind;
  targetId: string;
  embedUrl?: string;
  filePath?: string;
};

export function artifactDeliverableMeta(artifact: SuperAgentArtifact): ArtifactDeliverableMeta {
  switch (artifact.kind) {
    case 'design-project':
      if (artifact.scenario === 'deck' || artifact.scenario === 'document') {
        return {
          icon: 'slideshow-line',
          tone: 'audio',
          typeLabel: 'Slides & Docs',
          primaryActionLabel: 'Open editor',
          primaryActionIcon: 'slideshow-line',
        };
      }
      return {
        icon: 'layout-line',
        tone: 'agent',
        typeLabel: 'Interactive Prototype',
        primaryActionLabel: 'Open editor',
        primaryActionIcon: 'layout-line',
      };
    case 'motion-project':
      return {
        icon: 'movie-line',
        tone: 'video',
        typeLabel: 'Motion Video',
        primaryActionLabel: 'Open editor',
        primaryActionIcon: 'movie-line',
      };
    case 'motion-export':
      return {
        icon: 'clapperboard-line',
        tone: 'video',
        typeLabel: 'Motion Video',
        primaryActionLabel: 'Play',
        primaryActionIcon: 'play-fill',
      };
    case 'asset-image':
      return {
        icon: 'image-line',
        tone: 'image',
        typeLabel: 'Image Artwork',
        primaryActionLabel: 'Preview',
        primaryActionIcon: 'eye-line',
      };
    case 'asset-video':
      return {
        icon: 'film-line',
        tone: 'video',
        typeLabel: 'Video Asset',
        primaryActionLabel: 'Play',
        primaryActionIcon: 'play-fill',
      };
    case 'asset-audio':
      return {
        icon: 'music-2-line',
        tone: 'audio',
        typeLabel: 'Audio Track',
        primaryActionLabel: 'Play',
        primaryActionIcon: 'play-fill',
      };
    case 'brand-kit':
      return {
        icon: 'palette-line',
        tone: 'image',
        typeLabel: 'Brand Kit',
        primaryActionLabel: 'Preview',
        primaryActionIcon: 'eye-line',
      };
    case 'game-project':
      return {
        icon: 'gamepad-line',
        tone: 'agent',
        typeLabel: 'HTML Game',
        primaryActionLabel: 'Play game',
        primaryActionIcon: 'play-fill',
      };
    case 'web':
      return {
        icon: 'global-line',
        tone: 'coding',
        typeLabel: 'Web Page',
        primaryActionLabel: 'Preview',
        primaryActionIcon: 'eye-line',
      };
    default:
      return {
        icon: 'file-line',
        tone: 'agent',
        typeLabel: 'Artifact',
        primaryActionLabel: 'Open',
        primaryActionIcon: 'arrow-right-up-line',
      };
  }
}

export function resolveArtifactCloudTarget(artifact: SuperAgentArtifact): ArtifactCloudTarget | null {
  if (artifact.kind === 'game-project') {
    const targetId = artifact.projectId || (artifact.id.startsWith('game:') ? artifact.id.slice('game:'.length) : '');
    if (!targetId) return null;
    if (artifact.projectId) {
      return { targetKind: 'game', targetId, filePath: artifact.entry };
    }
    if (artifact.url && /^https:\/\//i.test(artifact.url)) {
      return { targetKind: 'game', targetId, embedUrl: artifact.url };
    }
    return null;
  }
  if (artifact.kind === 'design-project' && artifact.projectId) {
    return { targetKind: 'design', targetId: artifact.projectId, filePath: artifact.entry };
  }
  if (artifact.kind === 'motion-project' && artifact.projectId) {
    return { targetKind: 'motion', targetId: artifact.projectId, filePath: artifact.entry };
  }
  return null;
}

const RAW_ARTIFACT_SUBTITLES = new Set([
  'prototype',
  'website',
  'deck',
  'document',
  'game',
  'motion',
  'video',
  'image',
  'audio',
  'brand-kit',
  'design-project',
  'motion-project',
  'game-project',
  'game studio',
  'design studio',
  'motion studio',
]);

const MODEL_ROUTING_PREFIX_RE = /^(?:account|opendesign|cloud|fal|atlascloud|openai|google|bytedance|elevenlabs|minimax|kling|runway|luma|vidu|suno|codex|custom):/i;
const INLINE_AUDIO_EVENT = 'om-sa-inline-audio-play';

function cleanArtifactModelPart(raw: string): string {
  const display = modelDisplayLabel(undefined, raw) ?? raw;
  return display
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bTts\b/g, 'TTS')
    .replace(/\bAsr\b/g, 'ASR')
    .replace(/\bHd\b/g, 'HD')
    .replace(/\bElevenlabs\b/gi, 'ElevenLabs')
    .replace(/\bV(\d)/g, 'v$1');
}

function formatAudioClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatArtifactSubDetail(rawSub: string, t: (key: string) => string): string {
  if (!rawSub) return '';
  const parts = rawSub
    .split('·')
    .map(part => part.trim())
    .filter(part => part && !RAW_ARTIFACT_SUBTITLES.has(part.toLowerCase()))
    .map(part => {
      if (MODEL_ROUTING_PREFIX_RE.test(part)) {
        return cleanArtifactModelPart(part);
      }
      const genreKey = part.toLowerCase() as GameGenre;
      const mappedGenre = Object.hasOwn(gameGenreLabels, genreKey) ? gameGenreLabels[genreKey] : undefined;
      return mappedGenre ? t(mappedGenre) : t(part);
    });
  return parts.join(' · ');
}

function safeFilenameSlug(title: string, fallback: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

function appendDownloadParam(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    if (!parsed.searchParams.has('download')) {
      parsed.searchParams.set('download', '1');
    }
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.href;
  } catch {
    return rawUrl.includes('?') ? `${rawUrl}&download=1` : `${rawUrl}?download=1`;
  }
}

async function triggerFetchDownload(url: string, fallbackFilename: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Non-JSON error body; keep HTTP status.
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;\s]+)/i);
  const plainMatch = disposition.match(/filename="([^"]+)"/i);
  const filename = utf8Match?.[1]
    ? decodeURIComponent(utf8Match[1])
    : plainMatch?.[1] || fallbackFilename;
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1500);
  return filename;
}

const DECK_EXPORT_OPTIONS: { format: DesignExportFormat; label: string; icon: string }[] = [
  { format: 'pdf', label: 'Export PDF', icon: 'file-line' },
  { format: 'pptx', label: 'Export PPTX', icon: 'slideshow-line' },
  { format: 'html', label: 'Export HTML', icon: 'global-line' },
  { format: 'zip', label: 'Export ZIP', icon: 'download-2-line' },
];

const WEB_EXPORT_OPTIONS: { format: DesignExportFormat; label: string; icon: string }[] = [
  { format: 'zip', label: 'Export ZIP', icon: 'download-2-line' },
  { format: 'html', label: 'Export HTML', icon: 'global-line' },
  { format: 'open-design', label: 'OpenDesign ZIP', icon: 'layout-line' },
];

export type ArtifactDeliverableCardProps = {
  artifact: SuperAgentArtifact;
  chatId?: string | null;
  layout?: 'default' | 'hero';
  isActiveInViewer?: boolean;
  onOpenArtifactId: (artifactId: string) => void;
  onCopyText?: (text: string) => void;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
  onOpenAccountSettings?: () => void;
  onOpenInDesignStudio?: (projectId: string) => void;
  onOpenInMotionStudio?: (projectId: string) => void;
  onOpenInAssets?: (assetId: string, versionId?: string) => void;
  onOpenInBrandKit?: (kitId?: string) => void;
};

/**
 * Universal post-task deliverable card inside the Super Agent conversation stream.
 * Guides users from any generated artifact (HTML game, Design prototype/deck,
 * Motion video, media asset, Brand Kit, or web page) straight into Preview/Play,
 * OpenDesign Cloud deploy & sharing, or direct export/download.
 */
function withRevisionQuery(url: string, revision?: string): string {
  if (!revision || /[?&]rev=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}rev=${encodeURIComponent(revision)}`;
}

function buildCoverCandidates(artifact: SuperAgentArtifact): string[] {
  const candidates: string[] = [];
  const pushUnique = (raw?: string | null) => {
    if (!raw) return;
    const normalized = raw.trim().replace(/^\/api\//, '/motion-api/');
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  if (artifact.kind === 'game-project') {
    if (artifact.previewUrl) {
      pushUnique(withRevisionQuery(artifact.previewUrl, artifact.revision));
    }
    if (artifact.projectId) {
      const base = `/motion-api/games/${encodeURIComponent(artifact.projectId)}/play`;
      pushUnique(withRevisionQuery(`${base}/assets/cover.png`, artifact.revision));
      pushUnique(withRevisionQuery(`${base}/cover.webp`, artifact.revision));
    }
    return candidates;
  }

  if (artifact.kind === 'asset-image') {
    pushUnique(artifact.previewUrl || artifact.url);
    return candidates;
  }

  if (artifact.previewUrl) {
    pushUnique(artifact.previewUrl);
  }
  return candidates;
}

export function ArtifactDeliverableCard({
  artifact,
  chatId = null,
  layout = 'default',
  isActiveInViewer = false,
  onOpenArtifactId,
  onCopyText,
  onNotify,
  onOpenAccountSettings,
  onOpenInDesignStudio: _onOpenInDesignStudio,
  onOpenInMotionStudio: _onOpenInMotionStudio,
  onOpenInAssets,
  onOpenInBrandKit,
}: ArtifactDeliverableCardProps) {
  const { t } = useI18n();
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [coverIdx, setCoverIdx] = useState(0);

  useEffect(() => {
    setCoverIdx(0);
  }, [artifact.id, artifact.revision, artifact.previewUrl, artifact.url]);

  const meta = artifactDeliverableMeta(artifact);
  const rawSub = (artifact.subtitle ?? '').trim();
  const subDetail = formatArtifactSubDetail(rawSub, t);
  const isHero = layout === 'hero';
  const orientationTag = artifact.kind === 'game-project' && artifact.scenario === 'portrait'
    ? t('Portrait 9:16')
    : '';
  const subtitleText = isPlayableAdArtifact(artifact)
    ? (orientationTag ? `${t('Ad-revenue game')} · ${orientationTag}` : t('Ad-revenue game'))
    : artifact.kind === 'game-project' && subDetail
      ? (orientationTag ? `${subDetail} · ${orientationTag}` : subDetail)
      : subDetail
        ? (orientationTag ? `${t(meta.typeLabel)} · ${subDetail} · ${orientationTag}` : `${t(meta.typeLabel)} · ${subDetail}`)
        : (orientationTag ? `${t(meta.typeLabel)} · ${orientationTag}` : t(meta.typeLabel));
  const cloudTarget = resolveArtifactCloudTarget(artifact);
  // Game publish wizard: only local workspace game projects can be packaged/published to platforms.
  const isBundledGame = Boolean(
    artifact.kind === 'game-project'
    && artifact.projectId
    && bundledGames.some(game => game.id === artifact.projectId),
  );
  const publishGameId = artifact.kind === 'game-project' && artifact.projectId && !isBundledGame
    ? artifact.projectId
    : undefined;
  const publishSession = useGamePublishSession(publishGameId ? artifact.id : null);
  const publishPanelOpen = Boolean(publishGameId && isActiveInViewer && publishSession?.open);

  const coverCandidates = buildCoverCandidates(artifact);
  const thumbUrl = coverCandidates[coverIdx] ?? null;
  const stageVideoUrl = !thumbUrl && (artifact.kind === 'motion-export' || artifact.kind === 'asset-video')
    ? (artifact.url || artifact.downloadUrl)?.replace(/^\/api\//, '/motion-api/') ?? null
    : null;
  const hasVisualStage = isHero && Boolean(thumbUrl || stageVideoUrl);
  const isPortraitCover = Boolean(thumbUrl && artifact.kind === 'game-project' && artifact.scenario === 'portrait');
  const isPortraitCapture = Boolean(isPortraitCover && thumbUrl && /\/assets\/cover\.png(?:$|\?)/i.test(thumbUrl));
  const isWideThumb = Boolean(thumbUrl && artifact.kind === 'game-project' && !isPortraitCover);
  const isPlayableStage = artifact.kind === 'game-project'
    || artifact.kind === 'motion-export'
    || artifact.kind === 'asset-video';
  const primaryLabel = isActiveInViewer
    ? t(artifact.kind === 'game-project' ? 'Playing in Viewer' : 'Previewing in Viewer')
    : t(meta.primaryActionLabel);
  const primaryIcon = isActiveInViewer ? 'check-line' : meta.primaryActionIcon;

  const isDeckDesign = artifact.kind === 'design-project'
    && (artifact.scenario === 'deck' || artifact.scenario === 'document');
  const designExportOptions = isDeckDesign ? DECK_EXPORT_OPTIONS : WEB_EXPORT_OPTIONS;

  const handleToggleGamePublish = () => {
    if (!publishGameId) return;
    if (publishPanelOpen) {
      gamePublishActions.close(artifact.id);
      return;
    }
    const orientation = artifact.scenario === 'portrait'
      ? 'portrait'
      : artifact.scenario === 'landscape'
        ? 'landscape'
        : undefined;
    gamePublishActions.open({
      artifactId: artifact.id,
      chatId,
      gameId: publishGameId,
      gameTitle: artifact.title,
      ...(orientation ? { orientation } : {}),
      // Same share target as the viewer toolbar Publish button; missing when the game cannot be shared.
      link: cloudTarget
        ? {
            targetId: cloudTarget.targetId,
            filePath: cloudTarget.filePath,
            embedUrl: cloudTarget.embedUrl,
            title: artifact.title,
          }
        : undefined,
    });
    onOpenArtifactId(artifact.id);
  };

  const handleGameExport = async () => {
    if (!artifact.projectId || exportBusy) return;
    setExportBusy(true);
    try {
      const fallback = `${safeFilenameSlug(artifact.title, artifact.projectId)}.zip`;
      const filename = await triggerFetchDownload(
        `/motion-api/games/${encodeURIComponent(artifact.projectId)}/export`,
        fallback,
      );
      onNotify?.(t('Exported {name}', { name: filename }), 'info');
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : t('Export failed'), 'error');
    } finally {
      setExportBusy(false);
    }
  };

  const handleDesignExport = async (format: DesignExportFormat) => {
    if (!artifact.projectId || exportBusy) return;
    setExportMenuOpen(false);
    setExportBusy(true);
    try {
      const filename = await designClient.downloadExport(artifact.projectId, {
        format,
        filePath: artifact.entry ?? null,
      });
      onNotify?.(t('Exported {name}', { name: filename }), 'info');
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : t('Export failed'), 'error');
    } finally {
      setExportBusy(false);
    }
  };

  const handleDirectDownload = async (url: string, fallbackName: string) => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const filename = await triggerFetchDownload(url, fallbackName);
      onNotify?.(t('Downloaded {name}', { name: filename }), 'info');
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : t('Download failed'), 'error');
    } finally {
      setExportBusy(false);
    }
  };

  const mediaDownloadUrl =
    artifact.kind === 'motion-export'
      ? artifact.downloadUrl || artifact.url
      : ['asset-image', 'asset-video', 'asset-audio'].includes(artifact.kind)
        ? artifact.downloadUrl || (artifact.url ? appendDownloadParam(artifact.url) : undefined)
        : undefined;

  const isExternalWebUrl = artifact.kind === 'web' && Boolean(artifact.url && /^https?:\/\//i.test(artifact.url));

  const coverVisual = (
    <span
      className="om-sa-deliverable-icon"
      data-tone={meta.tone}
      data-wide={isWideThumb || undefined}
      data-portrait={isPortraitCover || undefined}
      aria-hidden="true"
    >
      {thumbUrl ? (
        <img
          className="om-sa-deliverable-thumb"
          src={thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setCoverIdx(idx => idx + 1)}
        />
      ) : (
        <RemixIcon name={meta.icon} size={20} />
      )}
    </span>
  );

  const actionsBar = (
    <div className="om-sa-deliverable-actions" role="group" aria-label={t('Artifact actions')}>
      <Button
        variant="plain"
        type="button"
        className="om-sa-deliverable-btn"
        data-primary
        data-viewer-active={isActiveInViewer || undefined}
        onClick={() => onOpenArtifactId(artifact.id)}
      >
        <RemixIcon name={primaryIcon} size={13} />
        <span>{primaryLabel}</span>
      </Button>

      {publishGameId && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn om-sa-deliverable-publish-btn"
          data-active={publishPanelOpen || undefined}
          aria-pressed={publishPanelOpen}
          onClick={handleToggleGamePublish}
        >
          <RemixIcon name="upload-2-line" size={13} />
          <span>{t('Publish')}</span>
        </Button>
      )}

      {cloudTarget && (
        <WebPublishPopover
          lazy
          compact
          side="top"
          align="start"
          targetKind={cloudTarget.targetKind}
          targetId={cloudTarget.targetId}
          embedUrl={cloudTarget.embedUrl}
          filePath={cloudTarget.filePath}
          title={artifact.title}
          revisionKey={artifact.revision ?? String(artifact.updatedAt)}
          triggerLabel={t('Share')}
          triggerIcon="share-forward-line"
          triggerClassName="om-sa-deliverable-btn"
          onOpenAccount={onOpenAccountSettings}
          onNotify={onNotify}
        />
      )}

      {artifact.kind === 'game-project' && artifact.projectId && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn"
          disabled={exportBusy}
          onClick={() => void handleGameExport()}
        >
          <RemixIcon name={exportBusy ? 'loader-4-line' : 'download-2-line'} size={13} className={exportBusy ? 'om-sa-deliverable-spin' : undefined} />
          <span>{t('Export ZIP')}</span>
        </Button>
      )}

      {artifact.kind === 'design-project' && artifact.projectId && (
        <Popover
          open={exportMenuOpen}
          onOpenChange={setExportMenuOpen}
          side="top"
          align="start"
          initialFocus={false}
          aria-label={t('Export')}
          className="om-sa-browser-menu-popover"
          trigger={
            <Button
              variant="plain"
              type="button"
              className="om-sa-deliverable-btn"
              disabled={exportBusy}
              aria-expanded={exportMenuOpen}
            >
              <RemixIcon name={exportBusy ? 'loader-4-line' : 'download-2-line'} size={13} className={exportBusy ? 'om-sa-deliverable-spin' : undefined} />
              <span>{t('Export')}</span>
              <RemixIcon name="arrow-down-s-line" size={12} />
            </Button>
          }
        >
          <div className="om-sa-browser-menu" role="menu" aria-label={t('Export formats')}>
            {designExportOptions.map(option => (
              <Button
                key={option.format}
                variant="plain"
                type="button"
                role="menuitem"
                className="om-sa-browser-menu-item"
                onClick={() => void handleDesignExport(option.format)}
              >
                <RemixIcon name={option.icon} size={14} />
                <span>{t(option.label)}</span>
              </Button>
            ))}
          </div>
        </Popover>
      )}

      {mediaDownloadUrl && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn"
          disabled={exportBusy}
          onClick={() => {
            const ext = artifact.kind === 'motion-export' || artifact.kind === 'asset-video'
              ? 'mp4'
              : artifact.kind === 'asset-audio'
                ? 'mp3'
                : 'png';
            void handleDirectDownload(mediaDownloadUrl, `${safeFilenameSlug(artifact.title, artifact.id)}.${ext}`);
          }}
        >
          <RemixIcon name={exportBusy ? 'loader-4-line' : 'download-2-line'} size={13} className={exportBusy ? 'om-sa-deliverable-spin' : undefined} />
          <span>{t('Download')}</span>
        </Button>
      )}

      {['asset-image', 'asset-video', 'asset-audio'].includes(artifact.kind) && artifact.assetId && onOpenInAssets && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn"
          onClick={() => onOpenInAssets(artifact.assetId!, artifact.versionId)}
        >
          <RemixIcon name="folder-open-line" size={13} />
          <span>{t('Open in Assets')}</span>
        </Button>
      )}

      {artifact.kind === 'brand-kit' && artifact.kitId && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn"
          disabled={exportBusy}
          onClick={() =>
            void handleDirectDownload(
              `/motion-api/brand-kits/${encodeURIComponent(artifact.kitId!)}/files/package.zip`,
              `${safeFilenameSlug(artifact.title, artifact.kitId!)}.zip`,
            )
          }
        >
          <RemixIcon name={exportBusy ? 'loader-4-line' : 'download-2-line'} size={13} className={exportBusy ? 'om-sa-deliverable-spin' : undefined} />
          <span>{t('Export ZIP')}</span>
        </Button>
      )}

      {artifact.kind === 'brand-kit' && onOpenInBrandKit && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn"
          onClick={() => onOpenInBrandKit(artifact.kitId)}
        >
          <RemixIcon name="palette-line" size={13} />
          <span>{t('Open in Brand Kit')}</span>
        </Button>
      )}

      {isExternalWebUrl && onCopyText && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn"
          onClick={() => onCopyText(artifact.url!)}
        >
          <RemixIcon name="link" size={13} />
          <span>{t('Copy link')}</span>
        </Button>
      )}

      {isExternalWebUrl && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn"
          onClick={() => window.open(artifact.url!, '_blank', 'noopener,noreferrer')}
        >
          <RemixIcon name="external-link-line" size={13} />
          <span>{t('Open in browser')}</span>
        </Button>
      )}
    </div>
  );

  return (
    <div
      className="om-sa-deliverable-card"
      data-kind={artifact.kind}
      data-layout={isHero ? 'hero' : undefined}
      data-has-stage={hasVisualStage || undefined}
      data-wide-cover={isWideThumb || undefined}
      data-portrait-cover={isPortraitCover || undefined}
      data-viewer-active={isActiveInViewer || undefined}
    >
      {isHero && hasVisualStage ? (
        <>
          <Button
            variant="plain"
            type="button"
            className="om-sa-deliverable-stage"
            data-stage-mode={isPortraitCapture ? 'portrait-frame' : 'full-bleed'}
            data-playable={isPlayableStage || undefined}
            aria-label={`${primaryLabel}: ${artifact.title}`}
            onClick={() => onOpenArtifactId(artifact.id)}
          >
            {thumbUrl ? (
              isPortraitCapture ? (
                <>
                  <img
                    className="om-sa-deliverable-stage-backdrop"
                    src={thumbUrl}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="om-sa-deliverable-stage-phone" aria-hidden="true">
                    <img
                      className="om-sa-deliverable-stage-phone-img"
                      src={thumbUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={() => setCoverIdx(idx => idx + 1)}
                    />
                  </span>
                </>
              ) : (
                <img
                  className="om-sa-deliverable-stage-img"
                  src={thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setCoverIdx(idx => idx + 1)}
                />
              )
            ) : stageVideoUrl ? (
              <video
                className="om-sa-deliverable-stage-img"
                src={stageVideoUrl}
                muted
                playsInline
                preload="metadata"
              />
            ) : null}
            <span className="om-sa-deliverable-stage-scrim" aria-hidden="true" />
            {isPlayableStage && !isActiveInViewer && (
              <span className="om-sa-deliverable-stage-play" aria-hidden="true">
                <RemixIcon name="play-fill" size={20} />
              </span>
            )}
          </Button>
          <div className="om-sa-deliverable-hero-footer">
            <Button
              variant="plain"
              type="button"
              className="om-sa-deliverable-main"
              onClick={() => onOpenArtifactId(artifact.id)}
            >
              <span className="om-sa-deliverable-meta">
                <strong title={artifact.title}>{artifact.title}</strong>
                <small>{subtitleText}</small>
              </span>
            </Button>
            {actionsBar}
          </div>
        </>
      ) : isHero ? (
        <div className="om-sa-deliverable-hero-compact">
          <Button
            variant="plain"
            type="button"
            className="om-sa-deliverable-main"
            onClick={() => onOpenArtifactId(artifact.id)}
          >
            {coverVisual}
            <span className="om-sa-deliverable-meta">
              <strong title={artifact.title}>{artifact.title}</strong>
              <small>{subtitleText}</small>
            </span>
          </Button>
          {actionsBar}
        </div>
      ) : (
        <>
          <Button
            variant="plain"
            type="button"
            className="om-sa-deliverable-main"
            onClick={() => onOpenArtifactId(artifact.id)}
          >
            {coverVisual}
            <span className="om-sa-deliverable-meta">
              <strong title={artifact.title}>{artifact.title}</strong>
              <small>{subtitleText}</small>
            </span>
            <span className="om-sa-deliverable-open-cue" aria-hidden="true">
              <RemixIcon name={isExternalWebUrl ? 'arrow-right-up-line' : 'arrow-right-s-line'} size={16} />
            </span>
          </Button>
          {actionsBar}
        </>
      )}
    </div>
  );
}

export type SupportingAssetRowProps = {
  artifact: SuperAgentArtifact;
  onOpenArtifactId: (artifactId: string) => void;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
  onOpenInAssets?: (assetId: string, versionId?: string) => void;
};

/**
 * Compact secondary row for supporting media assets (background art, BGM, clips)
 * generated alongside a primary project deliverable. Audio plays inline and images
 * open in a lightweight lightbox so neither interrupts the active right-hand Viewer.
 */
export function SupportingAssetRow({
  artifact,
  onOpenArtifactId,
  onNotify,
  onOpenInAssets,
}: SupportingAssetRowProps) {
  const { t } = useI18n();
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const meta = artifactDeliverableMeta(artifact);
  const rawSub = (artifact.subtitle ?? '').trim();
  const subDetail = formatArtifactSubDetail(rawSub, t);
  const subtitleText = subDetail ? `${t(meta.typeLabel)} · ${subDetail}` : t(meta.typeLabel);
  const isAudio = artifact.kind === 'asset-audio' && Boolean(artifact.url);
  const isImage = artifact.kind === 'asset-image' && Boolean(artifact.url);
  const thumbUrl = isImage && !thumbFailed ? artifact.url! : null;
  const mediaDownloadUrl = artifact.downloadUrl || (artifact.url ? appendDownloadParam(artifact.url) : undefined);

  useEffect(() => {
    if (!isAudio) return;
    const el = audioRef.current;
    const onOtherPlay = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const target = audioRef.current ?? el;
      if (detail !== artifact.id && target && !target.paused) {
        target.pause();
      }
    };
    window.addEventListener(INLINE_AUDIO_EVENT, onOtherPlay);
    return () => {
      window.removeEventListener(INLINE_AUDIO_EVENT, onOtherPlay);
      (audioRef.current ?? el)?.pause();
    };
  }, [artifact.id, isAudio]);

  const toggleInlineAudio = async () => {
    const el = audioRef.current;
    if (!el) {
      onOpenArtifactId(artifact.id);
      return;
    }
    if (!el.paused) {
      el.pause();
      return;
    }
    window.dispatchEvent(new CustomEvent<string>(INLINE_AUDIO_EVENT, { detail: artifact.id }));
    try {
      await el.play();
    } catch {
      onOpenArtifactId(artifact.id);
    }
  };

  const handlePrimaryClick = () => {
    if (isAudio) {
      void toggleInlineAudio();
      return;
    }
    if (isImage) {
      setLightboxOpen(true);
      return;
    }
    onOpenArtifactId(artifact.id);
  };

  const handleDownload = async () => {
    if (!mediaDownloadUrl || downloadBusy) return;
    setDownloadBusy(true);
    try {
      const ext = artifact.kind === 'asset-video' ? 'mp4' : artifact.kind === 'asset-audio' ? 'mp3' : 'png';
      const filename = await triggerFetchDownload(mediaDownloadUrl, `${safeFilenameSlug(artifact.title, artifact.id)}.${ext}`);
      onNotify?.(t('Downloaded {name}', { name: filename }), 'info');
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : t('Download failed'), 'error');
    } finally {
      setDownloadBusy(false);
    }
  };

  const progressPct = audioDuration > 0 ? Math.min(100, Math.max(0, (audioTime / audioDuration) * 100)) : 0;
  const showInlinePlayerProgress = isAudio && (audioPlaying || audioTime > 0);

  return (
    <>
      <div
        className="om-sa-supporting-row"
        data-kind={artifact.kind}
        data-playing={audioPlaying || undefined}
      >
        {isAudio && (
          <audio
            ref={audioRef}
            src={artifact.url}
            preload="none"
            onPlay={() => setAudioPlaying(true)}
            onPause={() => setAudioPlaying(false)}
            onEnded={() => {
              setAudioPlaying(false);
              setAudioTime(0);
            }}
            onLoadedMetadata={event => {
              const dur = event.currentTarget.duration;
              if (Number.isFinite(dur) && dur > 0) setAudioDuration(dur);
            }}
            onTimeUpdate={event => {
              setAudioTime(event.currentTarget.currentTime);
              const dur = event.currentTarget.duration;
              if (Number.isFinite(dur) && dur > 0) setAudioDuration(dur);
            }}
          />
        )}

        <Button
          variant="plain"
          type="button"
          className="om-sa-supporting-main"
          aria-label={isAudio ? (audioPlaying ? t('Pause') : t('Play')) : t(meta.primaryActionLabel)}
          onClick={handlePrimaryClick}
        >
          <span className="om-sa-supporting-thumb-wrap" data-tone={meta.tone} aria-hidden="true">
            {thumbUrl ? (
              <img
                className="om-sa-supporting-thumb"
                src={thumbUrl}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setThumbFailed(true)}
              />
            ) : isAudio ? (
              <RemixIcon name={audioPlaying ? 'pause-fill' : 'play-fill'} size={15} />
            ) : (
              <RemixIcon name={meta.icon} size={16} />
            )}
          </span>
          <span className="om-sa-supporting-meta">
            <strong title={artifact.title}>{artifact.title}</strong>
            {showInlinePlayerProgress ? (
              <span className="om-sa-supporting-audio-bar">
                <span className="om-sa-supporting-audio-track" aria-hidden="true">
                  <span className="om-sa-supporting-audio-fill" style={{ width: `${progressPct}%` }} />
                </span>
                <span className="om-sa-supporting-audio-time">
                  {formatAudioClock(audioTime)}
                  {audioDuration > 0 ? ` / ${formatAudioClock(audioDuration)}` : ''}
                </span>
              </span>
            ) : (
              <small title={subtitleText}>{subtitleText}</small>
            )}
          </span>
        </Button>

        <div className="om-sa-supporting-actions" role="group" aria-label={t('Artifact actions')}>
          {isImage && (
            <IconButton
              variant="ghost"
              className="om-sa-supporting-icon-btn"
              aria-label={t('Preview')}
              title={t('Preview')}
              onClick={() => setLightboxOpen(true)}
              icon={<RemixIcon name="eye-line" size={14} />}
            />
          )}
          {mediaDownloadUrl && (
            <IconButton
              variant="ghost"
              className="om-sa-supporting-icon-btn"
              aria-label={t('Download')}
              title={t('Download')}
              disabled={downloadBusy}
              onClick={() => void handleDownload()}
              icon={
                <RemixIcon
                  name={downloadBusy ? 'loader-4-line' : 'download-2-line'}
                  size={14}
                  className={downloadBusy ? 'om-sa-deliverable-spin' : undefined}
                />
              }
            />
          )}
          {artifact.assetId && onOpenInAssets && (
            <IconButton
              variant="ghost"
              className="om-sa-supporting-icon-btn"
              aria-label={t('Open in Assets')}
              title={t('Open in Assets')}
              onClick={() => onOpenInAssets(artifact.assetId!, artifact.versionId)}
              icon={<RemixIcon name="folder-open-line" size={14} />}
            />
          )}
        </div>
      </div>

      {isImage && (
        <Dialog.Root open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="om-sa-lightbox-backdrop" />
            <Dialog.Popup className="om-sa-lightbox-popup" aria-label={artifact.title}>
              <div className="om-sa-lightbox-head">
                <div className="om-sa-lightbox-title">
                  <Dialog.Title className="om-sa-lightbox-heading">{artifact.title}</Dialog.Title>
                  <span className="om-sa-lightbox-sub">{subtitleText}</span>
                </div>
                <div className="om-sa-lightbox-actions">
                  {mediaDownloadUrl && (
                    <Button
                      variant="plain"
                      type="button"
                      className="om-sa-deliverable-btn"
                      disabled={downloadBusy}
                      onClick={() => void handleDownload()}
                    >
                      <RemixIcon name={downloadBusy ? 'loader-4-line' : 'download-2-line'} size={13} className={downloadBusy ? 'om-sa-deliverable-spin' : undefined} />
                      <span>{t('Download')}</span>
                    </Button>
                  )}
                  {artifact.assetId && onOpenInAssets && (
                    <Button
                      variant="plain"
                      type="button"
                      className="om-sa-deliverable-btn"
                      onClick={() => {
                        setLightboxOpen(false);
                        onOpenInAssets(artifact.assetId!, artifact.versionId);
                      }}
                    >
                      <RemixIcon name="folder-open-line" size={13} />
                      <span>{t('Open in Assets')}</span>
                    </Button>
                  )}
                  <Button
                    variant="plain"
                    type="button"
                    className="om-sa-deliverable-btn"
                    onClick={() => {
                      setLightboxOpen(false);
                      onOpenArtifactId(artifact.id);
                    }}
                  >
                    <RemixIcon name="external-link-line" size={13} />
                    <span>{t('Open in Viewer')}</span>
                  </Button>
                  <IconButton
                    variant="ghost"
                    className="om-sa-supporting-icon-btn"
                    aria-label={t('Close preview')}
                    title={t('Close preview')}
                    onClick={() => setLightboxOpen(false)}
                    icon={<RemixIcon name="close-line" size={16} />}
                  />
                </div>
              </div>
              <div className="om-sa-lightbox-stage">
                <img className="om-sa-lightbox-img" src={artifact.url} alt={artifact.title} />
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
