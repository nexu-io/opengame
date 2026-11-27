import { Button } from 'open-design-ui/button';
import { useEffect, useRef } from 'react';
import type { SuperAgentMessage } from '../../../../shared/super-agent';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { downloadPackage } from './gamePackage';
import { gamePublishActions, useGamePublishSession, useGamePublishThread, usePublishForChat, type GamePublishThreadEntry } from './gamePublishStore';
import { CompactLink, hasWechatInlineControls, WechatInlineControls } from './WechatProgress';
import { PlatformInlineControls } from './PlatformStepControls';
import { gamePublishPlatform } from './platforms';
import { useOpenDesignPublishSignIn } from './useOpenDesignPublishSignIn';
import './gamePublish.css';

type Notify = (message: string, tone?: 'info' | 'error') => void;

/**
 * Splits publish entries into those anchored to earlier completed turns (rendered inside their
 * originating turn so they scroll into history) and those belonging to the current tail of the chat.
 */
export function partitionPublishEntries(
  entries: readonly GamePublishThreadEntry[],
  turnCount: number,
): { byTurn: Map<number, GamePublishThreadEntry[]>; tail: GamePublishThreadEntry[] } {
  const byTurn = new Map<number, GamePublishThreadEntry[]>();
  const tail: GamePublishThreadEntry[] = [];
  const lastTurnIndex = turnCount - 1;
  for (const entry of entries) {
    if (entry.anchorTurnIndex !== undefined && entry.anchorTurnIndex >= 0 && entry.anchorTurnIndex < lastTurnIndex) {
      const list = byTurn.get(entry.anchorTurnIndex);
      if (list) list.push(entry);
      else byTurn.set(entry.anchorTurnIndex, [entry]);
    } else {
      tail.push(entry);
    }
  }
  return { byTurn, tail };
}

/** Publish receipts anchored to a specific historical conversation turn inside ExecutionTimeline. */
export function GamePublishTurnEntries({ entries, activeInline, onOpenPanel, onNotify }: {
  entries: readonly GamePublishThreadEntry[];
  activeInline: boolean;
  onOpenPanel: (artifactId: string) => void;
  onNotify?: Notify;
}) {
  if (!entries.length) return null;
  return (
    <div className="om-gp-turn-entries">
      {entries.map(entry => (
        <ThreadEntry key={entry.id} entry={entry} activeInline={activeInline} onOpenPanel={onOpenPanel} onNotify={onNotify} />
      ))}
    </div>
  );
}

/**
 * Active publish controls and current-turn receipts rendered directly below the conversation.
 * Historical entries anchored to earlier turns stay with their originating turn in ExecutionTimeline.
 */
