import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyChanges, checkDocs, documentationContract } from '../.github/scripts/ci-scope.mjs';

test('README installation instructions and executable examples retain their full gate', () => {
  const before = '# Overview\nOriginal copy\n## Install\nChoose your host.\n### Manual\nKeep the configuration.\n## Showcase\nA film.\n```sh\nnpm ci\n```\n';
  assert.equal(documentationContract(before), documentationContract(before.replace('Original copy', 'New copy')));
  for (const [from, to] of [['Choose your host.', 'Infer the host.'], ['Keep the configuration.', 'Remove the configuration.'], ['npm ci', 'npm install']]) {
    assert.notEqual(documentationContract(before), documentationContract(before.replace(from, to)));
  }
  assert.notEqual(documentationContract('[Guide](install.md)'), documentationContract('[Guide](other.md)'));
  assert.notEqual(documentationContract('~~~sh\nnode a.mjs\n~~~'), documentationContract('~~~sh\nnode b.mjs\n~~~'));
});

test('presentation documents and game template content skip product regressions', () => {
  assert.equal(classifyChanges(['README.md', 'docs/README.ja.md']).full, false);
  assert.equal(classifyChanges(['README.md']).maintainability, false);
  assert.deepEqual(classifyChanges(['templates/games/racer/game.js', 'README.md']), {
    full: false, maintainability: false, documents: ['README.md'],
  });
  assert.equal(classifyChanges(['templates/games/racer/game.js', 'game-projects.ts']).full, true);
  for (const file of [
    'skills/openmotion-director/SKILL.md', 'skills/openmotion-production/references/native.md',
    'install.md', 'docs/install.md', 'docs/npm-installation.md', 'AGENTS.md', 'CLAUDE.md',
    'docs/examples/product-launch.MOTION.md', 'examples/demo/README.md',
    'docs/readme/hero.png', 'library/templates/catalog/demo/guide.md', 'unknown.md',
  ]) assert.equal(classifyChanges(['README.md', file]).full, true, file);
  assert.equal(classifyChanges([]).full, true, 'An unknown diff must retain the full gate');
});

test('code, dependency and analysis configuration changes retain maintainability checks', () => {
  for (const file of ['server.ts', 'studio/src/App.tsx', 'scripts/runtime-assets.mjs',
    'package.json', 'package-lock.json', 'studio/tsconfig.json',
    '.github/maintainability/jscpd.json', '.github/workflows/ci.yml']) {
    assert.equal(classifyChanges([file]).maintainability, true, file);
  }
  assert.equal(classifyChanges(['skills/openmotion-director/SKILL.md']).maintainability, false);
  assert.equal(classifyChanges(['docs/readme/live-product/manifest.json']).maintainability, false);
});

test('documentation checks validate real local references and reject product inputs', async () => {
  await checkDocs(['README.md', 'README.zh-CN.md', 'docs/README.md', 'docs/README.ja.md', 'docs/README.zh-CN.md']);
  await assert.rejects(checkDocs(['install.md']), /Not a presentation document/);
});

test('Git selection covers all push commits, renames, missing history and manual runs', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'motion-ci-scope-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' }, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  git('init', '--initial-branch=main');
  await writeFile(path.join(dir, 'README.md'), 'Initial\n');
  const base = commit();
  await writeFile(path.join(dir, 'README.md'), 'Updated\n');
  const docs = commit();
  const script = fileURLToPath(new URL('../.github/scripts/ci-scope.mjs', import.meta.url));
  const select = async (revision, event = 'push') => {
    const output = path.join(dir, '.git', 'ci-output');
    await writeFile(output, '');
    const result = JSON.parse(execFileSync(process.execPath, [script], { cwd: dir, encoding: 'utf8',
      env: { ...process.env, BASE_SHA: revision, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: output },
    }));
    const emitted = await readFile(output, 'utf8');
    assert(emitted.includes(`full=${result.full}\n`));
    return result;
  };
  assert.equal((await select(base)).full, false);
  assert.equal((await select(base, 'workflow_dispatch')).full, true);
  assert.equal((await select('a'.repeat(40))).full, true);
  await mkdir(path.join(dir, 'skills'));
  await writeFile(path.join(dir, 'skills/SKILL.md'), 'Product guidance\n');
  commit();
  await writeFile(path.join(dir, 'README.md'), 'Another update\n');
  commit();
  assert.equal((await select(docs)).full, true, 'Earlier product changes in a push must not disappear');
  const beforeRename = git('rev-parse', 'HEAD');
  git('mv', 'skills/SKILL.md', 'README.zh-CN.md');
  commit();
  assert.equal((await select(beforeRename)).full, true, 'A rename out of product guidance includes its deletion');
  // PRs compare the actual merge result with its first parent, even if the event base is stale.
  git('checkout', '-b', 'feature');
  await writeFile(path.join(dir, 'README.md'), 'PR copy\n');
  commit();
  git('checkout', 'main');
  git('merge', '--no-ff', 'feature', '-m', 'merge fixture');
  assert.equal((await select(base, 'pull_request')).full, false);
  const beforeInstructions = git('rev-parse', 'HEAD');
  await writeFile(path.join(dir, 'README.md'), 'PR copy\n```sh\nnpm ci\n```\n');
  commit();
  assert.equal((await select(beforeInstructions)).full, true, 'README command changes keep the full gate');
});

