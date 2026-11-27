import { useEffect, useState } from 'react';
import type { ReferralRewardsProgress } from '../../../shared/provider-directory';
import { MenuItem } from '../components/ui/Menu';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import styles from './BalanceEntry.module.css';
import { gatewayRequest } from './gatewayClient';

export function ReferralRewardsMenuItem({ consoleUrl }: { consoleUrl: string }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<ReferralRewardsProgress | null>(null);
  useEffect(() => {
    let active = true;
    void gatewayRequest<ReferralRewardsProgress | null>('settings/account/referral').then(result => {
      if (active) setProgress(result);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  return <MenuItem render={<a href={consoleUrl + '/reset?entry_source=client_entry'} target="_blank" rel="noopener noreferrer" />}>
    <span className="om-menu-label whitespace-normal">
      <RemixIcon name="group-line" size={16} />
      <span className={styles.identity}>
        <strong>{t('Share OpenDesign · Earn reset cards')}</strong>
        {progress && <span className={styles.plan}>{t('{invited}/{target} teammates joined · {cards} reset cards ready', {
          invited: progress.invitedCount,
          target: progress.inviteTarget,
          cards: progress.resetCardsAvailable,
        })}</span>}
      </span>
      <RemixIcon className="om-menu-external" name="external-link-line" size={14} />
    </span>
  </MenuItem>;
}
