import type { WorkspaceStore } from '../workspace.ts';
import type { CapabilityDefinition } from '../shared/capability-registry.ts';

export type CapabilityScriptContext = {
  store: WorkspaceStore;
  capability: CapabilityDefinition;
  requestId: string;
  model?: string;
  prompt: string;
  options: Record<string, unknown>;
  parameters: Record<string, unknown>;
  references: { assetId: string; versionId: string; filename: string }[];
};

import { runOpenDesign3dScript, runOpenDesignWorldScript } from './opendesign-3d.ts';

export type CapabilityScriptOutput = {
  sourcePath: string;
  name?: string;
  cleanup?: () => Promise<void>;
  onCommitted?: () => Promise<void>;
  result?: Record<string, unknown>;
};

export type CapabilityScriptHandler = (ctx: CapabilityScriptContext) => Promise<CapabilityScriptOutput>;

/**
 * Extension point for built-in deterministic local scripts (FFmpeg audio/video tools,
 * local matting/upscale CLI wrappers, SVG/PNG processors, etc.).
 *
 * To add a local script capability:
 * 1. Register `[scriptId]: async (ctx) => ({ sourcePath, name, cleanup })` below.
 * 2. Set `executor: { kind: 'script', scriptId }` and `status: 'live'` on the
 *    capability entry in `shared/capability-registry.ts` (or via remote/local overrides).
 * Both Studio GUI and MCP `openmotion_capability_run` will route to it automatically.
 */
export const builtinCapabilityScripts: Record<string, CapabilityScriptHandler> = {
  'opendesign-3d': runOpenDesign3dScript,
  'opendesign-world': runOpenDesignWorldScript,
};
