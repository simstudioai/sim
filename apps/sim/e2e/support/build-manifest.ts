import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { ChildEnvironment } from './env'
import { E2E_BUILD_CACHE_DIR, REPO_ROOT, SIM_APP_DIR } from './paths'

const BUILD_MANIFEST_VERSION = 1
const NEXT_DIR = path.join(SIM_APP_DIR, '.next')
const ROOT_BUILD_FILES = new Set([
  'bun.lock',
  'bunfig.toml',
  'package.json',
  'turbo.json',
  'tsconfig.json',
])
const UNHASHED_OS_ENV_KEYS = new Set([
  'PATH',
  'USER',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SYSTEMROOT',
  'GITHUB_ACTIONS',
])

export interface BuildIdentity {
  schemaVersion: typeof BUILD_MANIFEST_VERSION
  nextBuildHash: string
  sourceHash: string
  profileHash: string
  nodeVersion: string
  bunVersion: string
  nextVersion: string
  platform: NodeJS.Platform
  architecture: string
}

interface BuildManifest extends BuildIdentity {
  completed: true
  createdAt: string
  buildId: string
  artifactHash: string
}

export interface BuildReuseDecision {
  reused: boolean
  nextBuildHash: string
  reason: string
  cacheDirectory: string
}

export interface BuildArtifactPaths {
  activeNextDirectory: string
  buildCacheDirectory: string
}

const DEFAULT_ARTIFACT_PATHS: BuildArtifactPaths = {
  activeNextDirectory: NEXT_DIR,
  buildCacheDirectory: E2E_BUILD_CACHE_DIR,
}

export function computeBuildIdentity(options: {
  buildEnvironment: ChildEnvironment
  nodeExecutable: string
}): BuildIdentity {
  const sourceHash = hashRepositoryFiles(listRepositoryFiles().filter(isNextBuildInput))
  const profileHash = hashJson(
    Object.fromEntries(
      Object.entries(options.buildEnvironment.env)
        .filter(([key]) => !UNHASHED_OS_ENV_KEYS.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
    )
  )
  const nodeVersion = getExecutableVersion(options.nodeExecutable)
  const bunVersion = process.versions.bun ?? 'not-bun'
  const nextVersion = readPackageVersion(path.join(REPO_ROOT, 'node_modules/next/package.json'))
  const stableIdentity = {
    schemaVersion: BUILD_MANIFEST_VERSION,
    sourceHash,
    profileHash,
    nodeVersion,
    bunVersion,
    nextVersion,
    platform: process.platform,
    architecture: process.arch,
  } as const

  return {
    ...stableIdentity,
    nextBuildHash: hashJson(stableIdentity),
  }
}

export function restoreCachedBuild(
  identity: BuildIdentity,
  paths: BuildArtifactPaths = DEFAULT_ARTIFACT_PATHS
): BuildReuseDecision {
  clearInterruptedBuildStores(paths.buildCacheDirectory)
  const cacheDirectory = getCacheDirectory(identity.nextBuildHash, paths)
  const manifestPath = path.join(cacheDirectory, 'manifest.json')
  const artifactDirectory = path.join(cacheDirectory, '.next')
  const miss = (reason: string): BuildReuseDecision => ({
    reused: false,
    nextBuildHash: identity.nextBuildHash,
    reason,
    cacheDirectory,
  })

  if (!existsSync(manifestPath) || !existsSync(artifactDirectory)) {
    return miss('cache artifact or completed manifest is missing')
  }

  let manifest: BuildManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BuildManifest
  } catch {
    return miss('cache manifest is unreadable')
  }
  if (!isMatchingIdentity(manifest, identity) || manifest.completed !== true) {
    return miss('cache manifest identity does not match')
  }
  const buildIdPath = path.join(artifactDirectory, 'BUILD_ID')
  if (!existsSync(buildIdPath) || readFileSync(buildIdPath, 'utf8').trim() !== manifest.buildId) {
    return miss('cached BUILD_ID does not match the manifest')
  }
  if (hashDirectory(artifactDirectory) !== manifest.artifactHash) {
    return miss('cached artifact checksum does not match the manifest')
  }

  activateDirectory(artifactDirectory, paths.activeNextDirectory)
  return {
    reused: true,
    nextBuildHash: identity.nextBuildHash,
    reason: 'verified cache hit',
    cacheDirectory,
  }
}

