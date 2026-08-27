import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import {
  CORE_CONFIGURATION_KEYS,
  DEPLOYMENT_CONFIGURATION_KEYS,
} from '@sim/deployment-config/env-capabilities'
import { isPlaceholder, parseEnv, ROOT, SHARED_KEYS } from './env-files'

export type ConfigurationSourceKind = 'dev' | 'compose' | 'helm'

export interface ConfigurationSource {
  kind: ConfigurationSourceKind
  label: string
  location: string
  values: Map<string, string> | null
  warning?: string
  configurationIssues?: readonly string[]
  managedByCurrentCheckout: boolean
}

export interface ConfigurationCommandResult {
  status: number | null
  stdout: string
  stderr: string
}

export type ConfigurationCommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string
) => ConfigurationCommandResult

export interface ConfigurationSourceDiscoveryOptions {
  root?: string
  runner?: ConfigurationCommandRunner
  processEnvironment?: Readonly<NodeJS.ProcessEnv>
}

export type KubernetesResourceKind = 'secret' | 'configmap'

export type KubernetesResourceLookupResult =
  | { state: 'found'; resource: unknown }
  | { state: 'missing' }
  | { state: 'inaccessible' }

export type KubernetesResourceLookup = (
  kind: KubernetesResourceKind,
  name: string
) => KubernetesResourceLookupResult

export interface EnvironmentResolution {
  values: Map<string, string> | null
  warning?: string
}

interface ComposeProject {
  name: string
  configFiles: string[]
}

interface DiscoveredComposeProject {
  project: ComposeProject
  configFiles: string[]
  source: ConfigurationSource
}

interface ComposeDiscovery {
  projects: DiscoveredComposeProject[]
}

interface HelmRelease {
  name: string
  namespace: string
  chart: string
}

const SIM_COMPOSE_MARKERS = ['ghcr.io/simstudioai/simstudio', 'docker/app.Dockerfile'] as const

const COMPOSE_FILES = ['docker-compose.prod.yml', 'docker-compose.local.yml'] as const
const DEVELOPMENT_ENV_FILES = [
  '.env.development.local',
  '.env.local',
  '.env.development',
  '.env',
] as const
const DISCOVERY_COMMAND_TIMEOUT_MS = 10_000
const DEPLOYMENT_CONFIGURATION_KEY_SET = new Set(DEPLOYMENT_CONFIGURATION_KEYS)
const SPLIT_REQUIRED_KEYS = {
  sim: CORE_CONFIGURATION_KEYS,
  realtime: [
    'DATABASE_URL',
    'BETTER_AUTH_URL',
    'BETTER_AUTH_SECRET',
    'INTERNAL_API_SECRET',
    'NEXT_PUBLIC_APP_URL',
  ],
  db: ['DATABASE_URL'],
} as const

function defaultRunner(
  command: string,
  args: readonly string[],
  cwd: string
): ConfigurationCommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    timeout: DISCOVERY_COMMAND_TIMEOUT_MS,
  })
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

function runSafely(
  runner: ConfigurationCommandRunner,
  command: string,
  args: readonly string[],
  cwd: string
): ConfigurationCommandResult {
  try {
    return runner(command, args, cwd)
  } catch {
    return { status: null, stdout: '', stderr: '' }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

function readEnv(file: string): Map<string, string> {
  return parseEnv(readFileSync(file, 'utf8'))
}

function filterConfigurationValues(values: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...values].filter(([key]) => DEPLOYMENT_CONFIGURATION_KEY_SET.has(key)))
}

