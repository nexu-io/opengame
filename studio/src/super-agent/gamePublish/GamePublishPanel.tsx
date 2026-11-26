import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { useAccountSummary } from '../../motion/AccountSettings';
import { BLACK_FRIDAY_CAMPAIGN, campaignPricingUrl, newCampaignEntryId, useBlackFridayActive } from '../../motion/campaignAttribution';
import { readAccountPlan, useCheckoutReturnRefresh } from '../../motion/entitlementAttribution';
import { reportEntitlementGateClick, reportEntitlementGateView } from '../../motion/pageTracking';
import { gamePublishActions, useGamePublishSession, type GamePublishSession } from './gamePublishStore';
import { GamePublishResultAction } from './GamePublishThread';
import { ENABLED_PUBLISH_PLATFORMS, GAME_PUBLISH_PLATFORMS, sessionPublishPlatform, type GamePublishPlatformId } from './platforms';
import { PLAYABLE_NETWORKS, type PlayableNetworkId } from './playableNetworks';
import { ChoiceTiles } from '../../components/ui/ChoiceTiles';
import { PlatformIcon } from '../../../../packages/design-system/react/PlatformIcon';
import { CompactLink, WechatProgress } from './WechatProgress';
import { PlatformProgress } from './PlatformStepControls';
import { useOpenDesignPublishSignIn } from './useOpenDesignPublishSignIn';
import './gamePublish.css';

type Notify = (message: string, tone?: 'info' | 'error') => void;

/**
 * Right-hand publish panel, docked inside the Artifact viewer next to the game preview.
 * Fixed position and height; one step at a time. Real work (OpenDesign link, packages) reports
 * its real result; console steps record what the user says they did.
 */
