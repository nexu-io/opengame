import { Button } from 'open-design-ui/button';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { gamePublishDevTool } from './devTools';
import { downloadPackage, formatBytes, type GamePackageCheck } from './gamePackage';
import { gamePublishActions, stepBlocked, type GamePublishSession } from './gamePublishStore';
import { playableNetwork } from './playableNetworks';
import { CompactLink, OpenDesignProgress } from './WechatProgress';
import { gamePublishPlatform } from './platforms';
import { useOpenDesignPublishSignIn } from './useOpenDesignPublishSignIn';
import './gamePublish.css';

type Notify = (message: string, tone?: 'info' | 'error') => void;

/**
 * Platforms other than WeChat, right-hand panel: live step progress overview.
 * Interactive controls for the current step are rendered inline in the publish thread (PlatformInlineControls).
 */
export function PlatformProgress({ session }: { session: GamePublishSession }) {
  const { t } = useI18n();
  const platform = gamePublishPlatform(session.platformId);
  if (!platform) return null;
  const total = platform.steps.length;
  const finished = session.stepIndex >= total;
  const current = platform.steps[session.stepIndex];
  const waitingForTool = session.toolCheck?.state === 'missing';
  const tool = gamePublishDevTool(session.toolCheck?.toolId);
  return (
    <div className="om-gp-overview">
      <p className="om-gp-overview-now" role="status">
        <strong>{finished
          ? t('All {total} steps done', { total })
          : waitingForTool && tool ? t('Needed · {tool}', { tool: t(tool.name) })
            : t('Step {current} of {total} · {name}', { current: session.stepIndex + 1, total, name: t(current.title) })}</strong>
      </p>
      <OpenDesignProgress session={session} />
      <ol className="om-gp-overview-list">
        {platform.steps.map((step, index) => {
          const state = finished || index < session.stepIndex ? 'done' : index === session.stepIndex && !waitingForTool ? 'current' : 'todo';
          return (
            <li key={step.short} className="om-gp-overview-item" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
              {state === 'done' ? <RemixIcon name="checkbox-circle-fill" size={14} /> : state === 'current' ? <RemixIcon name="arrow-right-fill" size={14} /> : <span className="om-gp-overview-dot" aria-hidden="true" />}
              <span className="om-gp-overview-name">{index + 1}. {t(step.title)}</span>
              <span className="om-gp-overview-state">{t(state === 'done' ? 'Done' : state === 'current' ? 'In progress' : 'Not started')}</span>
            </li>
          );
        })}
      </ol>
      {finished && <p className="om-gp-muted">{t(platform.resultDetail)}</p>}
    </div>
  );
}

/**
 * Inline controls for the current publish step (developer tool check, choices, store links,
 * one-click package download, OpenDesign link sign-in, platform links, and step completion CTA).
 * Advances the local publish store directly without queueing extra Agent turns.
 */
