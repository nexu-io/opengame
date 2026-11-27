import type { HyperframeLintFinding } from '@hyperframes/core/lint';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { runHyperframes } from '../hyperframes.ts';

export type ExportLintFinding = Pick<HyperframeLintFinding, 'code' | 'message' | 'file' | 'line' | 'column' | 'fixHint'>;

/** Inspect the same hydrated version while it is still available, before snapshot cleanup. */
export async function diagnoseFailedRender(
  runtimeRoot: string,
  directory: string,
  compositionPath: string,
  signal?: AbortSignal,
): Promise<ExportLintFinding[]> {
  const target = compositionPath === 'index.html' ? '.' : compositionPath;
  const root = await realpath(directory);
  const report = await runHyperframes(runtimeRoot, root, ['lint', target, '--json'], 30_000, undefined, signal);
  const { findings, filesScanned } = JSON.parse(report.stdout);
  if (!filesScanned || !Array.isArray(findings)) throw new Error('Missing native lint findings');
  return exportLintErrors(root, findings);
}

export function exportLintErrors(root: string, findings: HyperframeLintFinding[]): ExportLintFinding[] {
  const errors: ExportLintFinding[] = [];
  for (const finding of findings) {
    if (finding?.severity !== 'error' || typeof finding.code !== 'string' || typeof finding.message !== 'string') continue;
    const file = typeof finding.file === 'string'
      ? path.relative(root, path.resolve(root, finding.file)).split(path.sep).join('/')
      : undefined;
    errors.push({
      code: finding.code,
      message: finding.message,
      ...(file && !path.isAbsolute(file) && !file.startsWith('../') && file !== '..' ? { file } : {}),
      ...(Number.isInteger(finding.line) && { line: finding.line }),
      ...(Number.isInteger(finding.column) && { column: finding.column }),
      ...(typeof finding.fixHint === 'string' && { fixHint: finding.fixHint }),
    });
  }
  return errors;
}