export function storeCompletedBuild(
  identity: BuildIdentity,
  paths: BuildArtifactPaths = DEFAULT_ARTIFACT_PATHS
): BuildReuseDecision {
  const buildIdPath = path.join(paths.activeNextDirectory, 'BUILD_ID')
  if (!existsSync(buildIdPath)) {
    throw new Error('Next build completed without .next/BUILD_ID')
  }

  mkdirSync(paths.buildCacheDirectory, { recursive: true })
  const cacheDirectory = getCacheDirectory(identity.nextBuildHash, paths)
  const temporaryDirectory = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}`
  rmSync(temporaryDirectory, { recursive: true, force: true })
  mkdirSync(temporaryDirectory, { recursive: true })
  const artifactDirectory = path.join(temporaryDirectory, '.next')
  cpSync(paths.activeNextDirectory, artifactDirectory, {
    recursive: true,
    verbatimSymlinks: true,
  })

  const manifest: BuildManifest = {
    ...identity,
    completed: true,
    createdAt: new Date().toISOString(),
    buildId: readFileSync(buildIdPath, 'utf8').trim(),
    artifactHash: hashDirectory(artifactDirectory),
  }
  writeFileSync(
    path.join(temporaryDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  )
  rmSync(cacheDirectory, { recursive: true, force: true })
  renameSync(temporaryDirectory, cacheDirectory)

  return {
    reused: false,
    nextBuildHash: identity.nextBuildHash,
    reason: 'fresh build stored in verified cache',
    cacheDirectory,
  }
}

export function pruneBuildCache(
  retainedHash: string,
  maxEntries = 1,
  buildCacheDirectory = E2E_BUILD_CACHE_DIR
): string[] {
  if (!existsSync(buildCacheDirectory)) return []
  clearInterruptedBuildStores(buildCacheDirectory)
  const entries = readdirSync(buildCacheDirectory)
  const candidates = entries
    .filter((name) => !name.includes('.tmp-'))
    .map((name) => {
      const directory = path.join(buildCacheDirectory, name)
      const stats = lstatSync(directory)
      return stats.isDirectory() && !name.includes('.tmp-')
        ? { name, directory, modifiedAt: stats.mtimeMs }
        : null
    })
    .filter(
      (candidate): candidate is { name: string; directory: string; modifiedAt: number } =>
        candidate !== null
    )
    .sort((left, right) => {
      if (left.name === retainedHash) return -1
      if (right.name === retainedHash) return 1
      return right.modifiedAt - left.modifiedAt
    })
  const removed = candidates.slice(Math.max(1, maxEntries))
  for (const candidate of removed) {
    rmSync(candidate.directory, { recursive: true, force: true })
  }
  return removed.map(({ name }) => name)
}

function clearInterruptedBuildStores(buildCacheDirectory: string): void {
  if (!existsSync(buildCacheDirectory)) return
  for (const name of readdirSync(buildCacheDirectory).filter((entry) => entry.includes('.tmp-'))) {
    rmSync(path.join(buildCacheDirectory, name), { recursive: true, force: true })
  }
}

export function clearActiveNextBuild(
  activeNextDirectory = DEFAULT_ARTIFACT_PATHS.activeNextDirectory
): void {
  rmSync(activeNextDirectory, { recursive: true, force: true })
  clearStaleActivationDirectories(activeNextDirectory)
}

function listRepositoryFiles(): string[] {
  const result = spawnSync(
    'git',
    ['-C', REPO_ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    }
  )
  if (result.status !== 0) {
    throw new Error(`Unable to enumerate E2E hash inputs: ${result.stderr}`)
  }
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort()
}

function isNextBuildInput(relativePath: string): boolean {
  const normalized = relativePath.replaceAll(path.sep, '/')
  if (normalized.startsWith('packages/')) return true
  if (ROOT_BUILD_FILES.has(normalized)) return true
  if (!normalized.startsWith('apps/sim/')) return false
  return !(
    normalized.startsWith('apps/sim/e2e/') ||
    normalized.startsWith('apps/sim/.next/') ||
    normalized.startsWith('apps/sim/playwright-report/') ||
    normalized.startsWith('apps/sim/test-results/')
  )
}

function hashRepositoryFiles(files: string[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(hashRepositoryPath(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function hashRepositoryPath(relativePath: string): string {
  const absolutePath = path.join(REPO_ROOT, relativePath)
  if (!existsSync(absolutePath)) return 'missing'
  const stats = lstatSync(absolutePath)
  if (stats.isSymbolicLink()) return hashText(`symlink:${readlinkSync(absolutePath)}`)
  if (!stats.isFile()) return `unsupported:${stats.mode}`
  return hashText(readFileSync(absolutePath))
}

function hashDirectory(directory: string): string {
  const hash = createHash('sha256')
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolutePath = path.join(current, name)
      const relativePath = path.relative(directory, absolutePath).replaceAll(path.sep, '/')
      const stats = lstatSync(absolutePath)
      hash.update(relativePath)
      hash.update('\0')
      if (stats.isDirectory()) {
        hash.update('directory\0')
        visit(absolutePath)
      } else if (stats.isSymbolicLink()) {
        hash.update(`symlink:${readlinkSync(absolutePath)}\0`)
      } else if (stats.isFile()) {
        hash.update(readFileSync(absolutePath))
        hash.update('\0')
      } else {
        throw new Error(`Unsupported file in cached Next build: ${absolutePath}`)
      }
    }
  }
  visit(directory)
  return hash.digest('hex')
}

function activateDirectory(source: string, destination: string): void {
  clearStaleActivationDirectories(destination)
  const temporary = `${destination}.e2e-restore-${process.pid}`
  const backup = `${destination}.e2e-backup-${process.pid}`
  rmSync(temporary, { recursive: true, force: true })
  rmSync(backup, { recursive: true, force: true })
  cpSync(source, temporary, { recursive: true, verbatimSymlinks: true })
  try {
    if (existsSync(destination)) renameSync(destination, backup)
    renameSync(temporary, destination)
    rmSync(backup, { recursive: true, force: true })
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    if (!existsSync(destination) && existsSync(backup)) renameSync(backup, destination)
    throw error
  }
}

function clearStaleActivationDirectories(destination: string): void {
  const parent = path.dirname(destination)
  if (!existsSync(parent)) return
  const base = path.basename(destination)
  for (const name of readdirSync(parent)) {
    if (name.startsWith(`${base}.e2e-restore-`) || name.startsWith(`${base}.e2e-backup-`)) {
      rmSync(path.join(parent, name), { recursive: true, force: true })
    }
  }
}

function isMatchingIdentity(manifest: BuildManifest, identity: BuildIdentity): boolean {
  return (
    manifest.schemaVersion === identity.schemaVersion &&
    manifest.nextBuildHash === identity.nextBuildHash &&
    manifest.sourceHash === identity.sourceHash &&
    manifest.profileHash === identity.profileHash &&
    manifest.nodeVersion === identity.nodeVersion &&
    manifest.bunVersion === identity.bunVersion &&
    manifest.nextVersion === identity.nextVersion &&
    manifest.platform === identity.platform &&
    manifest.architecture === identity.architecture
  )
}

function getCacheDirectory(nextBuildHash: string, paths: BuildArtifactPaths): string {
  return path.join(paths.buildCacheDirectory, nextBuildHash)
}

function getExecutableVersion(executable: string): string {
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
  })
  if (result.status !== 0) {
    throw new Error(`Unable to read ${executable} version: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function readPackageVersion(packageJsonPath: string): string {
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }
  if (!parsed.version) throw new Error(`Package has no version: ${packageJsonPath}`)
  return parsed.version
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value))
}

function hashText(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
