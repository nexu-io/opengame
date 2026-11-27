import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import {
  describeSuperAgentApproval,
  gameValidationPassed,
  type SuperAgentActionCard,
  type SuperAgentApproval,
  type SuperAgentArtifact,
  type SuperAgentChat,
  type SuperAgentFeedbackReason,
  type SuperAgentFeedbackScene,
  type SuperAgentFileOperation,
  type SuperAgentMessage,
  type SuperAgentPromptSegment,
  type SuperAgentResourceAttachment,
  type SuperAgentToolCategory,
  type SuperAgentToolEvent,
  type SuperAgentTurnFeedback,
  type SuperAgentTurnFeedbackAction,
  type SuperAgentTurnFeedbackRating,
} from '../../../shared/super-agent';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n, type Translate } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { WorkingIndicator } from '../motion/AssetCreationVisuals';
import { BLACK_FRIDAY_CAMPAIGN, campaignPricingUrl, newCampaignEntryId, useBlackFridayActive } from '../motion/campaignAttribution';
import { useCheckoutReturnRefresh } from '../motion/entitlementAttribution';
import { readDirectGameBrief } from '../motion/game/gameSuperAgent';
import { AccountHandoffCard } from './AccountHandoffCard';
import type { AccountHandoffResume } from './useAccountHandoff';
import { openBalanceGate } from '../motion/monetization/monetizationGateBus';
import { reportEntitlementGateClick, reportEntitlementGateView } from '../motion/pageTracking';
import { ArtifactDeliverableCard, SupportingAssetRow } from './ArtifactDeliverableCard';
import { FilesChangedCard, UnifiedDiffView } from './ChangedFilesTree';
import { InlineMentionChip } from './MentionNode';
import { ResourceThumbImage, resourceIcon, resourceImagePreviewUrl, resourceKey } from './ResourcePickerDialog';
import { SimpleMarkdown } from './SimpleMarkdown';

type TurnGroup = {
  id: string;
  user?: SuperAgentMessage;
  workItems: SuperAgentMessage[];
  timelineEntries: SuperAgentMessage[];
  assistantItems: SuperAgentMessage[];
  changedFiles: SuperAgentFileOperation[];
  artifacts: SuperAgentArtifact[];
  actionCards: SuperAgentActionCard[];
  hasRunning: boolean;
  hasFailure: boolean;
  durationMs?: number;
};

export function formatElapsedDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatWorkingDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '1s';
  const totalSecs = Math.max(1, Math.floor(ms / 1000));
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const remSecs = totalSecs % 60;
  return `${mins}m ${remSecs}s`;
}

function useLiveElapsedMs(startedAt: number | undefined, active: boolean, intervalMs = 500): number {
  const [elapsedMs, setElapsedMs] = useState(() =>
    active && typeof startedAt === 'number' ? Math.max(0, Date.now() - startedAt) : 0,
  );
  useEffect(() => {
    if (!active || typeof startedAt !== 'number') {
      setElapsedMs(0);
      return;
    }
    const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, startedAt, intervalMs]);
  return elapsedMs;
}

function isWorkItem(message: SuperAgentMessage): boolean {
  return message.role === 'tool' || (message.role === 'reasoning' && Boolean(message.text.trim()));
}

function isFailedGameValidation(event?: SuperAgentToolEvent): boolean {
  return Boolean(event && event.status !== 'running'
    && (event.validationPassed ?? gameValidationPassed(event.tool, event.outputPreview)) === false);
}

function resolveLiveTurnStatusText(
  t: (key: string, vars?: Record<string, string | number>) => string,
  options: { chat: SuperAgentChat | null; sending?: boolean; engineLabel?: string },
): string {
  if (options.sending && options.chat?.state !== 'running' && options.chat?.state !== 'waiting') {
    return t('Starting…');
  }
  const activity = options.chat?.turnActivity;
  const phase = activity?.phase ?? 'thinking';
  const targetLabel = activity?.label || options.engineLabel || 'Super Agent';
  if (phase === 'connecting') return t('Connecting to {agent}…', { agent: targetLabel });
  if (phase === 'tool') return t(activity?.label || 'Running {tool}…', { tool: activity?.activeToolName || 'tool' });
  if (phase === 'streaming') return t('Writing response…');
  if (phase === 'waiting_approval') return t('Waiting for approval…');
  return t('Thinking…');
}

function categoryIcon(category: SuperAgentToolCategory | undefined, status: SuperAgentToolEvent['status']): string {
  if (status === 'running') return 'loader-4-line';
  if (status === 'failed') return 'error-warning-line';
  switch (category) {
    case 'command':
      return 'terminal-box-fill';
    case 'file_read':
      return 'file-text-line';
    case 'file_write':
      return 'file-add-line';
    case 'file_edit':
      return 'file-code-line';
    case 'file_delete':
      return 'delete-bin-line';
    case 'search':
      return 'search-line';
    case 'web':
      return 'global-line';
    case 'mcp':
      return 'apps-2-line';
    case 'agent':
      return 'robot-fill';
    default:
      return 'code-s-slash-line';
  }
}

function collectTurnFiles(workItems: SuperAgentMessage[]): SuperAgentFileOperation[] {
  const byPath = new Map<string, SuperAgentFileOperation>();
  for (const item of workItems) {
    if (item.role !== 'tool' || !item.toolEvent) continue;
    const ev = item.toolEvent;
    const candidates = ev.files?.length ? ev.files : ev.fileOp ? [ev.fileOp] : [];
    for (const op of candidates) {
      if (!op.path || op.action === 'read') continue;
      const existing = byPath.get(op.path);
      if (!existing) {
        byPath.set(op.path, {
          ...op,
          ...(ev.artifactId && !op.artifactId ? { artifactId: ev.artifactId } : {}),
        });
      } else {
        byPath.set(op.path, {
          ...existing,
          action: existing.action === 'create' && op.action === 'edit' ? 'create' : op.action,
          addedLines: (existing.addedLines ?? 0) + (op.addedLines ?? 0) || existing.addedLines || op.addedLines,
          removedLines: (existing.removedLines ?? 0) + (op.removedLines ?? 0) || existing.removedLines || op.removedLines,
          diffPreview: op.diffPreview || existing.diffPreview,
          artifactId: op.artifactId || existing.artifactId || ev.artifactId,
        });
      }
    }
  }
  return [...byPath.values()];
}

function splitMessagesIntoRawTurns(
  messages: readonly SuperAgentMessage[] | undefined,
): { user?: SuperAgentMessage; rest: SuperAgentMessage[] }[] {
  if (!messages?.length) return [];
  const rawTurns: { user?: SuperAgentMessage; rest: SuperAgentMessage[] }[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      rawTurns.push({ user: msg, rest: [] });
    } else {
      if (!rawTurns.length) rawTurns.push({ rest: [] });
      rawTurns[rawTurns.length - 1].rest.push(msg);
    }
  }
  return rawTurns;
}

/** Shared turn count derived from ExecutionTimeline's exact turn-grouping rule. */
export function countConversationTurns(messages: readonly SuperAgentMessage[] | undefined): number {
  return splitMessagesIntoRawTurns(messages).length;
}

function groupMessagesIntoTurns(chat: SuperAgentChat): TurnGroup[] {
  const artifactsById = new Map(chat.artifacts.map(a => [a.id, a]));
  const rawTurns = splitMessagesIntoRawTurns(chat.messages);

  const claimedArtifactIds = new Set<string>();
  const chatIsRunning = chat.state === 'running' || chat.state === 'waiting';
  return rawTurns.map((group, idx) => {
    const isCurrentRunningTurn = chatIsRunning && idx === rawTurns.length - 1;
    const workItems = group.rest.filter(isWorkItem);
    const allAssistant = group.rest.filter(m => m.role === 'assistant');

    let lastWorkIdx = -1;
    for (let i = group.rest.length - 1; i >= 0; i -= 1) {
      if (isWorkItem(group.rest[i])) {
        lastWorkIdx = i;
        break;
      }
    }

    let assistantItems: SuperAgentMessage[];
    let foldedAssistantIds: Set<string>;
    if (lastWorkIdx === -1) {
      assistantItems = allAssistant;
      foldedAssistantIds = new Set();
    } else {
      const trailingAssistant = group.rest.slice(lastWorkIdx + 1).filter(m => m.role === 'assistant');
      if (trailingAssistant.length > 0) {
        assistantItems = trailingAssistant;
        const trailingIds = new Set(trailingAssistant.map(m => m.id));
        foldedAssistantIds = new Set(allAssistant.filter(m => !trailingIds.has(m.id)).map(m => m.id));
      } else if (!isCurrentRunningTurn && allAssistant.length > 0) {
        const fallbackFinal = allAssistant[allAssistant.length - 1];
        assistantItems = [fallbackFinal];
        foldedAssistantIds = new Set(allAssistant.slice(0, -1).map(m => m.id));
      } else {
        assistantItems = [];
        foldedAssistantIds = new Set(allAssistant.map(m => m.id));
      }
    }

    const timelineEntries = group.rest.filter(
      m => isWorkItem(m) || (m.role === 'assistant' && foldedAssistantIds.has(m.id) && Boolean(m.text.trim())),
    );
    const artifactIds = new Set<string>();
    for (const m of group.rest) {
      if (m.toolEvent?.artifactId) {
        artifactIds.add(m.toolEvent.artifactId);
        claimedArtifactIds.add(m.toolEvent.artifactId);
      }
      if (m.artifactIds) {
        for (const id of m.artifactIds) {
          artifactIds.add(id);
          claimedArtifactIds.add(id);
        }
      }
    }
    const turnStart = group.user?.createdAt ?? group.rest[0]?.createdAt ?? 0;
    const nextTurnStart = rawTurns[idx + 1]?.user?.createdAt ?? rawTurns[idx + 1]?.rest[0]?.createdAt;
    for (const artifact of chat.artifacts) {
      if (claimedArtifactIds.has(artifact.id)) continue;
      const ts = artifact.updatedAt || artifact.createdAt;
      if (ts >= turnStart && (nextTurnStart === undefined || ts < nextTurnStart)) {
        artifactIds.add(artifact.id);
        claimedArtifactIds.add(artifact.id);
      }
    }
    const artifacts = [...artifactIds]
      .map(id => artifactsById.get(id))
      .filter((a): a is SuperAgentArtifact => Boolean(a));
    const actionCardsByKey = new Map<string, SuperAgentActionCard>();
    for (const item of workItems) {
      const card = item.toolEvent?.actionCard;
      if (!card) continue;
      actionCardsByKey.set(`${card.kind}:${card.targetId ?? ''}`, card);
    }
    const rawActionCards = [...actionCardsByKey.values()];
    // When a turn already surfaces an in-place publish sign-in card, suppress redundant generic sign_in cards from the same turn.
    const hasWebPublishSignIn = rawActionCards.some(card => card.kind === 'web_publish_sign_in');
    const actionCards = hasWebPublishSignIn
      ? rawActionCards.filter(card => card.kind !== 'sign_in')
      : rawActionCards;
    const turnId = group.user?.id ?? `turn-${idx}`;
    const persistedFiles = chat.turnChangedFiles?.[turnId];
    const changedFiles = persistedFiles?.length ? persistedFiles : collectTurnFiles(workItems);
    const hasRunning = workItems.some(
      m => m.status === 'streaming' || m.toolEvent?.status === 'running',
    );
    const hasUnrecoveredFailure = workItems.some((m, wi) => {
      const ev = m.toolEvent;
      if (!ev) return false;
      const failedValidation = isFailedGameValidation(ev);
      const failed = ev.status === 'failed' || failedValidation;
      if (!failed) return false;
      const normalizedTool = (ev.tool ?? '').replace(/^mcp_+openmotion_+/, '');
      if (normalizedTool) {
        const recoveredLater = workItems.slice(wi + 1).some(later => {
          const lev = later.toolEvent;
          if (!lev) return false;
          const lTool = (lev.tool ?? '').replace(/^mcp_+openmotion_+/, '');
          return lTool === normalizedTool && lev.status === 'completed' && !isFailedGameValidation(lev);
        });
        if (recoveredLater) return false;
      }
      if (!failedValidation) {
        const restIndex = group.rest.indexOf(m);
        const hasLaterProgress = restIndex >= 0 && group.rest.slice(restIndex + 1).some(later =>
          (later.role === 'tool' && later.toolEvent?.status === 'completed' && !isFailedGameValidation(later.toolEvent))
          || (later.role === 'assistant' && Boolean(later.text.trim())),
        );
        const isPrep = isReadOnlyPrepTool(ev, { includeFailed: true });
        const isArgErr = isInternalArgError(ev);
        if (isPrep && (isArgErr || hasLaterProgress)) return false;
        if (isArgErr && hasLaterProgress) return false;
      }
      return true;
    });

    let durationMs: number | undefined;
    if (idx === rawTurns.length - 1 && chat.lastTurnDurationMs !== undefined) {
      durationMs = chat.lastTurnDurationMs;
    } else if (group.user && group.rest.length > 0) {
      const last = group.rest[group.rest.length - 1];
      const endTs = last.toolEvent?.finishedAt ?? last.createdAt;
      if (endTs >= group.user.createdAt) {
        durationMs = endTs - group.user.createdAt;
      }
    }

    return {
      id: turnId,
      user: group.user,
      workItems,
      timelineEntries,
      assistantItems,
      changedFiles,
      artifacts,
      actionCards,
      hasRunning,
      hasFailure: hasUnrecoveredFailure,
      durationMs,
    };
  });
}

