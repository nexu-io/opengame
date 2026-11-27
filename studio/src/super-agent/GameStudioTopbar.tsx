import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { Slider } from 'open-design-ui/slider';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  NEW_VIEWER_TAB_ID,
  artifactCanonicalAddress,
  isPlayableAdArtifact,
  type SuperAgentArtifact,
  type SuperAgentResourceAttachment,
} from '../../../shared/super-agent';
import { Popover } from '../components/ui/Popover';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { resourceIcon } from './ResourcePickerDialog';

export type GameStudioTabId = 'preview' | 'code' | 'publish' | 'trailer' | 'cloud';

export interface GameStudioTabDescriptor {
  id: GameStudioTabId;
  label: string;
  icon: string;
  /** Reserved slots (such as Cloud services) stay off until their backend panel is wired. */
  enabled: boolean;
}

export const GAME_STUDIO_TAB_REGISTRY: readonly GameStudioTabDescriptor[] = [
  { id: 'preview', label: 'Preview', icon: 'eye-line', enabled: true },
  { id: 'code', label: 'Code', icon: 'code-s-slash-line', enabled: true },
  { id: 'publish', label: 'Publish', icon: 'upload-2-line', enabled: true },
  { id: 'trailer', label: 'Trailer', icon: 'film-line', enabled: true },
  { id: 'cloud', label: 'Cloud', icon: 'cloud-line', enabled: false },
];

export interface GameStudioTopbarProps {
  active: boolean;
  activeTab: GameStudioTabId;
  activeArtifact: SuperAgentArtifact | null;
  openTabs: SuperAgentArtifact[];
  showNewTab: boolean;
  expanded: boolean;
  hasCodeView: boolean;
  hasPublishView: boolean;
  hasTrailerView: boolean;
  hasPublished?: boolean;
  targetIcon: string;
  targetDisplayLabel: string;
  addressDraft: string;
  onAddressDraftChange: (next: string) => void;
  onSubmitAddress: (raw: string) => void;
  normalizeAddress: (raw: string) => string | null;
  quickOpenItems: SuperAgentResourceAttachment[];
  webTabTitles: Record<string, string>;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onOpenResource: (item: SuperAgentResourceAttachment) => void;
  onSelectStudioTab: (tab: GameStudioTabId) => void;
  onToggleExpand: () => void;
  onClosePane: () => void;
  showAudioControl?: boolean;
  audioMuted?: boolean;
  audioVolume?: number;
  onToggleAudioMute?: () => void;
  onChangeAudioVolume?: (volume: number) => void;
  externalHref?: string;
  viewerProgressLoading?: boolean;
  compactToolbar?: boolean;
  viewportNode?: ReactNode;
  annotateNode?: ReactNode;
  screenshotNode?: ReactNode;
  consoleNode?: ReactNode;
  browserMenuNode?: ReactNode;
  remixNode?: ReactNode;
  shareNode?: ReactNode;
  publishNode?: ReactNode;
  tabIconFor: (artifact: SuperAgentArtifact) => string;
}

function tabSubtitle(item: SuperAgentArtifact, t: (key: string) => string): string {
  if (isPlayableAdArtifact(item)) return t('Ad-revenue game');
  return item.subtitle || artifactCanonicalAddress(item);
}

/**
 * Single-row Lovable-style Game Studio topbar.
 * Left: expand-on-active Studio view pills (Preview / Code / Publish / Trailer, plus reserved Cloud slot).
 * Center: integrated browser-capable preview bar (device viewport, nav/reload, unified tab + URL switcher, external link).
 * Right: game share & publish CTAs + pane window controls.
 */
