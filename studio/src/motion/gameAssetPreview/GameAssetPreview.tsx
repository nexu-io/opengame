import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { Skeleton } from '../../components/ui/Skeleton';
import { useI18n } from '../../i18n/I18n';
import { ModelAssetPreview } from '../ModelAssetPreview';
import { detectGameAssetPreview, type GameAssetPreviewProps } from './formats';
import { SpritePreview } from './SpritePreview';
import { TiledMapPreview } from './TiledMapPreview';

const InterchangePreview = lazy(() => import('./InterchangePreview'));

export function GameAssetPreview({ active = true, ...props }: GameAssetPreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    let intersecting = typeof IntersectionObserver === 'undefined';
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = intersecting ? undefined : new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); });
    observer?.observe(host.current);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <div ref={host} className="om-game-asset-preview">{active && visible && <Preview key={`${props.path}:${props.url}`} {...props} />}</div>;
}

function Preview(props: GameAssetPreviewProps) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const kind = props.previewKind ?? detectGameAssetPreview(props.path, props.content);
  switch (kind) {
    case 'tilemap': return <TiledMapPreview {...props} />;
    case 'image': case 'atlas': return <SpritePreview {...props} atlas={kind === 'atlas'} />;
    case 'glb': return <ModelAssetPreview src={props.url} title={props.title || props.path} />;
    case 'model': return <Suspense fallback={<Skeleton className="w-full h-full" />}><InterchangePreview {...props} /></Suspense>;
    case 'video': case 'audio': {
      const Media = kind;
      if (!failed) return <div className="om-inspector-stage motion-asset-stage"><Media src={props.url} controls preload="metadata" aria-label={props.title || props.path} className={kind === 'video' ? 'w-full h-full object-contain' : 'w-full max-w-md px-4'} onError={() => setFailed(true)} /></div>;
      return <div className="om-empty" role="status"><p>{t('This browser could not play the media file.')}</p><Button variant="ghost" onClick={() => setFailed(false)}>{t('Retry')}</Button></div>;
    }
    default: return <div className="om-empty" role="status">{t('Preview unavailable')}</div>;
  }
}
