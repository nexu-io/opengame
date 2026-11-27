const gameMaterialsSaveSection = [
  '### 4. Save and confirm',
  '',
  '- Inspect existing workspace assets with `openmotion_asset_manage` (`action: "list"` or `"get"`) or `openmotion_assets_use` before organizing or renaming material.',
  '- Pass the chosen `name` when generating or importing workspace library material through `openmotion_assets_use` (`action: "generate"` or `"import"`) or `openmotion_asset_manage` (`action: "import"`).',
  '- To rename or repair an existing workspace asset, call `openmotion_asset_manage` (`action: "update"`, `assetId`, `changes: { name }`) or `openmotion_assets_use` (`action: "update"`). Do not reimport or regenerate merely to change a name.',
  '- Confirm the saved name in the operation result or a subsequent `openmotion_asset_manage` (`action: "get"`) read, and update game-relative asset paths via `opengame_write_files` only when game source code needs a new asset file.',
].join('\n');

const gameJobsStep1 = '1. For raw model execution, `openmotion_assets_use` remains fully compatible alongside `openmotion_capability_run`, `openmotion_job_manage` and `openmotion_asset_manage`. Do not invoke an undiscovered tool name or silently fall back after a failed submission.';

const gameJobsStep5 = '5. **Keep existing media jobs on their original route**: a task already submitted through `openmotion_capability_run`, `openmotion_assets_use` or `openmotion_media_use` retains its original tool, `requestId` and `jobId`. Poll `status`, `resume` or `retry_save` on that original job instead of submitting a duplicate generation.';

const gameInspectionStep2 = '2. **Adopt only verified candidates into the game**: inspect the pinned workspace asset metadata and local file path through `openmotion_asset_manage` or `openmotion_assets_use` (`action: "get"`), verify dimensions, transparency, duration or audio levels, and wire only the selected assets into the game workspace via `opengame_write_files` (or copy verified files into the game\'s `assets/` directory as instructed by `openmotion://workflow/game/start`).';

const gameInspectionHandback = 'Inside a game workflow, pass back the pinned `{assetId, versionId}` together with measured dimensions, duration or audio notes, then continue with `opengame_write_files`, `opengame_validate` and `opengame_playtest`. Generation produces candidate assets, not a finished game: generated sprites, textures, 3D models or audio never relax the active game workflow\'s visual, runtime and playtest gates.';

/**
 * Adapt shared game/media workflow Markdown for the standalone OpenGame MCP profile:
 * - Rewrite canonical `openmotion_game_*` names to exposed `opengame_*` names.
 * - Replace film-project-only media steps (`openmotion_get_project`, `openmotion_import_assets`,
 *   `openmotion_edit_project`, `openmotion_assets`) with workspace asset + game file tools exposed
 *   by the `game` profile so agents never follow guidance into `MCP_TOOL_NOT_EXPOSED`.
 */
export function adaptGameWorkflowMarkdown(documentId, content) {
  let updated = String(content).replaceAll('openmotion_game_', 'opengame_');
  const normalizedId = String(documentId || '').replaceAll('\\', '/');

  if (normalizedId.endsWith('references/materials.md')) {
    updated = updated.replace(
      /### 4\. Save and confirm[\s\S]*?(?=\n\nPlatform type-name fallbacks|\n## |$)/,
      gameMaterialsSaveSection,
    );
  } else if (normalizedId.endsWith('references/jobs.md')) {
    updated = updated
      .replace(/^1\. For raw model execution.*$/m, gameJobsStep1)
      .replace(/^5\. \*\*Keep old project tasks on their original route\*\*:.*$/m, gameJobsStep5);
  } else if (normalizedId.endsWith('references/inspection.md')) {
    updated = updated
      .replace(/^2\. \*\*Import only selected candidates into the film\*\*:.*$/m, gameInspectionStep2)
      .replace(/^Inside a film workflow, .*$/m, gameInspectionHandback);
  }

  return updated;
}

export const gameWorkflowReadNext = 'Read openmotion://workflow/game/start first (and openmotion://workflow/media/start when generating media assets). Reuse complete bodies still available, load only missing sections, and use only tools listed in tools/list. Guidance is not execution or verification evidence.';
