import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelViewerElement } from '@google/model-viewer';
import { Button } from 'open-design-ui/button';
import { Slider } from 'open-design-ui/slider';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import { InspectorAction } from './gameAssetPreview/InspectorControls';
import { loadModelPreviewSource, offlineMessage } from './modelPreviewSource';
import './modelAssetPreview.css';

type Props = { src: string; title: string; animation?: string; active?: boolean };

export function ModelAssetPreview({ active = true, ...props }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    let intersecting = typeof IntersectionObserver === 'undefined';
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = intersecting ? undefined : new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      update();
    });
    observer?.observe(root.current);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return <div ref={root} className="om-model-preview om-game-preview-inspector">{active && visible && <ModelStage key={props.src} {...props} />}</div>;
}

function ModelStage({ src, title, animation }: Props) {
  const { t, locale, formatNumber } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  const viewer = useRef<ModelViewerElement | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [clips, setClips] = useState<string[]>();
  const [selection, setSelection] = useState({ name: '', requested: false });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState('1');
  const hint = t('Drag to orbit. Scroll or pinch to zoom.');
  const seconds = useMemo(() => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), [locale]);
  const clipOptions = useMemo(() => clips?.map(value => ({ value, label: value })) ?? [], [clips]);
  const speedOptions = useMemo(() => ['0.5', '1', '1.5', '2'].map(value => ({ value, label: `${formatNumber(Number(value))}×` })), [formatNumber]);

  useEffect(() => {
    const host = stage.current!;
    const controller = new AbortController();
    let element: ModelViewerElement | undefined;
    let objectUrl: string | undefined;
    const release = () => {
      element?.pause();
      element?.remove();
      viewer.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    const failed = (message: string) => {
      if (controller.signal.aborted) return;
      controller.abort();
      release();
      setClips(undefined);
      setPlaying(false);
      setError(message);
    };
    async function start() {
      const { createModelViewer } = await import('./modelPreviewRenderer');
      if (controller.signal.aborted) return;
      const source = await loadModelPreviewSource(src, controller.signal);
      objectUrl = source.objectUrl;
      if (controller.signal.aborted) { URL.revokeObjectURL(objectUrl); return; }
      element = createModelViewer(source.meshopt);
      viewer.current = element;
      element.setAttribute('camera-controls', '');
      element.setAttribute('interaction-prompt', 'none');
      element.setAttribute('animation-crossfade-duration', '0');
      element.setAttribute('loading', 'eager');
      const syncPlayback = () => {
        setPlaying(!element!.paused);
        setTime(element!.currentTime);
      };
      for (const event of ['play', 'pause', 'finished']) {
        element.addEventListener(event, syncPlayback, { signal: controller.signal });
      }
      const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      motionPreference.addEventListener('change', () => {
        if (motionPreference.matches) element?.pause();
      }, { signal: controller.signal });
      // A browser without WebGL can finish parsing the GLB without ever rendering it.
      let hasEnvironment = false;
      element.addEventListener('environment-change', () => { hasEnvironment = true; }, { signal: controller.signal });
      element.addEventListener('load', () => {
        if (hasEnvironment) setClips(element!.availableAnimations);
        else failed('Preview unavailable');
      }, { signal: controller.signal });
      element.addEventListener('error', () => failed('Preview unavailable'), { signal: controller.signal });
      host.append(element);
      element.src = objectUrl;
    }
    void start().catch(reason => failed(reason?.message === offlineMessage ? offlineMessage : 'Preview unavailable'));
    return () => { controller.abort(); release(); };
  }, [src, attempt]);

  useEffect(() => {
    if (viewer.current) {
      viewer.current.alt = title;
      viewer.current.setAttribute('a11y', JSON.stringify({ 'interaction-prompt': hint }));
    }
  }, [clips, title, hint]);

  useEffect(() => {
    if (clips) {
      const requested = !!animation && clips.includes(animation);
      setSelection({ name: requested ? animation : clips[0] ?? '', requested });
    }
  }, [animation, clips]);

  useEffect(() => {
    if (clips && viewer.current) viewer.current.timeScale = Number(speed);
  }, [clips, speed]);

  useEffect(() => {
    const element = viewer.current;
    if (!element || !selection.name || !clips?.includes(selection.name)) return;
    let current = true;
    element.animationName = selection.name;
    void element.updateComplete.then(() => {
      if (!current) return;
      element.currentTime = 0;
      setTime(0);
      setDuration(element.duration);
      if (selection.requested) {
        if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) element.play();
        else element.pause();
      }
    });
    return () => { current = false; };
  }, [selection, clips]);

  useEffect(() => {
    if (!playing) return;
    const tick = window.setInterval(() => setTime(viewer.current?.currentTime ?? 0), 80);
    return () => clearInterval(tick);
  }, [playing]);

  function togglePlayback() {
    const element = viewer.current;
    if (!element) return;
    if (element.paused) element.play();
    else element.pause();
  }
  function seek(value: number) {
    if (!viewer.current) return;
    viewer.current.pause();
    // A looping clip wraps to frame zero at exactly its duration.
    const target = value === duration ? Math.max(0, duration - 0.000001) : value;
    // Three's mixer applies timeScale while seeking with setTime().
    viewer.current.currentTime = target / viewer.current.timeScale;
    setTime(value);
  }
  return <>
    <div className="om-model-stage om-inspector-stage motion-asset-stage" ref={stage} title={hint} aria-busy={!error && !clips}>
      {error ? <div className="om-empty" role="status"><span>{t(error)}</span><Button type="button" variant="ghost" onClick={() => { setError(''); setAttempt(n => n + 1); }}>{t('Retry')}</Button></div>
        : !clips && <Skeleton className="absolute inset-0" />}
    </div>
    {clips && clips.length > 0 && <div className="om-model-footer om-inspector-footer">
      <div className="om-inspector-options">
        {clips.length > 1 && <Select className="om-inspector-select" label={t('Animation')} value={selection.name} options={clipOptions} onCommit={name => setSelection({ name, requested: false })} modal={false} />}
        <Select className="om-inspector-select" label={t('Playback speed')} value={speed} options={speedOptions} onCommit={setSpeed} modal={false} />
      </div>
      <div className="om-inspector-transport">
        <InspectorAction label={t(playing ? 'Pause' : 'Play')} icon={playing ? 'pause-fill' : 'play-fill'} onClick={togglePlayback} />
        <Slider className="flex-1" label={t('Animation position')} min={0} max={duration || 1} step={0.01} value={Math.min(time, duration)} disabled={!duration} onPreview={seek} onCommit={seek} />
        <span className="om-inspector-counter">{seconds.format(time)} / {t('{value}s', { value: seconds.format(duration) })}</span>
      </div>
    </div>}
  </>;
}