export function GamePublishThread({ chatId, messages, entries: entriesOverride, onOpenPanel, onNotify }: {
  chatId: string | null | undefined;
  messages?: readonly SuperAgentMessage[];
  entries?: readonly GamePublishThreadEntry[];
  onOpenPanel: (artifactId: string) => void;
  onNotify?: Notify;
}) {
  const { t } = useI18n();
  const storeEntries = useGamePublishThread(chatId);
  const entries = entriesOverride ?? storeEntries;
  const active = usePublishForChat(chatId);
  const endRef = useRef<HTMLDivElement>(null);

  // Refresh WeChat publish status whenever the Agent finishes a reply, so inline controls
  // (.key chooser, preview QR) still appear even after the user hides the right-hand publish panel.
  const wechatArtifactId = active?.platformId === 'wechat' ? active.artifactId : undefined;
  const wechatPanelOpen = Boolean(active?.open);
  const lastCompletedAssistantId = messages?.findLast(
    message => message.role === 'assistant' && message.status !== 'streaming',
  )?.id;
  const lastWechatRefreshRef = useRef<{ artifactId?: string; messageId?: string }>({});
  useEffect(() => {
    if (!wechatArtifactId) {
      lastWechatRefreshRef.current = {};
      return;
    }
    const prev = lastWechatRefreshRef.current;
    const switchedArtifact = prev.artifactId !== wechatArtifactId;
    const messageAdvanced = Boolean(lastCompletedAssistantId && prev.messageId !== lastCompletedAssistantId);
    lastWechatRefreshRef.current = { artifactId: wechatArtifactId, messageId: lastCompletedAssistantId };
    if (switchedArtifact) {
      if (!wechatPanelOpen) void gamePublishActions.refreshWechat(wechatArtifactId);
      return;
    }
    if (messageAdvanced) {
      void gamePublishActions.refreshWechat(wechatArtifactId);
    }
  }, [wechatArtifactId, wechatPanelOpen, lastCompletedAssistantId]);

  const lastEntry = entries.at(-1);
  const entryKey = lastEntry
    ? `${lastEntry.id}:${lastEntry.kind === 'agent' ? lastEntry.lines.length : lastEntry.kind === 'link' ? lastEntry.state : 0}`
    : '';
  const activeKey = active
    ? `${active.platformId ?? ''}:${active.stepIndex}:${active.package?.state ?? ''}:${active.toolCheck?.state ?? ''}:${active.wechat?.status?.current ?? ''}:${active.wechat?.status?.preview?.createdAt ?? ''}`
    : '';
  const progressKey = `${entryKey}|${activeKey}`;
  // Keep the newest publish activity and active step controls in view, like new Agent messages.
  useEffect(() => {
    if (progressKey !== '|') endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [progressKey]);

  const hasActiveStep = Boolean(active && (
    active.platformId === 'wechat'
      ? hasWechatInlineControls(active)
      : active.view === 'step' && Boolean(gamePublishPlatform(active.platformId))
  ));
  if (!entries.length && !hasActiveStep) return null;

  const isDouyinGuided = active?.platformId === 'douyin-minigame';
  const requestedAt = active?.guideRequestedAt;
  const platform = isDouyinGuided ? gamePublishPlatform(active.platformId) : undefined;
  const step = active && platform?.steps[active.stepIndex];
  const heading = active && platform && step ? t('Step {current} of {total} · {name}', {
    current: active.stepIndex + 1, total: platform.steps.length, name: t(step.title),
  }).replace(/\s/g, '') : undefined;
  const stepReply = heading && requestedAt !== undefined ? messages?.findLast(message => {
    if (message.role !== 'assistant' || message.status === 'streaming' || message.createdAt < requestedAt) return false;
    const [firstLine, ...body] = message.text.trim().split(/\r?\n/);
    return firstLine.replace(/[\s#*_]/g, '') === heading && body.some(line => line.trim());
  }) : undefined;
  const activeStep = hasActiveStep && active
    ? (active.platformId === 'wechat'
      ? <WechatInlineControls session={active} />
      : <PlatformInlineControls session={active} stepReplyText={stepReply?.text} onNotify={onNotify} />)
    : null;
  return (
    <div className="om-gp-thread" aria-label={t('Publish activity')}>
      {activeStep}
      {entries.map(entry => <ThreadEntry key={entry.id} entry={entry} activeInline={Boolean(active)} onOpenPanel={onOpenPanel} onNotify={onNotify} />)}
      <div ref={endRef} />
    </div>
  );
}

function LinkFailedCard({ entry, onNotify }: {
  entry: Extract<GamePublishThreadEntry, { kind: 'link-failed' }>;
  onNotify?: Notify;
}) {
  const { t } = useI18n();
  const session = useGamePublishSession(entry.artifactId);
  const { authorizing, signingIn, startSignIn } = useOpenDesignPublishSignIn(entry.artifactId, onNotify, 'game_publish_failed_signin', Boolean(entry.authRequired));
  const canSkip = Boolean(session?.platformId && session.platformId !== 'telegram');
  return (
    <div className="om-gp-result-card" data-failed>
      <RemixIcon name="alert-fill" size={22} className="om-gp-result-icon" />
      <strong>{t('Publishing on OpenDesign failed')}</strong>
      <span className="om-gp-muted">{entry.authRequired ? t('Sign in to OpenDesign to publish your play link.') : entry.message}</span>
      <div className="om-gp-result-actions">
        {entry.authRequired ? (
          <Button
            variant="plain"
            type="button"
            className="om-gp-primary"
            disabled={signingIn || authorizing}
            onClick={() => void startSignIn()}
          >
            <RemixIcon name={authorizing ? 'loader-4-line' : 'login-box-line'} size={14} className={authorizing ? 'om-gp-spin' : undefined} />
            <span>{authorizing ? t('Waiting for sign-in…') : t('Sign in with OpenDesign')}</span>
          </Button>
        ) : (
          <Button variant="plain" type="button" className="om-gp-primary" onClick={() => void gamePublishActions.publishLink(entry.artifactId, { anchorTurnIndex: entry.anchorTurnIndex })}>
            {t('Try again')}
          </Button>
        )}
        {canSkip && (
          <Button
            variant="plain"
            type="button"
            className="om-gp-secondary"
            onClick={() => gamePublishActions.dismissLinkError(entry.artifactId)}
          >
            {t('Skip, continue without link')}
          </Button>
        )}
      </div>
    </div>
  );
}

function ThreadEntry({ entry, activeInline, onOpenPanel: _onOpenPanel, onNotify }: { entry: GamePublishThreadEntry; activeInline: boolean; onOpenPanel: (artifactId: string) => void; onNotify?: Notify }) {
  const { t } = useI18n();
  if (entry.kind === 'user') {
    return <div className="om-gp-user">{t(entry.key, entry.name ? { name: t(entry.name) } : undefined)}</div>;
  }
  if (entry.kind === 'link') {
    const ready = entry.state === 'ready' && Boolean(entry.url);
    return (
      <div className="om-gp-link-bar" data-state={ready ? 'ready' : 'publishing'}>
        <span className="om-gp-link-bar-main">
          <RemixIcon
            name={ready ? 'checkbox-circle-fill' : 'loader-4-line'}
            size={15}
            className={ready ? 'om-gp-link-bar-icon' : 'om-gp-link-bar-icon om-gp-spin'}
          />
          <strong>{t(ready ? 'Live on OpenDesign' : 'Publishing on OpenDesign')}</strong>
        </span>
        {ready && entry.url && <CompactLink url={entry.url} onNotify={onNotify} />}
      </div>
    );
  }
  if (entry.kind === 'agent' && entry.work === 'wechat-key') {
    const detail = entry.lines[0];
    return (
      <div className="om-gp-receipt">
        <RemixIcon name="check-line" size={14} />
        <span>
          <strong>{t(entry.title)}</strong>
          {detail ? ` · ${t(detail.text, detail.vars)}` : ''}
        </span>
      </div>
    );
  }
  if (entry.kind === 'agent') {
    return (
      <div className="om-gp-agent">
        <div className="om-gp-agent-title">{t(entry.title, entry.name ? { name: t(entry.name) } : undefined)}</div>
        {entry.lines.map((line, index) => (
          <div key={index} className="om-gp-line" data-done={line.done || undefined} data-failed={!line.done || undefined}>
            <RemixIcon name={line.done ? 'check-line' : 'close-line'} size={13} />
            <span>{t(line.text, line.vars)}</span>
          </div>
        ))}
        {!entry.lines.length && (
          <div className="om-gp-line"><RemixIcon name="loader-4-line" size={13} className="om-gp-spin" /><span>{t('Working…')}</span></div>
        )}
        {entry.packageResult && !activeInline && (
          <div className="om-gp-inline-row om-gp-agent-download">
            <Button variant="plain" type="button" className="om-gp-secondary" onClick={() => downloadPackage(entry.packageResult!)}>
              <RemixIcon name="download-2-line" size={14} />
              <span>{t('Download {file}', { file: entry.packageResult.fileName })}</span>
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (entry.kind === 'link-failed') {
    return <LinkFailedCard entry={entry} onNotify={onNotify} />;
  }
  return (
    <div className="om-gp-result-card">
      <RemixIcon name="checkbox-circle-fill" size={22} className="om-gp-result-icon" />
      <strong>{t(entry.title)}</strong>
      {entry.link
        ? <CompactLink url={entry.detail} onNotify={onNotify} />
        : <>
          <span className="om-gp-muted">{t(entry.detail, entry.vars)}</span>
          <GamePublishResultAction action={entry.action} href={entry.href} />
          <PostPublishSignInHook artifactId={entry.artifactId} onNotify={onNotify} />
        </>}
    </div>
  );
}

/** Gentle post-publish hook for guests: turn the completed game into an instant shareable play link while waiting for platform review. */
function PostPublishSignInHook({ artifactId, onNotify }: { artifactId: string; onNotify?: Notify }) {
  const { t } = useI18n();
  const session = useGamePublishSession(artifactId);
  const { account, signedIn, authorizing, signingIn, startSignIn } = useOpenDesignPublishSignIn(artifactId, onNotify, 'game_publish_post_signin', Boolean(session && !session.linkUrl));
  if (!session || session.linkUrl || !account || signedIn) return null;
  return (
    <div className="om-gp-post-signin" data-testid="game-publish-post-signin-hook">
      <div className="om-gp-post-signin-copy">
        <strong>{t('Share a live play link while you wait?')}</strong>
        <span className="om-gp-muted">{t('Sign in to OpenDesign to get an instant web play link—no waiting for platform review.')}</span>
      </div>
      <Button
        variant="plain"
        type="button"
        className="om-gp-secondary om-gp-post-signin-btn"
        disabled={signingIn || authorizing}
        onClick={() => void startSignIn()}
      >
        <RemixIcon name={authorizing ? 'loader-4-line' : 'login-box-line'} size={14} className={authorizing ? 'om-gp-spin' : undefined} />
        <span>{authorizing ? t('Waiting for sign-in…') : t('Sign in & get play link')}</span>
      </Button>
    </div>
  );
}

/** Result-card button: opens the platform's official page. */
export function GamePublishResultAction({ action, href }: { action?: string; href?: string }) {
  const { t } = useI18n();
  if (!action || !href) return null;
  return (
    <a className="om-gp-primary" href={href} target="_blank" rel="noopener noreferrer">
      {t(action)} <RemixIcon name="external-link-line" size={12} />
    </a>
  );
}
