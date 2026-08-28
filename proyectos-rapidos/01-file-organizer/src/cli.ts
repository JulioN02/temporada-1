/**
 * CLI for file-organizer: parses argv with node:util.parseArgs (strict),
 * orchestrates config → plan → execute and renders the report. It only sets
 * `process.exitCode` — never calls `process.exit`.
 *
 * Conventions: stdout = report; stderr = errors. Public name: file-organizer.
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { loadConfig, ConfigError } from './config.ts';
import type { CliOptions } from './config.ts';
import { planMoves, executeMoves } from './mover.ts';
import type { MoveReport, PlanResult, SkipReason } from './mover.ts';

const USAGE = `file-organizer — organize a directory by file extension

Usage:
  node --experimental-strip-types src/cli.ts [options] [targetDir]

Arguments:
  targetDir               directory to organize (default: current directory)

Options:
  --dry-run               print the plan without writing anything (no mkdir)
  --config <path>         highest-precedence JSON config file
  --include-hidden        also process hidden (dot) files
  --help                  show this help and exit
  --version               print the version and exit

Configuration precedence (lowest → highest):
  embedded defaults < <cwd>/.file-organizer.json
  < <target>/.file-organizer.json < --config <path>

Config file shape:
  { "mapping": { "pdf": "PDF", ... }, "miscFolder": "Others", "omitMisc": false }
`;

const OPTIONS = {
  'dry-run': { type: 'boolean' as const },
  'config': { type: 'string' as const },
  'include-hidden': { type: 'boolean' as const },
  'help': { type: 'boolean' as const },
  'version': { type: 'boolean' as const },
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Reads the version from package.json at runtime (single source of truth). */
function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
}

const SKIP_LABELS: Record<SkipReason['kind'], string> = {
  hidden: 'hidden',
  directory: 'directory',
  symlink: 'symlink',
  ignored: 'ignored',
  'misc-omitted': 'misc omitted',
};

/**
 * Renders the deterministic stdout report (R20):
 *   Moved: n | Skipped: n | Errors: n
 *   {dest relative to target} ← {source name}
 *   skipped: {name} ({reason})
 * Every stdout line gets a `[dry-run] ` prefix in dry-run mode.
 */
function formatReport(targetDir: string, plan: PlanResult, report: MoveReport, dryRun: boolean): string {
  const prefix = dryRun ? '[dry-run] ' : '';
  const lines: string[] = [];

  lines.push(`${prefix}Moved: ${report.moved} | Skipped: ${plan.skipped.length} | Errors: ${report.errors}`);

  for (const op of report.movedOps) {
    const destRel = relative(targetDir, op.to);
    lines.push(`${prefix}${destRel} ← ${basename(op.from)}`);
  }

  for (const entry of plan.skipped) {
    lines.push(`${prefix}skipped: ${entry.path} (${SKIP_LABELS[entry.reason.kind]})`);
  }

  return lines.join('\n');
}

export async function runCli(argv: string[]): Promise<0 | 1> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    process.stderr.write(`error: ${errorMessage(err)}\n`);
    return 1;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`file-organizer ${readVersion()}\n`);
    return 0;
  }

  if (positionals.length > 1) {
    process.stderr.write('error: expected at most one target directory argument\n');
    return 1;
  }
  const targetDir = resolve(positionals.length === 1 ? positionals[0] : process.cwd());

  // R19: the target must exist and be a directory.
  try {
    const info = await stat(targetDir);
    if (!info.isDirectory()) {
      process.stderr.write(`error: ${targetDir} is not a directory\n`);
      return 1;
    }
  } catch (err) {
    process.stderr.write(`error: cannot access target directory ${targetDir}: ${errorMessage(err)}\n`);
    return 1;
  }

  const cli: CliOptions = {
    targetDir,
    configPath: typeof values.config === 'string' ? values.config : undefined,
    dryRun: values['dry-run'] === true,
    includeHidden: values['include-hidden'] === true,
  };

  const config = await loadConfig(targetDir, process.cwd(), cli); // ConfigError handled in main

  const plan = await planMoves(targetDir, config, { includeHidden: cli.includeHidden });

  const report = await executeMoves(plan.ops, { dryRun: cli.dryRun });

  process.stdout.write(formatReport(targetDir, plan, report, cli.dryRun) + '\n');
  for (const entry of report.errorEntries) {
    process.stderr.write(`error: ${entry.path}: ${entry.message}\n`);
  }

  return report.errors > 0 ? 1 : 0;
}

export function main(): void {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      if (err instanceof ConfigError) {
        process.stderr.write(`error: ${err.message}\n`);
      } else {
        process.stderr.write(`error: ${errorMessage(err)}\n`);
      }
      process.exitCode = 1;
    },
  );
}

// Entry guard: the module is a CLI entry point, not a library.
import { pathToFileURL } from 'node:url';
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}