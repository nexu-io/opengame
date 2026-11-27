export const MAX_ASSET_BYTES = 500_000_000;

/** Source-image acceptance cap for OpenDesign reference inputs (covers AMR's 25 MiB output ceiling and OPEND-5519's 30 MiB upload cap). */
export const OPEN_DESIGN_MAX_SOURCE_REFERENCE_BYTES = 30 * 1024 * 1024;
/** Target byte ceiling when browser-converting unsupported-but-decodable or >30 MiB files into a library reference. */
export const OPEN_DESIGN_TARGET_SOURCE_REFERENCE_BYTES = Math.floor(OPEN_DESIGN_MAX_SOURCE_REFERENCE_BYTES * 0.95);
/** Per-image rollout soft budget for sending originals to OpenDesign AMR before upstream provider URL fetches. */
export const OPEN_DESIGN_UPLOAD_SOFT_BUDGET_BYTES = 8 * 1024 * 1024;
/** Per-job total rollout soft budget across all uploaded reference images in one OpenDesign submission. */
export const OPEN_DESIGN_JOB_UPLOAD_BUDGET_BYTES = 32 * 1024 * 1024;
/** Legacy pre-OPEND-5519 AMR upload limit learned when an origin rejects with HTTP 413 asset_too_large. */
export const OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024;
/** Target byte ceiling when adapting a reference image to fit the legacy 2 MiB AMR upload limit (~95% headroom). */
export const OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES = 1_940_000;
/** Local safety cap for non-OpenDesign adapters (such as local Codex CLI). */
export const LOCAL_ADAPTER_MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export function isAssetFileWithinLimit(file: { isFile(): boolean; size: number }) {
  return file.isFile() && file.size <= MAX_ASSET_BYTES;
}
