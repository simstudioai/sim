import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  getSection,
  type IniDocument,
  listSections,
  parseIni,
  removeSection,
  serializeIni,
  setSectionValues,
} from './ini.js'
import { configPath, credentialsPath } from './paths.js'

export const DEFAULT_PROFILE = 'default'
export const DEFAULT_ENDPOINT = 'https://sim.ai'
export const OUTPUT_FORMATS = ['table', 'json'] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

/** Everything a command needs to make a call, after the resolution chain runs. */
export interface ResolvedProfile {
  name: string
  endpoint: string
  apiKey: string | null
  workspaceId: string | null
  output: OutputFormat
  /** Where each value came from, for `sim whoami` to explain surprising results. */
  sources: {
    endpoint: SettingSource
    apiKey: SettingSource
    workspaceId: SettingSource
    output: SettingSource
  }
}

export type SettingSource = 'flag' | 'env' | 'config' | 'credentials' | 'default' | 'unset'

export interface ProfileOverrides {
  profile?: string
  endpoint?: string
  apiKey?: string
  workspaceId?: string
  output?: string
}

/**
 * AWS's asymmetry, reproduced deliberately: the config file namespaces
 * non-default profiles as `[profile dev]` while the credentials file uses a bare
 * `[dev]`. It is a wart, but matching it means muscle memory and existing
 * tooling carry over.
 */
function configSectionName(profile: string): string {
  return profile === DEFAULT_PROFILE ? DEFAULT_PROFILE : `profile ${profile}`
}

function readIni(path: string): IniDocument {
  if (!existsSync(path)) return { preamble: [], sections: [] }
  return parseIni(readFileSync(path, 'utf8'))
}

function writeIni(path: string, doc: IniDocument, secret: boolean): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, serializeIni(doc), { mode: secret ? 0o600 : 0o644 })
  // `writeFileSync`'s mode only applies when it creates the file, so an existing
  // credentials file written before this ran (or created by a hand `touch`)
  // keeps its old, possibly world-readable, permissions without this.
  if (secret) chmodSync(path, 0o600)
}

export function readConfigProfile(profile: string): Record<string, string> {
  return getSection(readIni(configPath()), configSectionName(profile)) ?? {}
}

export function readCredentialsProfile(profile: string): Record<string, string> {
  return getSection(readIni(credentialsPath()), profile) ?? {}
}

/** Every profile named by either file, deduplicated and sorted. */
export function listProfiles(): string[] {
  const names = new Set<string>()

  for (const section of listSections(readIni(configPath()))) {
    if (section === DEFAULT_PROFILE) names.add(DEFAULT_PROFILE)
    else if (section.startsWith('profile ')) names.add(section.slice('profile '.length).trim())
  }
  for (const section of listSections(readIni(credentialsPath()))) {
    names.add(section)
  }

  return [...names].sort()
}

export function writeConfigProfile(profile: string, values: Record<string, string | null>): void {
  const doc = readIni(configPath())
  setSectionValues(doc, configSectionName(profile), values)
  writeIni(configPath(), doc, false)
}

export function writeCredentialsProfile(profile: string, apiKey: string | null): void {
  const doc = readIni(credentialsPath())
  setSectionValues(doc, profile, { api_key: apiKey })
  writeIni(credentialsPath(), doc, true)
}

/** Drops the profile from both files. Returns whether anything was removed. */
export function deleteProfile(profile: string): { config: boolean; credentials: boolean } {
  const configDoc = readIni(configPath())
  const config = removeSection(configDoc, configSectionName(profile))
  if (config) writeIni(configPath(), configDoc, false)

  const credentialsDoc = readIni(credentialsPath())
  const credentials = removeSection(credentialsDoc, profile)
  if (credentials) writeIni(credentialsPath(), credentialsDoc, true)

  return { config, credentials }
}

function normalizeEndpoint(endpoint: string): string {
  // A trailing slash here produces `https://sim.ai//api/v2/...`, which some
  // proxies 404 rather than normalize.
  return endpoint.replace(/\/+$/, '')
}

function parseOutput(value: string | undefined): OutputFormat | null {
  return value && (OUTPUT_FORMATS as readonly string[]).includes(value)
    ? (value as OutputFormat)
    : null
}

/**
 * Resolves one setting through the precedence chain, reporting where it landed.
 * Order is flags → environment → files → built-in default, the same order every
 * profile-based CLI uses: the more specific and more ephemeral the source, the
 * higher it wins.
 */
function resolve<T>(
  candidates: Array<[SettingSource, T | null | undefined]>,
  fallback: T | null,
  fallbackSource: SettingSource
): { value: T | null; source: SettingSource } {
  for (const [source, value] of candidates) {
    if (value !== null && value !== undefined && value !== '') return { value, source }
  }
  return { value: fallback, source: fallbackSource }
}

export function resolveProfile(overrides: ProfileOverrides = {}): ResolvedProfile {
  const name = overrides.profile || process.env.SIM_PROFILE || DEFAULT_PROFILE
  const config = readConfigProfile(name)
  const credentials = readCredentialsProfile(name)

  const endpoint = resolve<string>(
    [
      ['flag', overrides.endpoint],
      ['env', process.env.SIM_ENDPOINT],
      ['config', config.endpoint],
    ],
    DEFAULT_ENDPOINT,
    'default'
  )

  const apiKey = resolve<string>(
    [
      ['flag', overrides.apiKey],
      ['env', process.env.SIM_API_KEY],
      ['credentials', credentials.api_key],
    ],
    null,
    'unset'
  )

  const workspaceId = resolve<string>(
    [
      ['flag', overrides.workspaceId],
      ['env', process.env.SIM_WORKSPACE],
      ['config', config.workspace],
    ],
    null,
    'unset'
  )

  const output = resolve<OutputFormat>(
    [
      ['flag', parseOutput(overrides.output)],
      ['env', parseOutput(process.env.SIM_OUTPUT)],
      ['config', parseOutput(config.output)],
    ],
    'table',
    'default'
  )

  return {
    name,
    endpoint: normalizeEndpoint(endpoint.value as string),
    apiKey: apiKey.value,
    workspaceId: workspaceId.value,
    output: output.value as OutputFormat,
    sources: {
      endpoint: endpoint.source,
      apiKey: apiKey.source,
      workspaceId: workspaceId.source,
      output: output.source,
    },
  }
}