function inspectSplitConfiguration(root: string): string[] {
  const targets = [
    { id: 'sim', label: 'apps/sim/.env', file: path.join(root, 'apps/sim/.env') },
    {
      id: 'realtime',
      label: 'apps/realtime/.env',
      file: path.join(root, 'apps/realtime/.env'),
    },
    { id: 'db', label: 'packages/db/.env', file: path.join(root, 'packages/db/.env') },
  ] as const
  const issues: string[] = []
  const values = new Map<(typeof targets)[number]['id'], Map<string, string>>()

  for (const target of targets) {
    if (!existsSync(target.file)) {
      issues.push(`${target.label} is missing`)
      continue
    }
    const targetValues = readEnv(target.file)
    values.set(target.id, targetValues)
    for (const key of SPLIT_REQUIRED_KEYS[target.id]) {
      const value = targetValues.get(key)
      if (!value || isPlaceholder(value)) {
        issues.push(`${target.label}: ${key} is missing, empty, or a placeholder`)
      }
    }
  }

  const sim = values.get('sim')
  const realtime = values.get('realtime')
  if (sim && realtime) {
    for (const key of SHARED_KEYS) {
      const simValue = sim.get(key)
      const realtimeValue = realtime.get(key)
      if (simValue && realtimeValue && simValue !== realtimeValue) {
        issues.push(`${key} differs between apps/sim/.env and apps/realtime/.env`)
      }
    }
  }

  const db = values.get('db')
  const simDatabaseUrl = sim?.get('DATABASE_URL')
  const dbDatabaseUrl = db?.get('DATABASE_URL')
  if (simDatabaseUrl && dbDatabaseUrl && simDatabaseUrl !== dbDatabaseUrl) {
    issues.push('DATABASE_URL differs between apps/sim/.env and packages/db/.env')
  }
  return issues
}

function restoreProcessEnvironment(original: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key]
  }
  Object.assign(process.env, original)
}

function loadDevelopmentEnvironment(
  appDirectory: string,
  processEnvironment: Readonly<NodeJS.ProcessEnv>
): {
  values: Map<string, string>
  loadedFiles: string[]
  hasProcessOverrides: boolean
} {
  const originalEnvironment = { ...process.env }
  const configuredEnvironment = { ...processEnvironment }
  let loadFailed = false
  try {
    restoreProcessEnvironment(configuredEnvironment)
    process.env.NODE_ENV = 'development'
    const result = loadEnvConfig(
      appDirectory,
      true,
      {
        info: () => undefined,
        error: () => {
          loadFailed = true
        },
      },
      true
    )
    if (loadFailed) {
      throw new Error('One or more development environment files could not be loaded')
    }
    const loadedKeys = new Set(result.loadedEnvFiles.flatMap((file) => Object.keys(file.env)))
    const values = new Map<string, string>()
    for (const key of loadedKeys) {
      const loadedValue = result.combinedEnv[key]
      if (loadedValue !== undefined) values.set(key, loadedValue)
    }
    for (const key of DEPLOYMENT_CONFIGURATION_KEYS) {
      const processValue = configuredEnvironment[key]
      if (processValue !== undefined) values.set(key, processValue)
    }
    const hasProcessOverrides = DEPLOYMENT_CONFIGURATION_KEYS.some(
      (key) => configuredEnvironment[key] !== undefined
    )
    return {
      values,
      loadedFiles: result.loadedEnvFiles.map((file) => path.join(appDirectory, file.path)),
      hasProcessOverrides,
    }
  } finally {
    restoreProcessEnvironment(originalEnvironment)
  }
}

function hasSimComposeMarker(file: string): boolean {
  try {
    const contents = readFileSync(file, 'utf8')
    return SIM_COMPOSE_MARKERS.some((marker) => contents.includes(marker))
  } catch {
    return false
  }
}

/** Parses Docker's `KEY=value` environment representation without logging values. */
export function parseEnvironmentEntries(entries: readonly unknown[]): Map<string, string> | null {
  const values = new Map<string, string>()
  for (const entry of entries) {
    if (typeof entry !== 'string') return null
    const separator = entry.indexOf('=')
    if (separator <= 0) return null
    values.set(entry.slice(0, separator), entry.slice(separator + 1))
  }
  return values
}

/** Extracts the newest running, or newest stopped, container's effective environment. */
export function parseDockerInspectEnvironment(output: string): Map<string, string> | null {
  const parsed = parseJson(output)
  if (!Array.isArray(parsed)) return null

  const candidates: Array<{
    running: boolean
    created: string
    values: Map<string, string>
  }> = []
  for (const item of parsed) {
    const record = asRecord(item)
    const config = asRecord(record?.Config)
    if (!config || !Array.isArray(config.Env)) continue
    const values = parseEnvironmentEntries(config.Env)
    if (!values) continue
    const state = asRecord(record?.State)
    candidates.push({
      running: state?.Running === true,
      created: typeof record?.Created === 'string' ? record.Created : '',
      values,
    })
  }

  candidates.sort((left, right) => {
    if (left.running !== right.running) return left.running ? -1 : 1
    return right.created.localeCompare(left.created)
  })
  return candidates[0]?.values ?? null
}

