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

export type E2eHashOwner = 'next-build' | 'retained-stack' | 'scenario' | 'rerun'

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

export function computeExecutionHashes(nextBuildHash: string): {
  retainedStackHash: string
  scenarioHash: string
} {
  const files = listRepositoryFiles()
  return {
    retainedStackHash: hashJson({
      nextBuildHash,
      files: hashOwnedFiles(files, 'retained-stack'),
    }),
    scenarioHash: hashJson({
      files: hashOwnedFiles(files, 'scenario'),
    }),
  }
}

export function classifyE2eHashOwner(relativePath: string): E2eHashOwner {
  const normalized = relativePath.replaceAll(path.sep, '/')
  if (isNextBuildInput(normalized)) return 'next-build'
  if (normalized.startsWith('apps/realtime/')) return 'retained-stack'
  if (normalized === 'apps/sim/playwright.config.ts') return 'retained-stack'
  if (!normalized.startsWith('apps/sim/e2e/')) return 'retained-stack'

  const e2ePath = normalized.slice('apps/sim/e2e/'.length)
  if (
    e2ePath.startsWith('fixtures/') ||
    e2ePath === 'settings/personas.ts' ||
    e2ePath === 'scripts/seed-world.ts' ||
    e2ePath === 'scripts/capture-auth-states.ts'
  ) {
    return 'scenario'
  }
  if (
    e2ePath.endsWith('.spec.ts') ||
    e2ePath.startsWith('auth/') ||
    e2ePath.startsWith('settings/')
  ) {
    return 'rerun'
  }
  if (
    e2ePath.startsWith('support/') ||
    e2ePath.startsWith('fakes/') ||
    e2ePath.startsWith('scripts/')
  ) {
    return 'retained-stack'
  }
  return 'retained-stack'
}

export function restoreCachedBuild(identity: BuildIdentity): BuildReuseDecision {
  const cacheDirectory = getCacheDirectory(identity.nextBuildHash)
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

  activateDirectory(artifactDirectory, NEXT_DIR)
  return {
    reused: true,
    nextBuildHash: identity.nextBuildHash,
    reason: 'verified cache hit',
    cacheDirectory,
  }
}

export function storeCompletedBuild(identity: BuildIdentity): BuildReuseDecision {
  const buildIdPath = path.join(NEXT_DIR, 'BUILD_ID')
  if (!existsSync(buildIdPath)) {
    throw new Error('Next build completed without .next/BUILD_ID')
  }

  mkdirSync(E2E_BUILD_CACHE_DIR, { recursive: true })
  const cacheDirectory = getCacheDirectory(identity.nextBuildHash)
  const temporaryDirectory = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}`
  rmSync(temporaryDirectory, { recursive: true, force: true })
  mkdirSync(temporaryDirectory, { recursive: true })
  const artifactDirectory = path.join(temporaryDirectory, '.next')
  cpSync(NEXT_DIR, artifactDirectory, { recursive: true, verbatimSymlinks: true })

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

export function clearActiveNextBuild(): void {
  rmSync(NEXT_DIR, { recursive: true, force: true })
}

function listRepositoryFiles(): string[] {
  const result = spawnSync(
    'git',
    ['-C', REPO_ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    }
  )
  if (result.status !== 0) {
    throw new Error(`Unable to enumerate E2E hash inputs: ${result.stderr}`)
  }
  return [...new Set(result.stdout.split(/\r?\n/).filter(Boolean))].sort()
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

function hashOwnedFiles(files: string[], owner: E2eHashOwner): Array<[string, string]> {
  return files
    .filter((file) => classifyE2eHashOwner(file) === owner)
    .map((file) => [file, hashRepositoryPath(file)])
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

function getCacheDirectory(nextBuildHash: string): string {
  return path.join(E2E_BUILD_CACHE_DIR, nextBuildHash)
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
