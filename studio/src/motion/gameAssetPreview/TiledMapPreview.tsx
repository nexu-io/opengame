import { useEffect, useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { Skeleton } from '../../components/ui/Skeleton';
import { useI18n } from '../../i18n/I18n';
import type { GameAssetPreviewProps } from './formats';
import { mapFileHint, mapFormatHint, renderTiledMap, TiledFileError } from './TiledMap';

export function TiledMapPreview({ path, url, resolveFileUrl, title, active = true }: GameAssetPreviewProps) {
  const { t } = useI18n();
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<Error>();
  const [canvas, setCanvas] = useState<HTMLCanvasElement>();
  const [fit, setFit] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setCanvas(undefined);
    setError(undefined);
    setFit(true);
    if (!active) return;
    const controller = new AbortController();
    void renderTiledMap({ path, url, resolveFileUrl }, controller.signal).then(result => {
      if (!controller.signal.aborted) setCanvas(result);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason); });
    return () => controller.abort();
  }, [path, url, resolveFileUrl, active, attempt]);
  useEffect(() => {
    if (!canvas || !holder.current) return;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', title || path);
    canvas.className = fit ? 'w-full h-full object-contain' : 'max-w-none';
    canvas.style.imageRendering = 'pixelated';
    holder.current.replaceChildren(canvas);
  }, [canvas, fit, path, title]);
  if (!active) return null;
  if (error) return <div className="om-empty min-h-48" role="status"><p className="break-words">{error instanceof TiledFileError ? t(mapFileHint, { path: error.message }) : t(mapFormatHint)}</p><Button type="button" variant="ghost" onClick={() => setAttempt(n => n + 1)}>{t('Retry')}</Button></div>;
  if (!canvas) return <Skeleton className="w-full h-full" />;
  return <div className="om-game-preview-inspector">
    <div ref={holder} className="om-inspector-stage om-inspector-map motion-asset-stage" />
    <div className="om-inspector-footer"><div className="om-inspector-options"><Button type="button" variant="ghost" aria-pressed={fit} onClick={() => setFit(true)}>{t('Fit')}</Button><Button type="button" variant="ghost" aria-pressed={!fit} onClick={() => setFit(false)}>100%</Button></div></div>
  </div>;
}