function parseComposeProjects(output: string): ComposeProject[] | null {
  const parsed = parseJson(output)
  if (!Array.isArray(parsed)) return null
  const projects: ComposeProject[] = []
  for (const item of parsed) {
    const record = asRecord(item)
    const name = record?.Name
    const configFiles = record?.ConfigFiles
    if (typeof name !== 'string' || typeof configFiles !== 'string') return null
    const files = configFiles
      .split(',')
      .map((file) => file.trim())
      .filter(Boolean)
    if (files.length === 0) return null
    projects.push({ name, configFiles: files })
  }
  return projects
}

/** Reads `docker compose config --format json` and returns the resolved app environment. */
export function parseComposeConfigEnvironment(output: string): Map<string, string> | null {
  const parsed = asRecord(parseJson(output))
  const services = asRecord(parsed?.services)
  const app = asRecord(services?.simstudio)
  if (!app) return null
  if (Array.isArray(app.environment)) return parseEnvironmentEntries(app.environment)

  const environment = asRecord(app.environment)
  if (!environment) return null
  const values = new Map<string, string>()
  for (const [key, value] of Object.entries(environment)) {
    if (value === null) continue
    if (typeof value !== 'string') return null
    values.set(key, value)
  }
  return values
}

function stripYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function normalizeComposeEnvFilePath(value: string): string {
  const withoutPathKey = value.replace(/^path:\s*/, '')
  return stripYamlScalar(withoutPathKey).replace(/^\.\//, '')
}

function serviceRootEnvFileUsage(
  lines: readonly string[],
  serviceStart: number,
  serviceEnd: number
): boolean | null {
  const envFileStart = lines.findIndex(
    (line, index) => index > serviceStart && index < serviceEnd && /^ {4}env_file:\s*/.test(line)
  )
  if (envFileStart === -1) return false

  const inline = /^ {4}env_file:\s*(.+)$/.exec(lines[envFileStart])
  if (inline) return normalizeComposeEnvFilePath(inline[1]) === '.env' ? true : null

  const referencedFiles: string[] = []
  for (let index = envFileStart + 1; index < serviceEnd; index += 1) {
    const line = lines[index]
    if (/^ {4}\S/.test(line)) break
    const listEntry = /^ {6}-\s+(.+)$/.exec(line)
    const nestedPath = /^ {8}path:\s*(.+)$/.exec(line)
    if (listEntry) referencedFiles.push(normalizeComposeEnvFilePath(listEntry[1]))
    else if (nestedPath) referencedFiles.push(normalizeComposeEnvFilePath(nestedPath[1]))
  }
  if (referencedFiles.length !== 1) return null
  return referencedFiles[0] === '.env' ? true : null
}

function expandComposeValue(raw: string, variables: ReadonlyMap<string, string>): string | null {
  let valid = true
  const expanded = raw.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\+|\+|:\?|\?)([^}]*))?\}/g,
    (_match, key: string, operator: string | undefined, operand: string | undefined) => {
      const value = variables.get(key)
      const set = value !== undefined
      const nonEmpty = set && value !== ''
      if (!operator) return value ?? ''
      if (operator === ':-') return nonEmpty ? value : (operand ?? '')
      if (operator === '-') return set ? value : (operand ?? '')
      if (operator === ':+') return nonEmpty ? (operand ?? '') : ''
      if (operator === '+') return set ? (operand ?? '') : ''
      if (operator === ':?' && !nonEmpty) {
        valid = false
        return ''
      }
      if (operator === '?' && !set) {
        valid = false
        return ''
      }
      return value ?? ''
    }
  )
  if (!valid || expanded.includes('${')) return null
  return expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key: string) => {
    return variables.get(key) ?? ''
  })
}

/**
 * Resolves the current repository's simple Compose app environment when Docker
 * is unavailable. The checked-in files use list-form `KEY=value` entries.
 */
