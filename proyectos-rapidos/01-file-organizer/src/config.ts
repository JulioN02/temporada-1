/**
 * Configuration core for file-organizer: embedded default mapping, derived
 * types, per-extension merge semantics and fatal config errors.
 *
 * Pure module — no I/O at this level. Loading, validation and precedence
 * resolution live in `loadConfig` (added in the config phase).
 */

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