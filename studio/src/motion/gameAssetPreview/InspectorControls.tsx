import { IconButton } from 'open-design-ui/icon-button';
import { RemixIcon } from '../../icons/RemixIcons';

export function InspectorAction({ label, icon, onClick, disabled }: {
  label: string; icon: string; onClick: () => void; disabled?: boolean;
}) {
  return <IconButton type="button" aria-label={label} title={label} icon={<RemixIcon name={icon} size={16} />}
    onClick={onClick} disabled={disabled} />;
}