const ciPath = new URL('../.github/workflows/ci.yml', import.meta.url);
const jobBody = (ci, job) => ci.split(`  ${job}:\n`)[1].split(/\n  [\w-]+:\n/)[0];
const stepBody = (job, name) => job.split(`      - name: ${name}\n`)[1].split('      - name:')[0];

test('OpenGame CI covers source and runtime regressions independently of OpenMotion releases', async () => {
  const ci = await readFile(ciPath, 'utf8');
  const checks = jobBody(ci, 'checks');
  const studio = jobBody(ci, 'studio');
  const distribution = jobBody(ci, 'distribution');
  const platformReliability = jobBody(ci, 'platform-reliability');
  const motionRelease = await readFile(new URL('../.github/workflows/motion-release-checks.yml', import.meta.url), 'utf8');
  const dshIntegration = await readFile(new URL('../.github/workflows/dsh-integration.yml', import.meta.url), 'utf8');
  assert(jobBody(motionRelease, 'controls').includes("if: github.repository == 'nexu-io/openmotion'"));
  assert(jobBody(dshIntegration, 'plugin').includes("if: github.repository == 'nexu-io/openmotion'"));
  assert(!ci.includes('\n  maintainability:\n'), 'Advisory maintainability job should not consume a PR runner');
  assert(!ci.includes('\n  distribution-browser:\n'), 'Workspace browser regression shares setup with distribution');
  assert(!ci.includes('\n  template-library:\n'), 'Template policy checks run inside Source checks without an extra runner');
  assert(platformReliability.includes("if: github.event_name != 'pull_request'"));
  assert(!stepBody(checks, 'Scan tracked source without publication credentials').includes('if:'));
  assert(!checks.includes('lfs pull'), 'Source checks must not download LFS media');
  for (const command of ['scripts/package-npm.mjs', 'scripts/test-package.mjs', 'tests/npm-package.test.ts',
    'tests/packaged-game-download.mjs', 'tests/npm-installer.test.ts', 'tests/install-guide.test.ts', 'tests/stable-release.test.mjs']) {
    assert(!runCommands(ci).includes(command), `OpenGame CI must not validate the OpenMotion installer: ${command}`);
  }
  assert(!distribution.includes('npm run test:studio'));
  assert(stepBody(checks, 'Check presentation documentation').includes('ci-scope.mjs --check-docs'));
  assert(stepBody(checks, 'Check the final merge tree and media policy').includes('tests/ci-scope.test.mjs'));
  for (const lane of [checks, studio, distribution]) {
    assert(!lane.includes('    needs:'), 'Independent lanes start without waiting for scope detection');
    assert(lane.includes('run: node .github/scripts/ci-scope.mjs'));
    assert(stepBody(lane, 'Install locked dependencies').includes("steps.scope.outputs.full == 'true'"));
  }
  const sourceStep = stepBody(checks, 'Check source and Studio types');
  assert(sourceStep.includes("steps.scope.outputs.full == 'true'"));
  assert(sourceStep.includes('npm run check'));
  assert(sourceStep.includes('npm run design:test'));
  assert(sourceStep.includes('npm run typecheck:studio'));
  assert(sourceStep.includes('npm run typecheck:backend'));
  assert(!distribution.includes('npm run typecheck:backend'));
  assert(stepBody(distribution, 'OpenGame runtime regression').includes('tests/inline-video.test.ts'));
  assert(stepBody(distribution, 'Validate two-round inline rendering').includes('tests/inline-video-runtime.test.ts'));
  assert(!distribution.includes('npm run design:test'));
  for (const name of ['Related template preview browser regression', 'Transcript workflow browser regression',
    'Video review comments and annotation regression', 'Platform export Studio and MCP end-to-end regression',
    'Brand Kit capture, package and showcase regression', 'Repository template runtime regression',
    'Workspace, wrapper and session regression', 'Built-in template playback and export regression']) {
    assert(stepBody(distribution, name).includes("steps.scope.outputs.full == 'true'"), name);
  }
  const regressionBuild = stepBody(distribution, 'Build regression inputs');
  assert(regressionBuild.includes('npm run build:studio') && regressionBuild.includes('npm run build:tracking'));
  assert(stepBody(distribution, 'Validate tracking').includes('node --test tests/design-system.test.ts'));
  const matrix = distribution.match(/suite: \$\{\{ fromJSON\(github\.event_name == 'pull_request' && '([^']+)' \|\| '([^']+)'\) \}\}/);
  const suites = JSON.parse(matrix[2]);
  assert.deepEqual(JSON.parse(matrix[1]), ['runtime']);
  assert.deepEqual(suites, ['runtime', 'rendering', 'transcript', 'export']);
  for (const [, suite] of distribution.matchAll(/matrix\.suite == '([\w-]+)'/g)) assert(suites.includes(suite), `Unknown suite: ${suite}`);
  assert(distribution.includes('fail-fast: false'));
  assert(stepBody(distribution, 'Super Agent regression').includes("matrix.suite == 'runtime'"));
  assert(stepBody(distribution, 'Workspace, wrapper and session regression').includes("matrix.suite == 'runtime'"));
  assert(studio.includes('shard: [1, 2]'));
  assert(studio.includes('fail-fast: false'));
  const studioStep = stepBody(studio, 'Studio regression');
  assert(studioStep.includes("steps.scope.outputs.full == 'true'"));
  assert(studioStep.includes('npm run test:studio -- --maxWorkers=2 --shard=${{ matrix.shard }}/2'));
  assert(!studio.includes('lfs pull'));
  assert(!studio.includes('apt-get'));
});

