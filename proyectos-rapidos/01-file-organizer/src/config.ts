/**
 * Pure extension classification core for file-organizer: embedded default
 * mapping, derived types, per-extension merge semantics, JSON validation and
 * the precedence chain that resolves the active configuration.
 *
 * Loading/validation are I/O-bound; classification and merging are pure.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const DEFAULT_MAPPING = {
  pdf: 'PDF',
  jpg: 'Images', jpeg: 'Images', png: 'Images', gif: 'Images', webp: 'Images',
  svg: 'Images', bmp: 'Images', ico: 'Images', avif: 'Images',
  mp4: 'Videos', mkv: 'Videos', avi: 'Videos', mov: 'Videos', webm: 'Videos', m4v: 'Videos',
  mp3: 'Audio', wav: 'Audio', flac: 'Audio', ogg: 'Audio', m4a: 'Audio', aac: 'Audio', opus: 'Audio',
  ts: 'Code', js: 'Code', tsx: 'Code', jsx: 'Code', py: 'Code', rs: 'Code', go: 'Code',
  java: 'Code', c: 'Code', cpp: 'Code', h: 'Code', hpp: 'Code', sh: 'Code', json: 'Code',
  yml: 'Code', yaml: 'Code', toml: 'Code', html: 'Code', css: 'Code', scss: 'Code',
  doc: 'Documents', docx: 'Documents', xls: 'Documents', xlsx: 'Documents',
  ppt: 'Documents', pptx: 'Documents', odt: 'Documents', ods: 'Documents',
  txt: 'Documents', md: 'Documents', rtf: 'Documents', csv: 'Documents',
  zip: 'Archives', tar: 'Archives', gz: 'Archives', bz2: 'Archives', xz: 'Archives',
  '7z': 'Archives', rar: 'Archives', tgz: 'Archives', deb: 'Archives', rpm: 'Archives', iso: 'Archives',
} as const;

export type DefaultCategory = (typeof DEFAULT_MAPPING)[keyof typeof DEFAULT_MAPPING];

/** Active mapping: defaults + overrides (may add new extensions/categories). */
export type Mapping = Record<string, string>;

/** Resolved configuration after the precedence chain and merge. */
export interface Config {
  mapping: Mapping;
  miscFolder: string;
  omitMisc: boolean;
  /** Absolute paths of the JSON files actually loaded → ignored list (R9). */
  configFilesLoaded: string[];
}

/** A single validated JSON layer, before merging into the active config. */
export interface RawFileConfig {
  mapping?: Mapping;
  miscFolder?: string;
  omitMisc?: boolean;
}

/** CLI options that affect scanning/execution (not JSON values). */
export interface CliOptions {
  targetDir: string;
  configPath?: string;
  dryRun: boolean;
  includeHidden: boolean;
}

/**
 * Per-extension merge (R6): keys present in `override` overwrite the default
 * value for that extension or add a new extension; keys absent from `override`
 * keep their default. There is no removal mechanism in v1.
 * Key normalization (lowercase, no leading dot) happens at parse time, before merge.
 */
export function mergeMapping(defaults: Mapping, override: Mapping): Mapping {
  return { ...defaults, ...override };
}

/** Fatal configuration error; the CLI prints it to stderr and exits with 1. */
export class ConfigError extends Error {}

// ---------------------------------------------------------------------------
// Validation helpers (type guards over `unknown`, never `any`)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

const CONFIG_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['mapping', 'miscFolder', 'omitMisc']);

/** Lowercase and strip leading dots from an extension key (R3/R18). */
function normalizeExtensionKey(key: string): string {
  return key.trim().toLowerCase().replace(/^\.+/, '');
}

/**
 * Validates one parsed JSON layer (already `JSON.parse`d) with type guards and
 * normalizes mapping keys before merging. Any violation throws `ConfigError`
 * (R18: fatal error, never silent fallback to defaults).
 */
export function parseFileConfig(raw: unknown, source: string): RawFileConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(`${source}: config must be a JSON object`);
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_TOP_LEVEL_KEYS.has(key)) {
      throw new ConfigError(`${source}: unknown top-level key "${key}"`);
    }
  }

  const result: RawFileConfig = {};

  if (raw.mapping !== undefined) {
    if (!isRecord(raw.mapping)) {
      throw new ConfigError(`${source}: "mapping" must be an object`);
    }
    const mapping: Mapping = {};
    for (const [rawKey, value] of Object.entries(raw.mapping)) {
      const key = normalizeExtensionKey(rawKey);
      if (key === '') {
        throw new ConfigError(`${source}: mapping key "${rawKey}" is empty after normalization`);
      }
      if (!isNonEmptyString(value)) {
        throw new ConfigError(`${source}: mapping["${rawKey}"] must be a non-empty string`);
      }
      mapping[key] = value;
    }
    result.mapping = mapping;
  }

  if (raw.miscFolder !== undefined) {
    if (!isNonEmptyString(raw.miscFolder)) {
      throw new ConfigError(`${source}: "miscFolder" must be a non-empty string`);
    }
    if (raw.miscFolder.includes('/') || raw.miscFolder.includes('\\')) {
      throw new ConfigError(`${source}: "miscFolder" must not contain path separators`);
    }
    if (raw.miscFolder === '.' || raw.miscFolder === '..') {
      throw new ConfigError(`${source}: "miscFolder" must not be "." or ".."`);
    }
    result.miscFolder = raw.miscFolder;
  }

  if (raw.omitMisc !== undefined) {
    if (!isBoolean(raw.omitMisc)) {
      throw new ConfigError(`${source}: "omitMisc" must be a boolean`);
    }
    result.omitMisc = raw.omitMisc;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Precedence chain (R17) — defaults < <cwd>/.file-organizer.json
//                          < <target>/.file-organizer.json < --config <path>
// ---------------------------------------------------------------------------

const CONFIG_FILENAME = '.file-organizer.json';

/**
 * Loads the active configuration from the lowest-precedence layer to the
 * highest, merging per-extension and letting the upper layer win per key.
 * Optional layers (cwd/target) are skipped silently when absent; `--config`
 * is required and fatal when missing (R18). `configFilesLoaded` records the
 * absolute paths actually loaded (deduplicated) → ignored list (R9).
 */
export async function loadConfig(targetDir: string, cwd: string, cli: CliOptions): Promise<Config> {
  const config: Config = {
    mapping: { ...DEFAULT_MAPPING },
    miscFolder: 'Others',
    omitMisc: false,
    configFilesLoaded: [],
  };

  const loaded: string[] = [];

  async function applyFile(path: string, required: boolean): Promise<void> {
    let content: string;
    try {
      content = await readFile(path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' && !required) return; // optional layers are skipped silently
      throw new ConfigError(`${path}: cannot read config file`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new ConfigError(`${path}: invalid JSON`);
    }

    const layer = parseFileConfig(raw, path);
    if (layer.mapping !== undefined) {
      config.mapping = mergeMapping(config.mapping, layer.mapping);
    }
    if (layer.miscFolder !== undefined) {
      config.miscFolder = layer.miscFolder;
    }
    if (layer.omitMisc !== undefined) {
      config.omitMisc = layer.omitMisc;
    }
    loaded.push(resolve(path));
  }

  await applyFile(join(cwd, CONFIG_FILENAME), false);
  await applyFile(join(targetDir, CONFIG_FILENAME), false);
  if (cli.configPath !== undefined) {
    await applyFile(cli.configPath, true);
  }

  config.configFilesLoaded = [...new Set(loaded)];
  return config;
}