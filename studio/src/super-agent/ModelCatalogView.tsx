import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { motionApi } from '../motion/useWorkspace';
import { catalogDownloadPrompt, type CatalogModel } from '../../../shared/model-catalog';
import './modelCatalog.css';

const modelQueries = [
  ['Characters', 'character'], ['Animals', 'animal'], ['Vegetation', 'tree'],
  ['Buildings', 'building'], ['Furniture', 'furniture'], ['Vehicles', 'vehicle'], ['Props', 'crate'], ['Animation', 'animation'],
] as const;

const spriteQueries = [
  ['Character sprites', 'character'], ['Animation frames', 'sprite animation'], ['Visual effects', 'explosion'],
  ['Tilesets', 'tileset'], ['UI icons', 'icon'], ['Backgrounds', 'background'],
] as const;

export type CatalogDimension = '2d' | '3d';

const providersByHost: Record<string, string> = {
  '3dassets.dev': '3DAssets.dev', 'polyfork.dev': 'PolyFork', 'grab3d.com': 'Grab3D',
  'polyhaven.com': 'Poly Haven', 'blenderkit.com': 'BlenderKit', 'blendkit.com': 'BlenderKit',
  'commons.wikimedia.org': 'Wikimedia Commons', 'opengameart.org': 'OpenGameArt',
  'app.gazebosim.org': 'Gazebo Fuel', 'kenney.nl': 'Kenney', 'itch.io': 'itch.io',
};

function officialPage(model: CatalogModel) {
  if (!model.sourceUrl || !URL.canParse(model.sourceUrl)) return undefined;
  const url = new URL(model.sourceUrl);
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : undefined;
}

function providerName(model: CatalogModel) {
  const source = officialPage(model);
  if (source?.hostname.endsWith('.itch.io')) return 'itch.io';
  return source && providersByHost[source.hostname.replace(/^www\./, '')] || model.provider;
}

function ModelThumbnail({ model, preview }: { model: CatalogModel; preview: boolean }) {
  const { t } = useI18n();
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const ready = imageState === 'ready';
  return <div className="om-model-thumbnail motion-asset-stage">
    {model.thumbnailUrl && imageState !== 'failed' ? <>
      {!ready && <Skeleton className="om-model-image-placeholder" />}
      <img alt="" loading="lazy" decoding="async" src={model.thumbnailUrl} data-ready={ready} onLoad={async event => {
        const image = event.currentTarget;
        try { await image.decode?.(); setImageState('ready'); }
        catch { setImageState('failed'); }
      }} onError={() => setImageState('failed')} />
    </> : <span className="om-model-image-fallback"><RemixIcon name="stack-line" size={24} />{t('Preview unavailable')}</span>}
    {preview && ready && <Dialog.Root>
      <Dialog.Trigger render={<Button variant="secondary" size="sm" className="om-model-preview-button" />}>
        {t('Preview image')}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="om-sa-lightbox-backdrop" />
        <Dialog.Popup className="om-sa-lightbox-popup">
          <div className="om-sa-lightbox-head">
            <div className="om-sa-lightbox-title">
              <Dialog.Title className="om-sa-lightbox-heading">{model.title}</Dialog.Title>
              <span className="om-sa-lightbox-sub">{t('Preview image')} · {providerName(model)}</span>
            </div>
            <Dialog.Close render={<IconButton variant="ghost" aria-label={t('Close')} icon={<RemixIcon name="close-line" size={16} />} />} />
          </div>
          <div className="om-sa-lightbox-stage"><img className="om-sa-lightbox-img" src={model.thumbnailUrl} alt={model.title} /></div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>}
  </div>;
}

type Notify = (message: string, tone: 'info' | 'error') => void;

function CatalogPlaceholders({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => <li key={index} aria-hidden="true" className="om-model-placeholder">
    <Skeleton className="om-model-thumbnail" />
    <div className="om-model-details">
      <div className="om-model-placeholder-title"><Skeleton animated={false} /></div>
      <div className="om-model-credit"><Skeleton animated={false} /></div>
      <Skeleton className="om-model-placeholder-action" animated={false} />
    </div>
  </li>);
}