export function parseComposeFileEnvironment(
  contents: string,
  envFileValues: ReadonlyMap<string, string>
): Map<string, string> | null {
  const lines = contents.split('\n')
  const serviceStart = lines.findIndex((line) => /^ {2}simstudio:\s*$/.test(line))
  if (serviceStart === -1) return null

  let serviceEnd = lines.length
  for (let index = serviceStart + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_.-]+:\s*$/.test(lines[index])) {
      serviceEnd = index
      break
    }
  }

  const rootEnvFileUsage = serviceRootEnvFileUsage(lines, serviceStart, serviceEnd)
  if (rootEnvFileUsage === null) return null
  const values = rootEnvFileUsage ? new Map(envFileValues) : new Map<string, string>()

  let environmentStart = -1
  for (let index = serviceStart + 1; index < serviceEnd; index += 1) {
    const environment = /^ {4}environment:\s*(.*)$/.exec(lines[index])
    if (environment && environment[1] !== '') return null
    if (environment) {
      environmentStart = index
      break
    }
  }
  if (environmentStart === -1) return values

  for (let index = environmentStart + 1; index < serviceEnd; index += 1) {
    const line = lines[index]
    if (/^ {4}\S/.test(line) && !/^ {6}/.test(line)) break
    const listEntry = /^ {6}-\s+(.+)$/.exec(line)
    const mapEntry = /^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    let key: string
    let raw: string
    if (listEntry) {
      const entry = stripYamlScalar(listEntry[1])
      const separator = entry.indexOf('=')
      if (separator === -1) {
        if (envFileValues.has(entry)) values.set(entry, envFileValues.get(entry) ?? '')
        continue
      }
      key = entry.slice(0, separator)
      raw = entry.slice(separator + 1)
    } else if (mapEntry) {
      key = mapEntry[1]
      raw = stripYamlScalar(mapEntry[2])
    } else {
      continue
    }
    const expanded = expandComposeValue(raw, envFileValues)
    if (expanded === null) return null
    values.set(key, expanded)
  }
  return values
}

function preparedComposeSource(root: string, managed: boolean): ConfigurationSource | null {
  const envPath = path.join(root, '.env')
  if (!existsSync(envPath)) return null
  const envValues = readEnv(envPath)
  const composeFiles = COMPOSE_FILES.map((file) => path.join(root, file)).filter(
    (file) => existsSync(file) && hasSimComposeMarker(file)
  )
  if (composeFiles.length === 0) {
    return {
      kind: 'compose',
      label: 'Current checkout (Compose prepared)',
      location: envPath,
      values: null,
      warning:
        'No checked-in Sim Compose file could be read; effective container values are unknown.',
      managedByCurrentCheckout: managed,
    }
  }
  if (composeFiles.length > 1) {
    return {
      kind: 'compose',
      label: 'Current checkout (Compose prepared)',
      location: `${envPath} · candidates ${composeFiles.join(', ')}`,
      values: null,
      warning:
        'More than one Sim Compose variant is present and no live project identifies which one is selected.',
      managedByCurrentCheckout: managed,
    }
  }

  const composeFile = composeFiles[0]
  const resolvedValues = parseComposeFileEnvironment(readFileSync(composeFile, 'utf8'), envValues)
  const values = resolvedValues ? filterConfigurationValues(resolvedValues) : null
  return {
    kind: 'compose',
    label: 'Current checkout (Compose prepared)',
    location: `${envPath} · ${composeFile}`,
    values,
    ...(values
      ? {}
      : {
          warning:
            'The Sim app environment could not be resolved from the Compose file; run Docker Compose before relying on this status.',
        }),
    managedByCurrentCheckout: managed,
  }
}

