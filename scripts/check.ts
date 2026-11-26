import { isMain } from '../shared/entry.ts';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { releaseProfile } from '../shared/mcp-registry.ts';
import { checkDesign } from './design-check.ts';
import { checkI18n } from './check-i18n.ts';
import { checkRouting } from './check-routing.ts';
import { getWorkflow, markdownAnchors, workflowLinkAnchors, workflowRegistry, phase1WorkflowNames, packagedSkills } from '../shared/workflow.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

// Hosts parse SKILL.md frontmatter as YAML, so a plain value containing ": " or " #"
// is a parse error there even though a line-based regex accepts it.
export function assertSkillFrontmatterYaml(frontmatter: string, skill: string) {
  for (const line of frontmatter.split('\n')) {
    if (!line.trim() || /^\s/.test(line)) continue;
    const field = line.match(/^([A-Za-z_][\w-]*):(?: (.*))?$/);
    assert.ok(field, `${skill} frontmatter line is not a YAML key: ${line}`);
    const value = (field[2] ?? '').trim();
    if (!value || /^[>|][+-]?$/.test(value) || /^'[^']*'$|^"(?:[^"\\]|\\.)*"$/.test(value)) continue;
    assert.ok(!/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) && !/: | #|:$/.test(value),
      `${skill} frontmatter ${field[1]} is not a valid plain YAML value; use a folded block (>-) or quotes`);
  }
}