test('the existing standalone gate rejects failed, cancelled, skipped and missing lanes', async () => {
  const gate = jobBody(await readFile(ciPath, 'utf8'), 'standalone');
  const jobs = ['checks', 'platform-reliability', 'studio', 'distribution'];
  assert(gate.includes('if: ${{ always() }}'));
  assert(gate.includes(`needs: [${jobs.join(', ')}]`));
  assert(gate.includes('VALIDATION_RESULTS: ${{ toJSON(needs) }}'));
  assert(gate.includes("ALLOW_SKIPPED_PLATFORM: ${{ github.event_name == 'pull_request' }}"));
  const script = gate.split("node --input-type=module <<'NODE'\n")[1].split('          NODE')[0];
  const success = Object.fromEntries(jobs.map(job => [job, { result: 'success' }]));
  const run = (results, allowSkipped = false) => spawnSync(process.execPath, ['--input-type=module'], {
    input: script, encoding: 'utf8',
    env: { ...process.env, VALIDATION_RESULTS: JSON.stringify(results), ALLOW_SKIPPED_PLATFORM: String(allowSkipped) },
  });
  assert.equal(run(success).status, 0);
  for (const job of jobs) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const results = { ...success, [job]: result === undefined ? undefined : { result } };
      const rejected = run(results);
      assert.equal(rejected.status, 1, `${job}: ${result}`);
      assert(rejected.stderr.includes(job));
    }
  }
  const pr = { ...success, 'platform-reliability': { result: 'skipped' } };
  assert.equal(run(pr, true).status, 0, 'Pull requests intentionally skip macOS/Windows platform reliability');
  for (const result of ['failure', 'cancelled', undefined]) {
    assert.equal(run({ ...pr, 'platform-reliability': { result } }, true).status, 1);
  }
  assert.equal(run({ ...pr, studio: { result: 'skipped' } }, true).status, 1);
});