function localSources(
  root: string,
  processEnvironment: Readonly<NodeJS.ProcessEnv>
): {
  sources: ConfigurationSource[]
  setupSplitExists: boolean
  prepared: ConfigurationSource | null
} {
  const appDirectory = path.join(root, 'apps/sim')
  const simEnv = path.join(appDirectory, '.env')
  const setupSplitFiles = [
    simEnv,
    path.join(root, 'apps/realtime/.env'),
    path.join(root, 'packages/db/.env'),
  ]
  const setupSplitExists = setupSplitFiles.some(existsSync)
  const developmentExists =
    setupSplitExists ||
    DEVELOPMENT_ENV_FILES.some((file) => existsSync(path.join(appDirectory, file)))
  const sources: ConfigurationSource[] = []
  if (developmentExists) {
    const development = loadDevelopmentEnvironment(appDirectory, processEnvironment)
    const hasHigherPrecedenceFile = development.loadedFiles.some(
      (file) => canonicalPath(file) !== canonicalPath(simEnv)
    )
    sources.push({
      kind: 'dev',
      label: 'Current checkout (development)',
      location:
        development.loadedFiles.length > 0
          ? `process environment + ${development.loadedFiles.join(', ')}`
          : `${appDirectory} (process environment only)`,
      values: development.values,
      ...(development.loadedFiles.length > 0
        ? {}
        : { warning: 'No application env file was loaded; only the process environment applies.' }),
      configurationIssues: inspectSplitConfiguration(root),
      managedByCurrentCheckout:
        setupSplitExists && !hasHigherPrecedenceFile && !development.hasProcessOverrides,
    })
  }
  return {
    sources,
    setupSplitExists,
    prepared: preparedComposeSource(root, !setupSplitExists),
  }
}

function resolveComposeProjectEnvironment(
  runner: ConfigurationCommandRunner,
  root: string,
  project: ComposeProject,
  configFiles: readonly string[]
): EnvironmentResolution {
  const containers = runSafely(
    runner,
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.project=${project.name}`,
      '--filter',
      'label=com.docker.compose.service=simstudio',
      '--format',
      '{{.ID}}',
    ],
    root
  )
  if (containers.status !== 0) {
    return {
      values: null,
      warning: 'The Compose app containers could not be enumerated; effective values are unknown.',
    }
  }
  const ids = containers.stdout
    .split('\n')
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids.length > 0) {
    const inspect = runSafely(runner, 'docker', ['inspect', ...ids], root)
    if (inspect.status !== 0) {
      return {
        values: null,
        warning: 'The Compose app container could not be inspected; effective values are unknown.',
      }
    }
    const values = parseDockerInspectEnvironment(inspect.stdout)
    if (values) return { values: filterConfigurationValues(values) }
    return {
      values: null,
      warning:
        'Docker returned an invalid Compose app container definition; effective values are unknown.',
    }
  }

  const composeArgs = ['compose', '-p', project.name]
  for (const file of configFiles) composeArgs.push('-f', file)
  composeArgs.push('config', '--format', 'json')
  const config = runSafely(runner, 'docker', composeArgs, path.dirname(configFiles[0]))
  if (config.status === 0) {
    const values = parseComposeConfigEnvironment(config.stdout)
    if (values) return { values: filterConfigurationValues(values) }
  }

  return {
    values: null,
    warning:
      'The simstudio container and resolved Compose configuration could not be read; effective values are unknown.',
  }
}

function discoverComposeProjects(
  runner: ConfigurationCommandRunner,
  root: string
): ComposeDiscovery {
  const info = runSafely(runner, 'docker', ['info'], root)
  if (info.status !== 0) return { projects: [] }
  const listed = runSafely(runner, 'docker', ['compose', 'ls', '-a', '--format', 'json'], root)
  if (listed.status !== 0) return { projects: [] }
  const projects = parseComposeProjects(listed.stdout)
  if (!projects) throw new Error('Docker Compose returned an invalid project list')

  const discovered: DiscoveredComposeProject[] = []
  const seen = new Set<string>()
  for (const project of projects) {
    const configFiles = project.configFiles.map((file) => path.resolve(root, file))
    if (!configFiles.some(hasSimComposeMarker)) continue
    const identity = `${project.name}\0${configFiles.map(canonicalPath).sort().join('\0')}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const resolution = resolveComposeProjectEnvironment(runner, root, project, configFiles)
    discovered.push({
      project,
      configFiles,
      source: {
        kind: 'compose',
        label: `Compose project "${project.name}"`,
        location: configFiles.join(', '),
        values: resolution.values,
        ...(resolution.warning ? { warning: resolution.warning } : {}),
        managedByCurrentCheckout: false,
      },
    })
  }
  return { projects: discovered }
}

function decodeBase64(value: string): string | null {
  if (
    value !== '' &&
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return null
  }
  return Buffer.from(value, 'base64').toString('utf8')
}