export async function check() {
  const manifest = JSON.parse(await readFile(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  const marketplace = JSON.parse(await readFile(path.join(root, 'marketplace.example.json'), 'utf8'));
  assert.equal(manifest.name, marketplace.plugins[0].name);
  assert.deepEqual(manifest.skills, ['./skills/', './.codex-plugin/onboarding/']);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(pkg.dependencies.hyperframes, '0.9.7');
  assert.equal(lock.packages['node_modules/hyperframes'].version, pkg.dependencies.hyperframes);
  assert.equal(manifest.mcpServers, './.mcp.json');
  const mcp = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers.openmotion.type, 'stdio');
  assert.deepEqual(mcp.mcpServers.openmotion.args, ['--experimental-strip-types', 'mcp.ts']);
  assert.equal(mcp.mcpServers.openmotion.cwd, '.');
  assert.ok(!JSON.stringify(mcp).includes('${'), 'MCP launch paths cannot depend on placeholder expansion');
  assert.equal(marketplace.plugins[0].source.path, './');
  for (const folder of ['web', 'shared', 'scripts', 'tests', 'gateway', 'tracking']) {
    for (const file of await readdir(path.join(root, folder))) {
      if (file.endsWith('.ts')) stripTypeScriptTypes(await readFile(path.join(root, folder, file), 'utf8'), { mode: 'strip' });
    }
  }
  for (const file of ['server.ts', 'browser.ts', 'workspace.ts', 'mcp.ts', 'mcp-tools.ts', 'editor-runtime.ts', 'phase1.ts', 'phase1-versions.ts', 'project-archive.ts', 'project-management.ts', 'design-projects.ts', 'game-projects.ts', 'inline-video.ts', 'preview.ts', 'hyperframes.ts', 'template-library.ts', 'template-catalog.ts', 'prism-templates.ts', 'editor-server.ts']) stripTypeScriptTypes(await readFile(path.join(root, file), 'utf8'), { mode: 'strip' });
  for (const folder of ['skills', 'library/skills']) for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const document = await readFile(path.join(root, folder, entry.name, 'SKILL.md'), 'utf8');
    const frontmatter = document.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
    assert.ok(frontmatter, `Missing skill frontmatter: ${entry.name}`);
    assert.match(frontmatter, /^name: [a-z0-9-]+$/m);
    assert.match(frontmatter, /^description: .+$/m);
    assertSkillFrontmatterYaml(frontmatter, entry.name);
    assert.equal(document.match(/^name: (.+)$/m)?.[1], entry.name);
  }
  // Agents choose routes from these texts, so a stale "placeholder" note hides a ready Skill.
  const readySkills = [...new Set(Object.values(workflowRegistry).filter(definition => definition.status === 'ready')
    .map(definition => Object.values(definition.sections)[0]?.match(/^skills\/([^/]+)\//)?.[1]).filter(Boolean))] as string[];
  const topSkills = (await readdir(path.join(root, 'skills'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(topSkills, ['opengame', 'openmotion', ...packagedSkills].sort(),
    'Top-level skills/ must contain only the public entries (opengame, openmotion) plus packagedSkills');

  // Thin routers must remain concise so future changes do not inline full playbooks into entry prompts.
  for (const thinEntry of ['skills/opengame/SKILL.md', 'skills/openmotion/SKILL.md', 'skills/openmotion-video/SKILL.md']) {
    const content = await readFile(path.join(root, thinEntry), 'utf8');
    assert.ok(content.length <= 8000, `${thinEntry} exceeds thin-router budget (${content.length} > 8000 chars)`);
  }

  // Enforce strict L1 Skill DAG: openmotion-media has zero cross-Skill links, and creative domains never cross-link each other.
  const creativeDomains = new Set(['openmotion-video', 'openmotion-game', 'openmotion-design']);
  const stripCode = (text: string) => text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const skill of topSkills) {
    const skillDir = path.join(root, 'skills', skill);
    const mdFiles = (await readdir(skillDir, { recursive: true }))
      .filter(file => typeof file === 'string' && file.endsWith('.md'))
      .map(file => file.split('\\').join('/'));
    for (const rel of mdFiles) {
      const text = await readFile(path.join(skillDir, rel), 'utf8');
      const docRel = path.posix.join(skill, rel);
      for (const [, target] of stripCode(text).matchAll(/\]\(<?([^)\s>#]+)/g)) {
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target) || target.startsWith('/')) continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(docRel), target));
        if (resolved.startsWith('..')) continue; // Outside skills/ (e.g. docs/)
        const targetSkill = resolved.split('/')[0];
        if (targetSkill === skill) continue;
        if (skill === 'openmotion-media') {
          assert.fail(`DAG violation: openmotion-media must stay self-contained without cross-Skill link (${docRel} -> ${resolved})`);
        }
        if (creativeDomains.has(skill) && creativeDomains.has(targetSkill)) {
          assert.fail(`DAG violation: creative domain ${skill} must not cross-link ${targetSkill} (${docRel} -> ${resolved})`);
        }
      }
    }
  }

  // Bundled Skill helper scripts must self-locate rather than hardcode legacy Skill folders.
  const legacySkillPathPattern = /skills\/openmotion-(?:director|production|recreate|template-to-video|video-to-template)\b/;
  for (const scriptFile of await readdir(path.join(root, 'skills/openmotion-video/scripts'))) {
    if (!/\.(?:[cm]?js|ts|py)$/.test(scriptFile)) continue;
    const scriptText = await readFile(path.join(root, 'skills/openmotion-video/scripts', scriptFile), 'utf8');
    assert.doesNotMatch(scriptText, legacySkillPathPattern, `skills/openmotion-video/scripts/${scriptFile} hardcodes a retired Skill directory`);
  }

  for (const [workflow, definition] of Object.entries(workflowRegistry)) {
    if (releaseProfile === 'phase1' && !phase1WorkflowNames.includes(workflow)) continue;
    for (const section of Object.keys(definition.sections)) {
      const document = await getWorkflow(section, workflow);
      assert.ok(document.content.trim(), `Empty workflow section: ${workflow}/${section}`);
      for (const skill of readySkills) assert.doesNotMatch(document.content, new RegExp(`${skill} (?:remains|is still|is) (?:an? )?placeholder`, 'i'),
        `${document.documentId} calls ready Skill ${skill} a placeholder`);
      for (const reference of document.references) {
        const linked = await getWorkflow(reference.section, reference.workflow);
        assert.equal(linked.documentId, reference.documentId, `Unreachable workflow link from ${document.documentId}`);
      }
      for (const link of workflowLinkAnchors(document.content, document.documentId)) {
        const linked = link.documentId === document.documentId ? document : await getWorkflow(link.section, link.workflow);
        assert.ok(markdownAnchors(linked.content).has(link.anchor), `Missing heading anchor in ${document.documentId}: ${link.href}`);
      }
    }
  }
  assert.match(await readFile(path.join(root, 'templates/index.html'), 'utf8'), /data-composition-id/);
  await checkI18n();
  await checkRouting();
  await checkDesign();
  console.log('Plugin manifest, marketplace, skill, i18n, routing and TypeScript syntax checks passed.');
}
if (isMain(import.meta.url)) await check();