export function PlatformInlineControls({ session, onNotify }: { session: GamePublishSession; onNotify?: Notify }) {
  const { t } = useI18n();
  const platform = gamePublishPlatform(session.platformId);
  if (!platform || platform.id === 'wechat' || session.view !== 'step') return null;
  const tool = session.toolCheck?.state === 'missing' ? gamePublishDevTool(session.toolCheck.toolId) : undefined;
  if (tool) {
    return (
      <div className="om-gp-inline">
        <div className="om-gp-inline-step-head">
          <strong>{t('Needed · {tool}', { tool: t(tool.name) })}</strong>
          <p className="om-gp-muted">{t(tool.why)}</p>
        </div>
        <div className="om-gp-inline-row">
          <a className="om-gp-secondary" href={tool.downloadHref} target="_blank" rel="noopener noreferrer"><RemixIcon name="download-2-line" size={14} /> {t('Download {tool}', { tool: t(tool.name) })}</a>
          <Button variant="plain" type="button" className="om-gp-primary" onClick={() => gamePublishActions.confirmDevTool(session.artifactId)}>{t('I installed it, continue')}</Button>
          <Button variant="plain" type="button" className="om-gp-text-button" onClick={() => gamePublishActions.skipDevTool(session.artifactId)}>{t('Later')}</Button>
        </div>
      </div>
    );
  }
  const step = platform.steps[session.stepIndex];
  if (!step) return null;
  const total = platform.steps.length;
  const isPackageStep = step.kind === 'package';
  const reusablePackage = !isPackageStep && session.package?.state === 'ready' ? session.package.result : undefined;
  return (
    <div className="om-gp-inline">
      <div className="om-gp-inline-step-head">
        <strong>{t('Step {current} of {total} · {name}', { current: session.stepIndex + 1, total, name: t(step.title) })}</strong>
        {step.todo.length > 1 && (
          <ol className="om-gp-inline-todo">
            {step.todo.map(item => <li key={item}>{t(item)}</li>)}
          </ol>
        )}
      </div>
      {step.fields?.map(field => (
        <label key={field.label} className="om-gp-field">
          <span className="om-gp-field-label">{t(field.label)}</span>
          <input
            className="om-gp-input"
            inputMode="url"
            value={session.inputs[field.label] ?? ''}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            onChange={event => gamePublishActions.setInput(session.artifactId, field.label, event.target.value)}
          />
        </label>
      ))}
      {step.pick && (
        <div className="om-gp-chips" role="radiogroup" aria-label={t(step.title)}>
          {step.pick.map(option => (
            <Button key={option} variant="plain" type="button" role="radio" aria-checked={session.picked === option} className="om-gp-chip" data-selected={session.picked === option || undefined} onClick={() => gamePublishActions.pick(session.artifactId, option)}>
              {option}
            </Button>
          ))}
        </div>
      )}
      {isPackageStep && <PackageStep session={session} stepRef={{ platformId: platform.id, stepIndex: session.stepIndex }} />}
      {step.kind === 'link' && <LinkStep session={session} onNotify={onNotify} />}
      {step.links && (
        <div className="om-gp-links">
          {step.links.map(link => (
            <a key={link.label} className="om-gp-link" href={link.href} target="_blank" rel="noopener noreferrer">{t(link.label)} <RemixIcon name="external-link-line" size={12} /></a>
          ))}
        </div>
      )}
      {session.stepProblem && <p className="om-gp-need">{t(session.stepProblem)}</p>}
      {!isPackageStep && (
        <div className="om-gp-inline-row">
          <Button variant="plain" type="button" className="om-gp-primary" disabled={stepBlocked(session, step)} onClick={() => gamePublishActions.completeStep(session.artifactId, { platformId: platform.id, stepIndex: session.stepIndex })}>
            {t(step.cta)}
          </Button>
          {reusablePackage && (
            <Button variant="plain" type="button" className="om-gp-secondary" onClick={() => downloadPackage(reusablePackage)}>
              <RemixIcon name="download-2-line" size={14} />
              <span>{t('Download {file}', { file: reusablePackage.fileName })}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: GamePackageCheck }) {
  const { t } = useI18n();
  const icon = check.tone === 'ok' ? 'checkbox-circle-fill' : check.tone === 'warn' ? 'error-warning-line' : 'alert-fill';
  return (
    <div className="om-gp-check" data-tone={check.tone}>
      <RemixIcon name={icon} size={14} />
      <span className="om-gp-check-label">{t(check.label)}</span>
      <span className="om-gp-check-value">{t(check.value, check.vars)}</span>
    </div>
  );
}

/** Real package: built from the game's files, checked, downloaded by the browser (and advances in one click). */
function PackageStep({ session, stepRef }: { session: GamePublishSession; stepRef: { platformId: NonNullable<GamePublishSession['platformId']>; stepIndex: number } }) {
  const { t } = useI18n();
  const pkg = session.package;
  const network = pkg?.target === 'playable' ? playableNetwork(session.picked) : undefined;
  if (!pkg || pkg.state === 'building') {
    return (
      <div className="om-gp-wait">
        <RemixIcon name="loader-4-line" size={24} className="om-gp-spin" />
        <span className="om-gp-muted">{t('Building the package')}</span>
      </div>
    );
  }
  if (pkg.state === 'failed' || !pkg.result) {
    return (
      <div className="om-gp-checks">
        <p className="om-gp-error">{t('Could not build the package: {message}', { message: pkg.error ?? '' })}</p>
        <Button variant="plain" type="button" className="om-gp-secondary" onClick={() => void gamePublishActions.buildPackage(session.artifactId)}>{t('Try again')}</Button>
      </div>
    );
  }
  const { result } = pkg;
  return (
    <>
      <div className="om-gp-checks">
        <div className="om-gp-checks-head">
          <strong>{network?.name ?? result.fileName}</strong>
          <span className="om-gp-checks-meta">{formatBytes(result.bytes)}</span>
        </div>
        {result.checks.map(check => <CheckRow key={`${check.label}:${check.value}`} check={check} />)}
      </div>
      <div className="om-gp-download">
        <Button
          variant="plain"
          type="button"
          className="om-gp-primary"
          onClick={() => {
            downloadPackage(result);
            gamePublishActions.completeStep(session.artifactId, stepRef);
          }}
        >
          <RemixIcon name="download-2-line" size={14} />
          <span>{t('Download {file}', { file: result.fileName })}</span>
        </Button>
        {network && (
          <p className="om-gp-muted">{t('Upload it in {console} and preview it there before the ad goes live.', { console: t(network.console.label) })}</p>
        )}
        {network?.console.href && (
          <a className="om-gp-link" href={network.console.href} target="_blank" rel="noopener noreferrer">
            {t('Open {console}', { console: t(network.console.label) })} <RemixIcon name="external-link-line" size={12} />
          </a>
        )}
      </div>
    </>
  );
}

/** Step that needs the real OpenDesign link (Telegram). */
function LinkStep({ session, onNotify }: { session: GamePublishSession; onNotify?: Notify }) {
  const { t } = useI18n();
  const { account, signedIn, authorizing, signingIn, startSignIn } = useOpenDesignPublishSignIn(session.artifactId, onNotify);
  if (session.linkUrl) {
    return (
      <div className="om-gp-checks">
        <div className="om-gp-check" data-tone="ok">
          <RemixIcon name="checkbox-circle-fill" size={14} />
          <span className="om-gp-check-label">{t('Live on OpenDesign')}</span>
          <span className="om-gp-check-value"><CompactLink url={session.linkUrl} onNotify={onNotify} /></span>
        </div>
      </div>
    );
  }
  const needsSignIn = Boolean(session.linkError?.authRequired || (account && !signedIn));
  if (needsSignIn) {
    return (
      <div className="om-gp-checks om-gp-link-signin">
        <p className="om-gp-muted">{t('Telegram Mini Apps need a public web URL. Sign in to OpenDesign to publish one automatically.')}</p>
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
      </div>
    );
  }
  return (
    <div className="om-gp-checks">
      {session.linkError && <p className="om-gp-error">{t('Publishing failed: {message}', { message: session.linkError.message })}</p>}
      <Button variant="plain" type="button" className="om-gp-secondary" disabled={session.linkPublishing} onClick={() => void gamePublishActions.publishLink(session.artifactId)}>
        {session.linkPublishing ? t('Publishing on OpenDesign…') : session.linkError ? t('Try again') : t('Publish on OpenDesign')}
      </Button>
    </div>
  );
}