function resourceEnvironment(
  kind: KubernetesResourceKind,
  resource: unknown
): EnvironmentResolution {
  const record = asRecord(resource)
  if (!record) return { values: null, warning: 'Kubernetes returned an invalid resource.' }
  const values = new Map<string, string>()
  const data = record.data === undefined ? {} : asRecord(record.data)
  if (!data) return { values: null, warning: 'Kubernetes returned invalid resource data.' }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') {
      return { values: null, warning: 'Kubernetes returned a non-string environment value.' }
    }
    if (kind === 'secret') {
      const decoded = decodeBase64(value)
      if (decoded === null) {
        return { values: null, warning: 'Kubernetes returned invalid Secret data.' }
      }
      values.set(key, decoded)
    } else {
      values.set(key, value)
    }
  }

  const secondaryKey = kind === 'secret' ? 'stringData' : 'binaryData'
  const secondary = record[secondaryKey] === undefined ? {} : asRecord(record[secondaryKey])
  if (!secondary) return { values: null, warning: 'Kubernetes returned invalid resource data.' }
  for (const [key, value] of Object.entries(secondary)) {
    if (typeof value !== 'string') {
      return { values: null, warning: 'Kubernetes returned a non-string environment value.' }
    }
    if (kind === 'configmap') {
      const decoded = decodeBase64(value)
      if (decoded === null) {
        return { values: null, warning: 'Kubernetes returned invalid ConfigMap binary data.' }
      }
      values.set(key, decoded)
    } else {
      values.set(key, value)
    }
  }
  return { values }
}

function inaccessibleResourceWarning(kind: KubernetesResourceKind, name: string): string {
  const displayKind = kind === 'secret' ? 'Secret' : 'ConfigMap'
  return `Cannot read ${displayKind} "${name}"; configuration status is unknown. Verify kubectl RBAC allows get access in this namespace.`
}

function missingResourceWarning(kind: KubernetesResourceKind, name: string): string {
  const displayKind = kind === 'secret' ? 'Secret' : 'ConfigMap'
  return `${displayKind} "${name}" is required by the app Deployment but does not exist; configuration status is unknown.`
}

function loadKubernetesResource(
  kind: KubernetesResourceKind,
  name: string,
  optional: boolean,
  lookup: KubernetesResourceLookup
): EnvironmentResolution & { missing?: boolean } {
  const result = lookup(kind, name)
  if (result.state === 'inaccessible') {
    return { values: null, warning: inaccessibleResourceWarning(kind, name) }
  }
  if (result.state === 'missing') {
    return optional
      ? { values: new Map(), missing: true }
      : { values: null, warning: missingResourceWarning(kind, name) }
  }
  const resolution = resourceEnvironment(kind, result.resource)
  return resolution.values
    ? resolution
    : {
        values: null,
        warning: `${resolution.warning ?? 'Kubernetes resource could not be decoded'} Configuration status is unknown.`,
      }
}