// Root test files without an OpenGame workflow command.
const unscheduledSuites = [
  'asset-routing.test.ts', 'assets-use.test.ts', 'brand-story-tracking.test.ts', 'bundled-npm-runtime.test.ts',
  'codex-host-handoff.test.ts', 'cold-start.test.ts', 'dsh-distribution.test.ts', 'dsh-integration.test.ts',
  'dsh-release.test.ts', 'dsh-template-cards.test.ts', 'final-video-delivery.test.ts', 'final-video-ui.test.ts',
  'game-harness-generalization.test.ts', 'game-projects.test.ts', 'hosted-game-templates.test.ts',
  'inline-video-preview.test.ts', 'inline-video-result.test.ts', 'install-guide.test.ts', 'install-public-skill.test.ts', 'integration.test.ts',
  'legacy.test.ts', 'library-skill-catalog.test.ts', 'lint.test.ts', 'mcp-client.test.ts', 'mcp-config.test.ts', 'mcp.test.ts', 'media-save.test.ts',
  'npm-distribution-selection.test.ts', 'npm-installer.test.ts', 'npm-package.test.ts', 'onboarding-recovery.test.ts',
  'package.test.ts', 'page-metadata.test.ts', 'phase1-runtime.test.ts', 'phase1-shared.test.ts',
  'prebuilt-bootstrap.test.ts', 'recreate-rendering.test.ts', 'registry-download.test.mjs', 'registry-material-compat.test.ts', 'registry.test.ts',
  'release-notes.test.mjs', 'release-workflows.test.mjs', 'shared-editor.test.ts', 'slacking-and-fruit-gym.test.ts',
  'source-native-runtime.test.ts',
  'stable-release.test.mjs', 'studio-history-availability.test.ts',
  'template-metadata.test.ts', 'template-playback.test.ts', 'template-registry-consumer.test.mjs',
  'templates.test.ts', 'test-package.test.ts', 'tracking-task-ledger.test.ts',
  'verify-export.test.ts', 'video-compare.test.ts', 'vision-runtime-native.test.mjs', 'vision-runtime.test.mjs',
  'welcome-template.test.ts', 'work-generation.test.ts', 'workflow-layering.test.ts',
];

// Only shell bodies execute. A suite mentioned in a comment, a `paths:` filter or a
// job name is documentation, not a scheduled run, so the scan reads `run:` bodies only.
function runCommands(workflow) {
  const jobs = workflow.split(/^jobs:\s*$/m)[1] ?? '';
  return jobs.split(/^  [\w-]+:\s*$/m).filter(job => {
    const gate = job.match(/^    if:\s*(?:\$\{\{\s*)?github\.repository\s*==\s*'([^']+)'\s*(?:&&|\}\}|$)/m);
    return !gate || gate[1] === 'nexu-io/opengame';
  }).map(jobCommands).join('\n');
}

function jobCommands(job) {
  const commands = [];
  let blockIndent = null;
  for (const raw of job.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (blockIndent !== null) {
      if (indent > blockIndent) { commands.push(line.trim()); continue; }
      blockIndent = null;
    }
    const block = line.match(/^\s*(?:-\s+)?run:\s*\|\s*$/);
    if (block) { blockIndent = indent; continue; }
    const inline = line.match(/^\s*(?:-\s+)?run:\s*(\S.*)$/);
    if (inline) commands.push(inline[1].trim());
  }
  return commands.join('\n');
}

test('root test suites are either scheduled by a workflow or recorded as unscheduled', async () => {
  const suites = (await readdir(fileURLToPath(new URL('../tests/', import.meta.url))))
    .filter(file => /\.(test|spec)\.(ts|mjs|js)$/.test(file)).sort();
  const directory = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
  const workflows = await Promise.all((await readdir(directory)).filter(file => /\.ya?ml$/.test(file))
    .map(file => readFile(path.join(directory, file), 'utf8')));
  const corpus = workflows.map(runCommands).join('\n');
  const unscheduled = suites.filter(file => !corpus.includes('tests/' + file));
  assert.deepEqual(unscheduled, unscheduledSuites,
    'Every root suite must be named by a workflow or listed in unscheduledSuites');
  assert.ok(suites.length > unscheduled.length, 'Expected scheduled suites to exist');
});