export function ModelCatalogView({ query, dimension, conversationId, onAskAgent, onDimension, onQuery, reloadKey, acquire, notify }: {
  query: string;
  dimension: CatalogDimension;
  conversationId?: string;
  onAskAgent?: (conversationId: string, prompt: string) => void;
  onDimension: (dimension: CatalogDimension) => void;
  onQuery: (query: string) => void;
  reloadKey: number;
  acquire: (id: string) => Promise<void>;
  notify?: Notify;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(query);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<CatalogModel[] | 'failed' | 'loading'>('loading');
  const [more, setMore] = useState<'end' | 'ready' | 'loading' | 'manual' | 'failed'>('end');
  const loadMore = useRef<() => void>(() => {});
  const sentinel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const [appendCount, setAppendCount] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [failedImports, setFailedImports] = useState<Set<string>>(() => new Set());
  const is2d = dimension === '2d';
  const browseQueries = is2d ? spriteQueries : modelQueries;
  useEffect(() => {
    const controller = new AbortController();
    const cards = new Map<string, CatalogModel>();
    const consumed = new Set<string>();
    let cursor: string | null = null;
    let busy = false;
    let placeholderTimer: ReturnType<typeof setTimeout> | undefined;
    setResults('loading');
    setAppendCount(0);
    setMore('end');
    async function load(first = false) {
      if (busy || controller.signal.aborted) return;
      busy = true;
      if (!first) {
        setMore('loading');
        placeholderTimer = setTimeout(() => {
          const tracks = grid.current && getComputedStyle(grid.current).gridTemplateColumns;
          const columns = tracks?.match(/[\d.]+px/g)?.length || 2;
          const firstCard = grid.current?.firstElementChild;
          const featured = firstCard && getComputedStyle(firstCard).display === 'grid';
          const occupied = cards.size + (featured ? 1 : 0);
          setAppendCount(columns + (columns - occupied % columns) % columns);
        }, 120);
      }
      const path = `/model-catalog/search?q=${encodeURIComponent(query)}${is2d ? '&dimension=2d' : ''}`;
      try {
        const page = await motionApi<{ models: CatalogModel[]; nextCursor?: string | null }>(path + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (cursor) consumed.add(cursor);
        const before = cards.size;
        for (const model of page.models) if (!cards.has(model.id)) cards.set(model.id, model);
        cursor = page.nextCursor && !consumed.has(page.nextCursor) ? page.nextCursor : null;
        setResults([...cards.values()]);
        setMore(!cursor ? 'end' : cards.size > before ? 'ready' : 'manual');
      } catch (error) {
        if (controller.signal.aborted) return;
        if (first) setResults('failed');
        else {
          if (error instanceof Error && error.message.includes('Catalog cursor expired')) { cursor = null; consumed.clear(); }
          setMore('failed');
        }
      } finally {
        busy = false;
        clearTimeout(placeholderTimer);
        if (!controller.signal.aborted) setAppendCount(0);
      }
    }
    loadMore.current = () => { void load(); };
    void load(true);
    return () => { controller.abort(); clearTimeout(placeholderTimer); };
  }, [query, is2d, attempt, reloadKey]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || more !== 'ready' || typeof IntersectionObserver === 'undefined') return;
    let root = target.parentElement;
    while (root && !/^(auto|scroll|overlay)$/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const load = loadMore.current;
    let active = true;
    let observer: IntersectionObserver | undefined;
    let margin = 0;
    function observe() {
      if (!active || document.hidden) { observer?.disconnect(); observer = undefined; return; }
      const height = root ? root.clientHeight : window.innerHeight;
      const nextMargin = Math.round(Math.max(320, Math.min(1200, height * 0.9)));
      if (observer && margin === nextMargin) return;
      margin = nextMargin;
      observer?.disconnect();
      observer = new IntersectionObserver((entries, source) => {
        if (active && source === observer && !document.hidden && entries.some(entry => entry.isIntersecting && entry.boundingClientRect.height > 0)) load();
      }, { root, rootMargin: `0px 0px ${margin}px 0px` });
      observer.observe(target!);
    }
    observe();
    const resize = root && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(observe) : undefined;
    if (resize && root) resize.observe(root);
    else window.addEventListener('resize', observe);
    document.addEventListener('visibilitychange', observe);
    return () => {
      active = false;
      observer?.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', observe);
      document.removeEventListener('visibilitychange', observe);
    };
  }, [more, results]);

  function search(term: string) {
    const next = term.trim();
    setResults('loading');
    setDraft(next);
    if (next === query) setAttempt(value => value + 1);
    else onQuery(next);
  }

  async function add(id: string) {
    setAdding(id);
    try { await acquire(id); }
    catch {
      setFailedImports(ids => new Set(ids).add(id));
      notify?.(t('Could not add asset'), 'error');
    }
    finally { setAdding(null); }
  }

  const category = browseQueries.find(([, term]) => query === term);
  return <section className="om-model-catalog" aria-label={t('Game asset catalog')}>
    <header className="om-model-intro">
      <span className="om-model-mark" aria-hidden="true"><RemixIcon name="stack-line" size={24} /></span>
      <div>
      <h2>{t('Game asset catalog')}</h2>
      <p className="om-model-sources">{t('Add supported assets directly or ask the Agent to download an item.')}</p>
      </div>
    </header>
    <div className="om-segmented om-model-dimensions" role="group" aria-label={t('Asset dimension')}>
      {(['2d', '3d'] as const).map(value => <Button key={value} variant="plain" className="om-nav-item"
        aria-pressed={dimension === value} onClick={() => {
          if (value === dimension) return;
          setDraft('');
          setResults('loading');
          onDimension(value);
        }}>{value.toUpperCase()}</Button>)}
    </div>
    <form className="om-control-row" onSubmit={event => {
      event.preventDefault();
      search(draft);
    }}>
      <div className="om-field om-search-field"><RemixIcon name="search-line" size={16} />
        <input type="search" maxLength={200} value={draft} onChange={e => setDraft(e.target.value)} aria-label={t('Search assets')} placeholder={t('Search assets')} />
        {(draft || query) && <IconButton type="button" variant="ghost" size="sm" aria-label={t('Clear search')} icon={<RemixIcon name="close-line" size={14} />} onClick={() => search('')} />}
      </div>
      <Button type="submit" variant="primary" size="lg" className="shrink-0">{t('Search')}</Button>
    </form>
    <div className="om-model-categories" role="group" aria-label={t('Browse by category')}>
      <Button type="button" variant="plain" className="om-button om-filter-pill" aria-pressed={!query} onClick={() => search('')}>{t('Discover')}</Button>
      {browseQueries.map(([label, term]) => <Button key={term} type="button" variant="plain" className="om-button om-filter-pill"
        aria-pressed={query === term} onClick={() => search(term)}>{t(label)}</Button>)}
    </div>
    <h3 className="om-model-shelf-title">{category ? t(category[0]) : query ? t('Results for “{query}”', { query }) : is2d ? t('Featured assets') : t('Featured models')}</h3>
    <span className="sr-only" role="status">{(results === 'loading' || more === 'loading') && t('Loading…')}</span>
    {results === 'failed' ? <div role="status">{t('Could not load assets')} <Button type="button" variant="ghost" onClick={() => setAttempt(value => value + 1)}>{t('Retry')}</Button></div>
      : Array.isArray(results) && !results.length && more === 'end' ? <p role="status">{t('No assets found')}</p>
      : <ul ref={grid} className="om-model-grid" data-discovery={!query || undefined} aria-busy={results === 'loading' || more === 'loading'}>{Array.isArray(results) && results.map(model => <li key={model.id}>
        <ModelThumbnail key={model.thumbnailUrl} model={model} preview={is2d} />
        <div className="om-model-details">
        <strong>{model.title}</strong>
        <div className="om-model-credit">
          {officialPage(model) ? <a href={officialPage(model)?.href} target="_blank" rel="noopener noreferrer">{providerName(model)} <RemixIcon name="external-link-line" size={12} /></a>
            : providerName(model)}
          {' · '}{model.license || t('License not specified')}
        </div>
        <div className="om-model-actions">
          {model.downloadable && <Button type="button" size="sm" variant="ghost" loading={adding === model.id} disabled={adding !== null} onClick={() => void add(model.id)}>{t('Add to workspace')}</Button>}
          {(!model.downloadable || failedImports.has(model.id)) && <Button type="button" variant="ghost" size="sm" disabled={!conversationId || !onAskAgent}
            onClick={() => {
              if (conversationId) onAskAgent?.(conversationId, catalogDownloadPrompt({ ...model, sourceUrl: officialPage(model)?.href }, { dimension, conversationId, locale }));
            }}>{t('Ask Agent to download')}</Button>}
        </div>
        </div>
      </li>)}<CatalogPlaceholders count={results === 'loading' ? 6 : appendCount} /></ul>}
    {Array.isArray(results) && more !== 'end' && <div ref={sentinel} className="om-control-row">
      {more === 'failed' && <span role="status">{t('Could not load assets')}</span>}
      <Button type="button" variant="ghost" aria-disabled={more === 'loading'} onClick={() => { if (more !== 'loading') loadMore.current(); }}>
        {more === 'failed' ? t('Retry') : t('Load more')}
      </Button>
    </div>}
  </section>;
}