/** Resolves Kubernetes `envFrom` then explicit `env`, matching Kubernetes precedence. */
export function resolveKubernetesContainerEnvironment(
  container: unknown,
  lookup: KubernetesResourceLookup
): EnvironmentResolution {
  const record = asRecord(container)
  if (!record) return { values: null, warning: 'The app container definition is invalid.' }
  const values = new Map<string, string>()
  const envFrom = record.envFrom === undefined ? [] : record.envFrom
  if (!Array.isArray(envFrom)) {
    return { values: null, warning: 'The app container envFrom definition is invalid.' }
  }

  for (const source of envFrom) {
    const sourceRecord = asRecord(source)
    if (!sourceRecord)
      return { values: null, warning: 'The app container envFrom entry is invalid.' }
    const secretRef = asRecord(sourceRecord.secretRef)
    const configMapRef = asRecord(sourceRecord.configMapRef)
    const kind: KubernetesResourceKind | null = secretRef
      ? 'secret'
      : configMapRef
        ? 'configmap'
        : null
    const reference = secretRef ?? configMapRef
    if (!kind || !reference || typeof reference.name !== 'string') {
      return { values: null, warning: 'The app container envFrom reference is invalid.' }
    }
    const loaded = loadKubernetesResource(kind, reference.name, reference.optional === true, lookup)
    if (!loaded.values) return loaded
    const prefix = sourceRecord.prefix === undefined ? '' : sourceRecord.prefix
    if (typeof prefix !== 'string') {
      return { values: null, warning: 'The app container envFrom prefix is invalid.' }
    }
    for (const [key, value] of loaded.values) values.set(`${prefix}${key}`, value)
  }

  const explicitEnv = record.env === undefined ? [] : record.env
  if (!Array.isArray(explicitEnv)) {
    return { values: null, warning: 'The app container env definition is invalid.' }
  }
  for (const entry of explicitEnv) {
    const env = asRecord(entry)
    if (!env || typeof env.name !== 'string' || env.name === '') {
      return { values: null, warning: 'The app container has an invalid explicit env entry.' }
    }
    if (env.value !== undefined) {
      if (typeof env.value !== 'string' || env.valueFrom !== undefined) {
        return { values: null, warning: `Explicit env "${env.name}" is invalid.` }
      }
      values.set(env.name, env.value)
      continue
    }
    if (env.valueFrom === undefined) {
      values.set(env.name, '')
      continue
    }

    const valueFrom = asRecord(env.valueFrom)
    const secretKeyRef = asRecord(valueFrom?.secretKeyRef)
    const configMapKeyRef = asRecord(valueFrom?.configMapKeyRef)
    const kind: KubernetesResourceKind | null = secretKeyRef
      ? 'secret'
      : configMapKeyRef
        ? 'configmap'
        : null
    const reference = secretKeyRef ?? configMapKeyRef
    if (
      !kind ||
      !reference ||
      typeof reference.name !== 'string' ||
      typeof reference.key !== 'string'
    ) {
      return {
        values: null,
        warning: `Explicit env "${env.name}" uses an unsupported or invalid valueFrom source.`,
      }
    }
    const loaded = loadKubernetesResource(kind, reference.name, reference.optional === true, lookup)
    if (!loaded.values) return loaded
    if (loaded.missing) continue
    const value = loaded.values.get(reference.key)
    if (value === undefined) {
      if (reference.optional === true) continue
      return {
        values: null,
        warning: `${kind === 'secret' ? 'Secret' : 'ConfigMap'} "${reference.name}" does not contain key "${reference.key}"; configuration status is unknown.`,
      }
    }
    values.set(env.name, value)
  }
  return { values }
}

function parseHelmReleases(output: string): HelmRelease[] | null {
  const parsed = parseJson(output)
  if (!Array.isArray(parsed)) return null
  const releases: HelmRelease[] = []
  for (const item of parsed) {
    const record = asRecord(item)
    if (
      typeof record?.name !== 'string' ||
      typeof record.namespace !== 'string' ||
      typeof record.chart !== 'string'
    ) {
      return null
    }
    if (record.chart.startsWith('sim-')) {
      releases.push({ name: record.name, namespace: record.namespace, chart: record.chart })
    }
  }
  return releases
}

function helmLocation(context: string, release: HelmRelease): string {
  return `context ${context} · namespace ${release.namespace} · release ${release.name}`
}

function helmUnknown(release: HelmRelease, context: string, warning: string): ConfigurationSource {
  return {
    kind: 'helm',
    label: `Helm release "${release.name}"`,
    location: helmLocation(context, release),
    values: null,
    warning,
    managedByCurrentCheckout: false,
  }
}

