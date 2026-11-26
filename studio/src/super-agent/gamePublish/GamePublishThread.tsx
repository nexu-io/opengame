import { Button } from 'open-design-ui/button';
import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { downloadPackage } from './gamePackage';
import { gamePublishActions, useGamePublishSession, useGamePublishThread, usePublishForChat, type GamePublishThreadEntry } from './gamePublishStore';
import { CompactLink, WechatInlineControls } from './WechatProgress';
import { PlatformInlineControls } from './PlatformStepControls';
import { useOpenDesignPublishSignIn } from './useOpenDesignPublishSignIn';
import './gamePublish.css';

type Notify = (message: string, tone?: 'info' | 'error') => void;

/**
 * Publish activity rendered below the conversation: real work as it finishes (OpenDesign link, package builds)
 * and self-contained inline step cards. Only WeChat Mini Game is Agent-guided; all other platforms advance locally.
 */
export function GamePublishThread({ chatId, onOpenPanel, onNotify }: {
  chatId: string | null | undefined;
  onOpenPanel: (artifactId: string) => void;
  onNotify?: Notify;
}) {
  const { t } = useI18n();
  const entries = useGamePublishThread(chatId);
  const active = usePublishForChat(chatId);
  const endRef = useRef<HTMLDivElement>(null);
  const lastEntry = entries.at(-1);
  const entryKey = lastEntry ? `${lastEntry.id}:${lastEntry.kind === 'agent' ? lastEntry.lines.length : 0}` : '';
  const activeKey = active ? `${active.platformId ?? ''}:${active.stepIndex}:${active.package?.state ?? ''}:${active.toolCheck?.state ?? ''}` : '';
  const progressKey = `${entryKey}|${activeKey}`;
  // Keep the newest publish activity and active step controls in view, like new Agent messages.
  useEffect(() => {
    if (progressKey !== '|') endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [progressKey]);
  if (!entries.length && !active) return null;
  return (
    <div className="om-gp-thread" aria-label={t('Publish activity')}>
      {entries.map(entry => <ThreadEntry key={entry.id} entry={entry} activeInline={Boolean(active)} onOpenPanel={onOpenPanel} onNotify={onNotify} />)}
      {active && (active.platformId === 'wechat' ? <WechatInlineControls session={active} /> : <PlatformInlineControls session={active} onNotify={onNotify} />)}
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
  const { authorizing, signingIn, startSignIn } = useOpenDesignPublishSignIn(entry.artifactId, onNotify);
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
          <Button variant="plain" type="button" className="om-gp-primary" onClick={() => void gamePublishActions.publishLink(entry.artifactId)}>
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

function ThreadEntry({ entry, activeInline, onOpenPanel, onNotify }: { entry: GamePublishThreadEntry; activeInline: boolean; onOpenPanel: (artifactId: string) => void; onNotify?: Notify }) {
  const { t } = useI18n();
  if (entry.kind === 'user') {
    return <div className="om-gp-user">{t(entry.key, entry.name ? { name: t(entry.name) } : undefined)}</div>;
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
  const { account, signedIn, authorizing, signingIn, startSignIn } = useOpenDesignPublishSignIn(artifactId, onNotify);
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