const gameGuideSections: Readonly<Record<string, string>> = {
  start: 'Game workflow overview',
  flow: 'Game development flow',
  genres: 'Game genre recipes',
  design: 'Design system',
  style: 'Game visual style',
  review: 'Game review rubric',
  playable: 'Playable ad',
  audio: 'Audio',
  controls: 'Controls & camera guide',
  brief: 'Game brief & level plan',
  craft: 'Game feel & polish',
  sprites: '2D sprite animation',
  animation: '3D character animation',
  procedural: 'Procedural animation',
  textures: 'Materials & textures',
  gates: 'Quality gates',
  lookup: 'Reference research',
  provenance: 'Asset provenance',
  wechat: 'WeChat Mini Game port',
};

const mediaGuideSections: Readonly<Record<string, string>> = {
  start: 'Multimodal media guide',
  codex: 'Local image generation',
};

function sanitizeUserHomePath(raw?: string): string | undefined {
  if (!raw) return raw;
  return raw
    .replace(/\/Users\/[^/\s'"]+\//g, '~/')
    .replace(/\/home\/[^/\s'"]+\//g, '~/')
    .replace(/C:\\Users\\[^\\\s'"]+\\/gi, '~\\');
}

function normalizeInternalJargon(text: string, t: Translate): string {
  const replacement = t('Game creation workflow');
  const protectedPattern = /(```[\s\S]*?```|`[^`\n]+`|!\[[^\]]*\]\((?:<[^>\n]+>|[^)\n]+)\)|\[[^\]]+\]\((?:<[^>\n]+>|[^)\n]+)\))/g;
  return text
    .split(protectedPattern)
    .map((segment, idx) => (
      idx % 2 === 1
        ? segment
        : segment
            .replace(/([\u4e00-\u9fff])\s+OpenMotion\s*(?:游戏工作流|游戏技能|工作流)/gi, `$1${replacement}`)
            .replace(/OpenMotion\s*(?:游戏工作流|游戏技能|工作流)/gi, replacement)
            .replace(/\bOpenMotion Game (?:Skill|Workflow)\b/gi, replacement)
            .replace(/\bopenmotion-game\b/gi, replacement)
    ))
    .join('');
}

function stripRedundantDeliverableInlineLinks(text: string, deliverables: SuperAgentArtifact[]): string {
  if (!deliverables.length || !text.includes('](')) return text;
  const projectIds = new Set(
    deliverables
      .map(item => item.projectId || (item.id.includes(':') ? item.id.split(':').slice(1).join(':') : ''))
      .filter(Boolean),
  );
  if (!projectIds.size) return text;
  return text.replace(
    /(^|[。！？.!?\n])[ \t]*\[([^\]]+)\]\((\/(?:motion-api|api)\/(?:games|design)\/([^/?#)]+)\/[^)\s]*)\)(?=[ \t]*(?:\n|$))/gm,
    (full, prefix: string, _label: string, _href: string, targetId: string) => {
      try {
        if (projectIds.has(decodeURIComponent(targetId)) || projectIds.has(targetId)) {
          return prefix;
        }
      } catch {
        if (projectIds.has(targetId)) return prefix;
      }
      return full;
    },
  );
}

function formatConsumerChatError(rawError: string, t: Translate): { summary: string; detail?: string } {
  const trimmed = rawError.trim();
  if (/thread\s+[0-9a-f-]+\s+already has an active writer/i.test(trimmed)) {
    return {
      summary: t('The previous step is still wrapping up in the background. Click Continue in a moment to resume.'),
      detail: trimmed,
    };
  }
  if (/ECONNREFUSED|Failed to fetch|NetworkError/i.test(trimmed)) {
    return {
      summary: t('Connection to the local Agent service was interrupted. Check your Agent status and click Continue.'),
      detail: trimmed,
    };
  }
  return { summary: trimmed };
}

const REDUNDANT_MCP_ACTION_SUMMARIES = new Set([
  'inspect',
  'reference',
  'list',
  'models',
  'providers',
  'status',
  'get',
  'describe',
  'quote',
]);

const RAW_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseToolInputArgs(inputPreview?: string): Record<string, unknown> | undefined {
  if (!inputPreview) return undefined;
  try {
    const parsed = JSON.parse(inputPreview);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isInternalArgError(event?: SuperAgentToolEvent): boolean {
  if (!event || event.status !== 'failed') return false;
  const summary = event.summary?.trim() ?? '';
  if (/^INVALID_ARGUMENT\b/i.test(summary)) return true;
  const output = event.outputPreview ?? '';
  return /\bINVALID_ARGUMENT:/i.test(output);
}

function unwrapPosixShellCommand(raw: string): string {
  const trimmed = raw.trim();
  const wrapper = /^(?:\/(?:usr\/)?bin\/)?(?:zsh|bash|sh)\s+-[a-z]*c\s+([\s\S]+)$/.exec(trimmed);
  if (!wrapper) return trimmed;
  let inner = wrapper[1].trim();
  if (inner.length >= 2 && inner.startsWith("'") && inner.endsWith("'")) {
    return inner.slice(1, -1);
  }
  if (inner.length >= 2 && inner.startsWith('"') && inner.endsWith('"')) {
    inner = inner.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
    return inner;
  }
  return inner;
}

function isAgentMemoryShellCommand(event?: SuperAgentToolEvent): boolean {
  if (!event || event.category !== 'command') return false;
  const raw = (event.command || event.summary || '').trim();
  if (!raw) return false;
  const inner = unwrapPosixShellCommand(raw).trim();
  if (!/(?:\.codex[\\/]memories\b|MEMORY\.md\b|\.claude[\\/][^\s'"]*memory)/i.test(inner)) {
    return false;
  }
  // Reject command substitutions outside single-quoted literals (double quotes still expand `...` and $(...)).
  const withoutSingleQuotes = inner.replace(/'[^']*'/g, ' ');
  if (/`|\$\(/.test(withoutSingleQuotes)) return false;

  // Strip both single- and double-quoted literals before checking shell operators and pipes.
  const unquoted = withoutSingleQuotes
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/\s*2>\s*\/dev\/null\b/g, ' ')
    .trim();
  if (/[><]|&&|\|\||;|\b(?:tee|rm|mv|cp|chmod|chown|python\d*|node|perl|ruby)\b|\bsed\s+-i\b/i.test(unquoted)) {
    return false;
  }
  const stages = unquoted.split('|').map(stage => stage.trim()).filter(Boolean);
  if (stages.length === 0) return false;
  if (!/^(?:rg|grep|cat|head|tail|ls|find|test|\[|sed)\b/.test(stages[0])) return false;
  return stages.slice(1).every(stage => /^(?:rg|grep|head|tail|wc|sort|uniq|cut|awk)\b/.test(stage));
}

function workflowGuideDetail(event: SuperAgentToolEvent, t: Translate): string | undefined {
  const tool = (event.tool ?? '').replace(/^mcp_+openmotion_+/, '');
  if (tool !== 'openmotion_read_workflow' || !event.inputPreview || event.status === 'failed') {
    return sanitizeUserHomePath(event.summary);
  }

  const args = parseToolInputArgs(event.inputPreview);
  if (!args) return sanitizeUserHomePath(event.summary);

  const workflow = args.workflow ?? 'production';
  const section = args.section ?? 'start';
  if (typeof workflow !== 'string' || typeof section !== 'string') return sanitizeUserHomePath(event.summary);
  if (workflow === 'game' && Object.hasOwn(gameGuideSections, section)) return t(gameGuideSections[section]);
  if (workflow === 'media') {
    if (Object.hasOwn(mediaGuideSections, section)) return t(mediaGuideSections[section]);
    return `${t('Multimodal media guide')} · ${section}`;
  }
  return `${workflow}/${section}`;
}

function formatToolSummaryDetail(
  event: SuperAgentToolEvent,
  t: Translate,
  options: { isConsumerCreativeTurn?: boolean } = {},
): string | undefined {
  if (isAgentMemoryShellCommand(event)) return undefined;
  const raw = workflowGuideDetail(event, t)?.trim();
  if (!raw) return undefined;
  if (event.category === 'mcp' && REDUNDANT_MCP_ACTION_SUMMARIES.has(raw.toLowerCase())) {
    return undefined;
  }
  if (options.isConsumerCreativeTurn && event.category === 'mcp' && RAW_UUID_RE.test(raw)) {
    return undefined;
  }
  const capabilityMatch = /^(\d+)\s+capability\(s\)$/i.exec(raw);
  if (capabilityMatch) {
    return t('{count} capabilities', { count: Number(capabilityMatch[1]) });
  }
  const resourceMatch = /^(\d+)\s+resource\(s\)$/i.exec(raw);
  if (resourceMatch) {
    return t('{count} resources', { count: Number(resourceMatch[1]) });
  }
  const filesMatch = /^(\d+)\s+files?$/i.exec(raw);
  if (filesMatch) {
    return t('{count} files', { count: Number(filesMatch[1]) });
  }
  return raw;
}

function isReadOnlyPrepTool(
  event?: SuperAgentToolEvent,
  options: { includeFailed?: boolean; includeRunning?: boolean } = {},
): boolean {
  if (!event) return false;
  if (event.artifactId) return false;
  if (!options.includeRunning && event.status === 'running') return false;
  if (!options.includeFailed && (event.status === 'failed' || isFailedGameValidation(event))) return false;
  if (isAgentMemoryShellCommand(event)) return true;

  const tool = (event.tool ?? '').replace(/^mcp_+openmotion_+/, '');
  if (
    tool === 'openmotion_read_workflow'
    || tool === 'openmotion_capability_discover'
    || tool === 'openmotion_asset_models'
    || tool === 'openmotion_game_get'
    || tool === 'openmotion_game_read_file'
    || tool === 'openmotion_design_catalog'
    || tool === 'openmotion_list_skills'
    || tool === 'openmotion_get_skill'
    || tool === 'openmotion_list_templates'
    || tool === 'openmotion_get_template'
    || tool === 'openmotion_get_project'
    || tool === 'openmotion_list_versions'
    || tool === 'openmotion_workspace_resources'
  ) {
    return true;
  }

  const args = parseToolInputArgs(event.inputPreview);
  const action = typeof args?.action === 'string' ? args.action : '';

  if (tool === 'openmotion_media_use') {
    if (action) return action === 'inspect' || action === 'reference' || action === 'models' || action === 'schema';
    return event.label !== 'Generated media' && event.label !== 'Cancelled generation job';
  }
  if (tool === 'openmotion_design_edit') {
    if (action) return action === 'read_file' || action === 'list_files' || action === 'inspect' || action === 'get';
    return event.category === 'file_read';
  }
  if (tool === 'openmotion_asset_manage' || tool === 'openmotion_assets_use' || tool === 'openmotion_assets') {
    // Deliberately exclude "status" because media generation polling waits up to 55s and delivers artifacts.
    return action === 'list' || action === 'get' || action === 'read';
  }
  if (tool === 'openmotion_job_manage') {
    return action === 'list';
  }
  if (tool === 'openmotion_game_wechat') {
    return action === 'status';
  }
  return event.category === 'file_read';
}

function presentProgressiveToolStatus(
  t: Translate,
  toolName: string,
  event?: SuperAgentToolEvent,
): string {
  if (event && isReadOnlyPrepTool(event, { includeRunning: true, includeFailed: true })) {
    return t('Preparing workflow guides & environment…');
  }
  const normalized = toolName.replace(/^mcp_+openmotion_+/, '');
  const args = parseToolInputArgs(event?.inputPreview);
  const action = typeof args?.action === 'string' ? args.action : '';
  if (
    normalized === 'openmotion_read_workflow'
    || normalized === 'openmotion_capability_discover'
    || normalized === 'openmotion_asset_models'
    || normalized === 'openmotion_game_get'
    || normalized === 'openmotion_game_read_file'
    || normalized === 'openmotion_design_catalog'
    || normalized === 'openmotion_list_skills'
    || normalized === 'openmotion_get_skill'
    || normalized === 'openmotion_list_templates'
    || normalized === 'openmotion_get_template'
    || normalized === 'openmotion_get_project'
    || normalized === 'openmotion_list_versions'
    || normalized === 'openmotion_workspace_resources'
  ) {
    return t('Preparing workflow guides & environment…');
  }
  switch (normalized) {
    case 'openmotion_game_create':
      return t('Creating game project…');
    case 'openmotion_game_write_files':
      return t('Writing game source files…');
    case 'openmotion_game_validate':
      return t('Validating game build…');
    case 'openmotion_game_simulate':
      return t('Simulating game logic…');
    case 'openmotion_game_playtest':
      return t('Playtesting game…');
    case 'openmotion_game_capture_cover':
      return t('Capturing game cover…');
    case 'openmotion_game_update_meta':
    case 'openmotion_game_set_status':
      return t('Updating game details…');
    case 'openmotion_game_publish':
      return t('Publishing game…');
    case 'openmotion_capability_run':
      return t('Generating media assets…');
    case 'openmotion_media_use':
      if (action === 'generate') return t('Generating media assets…');
      return t('Preparing workflow guides & environment…');
    case 'openmotion_assets_use':
    case 'openmotion_assets':
      if (action === 'generate') return t('Generating media assets…');
      if (action === 'status') return t('Waiting for media generation…');
      if (action === 'list' || action === 'get' || action === 'read') {
        return t('Preparing workflow guides & environment…');
      }
      return t('Working on your request…');
    case 'openmotion_job_manage':
      if (action === 'status' || action === 'resume') return t('Waiting for media generation…');
      if (action === 'list') return t('Preparing workflow guides & environment…');
      return t('Working on your request…');
    case 'openmotion_design_project':
      if (action === 'create') return t('Creating design project…');
      return t('Working on your request…');
    case 'openmotion_design_edit':
      if (action === 'write') return t('Updating design source…');
      if (action === 'read_file' || action === 'list_files' || action === 'inspect' || action === 'get') {
        return t('Preparing workflow guides & environment…');
      }
      return t('Working on your request…');
    case 'openmotion_create_project':
      return t('Creating Motion project…');
    case 'openmotion_edit_project':
      return t('Updating Motion composition…');
    case 'openmotion_export_request':
      return t('Exporting video…');
    default:
      return t('Working on your request…');
  }
}

function resolveConsumerLiveActivity(
  t: Translate,
  options: { chat: SuperAgentChat; turn: TurnGroup; sending?: boolean; engineLabel?: string },
): { icon: string; spinning: boolean; text: string } {
  const { chat, turn, sending, engineLabel } = options;
  if (sending && chat.state !== 'running' && chat.state !== 'waiting') {
    return { icon: 'loader-4-line', spinning: true, text: t('Starting…') };
  }
  const activity = chat.turnActivity;
  const phase = activity?.phase ?? 'thinking';
  if (phase === 'connecting') {
    return {
      icon: 'loader-4-line',
      spinning: true,
      text: t('Connecting to {agent}…', { agent: activity?.label || engineLabel || 'Super Agent' }),
    };
  }
  if (phase === 'waiting_approval') {
    return { icon: 'loader-4-line', spinning: true, text: t('Waiting for approval…') };
  }
  if (phase === 'streaming') {
    return { icon: 'edit-line', spinning: false, text: t('Writing response…') };
  }
  const runningTools = turn.workItems
    .map(item => (item.role === 'tool' ? item.toolEvent : undefined))
    .filter((ev): ev is SuperAgentToolEvent => Boolean(ev && ev.status === 'running'));
  if (runningTools.length > 0) {
    const runningSubstantive = [...runningTools].reverse().find(
      ev => !isReadOnlyPrepTool(ev, { includeRunning: true, includeFailed: true }),
    );
    const activeEvent = runningSubstantive ?? runningTools[runningTools.length - 1];
    return {
      icon: 'loader-4-line',
      spinning: true,
      text: presentProgressiveToolStatus(t, activeEvent.tool, activeEvent),
    };
  }
  if (phase === 'tool' && activity?.activeToolName) {
    return {
      icon: 'loader-4-line',
      spinning: true,
      text: presentProgressiveToolStatus(t, activity.activeToolName),
    };
  }
  return { icon: 'sparkling-line', spinning: false, text: t('Thinking…') };
}

function ToolStepRow({
  message,
  selfHealed = false,
  suppressArtifactAction = false,
  isConsumerCreativeTurn = false,
  hideSubSecondDuration = false,
  onOpenArtifactId,
}: {
  message: SuperAgentMessage;
  selfHealed?: boolean;
  suppressArtifactAction?: boolean;
  isConsumerCreativeTurn?: boolean;
  hideSubSecondDuration?: boolean;
  onOpenArtifactId: (artifactId: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const ev = message.toolEvent;
  const isRunning = ev?.status === 'running';
  const liveElapsedMs = useLiveElapsedMs(ev?.startedAt, isRunning);
  if (!ev) return null;
  const failedValidation = isFailedGameValidation(ev);
  const rawFailed = failedValidation || ev.status === 'failed';
  const status = rawFailed ? (selfHealed ? 'completed' : 'failed') : (ev.status ?? 'completed');
  const isMemoryProbe = isAgentMemoryShellCommand(ev);
  const fileOp = ev.fileOp ?? ev.files?.[0];
  const diffFiles = (ev.files ?? (fileOp ? [fileOp] : [])).filter(f => f.diffPreview);
  const hasRawPayloads = Boolean((ev.inputPreview && ev.category !== 'command' && diffFiles.length === 0) || ev.outputPreview);
  const hasBody = Boolean(ev.command || diffFiles.length > 0 || hasRawPayloads);
  const isOpen = hasBody && expanded;
  const rawDurationMs = status === 'running'
    ? (liveElapsedMs >= 1000 ? liveElapsedMs : undefined)
    : ev.durationMs;
  const displayDurationMs = hideSubSecondDuration && rawDurationMs !== undefined && rawDurationMs < 1000
    ? undefined
    : rawDurationMs;
  const labelText = failedValidation && !selfHealed
    ? t('Game validation failed')
    : isMemoryProbe
      ? t('Checked workspace memory')
      : t(ev.label || message.text);
  const detail = selfHealed
    ? t('Adjusted parameters and retried automatically')
    : formatToolSummaryDetail(ev, t, { isConsumerCreativeTurn });
  const showExitPill = ev.exitCode !== undefined && !(isMemoryProbe && ev.exitCode === 0);

  const headerContent = (
    <>
      <span
        className="om-sa-tool-status"
        data-status={status}
        data-category={isMemoryProbe ? 'search' : (ev.category || 'tool')}
      >
        <RemixIcon name={selfHealed ? 'refresh-line' : isMemoryProbe ? 'book-open-line' : categoryIcon(ev.category, status)} size={15} />
      </span>
      <span className="om-sa-tool-label">{labelText}</span>
      {detail && detail !== ev.label && detail !== labelText && (
        <span className="om-sa-tool-summary" title={detail}>{detail}</span>
      )}
      <span className="om-sa-step-trail">
        {fileOp && (fileOp.addedLines !== undefined || fileOp.removedLines !== undefined) && (
          <span className="om-sa-diff-badges">
            {fileOp.addedLines !== undefined && fileOp.addedLines > 0 && (
              <span className="om-sa-diff-add">+{fileOp.addedLines}</span>
            )}
            {fileOp.removedLines !== undefined && fileOp.removedLines > 0 && (
              <span className="om-sa-diff-del">-{fileOp.removedLines}</span>
            )}
          </span>
        )}
        {showExitPill && (
          <span className="om-sa-exit-pill" data-ok={ev.exitCode === 0 || undefined}>
            {ev.exitCode === 0 ? 'exit 0' : `exit ${ev.exitCode}`}
          </span>
        )}
        {displayDurationMs !== undefined && (
          <span className="om-sa-step-time">{formatElapsedDuration(displayDurationMs)}</span>
        )}
        {hasBody && (
          <span className="om-sa-step-chevron" aria-hidden="true">
            <RemixIcon name="arrow-down-s-line" size={14} />
          </span>
        )}
      </span>
    </>
  );

  return (
    <div className="om-sa-tool-row" data-open={isOpen || undefined} data-retried={selfHealed || undefined}>
      <div className="om-sa-tool-head">
        {hasBody ? (
          <Button
            variant="plain"
            type="button"
            className="om-sa-tool-trigger"
            aria-expanded={isOpen}
            onClick={() => setExpanded(prev => !prev)}
          >
            {headerContent}
          </Button>
        ) : (
          <div className="om-sa-tool-trigger" data-static="true">
            {headerContent}
          </div>
        )}
        {ev.artifactId && !suppressArtifactAction && (
          <Button
            variant="plain"
            type="button"
            className="om-sa-tool-view-btn"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onOpenArtifactId(ev.artifactId!);
            }}
          >
            <span>{t('View in Viewer')}</span>
            <RemixIcon name="arrow-right-up-line" size={13} />
          </Button>
        )}
      </div>
      {isOpen && (
        <div className="om-sa-tool-body">
          {ev.command && (
            <div className="om-sa-cmd-block">
              <span className="om-sa-cmd-prompt" aria-hidden="true">$</span>
              <code>{sanitizeUserHomePath(ev.command)}</code>
            </div>
          )}
          {diffFiles.map((file, idx) => (
            <div key={`${file.path}-${idx}`} className="om-sa-diff-card">
              <div className="om-sa-diff-head">
                <span className="om-sa-diff-path">{file.path}</span>
                <span className="om-sa-diff-badges">
                  {file.addedLines !== undefined && <span className="om-sa-diff-add">+{file.addedLines}</span>}
                  {file.removedLines !== undefined && <span className="om-sa-diff-del">-{file.removedLines}</span>}
                </span>
              </div>
              {file.diffPreview && <UnifiedDiffView diff={file.diffPreview} />}
            </div>
          ))}
          {hasRawPayloads && (
            <details className="om-sa-tool-raw-details" open={ev.category === 'command'}>
              <summary className="om-sa-tool-raw-summary">
                <span>{t('View technical details')}</span>
                <RemixIcon name="arrow-down-s-line" size={13} />
              </summary>
              {ev.inputPreview && ev.category !== 'command' && diffFiles.length === 0 && (
                <div className="om-sa-tool-section">
                  <span className="om-sa-tool-section-label">{t('Input')}</span>
                  <pre className="om-sa-tool-pre">{ev.inputPreview}</pre>
                </div>
              )}
              {ev.outputPreview && (
                <div className="om-sa-tool-section">
                  <span className="om-sa-tool-section-label">{t('Output')}</span>
                  <pre className="om-sa-tool-pre">{ev.outputPreview}</pre>
                </div>
              )}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressNoteStepRow({
  message,
  onCopyText,
  onOpenWebUrl,
  onOpenFilePath,
}: {
  message: SuperAgentMessage;
  onCopyText?: (text: string) => void;
  onOpenWebUrl?: (url: string) => void;
  onOpenFilePath?: (filePath: string, label?: string) => void;
}) {
  const { t } = useI18n();
  const cleaned = normalizeInternalJargon(message.text.trim(), t);
  if (!cleaned) return null;
  return (
    <div className="om-sa-progress-note-row">
      <span className="om-sa-progress-note-dot" aria-hidden="true">
        <RemixIcon name="chat-1-line" size={13} />
      </span>
      <div className="om-sa-progress-note-body">
        <SimpleMarkdown
          content={cleaned}
          compact
          onCopyCode={onCopyText}
          onOpenWebUrl={onOpenWebUrl}
          onOpenFilePath={onOpenFilePath}
        />
      </div>
    </div>
  );
}

function PrepStepsGroupRow({
  items,
  selfHealedIds,
  isConsumerCreativeTurn = false,
  onOpenArtifactId,
}: {
  items: SuperAgentMessage[];
  selfHealedIds: ReadonlySet<string>;
  isConsumerCreativeTurn?: boolean;
  onOpenArtifactId: (artifactId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const totalMs = items.reduce((sum, item) => sum + (item.toolEvent?.durationMs ?? 0), 0);
  const showGroupDuration = totalMs > 0 && (!isConsumerCreativeTurn || totalMs >= 1000);
  return (
    <div className="om-sa-prep-group" data-open={open || undefined}>
      <Button
        variant="plain"
        type="button"
        className="om-sa-tool-trigger om-sa-prep-group-trigger"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="om-sa-tool-status" data-status="completed" data-category="search">
          <RemixIcon name="book-open-line" size={14} />
        </span>
        <span className="om-sa-tool-label">
          {t('Reviewed workflow guides & project context')}
        </span>
        <span className="om-sa-tool-summary">
          {t('{count} checks', { count: items.length })}
        </span>
        <span className="om-sa-step-trail">
          {showGroupDuration && <span className="om-sa-step-time">{formatElapsedDuration(totalMs)}</span>}
          <span className="om-sa-step-chevron" aria-hidden="true">
            <RemixIcon name="arrow-down-s-line" size={14} />
          </span>
        </span>
      </Button>
      {open && (
        <div className="om-sa-prep-group-items">
          {items.map(item => (
            <ToolStepRow
              key={item.id}
              message={item}
              selfHealed={selfHealedIds.has(item.id)}
              suppressArtifactAction
              isConsumerCreativeTurn={isConsumerCreativeTurn}
              hideSubSecondDuration={isConsumerCreativeTurn}
              onOpenArtifactId={onOpenArtifactId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReasoningStepRow({
  message,
  isStreaming: isStreamingProp,
  onCopyText,
  onOpenWebUrl,
  onOpenFilePath,
}: {
  message: SuperAgentMessage;
  isStreaming?: boolean;
  onCopyText?: (text: string) => void;
  onOpenWebUrl?: (url: string) => void;
  onOpenFilePath?: (filePath: string, label?: string) => void;
}) {
  const { t } = useI18n();
  const isStreaming = isStreamingProp ?? message.status === 'streaming';
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const liveElapsedMs = useLiveElapsedMs(message.createdAt, isStreaming);
  const hasBody = Boolean(message.text?.trim());
  const expanded = hasBody && (userExpanded ?? isStreaming);
  const durationLabel = !isStreaming && message.durationMs !== undefined
    ? t('Thought for {duration}', { duration: formatElapsedDuration(message.durationMs) })
    : isStreaming
      ? (liveElapsedMs >= 1000
          ? `${t('Thinking…')} · ${formatElapsedDuration(liveElapsedMs)}`
          : t('Thinking…'))
      : t('Reasoning');

  const headerContent = (
    <>
      <span className="om-sa-reasoning-icon" data-streaming={isStreaming || undefined}>
        <RemixIcon name={isStreaming ? 'loader-4-line' : 'sparkling-line'} size={14} />
      </span>
      <span className={isStreaming ? 'om-sa-reasoning-label om-sa-shimmer-text' : 'om-sa-reasoning-label'}>
        {durationLabel}
      </span>
      {!isStreaming && message.text && (
        <span className="om-sa-tool-summary">{message.text.slice(0, 120)}</span>
      )}
      {hasBody && (
        <span className="om-sa-step-trail">
          <span className="om-sa-step-chevron" aria-hidden="true">
            <RemixIcon name="arrow-down-s-line" size={14} />
          </span>
        </span>
      )}
    </>
  );

  return (
    <div className="om-sa-reasoning-row" data-open={expanded || undefined}>
      {hasBody ? (
        <Button
          variant="plain"
          type="button"
          className="om-sa-reasoning-trigger"
          aria-expanded={expanded}
          onClick={() => setUserExpanded(prev => !(prev ?? isStreaming))}
        >
          {headerContent}
        </Button>
      ) : (
        <div className="om-sa-reasoning-trigger" data-static="true">
          {headerContent}
        </div>
      )}
      {expanded && message.text && (
        <div className="om-sa-reasoning-body">
          <SimpleMarkdown
            content={message.text.trim()}
            compact
            onCopyCode={onCopyText}
            onOpenWebUrl={onOpenWebUrl}
            onOpenFilePath={onOpenFilePath}
          />
        </div>
      )}
    </div>
  );
}

function WorkLogSection({
  turn,
  chat,
  isActiveTurn,
  isConsumerCreativeTurn = false,
  sending = false,
  hideInlineStatus = false,
  hasPendingApproval = false,
  engineLabel,
  activity,
  onOpenArtifactId,
  onCopyText,
  onOpenWebUrl,
  onOpenFilePath,
}: {
  turn: TurnGroup;
  chat: SuperAgentChat;
  isActiveTurn: boolean;
  isConsumerCreativeTurn?: boolean;
  sending?: boolean;
  hideInlineStatus?: boolean;
  hasPendingApproval?: boolean;
  engineLabel?: string;
  activity?: SuperAgentChat['turnActivity'];
  onOpenArtifactId: (artifactId: string) => void;
  onCopyText?: (text: string) => void;
  onOpenWebUrl?: (url: string) => void;
  onOpenFilePath?: (filePath: string, label?: string) => void;
}) {
  const { t } = useI18n();
  const isTurnFinished = !isActiveTurn && !turn.hasRunning && turn.assistantItems.length > 0;
  const effectiveActivity = activity ?? chat.turnActivity;
  const isRunning = (isActiveTurn && !hasPendingApproval) || turn.hasRunning;
  const shouldAutoExpand = isConsumerCreativeTurn
    ? (!isRunning && !isTurnFinished)
    : !isTurnFinished;
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [mountStartedAt] = useState(() => Date.now());
  const liveStart = effectiveActivity?.startedAt ?? turn.workItems[0]?.createdAt ?? turn.user?.createdAt ?? mountStartedAt;
  const liveRunningMs = useLiveElapsedMs(liveStart, isRunning, 250);
  const activeReasoningId = isActiveTurn && (!effectiveActivity || effectiveActivity.phase === 'thinking')
    ? turn.workItems.at(-1)?.id
    : undefined;

  useEffect(() => {
    if (isTurnFinished) {
      setUserToggled(null);
    }
  }, [isTurnFinished]);

  const expanded = userToggled ?? shouldAutoExpand;
  const showInlineLive = isActiveTurn && !hasPendingApproval && !hideInlineStatus;

  if (!turn.workItems.length && !showInlineLive) return null;

  const toolCount = turn.workItems.filter(m => m.role === 'tool').length;
  const stepCount = turn.workItems.length;
  const plan = isActiveTurn ? (chat.turnActivity?.plan ?? []) : [];
  const planTotal = plan.length;
  const planDone = plan.filter(item => item.status === 'completed').length;
  const durationStr = formatElapsedDuration(turn.durationMs);
  const stepMeta = isRunning
    ? (planTotal > 0 ? t('{done}/{total} tasks', { done: planDone, total: planTotal }) : '')
    : (!isConsumerCreativeTurn && stepCount > 0 && durationStr ? t('{count} steps', { count: stepCount }) : '');

  const summaryTitle = isRunning
    ? t('Working for {time}', { time: formatWorkingDuration(liveRunningMs) })
    : isConsumerCreativeTurn
      ? (durationStr ? t('Worked for {duration}', { duration: durationStr }) : t('Process details'))
      : durationStr
        ? t('Worked for {duration} · {count} steps', { duration: durationStr, count: stepCount })
        : toolCount > 0
          ? t('Execution steps ({count})', { count: stepCount })
          : t('Thought');

  const hasActiveWorkItem = turn.workItems.some(
    item => (item.role === 'tool' && item.toolEvent?.status === 'running')
      || (item.role === 'reasoning' && item.status === 'streaming'),
  );
  const phase = sending && chat.state !== 'running' && chat.state !== 'waiting'
    ? 'connecting'
    : (chat.turnActivity?.phase ?? 'thinking');
  const statusText = resolveLiveTurnStatusText(t, { chat, sending, engineLabel });
  const phaseIcon = phase === 'streaming'
    ? 'edit-line'
    : phase === 'thinking'
      ? 'sparkling-line'
      : 'loader-4-line';
  const spinningIcon = phaseIcon === 'loader-4-line';

  const showConsumerLiveDigest = isConsumerCreativeTurn
    && !expanded
    && isActiveTurn
    && showInlineLive
    && turn.assistantItems.length === 0;

  const consumerDigest = showConsumerLiveDigest ? (() => {
    const progressNotes = turn.timelineEntries.filter(
      entry => entry.role === 'assistant' && Boolean(entry.text.trim()),
    );
    const latestNote = progressNotes[progressNotes.length - 1];
    const lastArtifactEntryById = new Map<string, string>();
    for (const entry of turn.workItems) {
      if (entry.toolEvent?.artifactId) {
        lastArtifactEntryById.set(entry.toolEvent.artifactId, entry.id);
      }
    }

    const milestoneByLabel = new Map<string, { id: string; label: string; artifactId?: string }>();
    let completedPrepCount = 0;
    for (const entry of turn.workItems) {
      if (entry.role !== 'tool' || !entry.toolEvent) continue;
      const ev = entry.toolEvent;
      if (ev.status !== 'completed' || isFailedGameValidation(ev)) continue;
      if (isReadOnlyPrepTool(ev)) {
        completedPrepCount += 1;
        continue;
      }
      const label = t(ev.label || entry.text);
      const artifactId = ev.artifactId && lastArtifactEntryById.get(ev.artifactId) === entry.id
        ? ev.artifactId
        : undefined;
      milestoneByLabel.delete(label);
      milestoneByLabel.set(label, { id: entry.id, label, artifactId });
    }
    const recentMilestones = [...milestoneByLabel.values()].slice(-3);
    const liveActivity = resolveConsumerLiveActivity(t, { chat, turn, sending, engineLabel });
    return {
      latestNote,
      recentMilestones,
      showPrepCompleted: recentMilestones.length === 0 && completedPrepCount >= 2,
      liveActivity,
    };
  })() : null;

  return (
    <div className="om-sa-work-log" data-active={isActiveTurn || undefined}>
      <Button
        variant="plain"
        type="button"
        className="om-sa-work-summary-btn"
        aria-expanded={expanded}
        onClick={() => setUserToggled(prev => !(prev ?? shouldAutoExpand))}
      >
        <span className="om-sa-work-summary-main">
          <span className={isRunning ? 'om-sa-work-summary-label om-sa-work-summary-timer' : 'om-sa-work-summary-label'}>
            {summaryTitle}
          </span>
          <span className="om-sa-work-chevron" data-open={expanded || undefined}>
            <RemixIcon name="arrow-down-s-line" size={14} />
          </span>
        </span>
        <span className="om-sa-work-summary-right">
          {stepMeta && isRunning && (
            <span className="om-sa-work-summary-meta">{stepMeta}</span>
          )}
          {!isRunning && !isTurnFinished && turn.hasFailure && (
            <span className="om-sa-work-pill" data-tone="danger">
              {t('Needs attention')}
            </span>
          )}
        </span>
      </Button>
      {consumerDigest && (
        <div className="om-sa-live-digest">
          {consumerDigest.latestNote && (
            <ProgressNoteStepRow
              message={consumerDigest.latestNote}
              onCopyText={onCopyText}
              onOpenWebUrl={onOpenWebUrl}
              onOpenFilePath={onOpenFilePath}
            />
          )}
          {planTotal > 0 ? (
            <LivePlanCard plan={chat.turnActivity?.plan} />
          ) : (
            <>
              {consumerDigest.recentMilestones.map(milestone => (
                <div key={milestone.id} className="om-sa-live-milestone-row">
                  <span className="om-sa-live-milestone-icon" aria-hidden="true">
                    <RemixIcon name="check-line" size={14} />
                  </span>
                  <span className="om-sa-live-milestone-label">{milestone.label}</span>
                  {milestone.artifactId && (
                    <Button
                      variant="plain"
                      type="button"
                      className="om-sa-tool-view-btn"
                      onClick={() => onOpenArtifactId(milestone.artifactId!)}
                    >
                      <span>{t('View in Viewer')}</span>
                      <RemixIcon name="arrow-right-up-line" size={13} />
                    </Button>
                  )}
                </div>
              ))}
              {consumerDigest.showPrepCompleted && (
                <div className="om-sa-live-milestone-row" data-kind="prep">
                  <span className="om-sa-live-milestone-icon" aria-hidden="true">
                    <RemixIcon name="book-open-line" size={14} />
                  </span>
                  <span className="om-sa-live-milestone-label">
                    {t('Reviewed workflow guides & project context')}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="om-sa-live-reply-phase" role="status" aria-live="polite">
            <span
              className="om-sa-live-reply-icon"
              data-spinning={consumerDigest.liveActivity.spinning || undefined}
              aria-hidden="true"
            >
              <RemixIcon name={consumerDigest.liveActivity.icon} size={14} />
            </span>
            <span className="om-sa-live-status-label om-sa-shimmer-text">
              {consumerDigest.liveActivity.text}
            </span>
          </div>
        </div>
      )}
      {expanded && (
        <div className="om-sa-work-items">
          {(() => {
            const entries = turn.timelineEntries;
            const lastArtifactEntryById = new Map<string, string>();
            const selfHealedIds = new Set<string>();

            for (let i = 0; i < entries.length; i += 1) {
              const cur = entries[i];
              const ev = cur.toolEvent;
              if (ev?.artifactId) {
                lastArtifactEntryById.set(ev.artifactId, cur.id);
              }
              if (ev && ev.status === 'failed' && !isFailedGameValidation(ev)) {
                const curTool = (ev.tool ?? '').replace(/^mcp_+openmotion_+/, '');
                const laterEntries = entries.slice(i + 1);
                const healedSameTool = Boolean(curTool) && laterEntries.some(later => {
                  const lev = later.toolEvent;
                  if (!lev) return false;
                  const lTool = (lev.tool ?? '').replace(/^mcp_+openmotion_+/, '');
                  return lTool === curTool && lev.status === 'completed' && !isFailedGameValidation(lev);
                });
                const hasLaterProgress = laterEntries.some(later =>
                  (later.role === 'tool' && later.toolEvent?.status === 'completed' && !isFailedGameValidation(later.toolEvent))
                  || (later.role === 'assistant' && Boolean(later.text.trim())),
                );
                const prepInternalNoise = isReadOnlyPrepTool(ev, { includeFailed: true })
                  && (isInternalArgError(ev) || hasLaterProgress);
                if (healedSameTool || prepInternalNoise) {
                  selfHealedIds.add(cur.id);
                }
              }
            }

            const isGroupablePrepEntry = (entry: SuperAgentMessage): boolean => {
              if (entry.role !== 'tool' || !entry.toolEvent) return false;
              if (isReadOnlyPrepTool(entry.toolEvent)) return true;
              return selfHealedIds.has(entry.id) && isReadOnlyPrepTool(entry.toolEvent, { includeFailed: true });
            };

            const rendered: ReactNode[] = [];
            let i = 0;
            while (i < entries.length) {
              const item = entries[i];
              if (isGroupablePrepEntry(item)) {
                let j = i + 1;
                while (j < entries.length && isGroupablePrepEntry(entries[j])) {
                  j += 1;
                }
                if (j - i >= 2) {
                  const batch = entries.slice(i, j);
                  rendered.push(
                    <PrepStepsGroupRow
                      key={`prep:${batch[0].id}`}
                      items={batch}
                      selfHealedIds={selfHealedIds}
                      isConsumerCreativeTurn={isConsumerCreativeTurn}
                      onOpenArtifactId={onOpenArtifactId}
                    />,
                  );
                  i = j;
                  continue;
                }
              }

              if (item.role === 'assistant') {
                rendered.push(
                  <ProgressNoteStepRow
                    key={item.id}
                    message={item}
                    onCopyText={onCopyText}
                    onOpenWebUrl={onOpenWebUrl}
                    onOpenFilePath={onOpenFilePath}
                  />,
                );
              } else if (item.role === 'reasoning') {
                rendered.push(
                  <ReasoningStepRow
                    key={item.id}
                    message={item}
                    isStreaming={item.id === activeReasoningId && item.status === 'streaming'}
                    onCopyText={onCopyText}
                    onOpenWebUrl={onOpenWebUrl}
                    onOpenFilePath={onOpenFilePath}
                  />,
                );
              } else {
                const aid = item.toolEvent?.artifactId;
                const suppressArtifactAction = Boolean(aid && lastArtifactEntryById.get(aid) !== item.id);
                rendered.push(
                  <ToolStepRow
                    key={item.id}
                    message={item}
                    selfHealed={selfHealedIds.has(item.id)}
                    suppressArtifactAction={suppressArtifactAction}
                    isConsumerCreativeTurn={isConsumerCreativeTurn}
                    onOpenArtifactId={onOpenArtifactId}
                  />,
                );
              }
              i += 1;
            }
            return rendered;
          })()}
          {showInlineLive && !hasActiveWorkItem && (
            <div className="om-sa-live-reply-phase" role="status" aria-live="polite">
              <span className="om-sa-live-reply-icon" data-spinning={spinningIcon || undefined} aria-hidden="true">
                <RemixIcon name={phaseIcon} size={14} />
              </span>
              <span className="om-sa-live-status-label om-sa-shimmer-text">
                {isConsumerCreativeTurn
                  ? resolveConsumerLiveActivity(t, { chat, turn, sending, engineLabel }).text
                  : statusText}
              </span>
            </div>
          )}
          {showInlineLive && <LivePlanCard plan={chat.turnActivity?.plan} />}
        </div>
      )}
    </div>
  );
}

function LivePlanCard({ plan }: { plan: NonNullable<SuperAgentChat['turnActivity']>['plan'] }) {
  const { t } = useI18n();
  if (!plan || !plan.length) return null;
  return (
    <div className="om-sa-plan-card">
      <div className="om-sa-plan-head">{t('Plan')}</div>
      <ul className="om-sa-plan-list">
        {plan.map((entry, idx) => (
          <li key={idx} className="om-sa-plan-item" data-status={entry.status}>
            <RemixIcon
              name={
                entry.status === 'completed'
                  ? 'checkbox-circle-line'
                  : entry.status === 'in_progress'
                    ? 'loader-4-line'
                    : 'checkbox-blank-line'
              }
              size={14}
            />
            <span>{entry.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveTurnStatusBar({
  chat,
  sending,
  engineLabel,
}: {
  chat: SuperAgentChat;
  sending?: boolean;
  engineLabel?: string;
}) {
  const { t } = useI18n();
  const [mountStartedAt] = useState(() => Date.now());
  const startedAt = chat.turnActivity?.startedAt || chat.updatedAt || mountStartedAt;
  const elapsedMs = useLiveElapsedMs(startedAt, true, 250);
  const statusText = resolveLiveTurnStatusText(t, { chat, sending, engineLabel });
  const phase = sending && chat.state !== 'running' && chat.state !== 'waiting'
    ? 'connecting'
    : (chat.turnActivity?.phase ?? 'thinking');
  const plan = chat.turnActivity?.plan ?? [];
  const planTotal = plan.length;
  const planDone = plan.filter(item => item.status === 'completed').length;
  const stepMeta = planTotal > 0
    ? t('{done}/{total} tasks', { done: planDone, total: planTotal })
    : '';
  const phaseIcon = phase === 'streaming'
    ? 'edit-line'
    : phase === 'thinking'
      ? 'sparkling-line'
      : 'loader-4-line';
  const spinningIcon = phaseIcon === 'loader-4-line';

  return (
    <article
      className="om-sa-message om-sa-live-reply"
      data-role="assistant"
      data-phase={phase}
      role="status"
      aria-live="polite"
    >
      <div className="om-sa-live-reply-head">
        <span className="om-sa-live-reply-elapsed">
          {t('Working for {time}', { time: formatWorkingDuration(elapsedMs) })}
        </span>
        {stepMeta && <span className="om-sa-live-reply-steps">{stepMeta}</span>}
      </div>
      <div className="om-sa-live-reply-phase">
        <span className="om-sa-live-reply-icon" data-spinning={spinningIcon || undefined} aria-hidden="true">
          <RemixIcon name={phaseIcon} size={14} />
        </span>
        <span className="om-sa-live-status-label om-sa-shimmer-text">{statusText}</span>
      </div>
      <LivePlanCard plan={chat.turnActivity?.plan} />
    </article>
  );
}

export function SuperAgentLiveProgressDock({
  chat,
  busy,
  sending,
  engineLabel,
}: {
  chat: SuperAgentChat | null;
  busy: boolean;
  sending: boolean;
  engineLabel?: string;
}) {
  const { t } = useI18n();
  const active = busy || sending;
  const [mountStartedAt] = useState(() => Date.now());
  const startedAt = busy ? (chat?.turnActivity?.startedAt || chat?.updatedAt || mountStartedAt) : mountStartedAt;
  const elapsedMs = useLiveElapsedMs(startedAt, active, 200);

  if (!active || (chat?.approvals.length ?? 0) > 0) return null;

  const plan = chat?.turnActivity?.plan ?? [];
  const planTotal = plan.length;
  const planDone = plan.filter(item => item.status === 'completed').length;
  const determinatePct = planTotal > 0 ? Math.max(8, Math.min(100, Math.round((planDone / planTotal) * 100))) : undefined;
  const statusText = resolveLiveTurnStatusText(t, { chat, sending, engineLabel });
  const stepMeta = planTotal > 0
    ? t('{done}/{total} tasks', { done: planDone, total: planTotal })
    : '';

  return (
    <div className="om-sa-progress-dock" role="status" aria-live="polite">
      <div className="om-sa-progress-track" aria-hidden="true">
        <div
          className="om-sa-progress-bar"
          data-determinate={determinatePct !== undefined || undefined}
          style={determinatePct !== undefined ? { width: `${determinatePct}%` } : undefined}
        />
      </div>
      <div className="om-sa-progress-row">
        <div className="om-sa-progress-main">
          <WorkingIndicator />
          <span className="om-sa-live-status-label">{statusText}</span>
        </div>
        <div className="om-sa-progress-meta">
          {stepMeta && <span className="om-sa-progress-steps">{stepMeta}</span>}
          <span className="om-sa-live-timer">{formatElapsedDuration(elapsedMs)}</span>
        </div>
      </div>
    </div>
  );
}

function isLongUserQuery(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 260) return true;
  return trimmed.split(/\r?\n/).length > 4;
}

function UserMessageBubble({
  text,
  segments,
  attachments,
  onPreviewAttachment,
}: {
  text: string;
  segments?: SuperAgentPromptSegment[];
  attachments?: SuperAgentResourceAttachment[];
  onPreviewAttachment?: (attachment: SuperAgentResourceAttachment) => void;
}) {
  const hasInlineMentions = Boolean(segments?.some(seg => seg.type === 'mention'));
  const game = !hasInlineMentions ? attachments?.find(attachment => attachment.kind === 'game-project') : undefined;
  const brief = game ? readDirectGameBrief(text, game.id) : undefined;

  return brief ? (
    <GameBriefBubble brief={brief} instruction={text} />
  ) : (
    <FullUserMessageBubble
      text={text}
      segments={segments}
      attachments={attachments}
      onPreviewAttachment={onPreviewAttachment}
    />
  );
}

function GameBriefBubble({ brief, instruction }: { brief: string; instruction: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  return (
    <div className="om-sa-user-bubble om-sa-user-bubble-collapsible" data-game-brief>
      <div className="om-sa-user-bubble-text" data-preview={isLongUserQuery(brief) || undefined}>
        {brief}
      </div>
      <Button
        variant="plain"
        type="button"
        className="om-sa-user-bubble-toggle"
        aria-expanded={expanded}
        aria-controls={expanded ? detailsId : undefined}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="om-sa-user-toggle-cta">
          <span>{t('Agent instructions')}</span>
          <span className="om-sa-user-toggle-chevron" data-open={expanded || undefined} aria-hidden="true">
            <RemixIcon name="arrow-down-s-line" size={14} />
          </span>
        </span>
      </Button>
      {expanded && (
        <div id={detailsId} className="om-sa-user-bubble-text" data-details tabIndex={0}>
          {instruction}
        </div>
      )}
    </div>
  );
}

function FullUserMessageBubble({
  text,
  segments,
  attachments,
  onPreviewAttachment,
}: {
  text: string;
  segments?: SuperAgentPromptSegment[];
  attachments?: SuperAgentResourceAttachment[];
  onPreviewAttachment?: (attachment: SuperAgentResourceAttachment) => void;
}) {
  const { t } = useI18n();
  const isLong = useMemo(() => isLongUserQuery(text), [text]);
  const lineCount = useMemo(() => text.trim().split(/\r?\n/).length, [text]);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const suppressHoverRef = useRef(false);

  const hasInlineMentions = Boolean(segments?.some(seg => seg.type === 'mention'));
  const attachmentByKey = useMemo(() => {
    const map = new Map<string, SuperAgentResourceAttachment>();
    for (const att of attachments ?? []) {
      map.set(resourceKey(att), att);
    }
    return map;
  }, [attachments]);

  const renderedContent = useMemo(() => {
    if (!hasInlineMentions || !segments?.length) return text;
    return segments.map((seg, idx) => {
      if (seg.type === 'text') {
        return <span key={`txt:${idx}`}>{seg.text}</span>;
      }
      const resolved = attachmentByKey.get(seg.attachmentKey) ?? {
        id: seg.attachmentKey,
        kind: seg.kind,
        title: seg.label,
      };
      return (
        <InlineMentionChip
          key={`mention:${seg.attachmentKey}:${idx}`}
          attachment={resolved}
          onOpen={onPreviewAttachment}
        />
      );
    });
  }, [hasInlineMentions, segments, text, attachmentByKey, onPreviewAttachment]);

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  if (!isLong) {
    return <div className="om-sa-user-bubble">{renderedContent}</div>;
  }

  const expanded = pinnedOpen || hoverExpanded;

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    if (pinnedOpen || hoverExpanded || suppressHoverRef.current) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHoverExpanded(true);
    }, 240);
  };

  const handleMouseLeave = () => {
    clearHoverTimer();
    suppressHoverRef.current = false;
    if (!pinnedOpen && hoverExpanded) {
      setHoverExpanded(false);
    }
  };

  const handleExpandClick = () => {
    clearHoverTimer();
    suppressHoverRef.current = false;
    setPinnedOpen(true);
    setHoverExpanded(false);
  };

  const handleCollapseClick = () => {
    clearHoverTimer();
    suppressHoverRef.current = true;
    setPinnedOpen(false);
    setHoverExpanded(false);
  };

  const metaHint = lineCount > 4
    ? t('{count} lines', { count: lineCount })
    : `${text.trim().length.toLocaleString()} chars`;

  return (
    <div
      className="om-sa-user-bubble om-sa-user-bubble-collapsible"
      data-expanded={expanded || undefined}
      data-collapsed={!expanded || undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {expanded && (
        <div className="om-sa-user-bubble-bar">
          <span className="om-sa-user-bubble-meta">
            {t('Full prompt')} · {metaHint}
          </span>
          <Button
            variant="plain"
            type="button"
            className="om-sa-user-collapse-pill"
            aria-expanded="true"
            onClick={handleCollapseClick}
          >
            <span>{t('Collapse')}</span>
            <span className="om-sa-user-toggle-chevron" data-open aria-hidden="true">
              <RemixIcon name="arrow-down-s-line" size={14} />
            </span>
          </Button>
        </div>
      )}

      <div
        className="om-sa-user-bubble-text"
        onClick={!expanded ? handleExpandClick : undefined}
      >
        {renderedContent}
      </div>

      <Button
        variant="plain"
        type="button"
        className="om-sa-user-bubble-toggle"
        aria-expanded={expanded}
        onClick={expanded ? handleCollapseClick : handleExpandClick}
      >
        <span className="om-sa-user-toggle-hint">{metaHint}</span>
        <span className="om-sa-user-toggle-cta">
          <span>{expanded ? t('Collapse') : t('Show full prompt')}</span>
          <span className="om-sa-user-toggle-chevron" data-open={expanded || undefined} aria-hidden="true">
            <RemixIcon name="arrow-down-s-line" size={14} />
          </span>
        </span>
      </Button>
    </div>
  );
}

const PROJECT_ARTIFACT_PREFIX: Partial<Record<SuperAgentResourceAttachment['kind'], string>> = {
  'game-project': 'game:',
  'design-project': 'design:',
  'motion-project': 'motion:',
};

function resolveUserMessageAttachments(
  userMsg: SuperAgentMessage,
  chat: Pick<SuperAgentChat, 'artifacts' | 'intent'>,
  isFirstTurn: boolean,
): SuperAgentResourceAttachment[] {
  const normalizedPrompt = userMsg.text.trim();
  const rawAttachments = userMsg.attachments ?? [];
  const inlineKeys = new Set(
    (userMsg.segments ?? [])
      .filter(seg => seg.type === 'mention')
      .map(seg => seg.attachmentKey),
  );
  const visibleAttachments: SuperAgentResourceAttachment[] = [];

  for (const att of rawAttachments) {
    if (inlineKeys.has(resourceKey(att))) continue;
    const cleanTitle = att.title.trim();
    if (/^Make an original game in the spirit of\b/i.test(cleanTitle)) continue;

    const projectPrefix = PROJECT_ARTIFACT_PREFIX[att.kind];
    if (projectPrefix) {
      const matchesChatArtifact = chat.artifacts.some(
        artifact => artifact.kind === att.kind
          && (artifact.projectId === att.id || artifact.id === `${projectPrefix}${att.id}`),
      );
      if (matchesChatArtifact) continue;
    }

    if (att.kind === 'game-project') {
      const matchesPromptTitle = Boolean(normalizedPrompt) && Boolean(cleanTitle) && (
        cleanTitle === normalizedPrompt
        || normalizedPrompt.endsWith(`· ${cleanTitle}`)
        || normalizedPrompt.endsWith(`·${cleanTitle}`)
      );
      if (matchesPromptTitle || (isFirstTurn && chat.intent === 'game')) continue;
    }

    visibleAttachments.push(att);
  }

  return visibleAttachments;
}

export type SuperAgentTurnFeedbackSubmit = {
  turnId: string;
  rating: 'positive' | 'negative' | 'clear';
  reasons?: SuperAgentFeedbackReason[];
  note?: string;
  scene: SuperAgentFeedbackScene;
  artifactKind?: string;
  action: SuperAgentTurnFeedbackAction;
};

type OpenTurnFeedbackState = {
  turnId: string;
  rating: SuperAgentTurnFeedbackRating;
  scene: SuperAgentFeedbackScene;
  artifactKind?: string;
  reasons: SuperAgentFeedbackReason[];
  note: string;
  submitting: boolean;
};

const TURN_FEEDBACK_TAGS: Record<
  SuperAgentFeedbackScene,
  Record<SuperAgentTurnFeedbackRating, ReadonlyArray<{ id: SuperAgentFeedbackReason; label: string }>>
> = {
  game: {
    positive: [
      { id: 'game_fun', label: 'Fun to play' },
      { id: 'game_great_visuals', label: 'Great visuals' },
      { id: 'game_smooth_controls', label: 'Smooth controls' },
      { id: 'game_matches_request', label: 'Nailed my request' },
    ],
    negative: [
      { id: 'game_not_fun', label: "Gameplay isn't fun" },
      { id: 'game_weak_visuals', label: 'Visuals need polish' },
      { id: 'game_clunky_controls', label: 'Controls feel off' },
      { id: 'game_buggy_or_broken', label: 'Broken or buggy' },
      { id: 'game_missed_request', label: 'Missed my request' },
    ],
  },
  general: {
    positive: [
      { id: 'great_result', label: 'Great result' },
      { id: 'matches_request', label: 'Nailed my request' },
      { id: 'fast_delivery', label: 'Fast delivery' },
      { id: 'clear_and_helpful', label: 'Clear and helpful' },
    ],
    negative: [
      { id: 'missed_request', label: 'Missed my request' },
      { id: 'low_quality', label: 'Low output quality' },
      { id: 'broken_or_error', label: 'Broken or errored' },
      { id: 'too_slow_or_off_track', label: 'Too slow or off-track' },
    ],
  },
};

function formatUserMessageTime(createdAt: number, locale: string): { short: string; full: string } | null {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return null;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const sameYear = date.getFullYear() === now.getFullYear();
  try {
    const short = new Intl.DateTimeFormat(
      locale,
      sameDay
        ? { hour: '2-digit', minute: '2-digit', hour12: false }
        : sameYear
          ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
          : { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
    ).format(date);
    const full = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
    return { short, full };
  } catch {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return { short: `${hh}:${mm}`, full: date.toISOString() };
  }
}

export function ExecutionTimeline({
  chat,
  busy,
  sending,
  hideInlineStatus,
  hideApprovals = false,
  continueDisabled,
  engineLabel,
  activeViewerArtifactId = null,
  onOpenArtifactId,
  onOpenChangedFile,
  onPreviewAttachment,
  onOpenFilePath,
  onOpenWebUrl,
  onCopyText,
  onNotify,
  onRateTurn,
  onOpenAccountSettings,
  onTriggerActionCard,
  onResumeAfterAccount,
  onOpenActionCardSettings,
  onOpenInDesignStudio,
  onOpenInMotionStudio,
  onOpenInAssets,
  onOpenInBrandKit,
  onApprove,
  onContinue,
  renderTurnFooter,
}: {
  chat: SuperAgentChat;
  busy: boolean;
  sending: boolean;
  hideInlineStatus?: boolean;
  hideApprovals?: boolean;
  continueDisabled?: boolean;
  engineLabel?: string;
  activeViewerArtifactId?: string | null;
  onOpenArtifactId: (artifactId: string) => void;
  onOpenChangedFile?: (file: SuperAgentFileOperation) => void;
  onPreviewAttachment: (attachment: SuperAgentResourceAttachment) => void;
  onOpenFilePath?: (filePath: string, label?: string) => void;
  onOpenWebUrl?: (url: string) => void;
  onCopyText: (text: string) => void;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
  onRateTurn?: (input: SuperAgentTurnFeedbackSubmit) => Promise<void> | void;
  onOpenAccountSettings?: () => void;
  onTriggerActionCard?: (card: SuperAgentActionCard) => void;
  onResumeAfterAccount?: AccountHandoffResume;
  onOpenActionCardSettings?: (card: SuperAgentActionCard, target: 'account' | 'api_key') => void;
  onOpenInDesignStudio?: (projectId: string) => void;
  onOpenInMotionStudio?: (projectId: string) => void;
  onOpenInAssets?: (assetId: string, versionId?: string) => void;
  onOpenInBrandKit?: (kitId?: string) => void;
  onApprove: (approvalId: string, accepted: boolean, alwaysAllow?: boolean) => void;
  onContinue?: () => void;
  renderTurnFooter?: (turnIndex: number, isLastTurn: boolean) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const [localTurnFeedback, setLocalTurnFeedback] = useState<Record<string, SuperAgentTurnFeedback | null>>({});
  const [openFeedback, setOpenFeedback] = useState<OpenTurnFeedbackState | null>(null);
  const feedbackSeqRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setLocalTurnFeedback({});
    setOpenFeedback(null);
    feedbackSeqRef.current = {};
  }, [chat.id]);

  const getTurnFeedback = (turnId: string): SuperAgentTurnFeedback | null =>
    Object.hasOwn(localTurnFeedback, turnId)
      ? localTurnFeedback[turnId]
      : (chat.turnFeedback?.[turnId] ?? null);

  const handleThumbClick = (
    turnId: string,
    targetRating: SuperAgentTurnFeedbackRating,
    scene: SuperAgentFeedbackScene,
    artifactKind?: string,
  ) => {
    const prevEntry = getTurnFeedback(turnId);
    const seq = (feedbackSeqRef.current[turnId] ?? 0) + 1;
    feedbackSeqRef.current[turnId] = seq;

    if (prevEntry?.rating === targetRating) {
      setLocalTurnFeedback(prev => ({ ...prev, [turnId]: null }));
      setOpenFeedback(prev => (prev?.turnId === turnId ? null : prev));
      void Promise.resolve(onRateTurn?.({
        turnId,
        rating: 'clear',
        scene,
        artifactKind,
        action: 'clear',
      })).catch(() => {
        if (feedbackSeqRef.current[turnId] === seq) {
          setLocalTurnFeedback(prev => ({ ...prev, [turnId]: prevEntry }));
        }
      });
      return;
    }

    const nextEntry: SuperAgentTurnFeedback = {
      rating: targetRating,
      scene,
      updatedAt: Date.now(),
    };
    setLocalTurnFeedback(prev => ({ ...prev, [turnId]: nextEntry }));
    setOpenFeedback({
      turnId,
      rating: targetRating,
      scene,
      artifactKind,
      reasons: [],
      note: '',
      submitting: false,
    });
    void Promise.resolve(onRateTurn?.({
      turnId,
      rating: targetRating,
      scene,
      artifactKind,
      action: 'rate',
    })).catch(() => {
      if (feedbackSeqRef.current[turnId] === seq) {
        setLocalTurnFeedback(prev => ({ ...prev, [turnId]: prevEntry }));
        setOpenFeedback(prev => (prev?.turnId === turnId ? null : prev));
      }
    });
  };

  const handleToggleFeedbackReason = (reasonId: SuperAgentFeedbackReason) => {
    setOpenFeedback(prev => {
      if (!prev) return prev;
      const exists = prev.reasons.includes(reasonId);
      return {
        ...prev,
        reasons: exists ? prev.reasons.filter(item => item !== reasonId) : [...prev.reasons, reasonId],
      };
    });
  };

  const handleSubmitTurnFeedbackReason = async () => {
    if (!openFeedback || openFeedback.submitting) return;
    const trimmedNote = openFeedback.note.trim();
    if (openFeedback.reasons.length === 0 && !trimmedNote) return;

    const draft = openFeedback;
    const prevEntry = getTurnFeedback(draft.turnId);
    const seq = (feedbackSeqRef.current[draft.turnId] ?? 0) + 1;
    feedbackSeqRef.current[draft.turnId] = seq;

    const nextEntry: SuperAgentTurnFeedback = {
      rating: draft.rating,
      ...(draft.reasons.length ? { reasons: draft.reasons } : {}),
      ...(trimmedNote ? { note: trimmedNote } : {}),
      scene: draft.scene,
      updatedAt: Date.now(),
    };
    setOpenFeedback(prev => (prev && prev.turnId === draft.turnId ? { ...prev, submitting: true } : prev));
    setLocalTurnFeedback(prev => ({ ...prev, [draft.turnId]: nextEntry }));
    try {
      await onRateTurn?.({
        turnId: draft.turnId,
        rating: draft.rating,
        reasons: draft.reasons,
        note: trimmedNote,
        scene: draft.scene,
        artifactKind: draft.artifactKind,
        action: 'update_reason',
      });
      if (feedbackSeqRef.current[draft.turnId] === seq) {
        setOpenFeedback(prev => (prev?.turnId === draft.turnId ? null : prev));
        onNotify?.(t('Thanks for your feedback'), 'info');
      }
    } catch {
      if (feedbackSeqRef.current[draft.turnId] === seq) {
        setLocalTurnFeedback(prev => ({ ...prev, [draft.turnId]: prevEntry }));
        setOpenFeedback(prev => (prev && prev.turnId === draft.turnId ? { ...prev, submitting: false } : prev));
      }
    }
  };
  const turns = useMemo(() => groupMessagesIntoTurns(chat), [chat]);
  const lastTurn = turns[turns.length - 1];
  const showInterruptedCard = !busy && !sending && !chat.error && (
    chat.state === 'cancelled'
    || (chat.state === 'idle' && Boolean(lastTurn) && lastTurn.workItems.length > 0 && lastTurn.assistantItems.length === 0 && lastTurn.artifacts.length === 0)
  );
  const interruptedMeta = [
    lastTurn?.workItems.length ? t('{count} steps', { count: lastTurn.workItems.length }) : '',
    lastTurn?.durationMs !== undefined
      ? formatElapsedDuration(lastTurn.durationMs)
      : chat.lastTurnDurationMs !== undefined
        ? formatElapsedDuration(chat.lastTurnDurationMs)
        : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="om-sa-message-list">
      {turns.map((turn, idx) => {
        const isLastTurn = idx === turns.length - 1;
        const isActiveTurn = (busy || sending) && isLastTurn;
        const combinedAssistantText = turn.assistantItems.map(m => m.text).filter(Boolean).join('\n\n');

        return (
          <div key={turn.id} className="om-sa-turn" data-active={isActiveTurn || undefined}>
            {turn.user && (() => {
              const visibleAttachments = resolveUserMessageAttachments(turn.user, chat, idx === 0);
              const sentTime = formatUserMessageTime(turn.user.createdAt, locale);
              return (
                <article className="om-sa-message" data-role="user">
                  <div className="om-sa-message-body">
                    {visibleAttachments.length > 0 && (
                      <div className="om-sa-msg-attachments">
                        {visibleAttachments.map(att => {
                          const isBrowserAnnotation = att.kind === 'browser-annotation';
                          const chipTitle = isBrowserAnnotation
                            ? (att.annotation?.comment || att.title)
                            : att.title;
                          const tooltipLabel = isBrowserAnnotation
                            ? [
                                att.annotation?.element?.componentName,
                                att.annotation?.element?.selector,
                                att.annotation?.pageUrl || att.subtitle,
                              ].filter(Boolean).join(' · ')
                            : '';
                          const chip = (
                            <Button
                              key={resourceKey(att)}
                              variant="plain"
                              type="button"
                              className="om-sa-attachment-chip"
                              data-kind={isBrowserAnnotation ? 'browser-annotation' : undefined}
                              onClick={() => onPreviewAttachment(att)}
                            >
                              <ResourceThumbImage
                                className="om-sa-attachment-thumb"
                                src={isBrowserAnnotation ? resourceImagePreviewUrl(att) : null}
                                fallback={<RemixIcon name={resourceIcon(att)} size={13} />}
                              />
                              <span>{chipTitle}</span>
                            </Button>
                          );
                          return isBrowserAnnotation && tooltipLabel ? (
                            <Tooltip key={resourceKey(att)} label={tooltipLabel}>{chip}</Tooltip>
                          ) : chip;
                        })}
                      </div>
                    )}
                    <UserMessageBubble
                      text={turn.user.text}
                      segments={turn.user.segments}
                      attachments={turn.user.attachments}
                      onPreviewAttachment={onPreviewAttachment}
                    />
                    {sentTime && (
                      <time
                        className="om-sa-user-time"
                        dateTime={new Date(turn.user.createdAt).toISOString()}
                        title={sentTime.full}
                      >
                        {sentTime.short}
                      </time>
                    )}
                  </div>
                </article>
              );
            })()}

            <WorkLogSection
              turn={turn}
              chat={chat}
              isActiveTurn={isActiveTurn}
              isConsumerCreativeTurn={Boolean(chat.intent && chat.intent !== 'coding')}
              sending={sending}
              hideInlineStatus={hideInlineStatus}
              hasPendingApproval={chat.approvals.length > 0}
              engineLabel={engineLabel}
              activity={isActiveTurn ? chat.turnActivity : undefined}
              onOpenArtifactId={onOpenArtifactId}
              onCopyText={onCopyText}
              onOpenWebUrl={onOpenWebUrl}
              onOpenFilePath={onOpenFilePath}
            />

            {(() => {
              const deliverableArtifacts = !isActiveTurn
                ? turn.artifacts.filter(artifact => artifact.kind !== 'workspace-file')
                : [];
              const isConsumerCreativeTurn = Boolean(chat.intent && chat.intent !== 'coding');
              const primaryKinds = new Set<SuperAgentArtifact['kind']>([
                'game-project',
                'design-project',
                'motion-project',
                'motion-export',
              ]);
              const supportingKinds = new Set<SuperAgentArtifact['kind']>([
                'asset-image',
                'asset-audio',
                'asset-video',
              ]);
              const primaryArtifacts = deliverableArtifacts.filter(artifact => primaryKinds.has(artifact.kind));
              const hasPrimaryProject = primaryArtifacts.length > 0;
              const heroDeliverables = hasPrimaryProject
                ? [
                    ...primaryArtifacts,
                    ...deliverableArtifacts.filter(
                      artifact => !primaryKinds.has(artifact.kind) && !supportingKinds.has(artifact.kind),
                    ),
                  ]
                : deliverableArtifacts;
              const supportingAssets = hasPrimaryProject
                ? deliverableArtifacts.filter(artifact => supportingKinds.has(artifact.kind))
                : [];
              const useHeroSingleLayout =
                heroDeliverables.length === 1
                && (
                  hasPrimaryProject
                  || heroDeliverables[0].kind === 'asset-image'
                  || heroDeliverables[0].kind === 'asset-video'
                );

              const filesChangedSection = !isActiveTurn && turn.changedFiles.length > 0 ? (
                <FilesChangedCard
                  files={turn.changedFiles}
                  projectDir={chat.projectDir}
                  defaultExpanded={!isConsumerCreativeTurn}
                  subtle={isConsumerCreativeTurn}
                  onCopyText={onCopyText}
                  onOpenFile={onOpenChangedFile}
                />
              ) : null;

              const deliverablesSection = deliverableArtifacts.length > 0 ? (
                <div
                  className="om-sa-deliverables-group"
                  data-layout={useHeroSingleLayout ? 'hero' : undefined}
                >
                  {heroDeliverables.length > 0 && (
                    <div
                      className="om-sa-deliverables"
                      data-count={heroDeliverables.length === 1 ? 'single' : 'multi'}
                      data-layout={useHeroSingleLayout ? 'hero' : undefined}
                    >
                      {heroDeliverables.map(artifact => (
                        <ArtifactDeliverableCard
                          key={artifact.id}
                          artifact={artifact}
                          chatId={chat.id}
                          layout={useHeroSingleLayout ? 'hero' : 'default'}
                          isActiveInViewer={Boolean(activeViewerArtifactId && activeViewerArtifactId === artifact.id)}
                          onOpenArtifactId={onOpenArtifactId}
                          onCopyText={onCopyText}
                          onNotify={onNotify}
                          onOpenAccountSettings={onOpenAccountSettings}
                          onOpenInDesignStudio={onOpenInDesignStudio}
                          onOpenInMotionStudio={onOpenInMotionStudio}
                          onOpenInAssets={onOpenInAssets}
                          onOpenInBrandKit={onOpenInBrandKit}
                        />
                      ))}
                    </div>
                  )}

                  {supportingAssets.length > 0 && (
                    <div className="om-sa-supporting-assets" role="region" aria-label={t('Supporting assets ({count})', { count: supportingAssets.length })}>
                      <div className="om-sa-supporting-head">
                        <span>{t('Supporting assets ({count})', { count: supportingAssets.length })}</span>
                      </div>
                      <div className="om-sa-supporting-list">
                        {supportingAssets.map(asset => (
                          <SupportingAssetRow
                            key={asset.id}
                            artifact={asset}
                            onOpenArtifactId={onOpenArtifactId}
                            onNotify={onNotify}
                            onOpenInAssets={onOpenInAssets}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null;

              return (
                <>
                  {turn.assistantItems.map(msg => {
                    const cleanedContent = deliverableArtifacts.length > 0
                      ? normalizeInternalJargon(stripRedundantDeliverableInlineLinks(msg.text, deliverableArtifacts), t)
                      : normalizeInternalJargon(msg.text, t);
                    return (
                      <article key={msg.id} className="om-sa-message" data-role="assistant">
                        <div className="om-sa-message-body">
                          <div className="om-sa-assistant-content">
                            <SimpleMarkdown
                              content={cleanedContent}
                              onCopyCode={onCopyText}
                              onOpenWebUrl={onOpenWebUrl}
                              onOpenFilePath={onOpenFilePath}
                            />
                          </div>
                        </div>
                      </article>
                    );
                  })}

                  {isLastTurn && turn.actionCards.length > 0 && (!isActiveTurn || turn.assistantItems.length > 0) && (
                    <div className="om-sa-action-cards">
                      {turn.actionCards.map(card => (
                        <TurnActionCard
                          key={card.id}
                          card={card}
                          handoffKey={`${chat.id}:${turn.id}:${card.id}`}
                          onTrigger={onTriggerActionCard}
                          onResume={onResumeAfterAccount}
                          onOpenSettings={onOpenActionCardSettings}
                        />
                      ))}
                    </div>
                  )}

                  {isConsumerCreativeTurn ? (
                    <>
                      {deliverablesSection}
                      {filesChangedSection}
                    </>
                  ) : (
                    <>
                      {filesChangedSection}
                      {deliverablesSection}
                    </>
                  )}

                  {!isActiveTurn && turn.assistantItems.length > 0 && (() => {
                    const tokenDetail = isLastTurn && chat.lastTurnUsage?.totalTokens
                      ? `${chat.lastTurnUsage.totalTokens.toLocaleString()} ${t('tokens')}`
                      : '';
                    const showInlineTokens = Boolean(tokenDetail && (!chat.intent || chat.intent === 'coding'));
                    const currentFeedback = getTurnFeedback(turn.id);
                    const activeRating = currentFeedback?.rating ?? null;
                    const feedbackScene: SuperAgentFeedbackScene =
                      chat.intent === 'game'
                      || turn.artifacts.some(artifact => artifact.kind === 'game-project')
                      || chat.artifacts.some(artifact => artifact.kind === 'game-project')
                        ? 'game'
                        : 'general';
                    const primaryArtifactKind = deliverableArtifacts[0]?.kind ?? turn.artifacts[0]?.kind;
                    const isTrayOpen = openFeedback?.turnId === turn.id;
                    const trayTags = isTrayOpen ? TURN_FEEDBACK_TAGS[openFeedback.scene][openFeedback.rating] : [];
                    const canSubmitReason = Boolean(
                      isTrayOpen && !openFeedback.submitting && (openFeedback.reasons.length > 0 || openFeedback.note.trim().length > 0),
                    );
                    return (
                      <>
                        <div className="om-sa-turn-footer">
                          <span
                            className="om-sa-turn-meta"
                            title={!showInlineTokens && tokenDetail ? tokenDetail : undefined}
                          >
                            {[
                              engineLabel || chat.engine,
                              !isConsumerCreativeTurn && turn.workItems.length > 0 ? t('{count} steps', { count: turn.workItems.length }) : '',
                              turn.durationMs !== undefined ? formatElapsedDuration(turn.durationMs) : '',
                              showInlineTokens ? tokenDetail : '',
                            ].filter(Boolean).join(' · ')}
                          </span>
                          <div className="om-sa-turn-actions" role="group" aria-label={t('Response actions')}>
                            {combinedAssistantText && (
                              <IconButton
                                variant="plain"
                                className="om-sa-turn-action-btn"
                                aria-label={t('Copy response')}
                                title={t('Copy response')}
                                onClick={() => onCopyText(combinedAssistantText)}
                                icon={<RemixIcon name="file-copy-line" size={13} />}
                              />
                            )}
                            <IconButton
                              variant="plain"
                              className="om-sa-turn-action-btn om-sa-turn-rate-btn"
                              data-rating="positive"
                              data-active={activeRating === 'positive' ? 'positive' : undefined}
                              aria-label={t(activeRating === 'positive' ? 'Remove like' : 'Helpful')}
                              title={t(activeRating === 'positive' ? 'Remove like' : 'Helpful')}
                              aria-pressed={activeRating === 'positive'}
                              onClick={() => handleThumbClick(turn.id, 'positive', feedbackScene, primaryArtifactKind)}
                              icon={<RemixIcon name={activeRating === 'positive' ? 'thumb-up-fill' : 'thumb-up-line'} size={13} />}
                            />
                            <IconButton
                              variant="plain"
                              className="om-sa-turn-action-btn om-sa-turn-rate-btn"
                              data-rating="negative"
                              data-active={activeRating === 'negative' ? 'negative' : undefined}
                              aria-label={t(activeRating === 'negative' ? 'Remove dislike' : 'Not helpful')}
                              title={t(activeRating === 'negative' ? 'Remove dislike' : 'Not helpful')}
                              aria-pressed={activeRating === 'negative'}
                              onClick={() => handleThumbClick(turn.id, 'negative', feedbackScene, primaryArtifactKind)}
                              icon={<RemixIcon name={activeRating === 'negative' ? 'thumb-down-fill' : 'thumb-down-line'} size={13} />}
                            />
                          </div>
                        </div>

                        {isTrayOpen && openFeedback && (
                          <div
                            className="om-sa-turn-feedback-card"
                            data-rating={openFeedback.rating}
                            role="region"
                            aria-label={t(openFeedback.rating === 'positive' ? 'What worked well?' : 'What could be better?')}
                            onKeyDown={event => {
                              if (event.key === 'Escape') {
                                event.stopPropagation();
                                setOpenFeedback(null);
                              }
                            }}
                          >
                            <div className="om-sa-turn-feedback-head">
                              <span className="om-sa-turn-feedback-title">
                                {t(openFeedback.rating === 'positive' ? 'What worked well?' : 'What could be better?')}
                              </span>
                              <IconButton
                                variant="plain"
                                className="om-sa-turn-feedback-close"
                                aria-label={t('Close')}
                                title={t('Close')}
                                onClick={() => setOpenFeedback(null)}
                                icon={<RemixIcon name="close-line" size={14} />}
                              />
                            </div>
                            <div className="om-sa-feedback-tags" role="group" aria-label={t('Quick feedback tags')}>
                              {trayTags.map(tag => {
                                const selected = openFeedback.reasons.includes(tag.id);
                                return (
                                  <Button
                                    key={tag.id}
                                    variant="plain"
                                    type="button"
                                    className="om-sa-feedback-tag"
                                    data-tone={openFeedback.rating}
                                    data-selected={selected || undefined}
                                    aria-pressed={selected}
                                    onClick={() => handleToggleFeedbackReason(tag.id)}
                                  >
                                    {t(tag.label)}
                                  </Button>
                                );
                              })}
                            </div>
                            <div className="om-sa-feedback-input-row">
                              <input
                                type="text"
                                className="om-sa-feedback-note-input"
                                value={openFeedback.note}
                                maxLength={500}
                                aria-label={t('Add a reason (optional)…')}
                                placeholder={t('Add a reason (optional)…')}
                                onChange={event => {
                                  const nextVal = event.target.value;
                                  setOpenFeedback(prev => (prev && prev.turnId === turn.id ? { ...prev, note: nextVal } : prev));
                                }}
                                onKeyDown={event => {
                                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && canSubmitReason) {
                                    event.preventDefault();
                                    void handleSubmitTurnFeedbackReason();
                                  }
                                }}
                              />
                              <Button
                                variant="plain"
                                type="button"
                                className="om-sa-feedback-submit-btn"
                                disabled={!canSubmitReason}
                                onClick={() => void handleSubmitTurnFeedbackReason()}
                              >
                                {openFeedback.submitting ? t('Saving…') : t('Submit')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
              );
            })()}
            {renderTurnFooter?.(idx, isLastTurn)}
          </div>
        );
      })}

      {(busy || sending) && !chat.approvals.length && (
        hideInlineStatus
          ? <LivePlanCard plan={chat.turnActivity?.plan} />
          : turns.length === 0
            ? (
              <LiveTurnStatusBar
                chat={chat}
                sending={sending}
                engineLabel={engineLabel}
              />
            )
            : null
      )}

      {chat.error && (() => {
        const formattedErr = formatConsumerChatError(chat.error, t);
        return (
          <div className="om-sa-error-card" role="alert">
            <span className="om-sa-error-icon" aria-hidden="true">
              <RemixIcon name="error-warning-line" size={18} />
            </span>
            <div className="om-sa-error-copy">
              <strong>{t('Conversation paused')}</strong>
              <p className="om-muted" title={formattedErr.detail}>{formattedErr.summary}</p>
            </div>
            {onContinue && (
              <Button
                variant="plain"
                className="om-sa-continue-btn"
                disabled={continueDisabled || busy || sending}
                onClick={onContinue}
              >
                <RemixIcon name="play-fill" size={14} />
                <span>{t('Continue')}</span>
              </Button>
            )}
          </div>
        );
      })()}

      {showInterruptedCard && (
        <div className="om-sa-interrupted-card" role="status">
          <span className="om-sa-interrupted-icon" aria-hidden="true">
            <RemixIcon name="pause-line" size={18} />
          </span>
          <div className="om-sa-interrupted-copy">
            <strong>{t(chat.state === 'cancelled' ? 'Stopped before finishing' : 'No final response yet')}</strong>
            <p className="om-muted">
              {interruptedMeta ? `${interruptedMeta} · ` : ''}
              {t('Resume from where it stopped, or send a new instruction below.')}
            </p>
          </div>
          {onContinue && (
            <Button
              variant="plain"
              className="om-sa-continue-btn"
              data-primary
              disabled={continueDisabled}
              onClick={onContinue}
            >
              <RemixIcon name="play-fill" size={14} />
              <span>{t('Continue')}</span>
            </Button>
          )}
        </div>
      )}

      {!hideApprovals && chat.approvals.map(approval => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          sending={sending}
          onApprove={onApprove}
        />
      ))}
    </div>
  );
}

function actionCardMeta(kind: SuperAgentActionCard['kind']): {
  icon: string;
  title: string;
  description: string;
  cta: string;
} {
  switch (kind) {
    case 'top_up':
      return {
        icon: 'error-warning-line',
        title: 'Top up OpenDesign balance',
        description: "Your OpenDesign balance is too low to generate media. Top up your credits and I'll continue automatically.",
        cta: 'Top up credits',
      };
    case 'configure_key':
    default:
      return {
        icon: 'settings-3-line',
        title: 'Configure media provider',
        description: 'Open Model providers to sign in or update your API key, then reply here to continue.',
        cta: 'Open settings',
      };
  }
}

function actionCardHookId(kind: SuperAgentActionCard['kind']) {
  switch (kind) {
    case 'sign_in': return 'studio_generate' as const;
    case 'upgrade_free':
    case 'upgrade_go': return 'studio_free_gate' as const;
    case 'top_up': return 'failure_card_topup' as const;
    case 'web_publish_sign_in': return 'game_publish_signin' as const;
    default: return null;
  }
}

function TurnActionCard({
  card,
  handoffKey,
  onTrigger,
  onResume,
  onOpenSettings,
}: {
  card: SuperAgentActionCard;
  handoffKey?: string;
  onTrigger?: (card: SuperAgentActionCard) => void;
  onResume?: AccountHandoffResume;
  onOpenSettings?: (card: SuperAgentActionCard, target: 'account' | 'api_key') => void;
}) {
  if (card.kind === 'sign_in' || card.kind === 'upgrade_free' || card.kind === 'upgrade_go' || card.kind === 'web_publish_sign_in') {
    return <AccountHandoffCard card={card} handoffKey={handoffKey} onResume={onResume} onOpenSettings={onOpenSettings} />;
  }
  return <GateActionCard card={card} handoffKey={handoffKey} onTrigger={onTrigger} onResume={onResume} />;
}

function GateActionCard({
  card,
  handoffKey,
  onTrigger,
  onResume,
}: {
  card: SuperAgentActionCard;
  handoffKey?: string;
  onTrigger?: (card: SuperAgentActionCard) => void;
  onResume?: AccountHandoffResume;
}) {
  const { locale, t } = useI18n();
  const descriptionId = useId();
  const meta = actionCardMeta(card.kind);
  const hookId = actionCardHookId(card.kind);
  const campaign = useBlackFridayActive();
  const [entryId, setEntryId] = useState(newCampaignEntryId);
  const markCheckoutReturn = useCheckoutReturnRefresh('creative_studio', hookId ?? 'studio_free_gate');
  const reportedRef = useRef(false);

  useEffect(() => {
    if (!hookId || reportedRef.current) return;
    reportedRef.current = true;
    reportEntitlementGateView('creative_studio', hookId, {
      studio_id: 'game',
      entry_id: entryId,
      ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}),
    });
  }, [hookId, entryId, campaign]);

  const isDirectUpgrade = card.kind === 'upgrade_free' || card.kind === 'upgrade_go';
  const isTopUp = card.kind === 'top_up';

  function handleTrigger() {
    if (hookId) {
      reportEntitlementGateClick(
        'creative_studio',
        card.kind === 'sign_in' || card.kind === 'web_publish_sign_in' ? 'start_sign_in' : 'open_pricing',
        hookId,
        { studio_id: 'game', entry_id: entryId, ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}) },
      );
    }
    if (isTopUp) {
      const clickedId = entryId;
      openBalanceGate({
        reason: 'insufficient_balance',
        pageName: 'creative_studio',
        studioId: 'game',
        entryId: clickedId,
        hookId: hookId ?? 'failure_card_topup',
        ...(onResume ? { onRecovered: () => onResume(card, { key: handoffKey ?? card.id }) } : {}),
      });
      setEntryId(newCampaignEntryId());
      return;
    }
    onTrigger?.(card);
  }

  return (
    <div className="om-sa-action-card" data-kind={card.kind} role="group" aria-label={t(meta.title)}>
      <span className="om-sa-action-card-icon" aria-hidden="true">
        <RemixIcon name={meta.icon} size={18} />
      </span>
      <div className="om-sa-action-card-copy">
        <strong>{t(meta.title)}</strong>
        <p id={descriptionId}>{t(meta.description)}</p>
      </div>
      {isDirectUpgrade ? (
        <a
          className="om-sa-deliverable-btn om-sa-action-card-btn"
          data-primary
          href={campaignPricingUrl(locale, 'opengame_agent_upgrade', entryId, { studioId: 'game', modality: 'all' })}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={descriptionId}
          onClick={() => {
            const clickedId = entryId;
            markCheckoutReturn(clickedId);
            if (hookId) {
              reportEntitlementGateClick('creative_studio', 'open_pricing', hookId, {
                studio_id: 'game',
                entry_id: clickedId,
                ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}),
              });
            }
            window.setTimeout(() => setEntryId(newCampaignEntryId()), 0);
          }}
        >
          <span>{campaign ? t('Upgrade · 50% OFF') : t(meta.cta)}</span>
          <RemixIcon name="external-link-line" size={14} />
        </a>
      ) : (isTopUp || onTrigger) && (
        <Button
          variant="plain"
          type="button"
          className="om-sa-deliverable-btn om-sa-action-card-btn"
          data-primary
          aria-describedby={descriptionId}
          onClick={handleTrigger}
        >
          <span>{t(meta.cta)}</span>
          <RemixIcon name="arrow-right-line" size={14} />
        </Button>
      )}
    </div>
  );
}

function approvalKindIcon(kind: SuperAgentApproval['kind']): string {
  switch (kind) {
    case 'command':
      return 'terminal-box-fill';
    case 'file':
      return 'file-code-line';
    case 'generation':
      return 'sparkling-line';
    default:
      return 'shield-check-line';
  }
}

export function ApprovalCard({
  approval,
  sending,
  onApprove,
}: {
  approval: SuperAgentApproval;
  sending: boolean;
  onApprove: (approvalId: string, accepted: boolean, alwaysAllow?: boolean) => void;
}) {
  const { t } = useI18n();
  const display = useMemo(() => describeSuperAgentApproval(approval), [approval]);
  const heading = display.headingFallback ? t(display.headingFallback) : t(display.headingKey);
  const summaryText = display.summaryText ?? t(display.summaryKey, display.summaryVars);

  return (
    <section className="om-sa-approval" aria-label={heading}>
      <div className="om-sa-approval-head">
        <span className="om-sa-approval-icon" data-kind={approval.kind}>
          <RemixIcon name={approvalKindIcon(approval.kind)} size={17} />
        </span>
        <div className="om-sa-approval-copy">
          <div className="om-sa-approval-title-row">
            <h3 className="om-sa-approval-title">{heading}</h3>
            {display.target && (
              <span className="om-sa-approval-target" title={display.target}>
                {display.target}
              </span>
            )}
          </div>
          <p className="om-sa-approval-summary">{summaryText}</p>
        </div>
      </div>

      {display.technicalDetail && (
        <details className="om-sa-approval-details">
          <summary className="om-sa-approval-details-toggle">
            <span>{t('View details')}</span>
            <RemixIcon name="arrow-down-s-line" size={14} />
          </summary>
          <pre className="om-sa-approval-pre">{display.technicalDetail}</pre>
        </details>
      )}

      <div className="om-sa-approval-actions">
        <Button
          variant="plain"
          className="om-sa-approval-btn"
          data-primary
          disabled={sending}
          onClick={() => onApprove(approval.id, true)}
        >
          <RemixIcon name="check-line" size={15} />
          <span>{t('Approve')}</span>
        </Button>
        <Button
          variant="plain"
          className="om-sa-approval-btn"
          disabled={sending}
          onClick={() => onApprove(approval.id, true, true)}
        >
          <span>{t('Always allow')}</span>
        </Button>
        <Button
          variant="plain"
          className="om-sa-approval-btn"
          data-quiet
          disabled={sending}
          onClick={() => onApprove(approval.id, false)}
        >
          <span>{t('Decline')}</span>
        </Button>
      </div>
    </section>
  );
}
