import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from 'open-design-ui/button';
import { Slider } from 'open-design-ui/slider';
import { NumberField } from '../../components/ui/NumberField';
import { Popover } from '../../components/ui/Popover';
import { RemixIcon } from '../../icons/RemixIcons';
import { InspectorAction } from './InspectorControls';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { useI18n } from '../../i18n/I18n';
import { drawFrame, gridFrame, parseAtlas } from './atlas';
import { companionPath, readPreviewBytes, type GameAssetPreviewProps } from './formats';

export function SpritePreview({ path, url, resolveFileUrl, atlas }: GameAssetPreviewProps & { atlas: boolean }) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [asset, setAsset] = useState<{ image: HTMLImageElement; manifest?: ReturnType<typeof parseAtlas> }>();
  const [actionIndex, setActionIndex] = useState(0);
  const [sheet, setSheet] = useState(atlas);
  const [rows, setRows] = useState(1), [cols, setCols] = useState(1);
  const [fps, setFps] = useState(8), [index, setIndex] = useState(0), [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    async function load() {
      setFailed(false); setAsset(undefined); setPlaying(false); setIndex(0); setActionIndex(0);
      let source = url;
      let manifest: ReturnType<typeof parseAtlas> | undefined;
      if (atlas) {
        manifest = parseAtlas(await (await readPreviewBytes(url, controller.signal, 4 * 1024 ** 2)).text());
        source = resolveFileUrl?.(companionPath(path, manifest.image)) || '';
        if (!source || !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(manifest.image)) throw new Error('Atlas image unavailable');
      }
      const blob = await readPreviewBytes(source, controller.signal, 32 * 1024 ** 2);
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (manifest?.frames.some(({ crop }) => crop.x + crop.w > image.naturalWidth || crop.y + crop.h > image.naturalHeight)) throw new Error('Invalid frame bounds');
      if (!controller.signal.aborted) setAsset({ image, manifest });
    }
    void load().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, url, atlas, resolveFileUrl, attempt]);

  const actions = asset?.manifest?.animations;
  const frames = actions?.[actionIndex]?.frames ?? asset?.manifest?.frames;
  const count = frames?.length ?? rows * cols;
  const position = index % count;
  useEffect(() => {
    if (!playing || !sheet || count < 2) return;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % count), 1000 / fps);
    return () => clearInterval(timer);
  }, [playing, sheet, count, fps]);
  useEffect(() => {
    if (!asset || !canvas.current || !sheet) return;
    const frame = frames?.[position] ?? gridFrame(asset.image.naturalWidth, asset.image.naturalHeight, rows, cols, position);
    drawFrame(canvas.current, asset.image, frame);
  }, [asset, frames, position, sheet, rows, cols]);

  if (failed) return <div className="om-empty" role="status"><p>{t(atlas ? 'Check the atlas frames and companion image path.' : 'Preview unavailable')}</p><Button variant="ghost" onClick={() => setAttempt(n => n + 1)}>{t('Retry')}</Button></div>;
  if (!asset) return <Skeleton className="w-full h-full" />;
  function seek(next: number) { setPlaying(false); setIndex(next); }
  const field = (label: string, value: number, maximum: number, update: (value: number) => void) => <div className="om-inspector-field">
    <span>{t(label)}</span><NumberField label={t(label)} min={1} max={maximum} step={1} value={value}
      onCommit={next => update(Math.min(maximum, Math.max(1, Math.floor(next))))} />
  </div>;
  const frame = sheet ? frames?.[position] ?? gridFrame(asset.image.naturalWidth, asset.image.naturalHeight, rows, cols, position) : undefined;
  const aspect = frame ? frame.width / frame.height : asset.image.naturalWidth / asset.image.naturalHeight;
  return <div className="om-game-preview-inspector">
    <div className="om-inspector-stage motion-asset-stage" style={{ '--asset-aspect': aspect } as CSSProperties}>
      {sheet ? <canvas ref={canvas} aria-label={frames?.[position]?.name || path} className="om-inspector-image motion-color-checkerboard [image-rendering:pixelated]" /> : <img src={asset.image.src} alt={path} className="om-inspector-image motion-color-checkerboard" />}
    </div>
    <div className="om-inspector-footer">
      <div className="om-inspector-options">
        {!atlas && <Button type="button" variant="ghost" aria-pressed={sheet} icon={<RemixIcon name="grid-line" size={16} />} onClick={() => { setSheet(!sheet); setPlaying(false); }}>{t('Sprite sheet')}</Button>}
        {actions && actions.length > 1 && <Select className="om-inspector-select" label={t('Animation')} value={String(actionIndex)} modal={false} options={actions.map(({ name }, i) => ({ label: name, value: String(i) }))} onCommit={value => { seek(0); setActionIndex(Number(value)); }} />}
        {sheet && <Popover side="top" align="start" modal={false} aria-label={t('Settings')} className="om-inspector-settings" trigger={
          <Button type="button" variant="ghost" aria-label={t('Settings')} title={t('Settings')} icon={<RemixIcon name="equalizer-line" size={15} />}>{fps} fps</Button>
        }>
          {field('Frame rate', fps, 60, setFps)}
          {!atlas && <>{field('Sprite rows', rows, Math.min(asset.image.naturalHeight, 256), setRows)}{field('Sprite columns', cols, Math.min(asset.image.naturalWidth, 256), setCols)}</>}
        </Popover>}
      </div>
      {sheet && <div className="om-inspector-transport">
        <InspectorAction label={t(playing ? 'Pause' : 'Play')} icon={playing ? 'pause-fill' : 'play-fill'} disabled={count < 2} onClick={() => setPlaying(!playing)} />
        <InspectorAction label={t('Previous frame')} icon="skip-left-line" disabled={count < 2} onClick={() => seek((position + count - 1) % count)} />
        <InspectorAction label={t('Next frame')} icon="skip-right-line" disabled={count < 2} onClick={() => seek((position + 1) % count)} />
        <Slider className="flex-1" label={t('Animation position')} min={1} max={Math.max(2, count)} step={1} value={position + 1} disabled={count < 2} onPreview={n => seek(n - 1)} onCommit={n => seek(n - 1)} />
        <span className="om-inspector-counter" title={frames?.[position]?.name}>{position + 1} / {count}</span>
      </div>}
    </div>
  </div>;
}