function discoverHelmReleases(
  runner: ConfigurationCommandRunner,
  root: string
): ConfigurationSource[] {
  const contextResult = runSafely(runner, 'kubectl', ['config', 'current-context'], root)
  if (contextResult.status !== 0) return []
  const context = contextResult.stdout.trim()
  if (!context) return []
  const listed = runSafely(
    runner,
    'helm',
    ['list', '-A', '--deployed', '--failed', '-o', 'json', '--kube-context', context],
    root
  )
  if (listed.status !== 0) return []
  const releases = parseHelmReleases(listed.stdout)
  if (!releases) throw new Error('Helm returned an invalid release list')
  const seen = new Set<string>()
  const sources: ConfigurationSource[] = []

  for (const release of releases) {
    const identity = `${release.namespace}\0${release.name}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const selector = `app.kubernetes.io/instance=${release.name},app.kubernetes.io/component=app`
    const deploymentResult = runSafely(
      runner,
      'kubectl',
      [
        'get',
        'deployments',
        '-n',
        release.namespace,
        '-l',
        selector,
        '-o',
        'json',
        '--context',
        context,
      ],
      root
    )
    if (deploymentResult.status !== 0) {
      sources.push(
        helmUnknown(
          release,
          context,
          `Cannot read the app Deployment in namespace "${release.namespace}"; verify kubectl access to the current context.`
        )
      )
      continue
    }
    const deploymentList = asRecord(parseJson(deploymentResult.stdout))
    const items = deploymentList?.items
    const itemCount = Array.isArray(items) ? items.length : null
    if (!Array.isArray(items) || items.length !== 1) {
      sources.push(
        helmUnknown(
          release,
          context,
          itemCount === 0
            ? 'No app Deployment matched the Sim instance/component labels.'
            : 'More than one app Deployment matched the Sim instance/component labels.'
        )
      )
      continue
    }
    const deployment = asRecord(items[0])
    const spec = asRecord(deployment?.spec)
    const template = asRecord(spec?.template)
    const podSpec = asRecord(template?.spec)
    const containers = podSpec?.containers
    if (!Array.isArray(containers)) {
      sources.push(
        helmUnknown(release, context, 'The app Deployment has no readable containers list.')
      )
      continue
    }
    const appContainer = containers.find((container) => asRecord(container)?.name === 'app')
    if (!appContainer) {
      sources.push(
        helmUnknown(release, context, 'The app Deployment has no container named "app".')
      )
      continue
    }

    const resourceCache = new Map<string, KubernetesResourceLookupResult>()
    const lookup: KubernetesResourceLookup = (kind, name) => {
      const key = `${kind}\0${name}`
      const cached = resourceCache.get(key)
      if (cached) return cached
      const result = runSafely(
        runner,
        'kubectl',
        [
          'get',
          kind,
          name,
          '-n',
          release.namespace,
          '--ignore-not-found',
          '-o',
          'json',
          '--context',
          context,
        ],
        root
      )
      let resolved: KubernetesResourceLookupResult
      if (result.status !== 0) resolved = { state: 'inaccessible' }
      else if (result.stdout.trim() === '') resolved = { state: 'missing' }
      else {
        const resource = parseJson(result.stdout)
        resolved = resource === null ? { state: 'inaccessible' } : { state: 'found', resource }
      }
      resourceCache.set(key, resolved)
      return resolved
    }
    const resolution = resolveKubernetesContainerEnvironment(appContainer, lookup)
    sources.push({
      kind: 'helm',
      label: `Helm release "${release.name}"`,
      location: helmLocation(context, release),
      values: resolution.values ? filterConfigurationValues(resolution.values) : null,
      ...(resolution.warning ? { warning: resolution.warning } : {}),
      managedByCurrentCheckout: false,
    })
  }
  return sources
}

/** Discovers every configuration snapshot without writing or displaying environment values. */
export function discoverConfigurationSources(
  options: ConfigurationSourceDiscoveryOptions = {}
): ConfigurationSource[] {
  const root = path.resolve(options.root ?? ROOT)
  const runner = options.runner ?? defaultRunner
  const local = localSources(root, options.processEnvironment ?? process.env)
  const compose = discoverComposeProjects(runner, root)
  const rootPath = canonicalPath(root)
  const currentRootProjects = compose.projects.filter((project) => {
    return project.configFiles.some((file) => canonicalPath(path.dirname(file)) === rootPath)
  })
  const knownCurrentFiles = new Set(
    COMPOSE_FILES.map((file) => canonicalPath(path.join(root, file)))
  )
  const rootEnvExists = existsSync(path.join(root, '.env'))
  const canManageCurrentCompose =
    !local.setupSplitExists && rootEnvExists && currentRootProjects.length === 1

  for (const project of currentRootProjects) {
    const exactCurrentFileSet =
      project.configFiles.length === 1 &&
      knownCurrentFiles.has(canonicalPath(project.configFiles[0]))
    project.source.managedByCurrentCheckout = canManageCurrentCompose && exactCurrentFileSet
  }

  const sources = [...local.sources]
  if (currentRootProjects.length === 0 && local.prepared) sources.push(local.prepared)
  sources.push(...compose.projects.map((project) => project.source))
  sources.push(...discoverHelmReleases(runner, root))
  return sources
}
