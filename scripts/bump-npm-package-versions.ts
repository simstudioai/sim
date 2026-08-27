#!/usr/bin/env bun

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCKFILE_PATH = path.join(ROOT, 'bun.lock')
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

interface PackageConfig {
  readonly allowInitialPublish?: boolean
  readonly manifestPath: string
  readonly name: string
  readonly selector: string
  readonly workspacePath: string
}

interface PackageManifest extends Record<string, unknown> {
  name: string
  version: string
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

interface PlannedUpdate {
  config: PackageConfig
  currentVersion: string
  manifest: PackageManifest
  nextVersion: string
}

const PACKAGE_CONFIGS = [
  {
    manifestPath: path.join(ROOT, 'packages/sim-cli/package.json'),
    name: 'sim',
    selector: 'sim-cli',
    workspacePath: 'packages/sim-cli',
  },
  {
    manifestPath: path.join(ROOT, 'packages/sim-setup/package.json'),
    name: 'sim-setup',
    selector: 'sim-setup',
    workspacePath: 'packages/sim-setup',
  },
  {
    allowInitialPublish: true,
    manifestPath: path.join(ROOT, 'packages/sim-skills/package.json'),
    name: 'sim-skills',
    selector: 'sim-skills',
    workspacePath: 'packages/sim-skills',
  },
] as const satisfies readonly PackageConfig[]

function parseStableVersion(version: string, source: string): ParsedVersion {
  const match = STABLE_VERSION_PATTERN.exec(version)
  if (!match) {
    throw new Error(`${source} must be a stable X.Y.Z version, got '${version}'`)
  }

  const parsed = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
  if (!Number.isSafeInteger(parsed.major)) {
    throw new Error(`${source} major version exceeds JavaScript's safe integer range`)
  }
  if (!Number.isSafeInteger(parsed.minor)) {
    throw new Error(`${source} minor version exceeds JavaScript's safe integer range`)
  }
  if (!Number.isSafeInteger(parsed.patch)) {
    throw new Error(`${source} patch version exceeds JavaScript's safe integer range`)
  }
  return parsed
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

function formatVersion(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

/**
 * Resolves the stable version a package should use for its next publish.
 *
 * A higher manifest version is an explicit release decision and is preserved.
 * Otherwise the highest published stable version receives a patch increment.
 * Prereleases never advance the stable line.
 */
export function resolveNextStableVersion(
  manifestVersion: string,
  publishedVersions: string[],
  options: { allowInitialPublish?: boolean } = {}
): string {
  const manifest = parseStableVersion(manifestVersion, 'Manifest version')
  const stableVersions = publishedVersions.flatMap((version) => {
    if (typeof version !== 'string') {
      throw new Error('npm returned a non-string package version')
    }
    return STABLE_VERSION_PATTERN.test(version)
      ? [parseStableVersion(version, 'Published version')]
      : []
  })

  if (stableVersions.length === 0) {
    if (options.allowInitialPublish) return formatVersion(manifest)
    throw new Error('npm returned no published stable versions')
  }

  const latestPublished = stableVersions.reduce((latest, version) =>
    compareVersions(version, latest) > 0 ? version : latest
  )
  if (compareVersions(manifest, latestPublished) > 0) return formatVersion(manifest)

  if (latestPublished.patch === Number.MAX_SAFE_INTEGER) {
    throw new Error('Published patch version cannot be incremented safely')
  }
  return formatVersion({ ...latestPublished, patch: latestPublished.patch + 1 })
}

function readManifest(config: PackageConfig): PackageManifest {
  const metadata: unknown = JSON.parse(readFileSync(config.manifestPath, 'utf8'))
  if (metadata === null || typeof metadata !== 'object') {
    throw new Error(`${config.workspacePath}/package.json must contain a JSON object`)
  }

  const manifest = metadata as Record<string, unknown>
  if (manifest.name !== config.name) {
    throw new Error(
      `${config.workspacePath}/package.json must describe '${config.name}', got '${String(manifest.name)}'`
    )
  }
  if (typeof manifest.version !== 'string') {
    throw new Error(`${config.workspacePath}/package.json is missing a string version`)
  }
  return manifest as PackageManifest
}

function commandStderr(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return undefined
  const stderr = error.stderr
  if (typeof stderr === 'string') return stderr
  if (Buffer.isBuffer(stderr)) return stderr.toString('utf8')
  return undefined
}

export function isMissingNpmPackageError(stderr: string, packageName: string): boolean {
  return (
    stderr.includes('404 Not Found:') &&
    stderr.includes(`'${packageName}@latest' does not exist in this registry`)
  )
}

function publishedVersions(config: PackageConfig): string[] {
  let output: string
  try {
    output = execFileSync('bun', ['pm', 'view', config.name, 'versions', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr = commandStderr(error)
    if (config.allowInitialPublish && stderr && isMissingNpmPackageError(stderr, config.name)) {
      return []
    }
    const detail = stderr?.trim()
    throw new Error(
      `Could not read published versions for '${config.name}' from npm${detail ? `: ${detail}` : ''}`,
      { cause: error }
    )
  }

  let metadata: unknown
  try {
    metadata = JSON.parse(output)
  } catch (error) {
    throw new Error(`npm returned invalid JSON for '${config.name}'`, { cause: error })
  }
  if (!Array.isArray(metadata)) {
    throw new Error(`npm did not return a version array for '${config.name}'`)
  }
  return metadata
}

/** Updates one workspace version without touching an identically named version elsewhere. */
export function updateLockfileWorkspaceVersion(
  lockfile: string,
  workspacePath: string,
  packageName: string,
  currentVersion: string,
  nextVersion: string
): string {
  const marker = `    "${workspacePath}": {`
  const workspaceStart = lockfile.indexOf(marker)
  if (workspaceStart === -1 || lockfile.indexOf(marker, workspaceStart + marker.length) !== -1) {
    throw new Error(`bun.lock must contain exactly one '${workspacePath}' workspace entry`)
  }

  const nextWorkspace = lockfile.indexOf('\n    "packages/', workspaceStart + marker.length)
  if (nextWorkspace === -1) {
    throw new Error(`bun.lock has no workspace boundary after '${workspacePath}'`)
  }
  const workspace = lockfile.slice(workspaceStart, nextWorkspace)
  const currentMetadata = `      "name": "${packageName}",\n      "version": "${currentVersion}",`
  const metadataIndex = workspace.indexOf(currentMetadata)
  if (
    metadataIndex === -1 ||
    workspace.indexOf(currentMetadata, metadataIndex + currentMetadata.length) !== -1
  ) {
    throw new Error(
      `bun.lock must contain exactly one ${packageName}@${currentVersion} entry in '${workspacePath}'`
    )
  }

  const nextWorkspaceContents = workspace.replace(
    currentMetadata,
    `      "name": "${packageName}",\n      "version": "${nextVersion}",`
  )
  return `${lockfile.slice(0, workspaceStart)}${nextWorkspaceContents}${lockfile.slice(nextWorkspace)}`
}

function selectedPackages(args: string[]): readonly PackageConfig[] {
  if (args.length === 0) return PACKAGE_CONFIGS

  const uniqueArgs = new Set(args)
  if (uniqueArgs.size !== args.length) {
    throw new Error('Package selectors must not be repeated')
  }

  return args.map((selector) => {
    const config = PACKAGE_CONFIGS.find((candidate) => candidate.selector === selector)
    if (!config) {
      throw new Error(
        `Unknown package '${selector}'. Expected one of: ${PACKAGE_CONFIGS.map((candidate) => candidate.selector).join(', ')}`
      )
    }
    return config
  })
}

function main(): void {
  const configs = selectedPackages(process.argv.slice(2))
  const updates = configs.map<PlannedUpdate>((config) => {
    const manifest = readManifest(config)
    return {
      config,
      currentVersion: manifest.version,
      manifest,
      nextVersion: resolveNextStableVersion(manifest.version, publishedVersions(config), {
        allowInitialPublish: config.allowInitialPublish,
      }),
    }
  })

  let nextLockfile = readFileSync(LOCKFILE_PATH, 'utf8')
  for (const update of updates) {
    nextLockfile = updateLockfileWorkspaceVersion(
      nextLockfile,
      update.config.workspacePath,
      update.config.name,
      update.currentVersion,
      update.nextVersion
    )
  }

  for (const update of updates) {
    update.manifest.version = update.nextVersion
  }
  for (const update of updates) {
    writeFileSync(update.config.manifestPath, `${JSON.stringify(update.manifest, null, 2)}\n`)
  }
  writeFileSync(LOCKFILE_PATH, nextLockfile)

  for (const update of updates) {
    process.stdout.write(
      `${update.config.name}: ${update.currentVersion} -> ${update.nextVersion}\n`
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