export function GameStudioTopbar({
  active,
  activeTab,
  activeArtifact,
  openTabs,
  showNewTab,
  expanded,
  hasCodeView,
  hasPublishView,
  hasTrailerView,
  hasPublished = false,
  targetIcon,
  targetDisplayLabel,
  addressDraft,
  onAddressDraftChange,
  onSubmitAddress,
  normalizeAddress,
  quickOpenItems,
  webTabTitles,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onOpenResource,
  onSelectStudioTab,
  onToggleExpand,
  onClosePane,
  showAudioControl = false,
  audioMuted = false,
  audioVolume = 1,
  onToggleAudioMute,
  onChangeAudioVolume,
  externalHref,
  viewerProgressLoading = false,
  compactToolbar = false,
  viewportNode,
  annotateNode,
  screenshotNode,
  consoleNode,
  browserMenuNode,
  remixNode,
  shareNode,
  publishNode,
  tabIconFor,
}: GameStudioTopbarProps) {
  const { t } = useI18n();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSwitcherOpen(false);
    setAudioMenuOpen(false);
    setSearchTouched(false);
  }, [active, activeTab, activeArtifact?.id, showNewTab]);

  useEffect(() => {
    if (!switcherOpen && !audioMenuOpen) return;
    const onWindowBlur = () => {
      setSwitcherOpen(false);
      setAudioMenuOpen(false);
      setSearchTouched(false);
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [switcherOpen, audioMenuOpen]);

  const isAudioSilent = audioMuted || audioVolume <= 0.001;
  const audioPercent = isAudioSilent ? 0 : Math.round(audioVolume * 100);
  const audioIcon = isAudioSilent
    ? 'volume-mute-line'
    : audioVolume >= 0.5
      ? 'volume-up-line'
      : 'volume-down-line';

  const visibleTabs = useMemo(() => {
    return GAME_STUDIO_TAB_REGISTRY.filter(item => {
      if (!item.enabled) return false;
      if (item.id === 'code') return hasCodeView;
      if (item.id === 'publish') return hasPublishView;
      if (item.id === 'trailer') return hasTrailerView;
      return true;
    });
  }, [hasCodeView, hasPublishView, hasTrailerView]);

  const activeTabMeta = visibleTabs.find(item => item.id === activeTab) ?? visibleTabs[0];
  const isWebOrNewTab = activeArtifact?.kind === 'web' || showNewTab;
  const trimmedDraft = addressDraft.trim();
  const normalizedDraft = trimmedDraft ? normalizeAddress(trimmedDraft) : null;
  const filterQuery = searchTouched ? trimmedDraft.toLowerCase() : '';
  const showAddressSuggestions = Boolean(
    searchTouched
    && trimmedDraft
    && !/^(?:design|motion|game|export|asset|brand):\/\//i.test(trimmedDraft),
  );
  const filteredOpenTabs = useMemo(() => {
    if (!filterQuery) return openTabs;
    return openTabs.filter(tab => {
      const title = (tab.kind === 'web' ? (webTabTitles[tab.id] || tab.title) : tab.title).toLowerCase();
      const subtitle = tabSubtitle(tab, t).toLowerCase();
      const url = (tab.url ?? '').toLowerCase();
      return title.includes(filterQuery) || subtitle.includes(filterQuery) || url.includes(filterQuery);
    });
  }, [filterQuery, openTabs, webTabTitles, t]);
  const matchedResources = useMemo(() => {
    if (!showAddressSuggestions) return [];
    const q = trimmedDraft.toLowerCase();
    return quickOpenItems
      .filter(item => `${item.title} ${item.subtitle ?? ''}`.toLowerCase().includes(q))
      .slice(0, 3);
  }, [quickOpenItems, showAddressSuggestions, trimmedDraft]);

  return (
    <header className="om-sa-viewer-toolbar om-sa-game-studio-bar" data-game-studio>
      <div className="om-sa-game-studio-tabs" role="tablist" aria-label={t('Game Studio views')}>
        {visibleTabs.map(tab => {
          const isActive = activeTab === tab.id;
          const showPublishDot = tab.id === 'publish' && hasPublished;
          return (
            <Tooltip key={tab.id} label={t(tab.label)}>
              <Button
                variant="plain"
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={t(tab.label)}
                className="om-sa-game-studio-tab"
                data-tab-id={tab.id}
                data-active={isActive || undefined}
                onClick={() => onSelectStudioTab(tab.id)}
              >
                <RemixIcon name={tab.icon} size={14} />
                <span className="om-sa-game-tab-label">{t(tab.label)}</span>
                {showPublishDot && (
                  <span className="om-sa-game-tab-dot" aria-hidden="true" />
                )}
              </Button>
            </Tooltip>
          );
        })}
      </div>

      <div className="om-sa-game-studio-center">
        {activeTab === 'preview' ? (
          <>
            <div className="om-sa-game-browser-bar">
              {viewportNode}

              <div className="om-sa-nav-btns">
                {isWebOrNewTab && (
                  <>
                    <Tooltip label={t('Back')}>
                      <IconButton
                        variant="ghost"
                        className="motion-icon-button"
                        aria-label={t('Back')}
                        disabled={activeArtifact?.kind !== 'web' || !canGoBack}
                        onClick={onBack}
                        icon={<RemixIcon name="arrow-left-line" size={14} />}
                      />
                    </Tooltip>
                    <Tooltip label={t('Forward')}>
                      <IconButton
                        variant="ghost"
                        className="motion-icon-button"
                        aria-label={t('Forward')}
                        disabled={activeArtifact?.kind !== 'web' || !canGoForward}
                        onClick={onForward}
                        icon={<RemixIcon name="arrow-right-line" size={14} />}
                      />
                    </Tooltip>
                  </>
                )}
                <Tooltip label={t('Reload')}>
                  <IconButton
                    variant="ghost"
                    className="motion-icon-button"
                    aria-label={t('Reload')}
                    disabled={!activeArtifact}
                    onClick={onReload}
                    icon={<RemixIcon name="refresh-line" size={14} />}
                  />
                </Tooltip>
              </div>

              <Popover
                open={switcherOpen}
                onOpenChange={nextOpen => {
                  setSwitcherOpen(nextOpen);
                  setSearchTouched(false);
                  if (nextOpen) {
                    requestAnimationFrame(() => urlInputRef.current?.select());
                  }
                }}
                side="bottom"
                align="center"
                aria-label={t('Switch preview tab or enter URL')}
                tooltip={t('Switch preview tab or enter URL')}
                className="om-sa-game-switcher-popover"
                trigger={
                  <Button
                    variant="plain"
                    type="button"
                    className="om-sa-game-target-trigger"
                    data-active={switcherOpen || undefined}
                    aria-label={t('Switch preview tab or enter URL')}
                    aria-expanded={switcherOpen}
                  >
                    <RemixIcon name={targetIcon} size={13} />
                    <span className="om-sa-game-target-label">
                      {targetDisplayLabel || t('New tab')}
                    </span>
                    {openTabs.length > 1 && (
                      <span className="om-sa-game-tab-count" aria-label={t('Open tabs')}>
                        {openTabs.length}
                      </span>
                    )}
                    <RemixIcon name="arrow-down-s-line" size={13} className="om-sa-device-caret" />
                  </Button>
                }
              >
                <div className="om-sa-game-switcher-body">
                  <form
                    className="om-sa-game-url-form"
                    onSubmit={event => {
                      event.preventDefault();
                      setSwitcherOpen(false);
                      onSubmitAddress(addressDraft);
                    }}
                  >
                    <RemixIcon name={normalizedDraft ? 'global-line' : 'search-line'} size={14} />
                    <input
                      ref={urlInputRef}
                      data-panel-search-input=""
                      value={addressDraft}
                      placeholder={t('Search web, artifacts, or enter a URL')}
                      aria-label={t('Artifact address bar')}
                      onChange={event => {
                        setSearchTouched(true);
                        onAddressDraftChange(event.target.value);
                      }}
                    />
                    {addressDraft.length > 0 && (
                      <IconButton
                        variant="plain"
                        className="om-sa-game-url-clear"
                        aria-label={t('Clear')}
                        onClick={() => {
                          setSearchTouched(true);
                          onAddressDraftChange('');
                          urlInputRef.current?.focus();
                        }}
                        icon={<RemixIcon name="close-line" size={12} />}
                      />
                    )}
                  </form>

                  <div className="om-sa-game-switcher-scroll">
                    {showAddressSuggestions && (
                      <div className="om-sa-game-switcher-section" role="listbox" aria-label={t('Suggestions')}>
                        {normalizedDraft ? (
                          <Button
                            variant="plain"
                            type="button"
                            className="om-sa-suggest-row"
                            onClick={() => {
                              setSwitcherOpen(false);
                              onSubmitAddress(normalizedDraft);
                            }}
                          >
                            <RemixIcon name="global-line" size={14} />
                            <span className="om-sa-suggest-query">{normalizedDraft}</span>
                            <small>{t('Open URL')}</small>
                          </Button>
                        ) : (
                          <Button
                            variant="plain"
                            type="button"
                            className="om-sa-suggest-row"
                            onClick={() => {
                              setSwitcherOpen(false);
                              onSubmitAddress(trimmedDraft);
                            }}
                          >
                            <RemixIcon name="search-line" size={14} />
                            <span className="om-sa-suggest-query">{trimmedDraft}</span>
                            <small>{t('Search the web')}</small>
                          </Button>
                        )}
                        {matchedResources.map(item => (
                          <Button
                            key={`game-suggest:${item.kind}:${item.id}`}
                            variant="plain"
                            type="button"
                            className="om-sa-suggest-row"
                            onClick={() => {
                              setSwitcherOpen(false);
                              onOpenResource(item);
                            }}
                          >
                            <RemixIcon name={resourceIcon(item)} size={14} />
                            <span className="om-sa-suggest-query">{item.title}</span>
                            <small>{item.subtitle || item.kind}</small>
                          </Button>
                        ))}
                      </div>
                    )}

                    {filteredOpenTabs.length > 0 && (
                      <div className="om-sa-game-switcher-section">
                        <span className="om-sa-game-switcher-heading">{t('Open tabs')}</span>
                        <div className="om-sa-game-tab-list" role="menu" aria-label={t('Viewer tabs')}>
                          {filteredOpenTabs.map(tab => {
                            const isCurrent = !showNewTab && activeArtifact?.id === tab.id;
                            const tabTitle = tab.kind === 'web' ? (webTabTitles[tab.id] || tab.title) : tab.title;
                            return (
                              <div
                                key={tab.id}
                                className="om-sa-game-tab-row"
                                data-active={isCurrent || undefined}
                              >
                                <Button
                                  variant="plain"
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={isCurrent}
                                  className="om-sa-game-tab-select"
                                  onClick={() => {
                                    setSwitcherOpen(false);
                                    onSelectTab(tab.id);
                                  }}
                                >
                                  <RemixIcon name={tabIconFor(tab)} size={14} />
                                  <span className="om-sa-game-tab-text">
                                    <strong>{tabTitle}</strong>
                                    <small>{tabSubtitle(tab, t)}</small>
                                  </span>
                                  {isCurrent && <RemixIcon name="check-line" size={14} className="om-sa-game-tab-check" />}
                                </Button>
                                <IconButton
                                  variant="plain"
                                  className="om-sa-game-tab-close"
                                  aria-label={t('Close tab')}
                                  onClick={() => onCloseTab(tab.id)}
                                  icon={<RemixIcon name="close-line" size={12} />}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {!showNewTab && (
                    <div className="om-sa-game-switcher-footer">
                      <Button
                        variant="plain"
                        type="button"
                        className="om-sa-game-newtab-action"
                        onClick={() => {
                          setSwitcherOpen(false);
                          onNewTab();
                        }}
                      >
                        <RemixIcon name="add-line" size={14} />
                        <span>{t('New tab')}</span>
                      </Button>
                    </div>
                  )}
                </div>
              </Popover>

              {showAudioControl && onToggleAudioMute && onChangeAudioVolume && (
                <Popover
                  open={audioMenuOpen}
                  onOpenChange={setAudioMenuOpen}
                  openOnHover
                  side="bottom"
                  align="center"
                  initialFocus={false}
                  aria-label={t('Preview volume')}
                  className="om-sa-game-audio-popover"
                  trigger={
                    <IconButton
                      variant="ghost"
                      className="motion-icon-button om-sa-game-audio-btn"
                      data-muted={isAudioSilent || undefined}
                      aria-label={t(isAudioSilent ? 'Unmute audio' : 'Mute audio')}
                      aria-pressed={isAudioSilent}
                      onClick={() => onToggleAudioMute()}
                      icon={<RemixIcon name={audioIcon} size={14} />}
                    />
                  }
                >
                  <div className="om-sa-game-audio-controls">
                    <IconButton
                      variant="ghost"
                      className="motion-icon-button om-sa-game-audio-inner-btn"
                      data-muted={isAudioSilent || undefined}
                      aria-label={t(isAudioSilent ? 'Unmute audio' : 'Mute audio')}
                      aria-pressed={isAudioSilent}
                      onClick={() => onToggleAudioMute()}
                      icon={<RemixIcon name={audioIcon} size={14} />}
                    />
                    <Slider
                      label={t('Preview volume')}
                      min={0}
                      max={100}
                      step={1}
                      value={audioPercent}
                      onPreview={value => onChangeAudioVolume(value / 100)}
                      onCommit={value => onChangeAudioVolume(value / 100)}
                      className="om-sa-game-audio-slider"
                    />
                    <span className="om-sa-game-audio-pct">{audioPercent}%</span>
                  </div>
                </Popover>
              )}

              {externalHref && (
                <Tooltip label={t('Open external')}>
                  <IconButton
                    variant="ghost"
                    className="motion-icon-button om-sa-game-external-btn"
                    aria-label={t('Open external')}
                    onClick={() => window.open(externalHref, '_blank', 'noopener,noreferrer')}
                    icon={<RemixIcon name="external-link-line" size={14} />}
                  />
                </Tooltip>
              )}
            </div>

            {(annotateNode || (!compactToolbar && screenshotNode) || consoleNode) && (
              <div className="om-sa-tool-group">
                {annotateNode}
                {!compactToolbar && screenshotNode}
                {consoleNode}
              </div>
            )}
          </>
        ) : (
          <div className="om-sa-game-context-title">
            {activeArtifact && (
              <>
                <span className="om-sa-game-context-name">{activeArtifact.title}</span>
                <span className="om-sa-game-context-sep" aria-hidden="true">·</span>
              </>
            )}
            <span>{t(activeTabMeta.label)}</span>
          </div>
        )}
      </div>

      <div className="om-sa-game-studio-actions">
        {remixNode}
        {shareNode}
        {publishNode}
        {browserMenuNode}

        {(remixNode || shareNode || publishNode || browserMenuNode) && (
          <span className="om-sa-toolbar-divider" aria-hidden="true" />
        )}

        <div className="om-sa-viewer-win-actions">
          <Tooltip label={t(expanded ? 'Restore viewer' : 'Expand viewer')}>
            <IconButton
              variant="ghost"
              className="motion-icon-button"
              aria-label={t(expanded ? 'Restore viewer' : 'Expand viewer')}
              onClick={onToggleExpand}
              icon={<RemixIcon name={expanded ? 'fullscreen-exit-line' : 'fullscreen-line'} size={15} />}
            />
          </Tooltip>
          <Tooltip label={t('Close viewer')}>
            <IconButton
              variant="ghost"
              className="motion-icon-button"
              aria-label={t('Close viewer')}
              onClick={onClosePane}
              icon={<RemixIcon name="close-line" size={16} />}
            />
          </Tooltip>
        </div>
      </div>

      {viewerProgressLoading && (
        <div className="om-sa-viewer-progress" role="progressbar" aria-label={t('Loading…')} />
      )}
    </header>
  );
}
export { NEW_VIEWER_TAB_ID };