export function GamePublishPanel({ artifactId, coverUrl, onNotify }: {
  artifactId: string;
  coverUrl?: string;
  onNotify?: Notify;
}) {
  const { t } = useI18n();
  const { account, error: accountError } = useAccountSummary();
  const session = useGamePublishSession(artifactId);

  // Resolve any deferred OpenDesign link decision once the account summary resolves or fails, even after panel reopen.
  useEffect(() => {
    if (!session?.linkDeferred || (!account && !accountError)) return;
    gamePublishActions.resolveDeferredLink(artifactId, account?.state === 'signed-in');
  }, [account, accountError, artifactId, session?.linkDeferred]);

  if (!session?.open) return null;
  const platform = sessionPublishPlatform(session);
  const platformTitle = platform && session.network ? t('{name} playable ad', { name: platform.name }) : platform ? t(platform.name) : '';
  const close = () => gamePublishActions.close(artifactId);

  const header = (title: string, back?: { label: string; onClick: () => void }) => (
    <header className="om-gp-head">
      {back && (
        <Button variant="plain" type="button" className="om-gp-back" onClick={back.onClick}>
          <RemixIcon name="arrow-left-s-line" size={15} />
          <span>{back.label}</span>
        </Button>
      )}
      <h2 className="om-gp-title">{title}</h2>
      <Button variant="plain" type="button" className="om-gp-close" aria-label={t('Close')} onClick={close}>
        <RemixIcon name="close-line" size={16} />
      </Button>
    </header>
  );

  const choose = (id: GamePublishPlatformId, network?: PlayableNetworkId) => {
    if (!account && !accountError) {
      gamePublishActions.choose(artifactId, id, { deferLink: true, network });
      return;
    }
    gamePublishActions.choose(artifactId, id, { signedIn: account?.state === 'signed-in', network });
  };

  // Same tiles as the video export panel: one square per platform with its mark. OpenDesign is not a tile: it is the
  // checked-by-default line under them (OpenDesignChoice), and every platform picked above also gets its link.
  // Playable ads are one tile per ad network, so each network's package rules are reached in one click.
  type Tile = { value: string; label: string; icon: ReactNode };
  const tileIcon = (item: { icon?: Parameters<typeof PlatformIcon>[0]['platform']; badge: string }) => item.icon
    ? <PlatformIcon platform={item.icon} />
    : <span className="om-platform-icon om-gp-badge" aria-hidden="true">{item.badge}</span>;
  const tileGroup = (title: string, options: Tile[], onPick: (value: string) => void) => (
    <section className="om-gp-platform-group" aria-label={title}>
      <h3 className="om-gp-platform-group-title">{title}</h3>
      <ChoiceTiles<string>
        label={title}
        value=''
        className="om-gp-platforms"
        options={options}
        onChange={value => { if (value) onPick(value); }}
      />
    </section>
  );

  const enabled = GAME_PUBLISH_PLATFORMS.filter(item => ENABLED_PUBLISH_PLATFORMS.includes(item.id));
  const tiles = (
    <>
      {tileGroup(t('Game platforms'), enabled.map(item => ({ value: item.id, label: t(item.name), icon: tileIcon(item) })), value => choose(value as GamePublishPlatformId))}
      {tileGroup(t('Playable ad networks'), PLAYABLE_NETWORKS.map(network => ({ value: network.id, label: network.short ?? network.name, icon: tileIcon(network) })), value => choose('playable-ad', value as PlayableNetworkId))}
    </>
  );

  let body: ReactNode;
  let foot: ReactNode;
  let head: ReactNode;

  if (platform?.id === 'wechat' && session.view !== 'list') {
    // WeChat is guided by the Agent in the conversation; the panel only shows where things stand.
    head = header(platformTitle, { label: t('Platforms'), onClick: () => gamePublishActions.showList(artifactId) });
    body = <WechatProgress session={session} />;
    foot = (
      <>
        <Button variant="plain" type="button" className="om-gp-secondary" onClick={close}>{t('Hide for now')}</Button>
        <span className="om-gp-spacer" />
      </>
    );
  } else if (session.view === 'list' || !platform) {
    head = header(t('Choose a platform'));
    body = (
      <>
        <div className="om-gp-hero">
          {coverUrl ? <img src={coverUrl} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <span className="om-gp-hero-placeholder"><RemixIcon name="gamepad-line" size={22} /></span>}
          <div>
            <strong>{session.gameTitle}</strong>
            <p>{t('Pick one to start. Steps are shown one at a time.')}</p>
          </div>
        </div>
        {tiles}
        <OpenDesignChoice session={session} onNotify={onNotify} />
      </>
    );
  } else {
    // Non-WeChat platforms render self-contained step cards in the publish thread; the panel tracks live step progress.
    head = header(platformTitle, { label: t('Platforms'), onClick: () => gamePublishActions.showList(artifactId) });
    body = (
      <>
        <PlatformProgress session={session} />
        {session.view === 'result' && <GamePublishResultAction action={platform.resultAction} href={platform.resultHref} />}
      </>
    );
    foot = session.view === 'result' ? (
      <>
        <Button variant="plain" type="button" className="om-gp-secondary" onClick={() => gamePublishActions.showList(artifactId)}>{t('Publish to another platform')}</Button>
        <span className="om-gp-spacer" />
        <Button variant="plain" type="button" className="om-gp-secondary" onClick={close}>{t('Close')}</Button>
      </>
    ) : (
      <>
        <Button variant="plain" type="button" className="om-gp-secondary" onClick={close}>{t('Hide for now')}</Button>
        <span className="om-gp-spacer" />
      </>
    );
  }

  return (
    <aside className="om-gp-panel" aria-label={t('Publish panel')}>
      {head}
      <div className="om-gp-body">{body}</div>
      {foot && <footer className="om-gp-foot">{foot}</footer>}
    </aside>
  );
}

/**
 * OpenDesign, one small line under the platform tiles, checked by default: every platform picked above also
 * publishes the OpenDesign play link. "Only OpenDesign" publishes the link on its own.
 * Adds direct sign-in hook for guests and Unlisted (Go+) upgrade hook for Free users with full attribution.
 */
