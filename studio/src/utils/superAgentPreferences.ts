import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_SUPER_AGENT_PREFERENCES,
  type SuperAgentFollowUpMode,
  type SuperAgentPermissionMode,
} from '../../../shared/super-agent';
import { getSuperAgentPreferences, updateSuperAgentPreferences } from '../super-agent/superAgentClient';
import { readStudioUiPreferences, writeStudioUiPreferences } from './studioUiPreferences';

const FOLLOW_UP_EVENT = 'motion:super-agent-follow-up-change';
const AUTO_MULTIMODAL_EVENT = 'motion:super-agent-auto-multimodal-change';
const DEFAULT_FOLLOW_UP_BEHAVIOR: SuperAgentFollowUpMode = 'steer';
const DEFAULT_PERMISSION_MODE: SuperAgentPermissionMode = 'auto';
const DEFAULT_AUTO_MULTIMODAL_GENERATION = DEFAULT_SUPER_AGENT_PREFERENCES.autoMultimodalGeneration;
let autoMultimodalMutationVersion = 0;

/** Reads the persisted default approval mode (`auto` by default, or `on-request`). */
export function savedPermissionMode(): SuperAgentPermissionMode {
  const value = readStudioUiPreferences().superAgentPermissionMode;
  return value === 'on-request' ? 'on-request' : DEFAULT_PERMISSION_MODE;
}

/** Updates the persisted default approval mode for new Super Agent conversations. */
export function savePermissionMode(mode: SuperAgentPermissionMode): void {
  const normalized: SuperAgentPermissionMode = mode === 'on-request' ? 'on-request' : 'auto';
  writeStudioUiPreferences({ superAgentPermissionMode: normalized });
}

/** Reads the cached default for automatic multimodal generation (`true` by default). */
export function savedAutoMultimodalGeneration(): boolean {
  const value = readStudioUiPreferences().superAgentAutoMultimodalGeneration;
  return typeof value === 'boolean' ? value : DEFAULT_AUTO_MULTIMODAL_GENERATION;
}

/** Updates the cached preference for automatic multimodal generation and notifies listeners. */
export function setCachedAutoMultimodalGeneration(enabled: boolean): void {
  const normalized = Boolean(enabled);
  writeStudioUiPreferences({ superAgentAutoMultimodalGeneration: normalized });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTO_MULTIMODAL_EVENT));
  }
}

/** Reads the persisted default follow-up behavior (`steer` by default, or `queue`). */
export function savedFollowUpBehavior(): SuperAgentFollowUpMode {
  const value = readStudioUiPreferences().superAgentFollowUpBehavior;
  return value === 'queue' ? 'queue' : DEFAULT_FOLLOW_UP_BEHAVIOR;
}

/** Updates the persisted default follow-up behavior and notifies active listeners. */
export function setFollowUpBehavior(mode: SuperAgentFollowUpMode): void {
  const normalized: SuperAgentFollowUpMode = mode === 'queue' ? 'queue' : 'steer';
  writeStudioUiPreferences({ superAgentFollowUpBehavior: normalized });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOLLOW_UP_EVENT));
  }
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === 'hf-studio-ui-preferences') listener();
  };
  window.addEventListener(FOLLOW_UP_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(FOLLOW_UP_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

function subscribeAutoMultimodal(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === 'hf-studio-ui-preferences') listener();
  };
  window.addEventListener(AUTO_MULTIMODAL_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(AUTO_MULTIMODAL_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** React hook keeping Settings and Super Agent follow-up behavior synchronized. */
export function useFollowUpBehavior(): [SuperAgentFollowUpMode, (mode: SuperAgentFollowUpMode) => void] {
  const mode = useSyncExternalStore(subscribe, savedFollowUpBehavior, () => DEFAULT_FOLLOW_UP_BEHAVIOR);
  const update = useCallback((next: SuperAgentFollowUpMode) => {
    setFollowUpBehavior(next);
  }, []);
  return [mode, update];
}

/** React hook synchronizing automatic multimodal asset generation with the workspace service. */
export function useAutoMultimodalGeneration(): {
  enabled: boolean;
  saving: boolean;
  setEnabled: (next: boolean) => Promise<boolean>;
} {
  const enabled = useSyncExternalStore(
    subscribeAutoMultimodal,
    savedAutoMultimodalGeneration,
    () => DEFAULT_AUTO_MULTIMODAL_GENERATION,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchVersion = autoMultimodalMutationVersion;
    void getSuperAgentPreferences()
      .then(result => {
        if (!active || autoMultimodalMutationVersion !== fetchVersion) return;
        if (typeof result?.preferences?.autoMultimodalGeneration !== 'boolean') return;
        setCachedAutoMultimodalGeneration(result.preferences.autoMultimodalGeneration);
      })
      .catch(() => {
        /* Keep cached/default preference when running without a live workspace backend. */
      });
    return () => {
      active = false;
    };
  }, []);

  const setEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    const previous = savedAutoMultimodalGeneration();
    const mutationVersion = ++autoMultimodalMutationVersion;
    setCachedAutoMultimodalGeneration(next);
    setSaving(true);
    try {
      const result = await updateSuperAgentPreferences({ autoMultimodalGeneration: next });
      const committed = typeof result?.preferences?.autoMultimodalGeneration === 'boolean'
        ? result.preferences.autoMultimodalGeneration
        : next;
      if (autoMultimodalMutationVersion === mutationVersion) {
        setCachedAutoMultimodalGeneration(committed);
      }
      return true;
    } catch {
      if (autoMultimodalMutationVersion === mutationVersion) {
        setCachedAutoMultimodalGeneration(previous);
      }
      return false;
    } finally {
      if (autoMultimodalMutationVersion === mutationVersion) {
        setSaving(false);
      }
    }
  }, []);

  return { enabled, saving, setEnabled };
}
