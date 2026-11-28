import { useEffect, useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { Slider } from 'open-design-ui/slider';
import { InspectorAction } from './InspectorControls';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { useI18n } from '../../i18n/I18n';
import { createModelStage, graphicsHint } from './modelStage';
import { fbxGuidance, gltfGuidance } from './loadInterchange';
import type { GameAssetPreviewProps } from './formats';

type Stage = Awaited<ReturnType<typeof createModelStage>>;

export default function InterchangePreview({ path, url, resolveFileUrl }: GameAssetPreviewProps) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>();
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [clip, setClip] = useState('0'), [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let result: Stage | undefined;
    setError(''); setStage(undefined); setClip('0'); setPlaying(false); setTime(0);
    void createModelStage(host.current!, { path, url, resolveFileUrl }, controller.signal).then(value => {
      result = value;
      if (controller.signal.aborted) result.dispose(); else setStage(value);
    }).catch(reason => {
      if (controller.signal.aborted) return;
      if (reason instanceof Error && reason.message === graphicsHint) setError(graphicsHint);
      else setError(/\.gltf$/i.test(path) ? gltfGuidance : /\.fbx$/i.test(path) ? fbxGuidance : 'Preview unavailable');
    });
    return () => { controller.abort(); result?.dispose(); };
  }, [path, url, resolveFileUrl, attempt]);
  useEffect(() => {
    if (!stage || !playing) return;
    const timer = window.setInterval(() => setTime(stage.time()), 100);
    return () => clearInterval(timer);
  }, [stage, playing]);
  const duration = stage?.clips[Number(clip)]?.duration || 0;
  function seek(seconds: number) { stage?.seek(seconds); setTime(seconds); setPlaying(false); }
  return <div className="om-game-preview-inspector">
    <div className="om-inspector-stage motion-asset-stage">
      <div ref={host} className="absolute inset-0" role="img" aria-label={path} title={t('Drag to orbit. Scroll or pinch to zoom.')} />
      {!stage && !error && <Skeleton className="absolute inset-0" />}
      {error && <div className="om-empty absolute inset-0" role="status"><p>{t(error)}</p><Button variant="ghost" onClick={() => setAttempt(n => n + 1)}>{t('Retry')}</Button></div>}
    </div>
    {stage && <div className="om-inspector-footer">
      <div className="om-inspector-options">
        <InspectorAction label={t('Fit model')} icon="focus-3-line" onClick={stage.fit} />
        {stage.clips.length > 1 && <Select className="om-inspector-select" label={t('Animation')} value={clip} modal={false} options={stage.clips.map((item: { name: string }, index: number) => ({ value: String(index), label: item.name || String(index + 1) }))} onCommit={value => { stage.select(Number(value)); setClip(value); setTime(0); }} />}
      </div>
      {!!stage.clips.length && <div className="om-inspector-transport">
        <InspectorAction label={t(playing ? 'Pause' : 'Play')} icon={playing ? 'pause-fill' : 'play-fill'} onClick={() => { stage.play(!playing); setPlaying(!playing); }} />
        <Slider className="flex-1" label={t('Animation position')} value={Math.min(duration, time)} min={0} max={duration || 1} step={0.01} disabled={!duration} onPreview={seek} onCommit={seek} />
        <span className="om-inspector-counter">{time.toFixed(1)} / {t('{value}s', { value: duration.toFixed(1) })}</span>
      </div>}
      {stage.note && <span className="om-muted">{t(stage.note)}</span>}
    </div>}
  </div>;
}
