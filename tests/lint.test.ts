import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { lintProject } from '@hyperframes/core/lint';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { inspectProject, pluginRoot, runHyperframes } from '../hyperframes.ts';
import { diagnoseFailedRender, type ExportLintFinding } from '../shared/export-lint-diagnostics.ts';
import { renderNext } from '../server.ts';

test('Motion lint and preview reject the same structural errors as Studio before opening or rendering', () => fixture(async store => {
  let opened = 0;
  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => { opened++; },
    mutation: async task => task(), cancel: async () => {},
  });
  const project = await service.call('openmotion_create_project', { requestId: 'create', projectType: 'natural_language', title: 'Lint compatibility', requirements: 'An editable film' });
  const directory = store.projectDirectoryFor(project.projectId);
  const original = await readFile(path.join(directory, 'index.html'), 'utf8');
  const nested = '<section id="scene" data-start="0" data-duration="10" data-track-index="1"><div id="content">Nested scene</div></section>';
  const invalid = original.replace('</div>', nested + '</div>');
  const saved = await service.call('openmotion_edit_project', { projectId: project.projectId, requestId: 'invalid', expectedRevision: project.revision,
    expectedVersionId: project.currentVersionId, files: [{ path: 'index.html', content: invalid }] });
  assert.equal((await runHyperframes(pluginRoot, directory, ['lint', '.', '--json'])).code, 0, 'the upstream CLI only warns about this structure');
  const checked = await inspectProject(pluginRoot, directory, 'lint');
  const studio = await lintProject(directory, undefined, { host: 'studio' });
  assert.equal(checked.exitCode, 1);
  assert.equal(checked.result.errorCount, studio.totalErrors);
  assert.deepEqual(checked.result.findings, studio.results.flatMap(entry => entry.result.findings));
  assert.ok(checked.result.findings.some(item => item.code === 'nested_structure_needs_subcomposition' && item.severity === 'error' && item.file && item.line && item.fixHint));
  await assert.rejects(service.call('openmotion_open_preview', { projectId: project.projectId }), /PROJECT_VALIDATION_FAILED.*nested_structure_needs_subcomposition/);
  assert.equal(opened, 0);
  assert.equal(await readFile(path.join(directory, 'index.html'), 'utf8'), invalid);
  const requested = await service.call('openmotion_export_request', { projectId: project.projectId, requestId: 'export-invalid', expectedRevision: saved.revision, versionId: saved.version.versionId, audio: 'silent' });
  await renderNext(store, pluginRoot);
  const failed = await store.job(requested.job.id);
  assert.equal(failed?.state, 'failed');
  assert.match(failed?.error || '', /nested_structure_needs_subcomposition/);
  const { exportJob } = await service.call('openmotion_get_project', { projectId: project.projectId, exportJobId: requested.job.id });
  assert.equal(exportJob.versionId, saved.version.versionId);
  assert.ok(exportJob.lintFindings.some((item: ExportLintFinding) => item.code === 'nested_structure_needs_subcomposition' && item.file === 'index.html' && item.line && item.fixHint));
  const fixed = await service.call('openmotion_edit_project', { projectId: project.projectId, requestId: 'fixed', expectedRevision: saved.revision,
    expectedVersionId: saved.version.versionId, files: [
      { path: 'index.html', content: original.replace('</div>', '<div id="scene" data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="10" data-track-index="1"></div></div>').replace('</style>', '#main{transition:opacity 1s}</style>') },
      { path: 'compositions/scene.html', content: '<template><div id="root" data-composition-id="scene" data-width="1920" data-height="1080" data-start="0" data-duration="10" data-no-timeline>' + nested + '</div></template>' },
    ] });
  const valid = await service.call('openmotion_open_preview', fixed.previewHandoff.nextAction.arguments);
  assert.equal(valid.preflight.errorCount, 0);
  assert.ok(valid.preflight.findings.some(item => item.code === 'css_transition_used' && item.severity === 'warning'));
  assert.equal(opened, 1, 'ordinary warnings must not block the editor');
}, false));

test('Motion lint retains cancellation before starting its isolated worker', () => fixture(async store => {
  await assert.rejects(inspectProject(pluginRoot, store.projectDirectory, 'lint', AbortSignal.abort()), /COMMAND_CANCELLED/);
}));

test('post-render diagnostics inspect the selected entry under the renderer CLI policy', () => fixture(async store => {
  const directory = store.projectDirectory;
  const source = await readFile(path.join(directory, 'index.html'), 'utf8');
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(path.join(directory, 'scenes'));
  await writeFile(path.join(directory, 'scenes', 'scene.html'), source.replace(/data-width="[0-9]+"/, ''));
  const findings = await diagnoseFailedRender(pluginRoot, directory, 'scenes/scene.html');
  assert.ok(findings.some(item => item.code === 'root_missing_dimensions' && item.file === 'scenes/scene.html'));
}));
