import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMain } from '../shared/entry.ts';
import {
  applySourceUpdate,
  checkSourceUpdate,
  DEFAULT_UPDATE_BRANCH,
  DEFAULT_UPDATE_REMOTE,
  maybeAutoUpdateBeforeCreation,
} from '../shared/source-update.ts';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const usage = `Usage:
  node --experimental-strip-types scripts/update.ts [--apply|--check|--auto] [options]

Modes:
  --apply            Check and update a clean main source checkout immediately (default)
  --check            Check whether origin/main has a newer commit (respects 24h TTL unless --force)
  --auto             Run the automatic 24h-throttled silent check-and-apply flow

Options:
  --force            Bypass the 24-hour check cooldown (for --check or --auto)
  --no-restart       Do not shut down an idle local editor daemon after updating
  --data-dir DIR     Workspace data directory for update-check state and lock (default: MOTION_DATA_DIR or .motion-data)
  --remote NAME      Git remote to fetch from (default: ${DEFAULT_UPDATE_REMOTE})
  --branch NAME      Git branch to track (default: ${DEFAULT_UPDATE_BRANCH})
  -h, --help         Show this help text`;

export async function runUpdateCli(argv: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      apply: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      auto: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'no-restart': { type: 'boolean', default: false },
      'data-dir': { type: 'string' },
      remote: { type: 'string' },
      branch: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    console.log(usage);
    return { exitCode: 0, output: null };
  }

  const selectedModes = [values.apply, values.check, values.auto].filter(Boolean).length;
  if (selectedModes > 1) {
    throw new Error('Specify at most one of --apply, --check, or --auto');
  }

  const dataDirectory = path.resolve(
    values['data-dir'] || env.MOTION_DATA_DIR || path.join(repoRoot, '.motion-data'),
  );
  const common = {
    repoRoot,
    dataDirectory,
    remote: values.remote,
    branch: values.branch,
    restartBackend: !values['no-restart'],
    env,
  };

  let result;
  if (values.check) {
    result = await checkSourceUpdate({ ...common, force: values.force, automatic: false });
  } else if (values.auto) {
    result = await maybeAutoUpdateBeforeCreation({ ...common, force: values.force });
  } else {
    result = await applySourceUpdate({ ...common, automatic: false });
  }

  console.log(JSON.stringify(result, null, 2));
  const failed = ['failed', 'failed_rolled_back', 'check_failed'].includes(result.status);
  return { exitCode: failed ? 1 : 0, output: result };
}

if (isMain(import.meta.url)) {
  try {
    const { exitCode } = await runUpdateCli();
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