function OpenDesignChoice({ session, onNotify }: { session: GamePublishSession; onNotify?: Notify }) {
  const { locale, t } = useI18n();
  const { account, signedIn, authorizing, signingIn, startSignIn: startPanelSignIn } = useOpenDesignPublishSignIn(session.artifactId, onNotify);
  const campaign = useBlackFridayActive();
  const [upgradeEntryId, setUpgradeEntryId] = useState(newCampaignEntryId);
  const markCheckoutReturn = useCheckoutReturnRefresh('creative_studio', 'game_publish_unlisted_upgrade');
  const reportedGateRef = useRef<string | null>(null);

  const plan = readAccountPlan(account);
  const isFreePlan = signedIn && plan === 'free';
  const isPaidPlan = signedIn && Boolean(plan) && plan !== 'free';
  const needsSignIn = Boolean(account && !signedIn && (session.linkToo || session.linkError?.authRequired));

  // Report gate impression once per distinct state.
  useEffect(() => {
    if (needsSignIn && reportedGateRef.current !== 'signin') {
      reportedGateRef.current = 'signin';
      reportEntitlementGateView('creative_studio', 'game_publish_panel_signin', {
        studio_id: 'game',
        publish_target: 'game',
      });
    } else if (isFreePlan && reportedGateRef.current !== 'unlisted') {
      reportedGateRef.current = 'unlisted';
      reportEntitlementGateView('creative_studio', 'game_publish_unlisted_upgrade', {
        studio_id: 'game',
        publish_target: 'game',
        entry_id: upgradeEntryId,
        ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}),
      });
    }
  }, [needsSignIn, isFreePlan, upgradeEntryId, campaign]);

  function handleUpgradeClick() {
    const clickedId = upgradeEntryId;
    markCheckoutReturn(clickedId);
    reportEntitlementGateClick('creative_studio', 'open_pricing', 'game_publish_unlisted_upgrade', {
      studio_id: 'game',
      publish_target: 'game',
      entry_id: clickedId,
      ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}),
    });
    window.setTimeout(() => setUpgradeEntryId(newCampaignEntryId()), 0);
  }

  const upgradeHref = campaignPricingUrl(locale, 'opengame_publish_unlisted', upgradeEntryId);

  return (
    <div className="om-gp-od-block">
      {session.linkUrl ? (
        <div className="om-gp-od-line" data-done>
          <RemixIcon name="checkbox-circle-fill" size={14} />
          <span className="om-gp-od-line-text">{t('Live on OpenDesign')}</span>
          <CompactLink url={session.linkUrl} onNotify={onNotify} />
        </div>
      ) : (
        <div className="om-gp-od-line" data-failed={session.linkError ? true : undefined}>
          <label className="om-gp-od-line-text">
            <input
              type="checkbox"
              checked={session.linkToo}
              disabled={session.linkPublishing}
              onChange={event => gamePublishActions.setLinkToo(session.artifactId, event.target.checked)}
            />
            <span>
              {session.linkPublishing ? t('Publishing on OpenDesign…')
                : session.linkError ? (session.linkError.authRequired ? t('Sign in to OpenDesign to publish your play link.') : t('Publishing failed: {message}', { message: session.linkError.message }))
                  : t('Also publish on OpenDesign')}
            </span>
          </label>
          {!session.linkPublishing && !needsSignIn && (
            <Button variant="plain" type="button" className="om-gp-text-btn" onClick={() => void gamePublishActions.publishLink(session.artifactId)}>
              {session.linkError ? t('Try again') : t('Only OpenDesign')}
            </Button>
          )}
        </div>
      )}

      {needsSignIn && !session.linkUrl && (
        <div className="om-gp-monetization-card" data-testid="game-publish-signin-hook">
          <div className="om-gp-monetization-copy">
            <strong>{t('Sign in to publish a live play link')}</strong>
            <span>{t('Get an instant OpenDesign play URL you can share for playtesting.')}</span>
          </div>
          <Button
            variant="plain"
            type="button"
            className="om-gp-primary om-gp-monetization-btn"
            disabled={signingIn || authorizing}
            onClick={() => void startPanelSignIn()}
          >
            <RemixIcon name={authorizing ? 'loader-4-line' : 'login-box-line'} size={14} className={authorizing ? 'animate-spin motion-reduce:animate-none' : undefined} />
            <span>{authorizing ? t('Waiting for sign-in…') : t('Sign in with OpenDesign')}</span>
          </Button>
        </div>
      )}

      {isFreePlan && (
        <div className="om-gp-monetization-card" data-tone="upgrade" data-testid="game-publish-unlisted-hook">
          <div className="om-gp-monetization-copy">
            <strong>
              <RemixIcon name="eye-off-line" size={13} />
              <span>{t('Unlisted link (private playtest)')}</span>
            </strong>
            <span>{t('Free links are shared in the community. Upgrade to Go+ to keep playtest links unlisted.')}</span>
          </div>
          <a
            className="om-gp-upgrade-link"
            href={upgradeHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleUpgradeClick}
          >
            <RemixIcon name="sparkling-line" size={13} />
            <span>{campaign ? t('Upgrade · 50% OFF') : t('Upgrade to Go+')}</span>
            <RemixIcon name="external-link-line" size={12} />
          </a>
        </div>
      )}

      {isPaidPlan && (
        <div className="om-gp-unlisted-badge" data-testid="game-publish-unlisted-unlocked">
          <RemixIcon name="shield-check-line" size={13} />
          <span>{t('Unlisted playtest links unlocked on your plan')}</span>
        </div>
      )}
    </div>
  );
}
