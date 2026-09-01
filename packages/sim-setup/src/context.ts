import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SOURCE_PACKAGE_MARKERS = [
  ['apps/sim/package.json', '@sim/app'],
  ['apps/realtime/package.json', '@sim/realtime'],
  ['packages/db/package.json', '@sim/db'],
] as const
const SIM_COMPOSE_MARKER = 'ghcr.io/simstudioai/simstudio'
const COMPOSE_FILE = 'docker-compose.prod.yml'

export type SetupContext =
  | { kind: 'source'; root: string }
  | { kind: 'standalone'; root: string; existing: boolean }

function readPackageName(file: string): string | null {
  if (!existsSync(file)) return null
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('name' in parsed)) return null
  return typeof parsed.name === 'string' ? parsed.name : null
}

function parentDirectories(start: string): string[] {
  const directories: string[] = []
  let current = path.resolve(start)
  while (true) {
    directories.push(current)
    const parent = path.dirname(current)
    if (parent === current) return directories
    current = parent
  }
}

function inspectSourceRoot(candidate: string): 'valid' | 'partial' | 'absent' {
  const rootName = readPackageName(path.join(candidate, 'package.json'))
  const markerNames = SOURCE_PACKAGE_MARKERS.map(([file]) =>
    readPackageName(path.join(candidate, file))
  )
  const looksLikeSource = rootName === 'simstudio' || markerNames.some((name) => name !== null)
  if (!looksLikeSource) return 'absent'
  if (
    rootName === 'simstudio' &&
    SOURCE_PACKAGE_MARKERS.every(([, expected], index) => markerNames[index] === expected)
  ) {
    return 'valid'
  }
  return 'partial'
}

function isStandaloneInstall(candidate: string): boolean {
  const composeFile = path.join(candidate, COMPOSE_FILE)
  if (!existsSync(composeFile)) return false
  return readFileSync(composeFile, 'utf8').includes(SIM_COMPOSE_MARKER)
}

export function directoryOverride(args: readonly string[]): string | null {
  const equalsArg = args.find((arg) => arg.startsWith('--dir='))
  if (equalsArg) {
    const value = equalsArg.slice('--dir='.length)
    if (!value) throw new Error('--dir requires a directory path')
    return value
  }
  const index = args.indexOf('--dir')
  if (index === -1) return null
  const value = args[index + 1]
  if (!value || value.startsWith('-')) throw new Error('--dir requires a directory path')
  return value
}

/** Classifies one exact filesystem root without walking through its ancestors. */
export function resolveSetupContextAtRoot(root: string): SetupContext {
  const resolvedRoot = path.resolve(root)
  const source = inspectSourceRoot(resolvedRoot)
  if (source === 'valid') return { kind: 'source', root: resolvedRoot }
  if (source === 'partial') {
    throw new Error(
      `Incomplete Sim source checkout at ${resolvedRoot}; expected package.json plus apps/sim, apps/realtime, and packages/db package manifests.`
    )
  }
  return {
    kind: 'standalone',
    root: resolvedRoot,
    existing: isStandaloneInstall(resolvedRoot),
  }
}

/** Resolves the filesystem context before setup reads or writes any installation state. */
export function resolveSetupContext(
  start: string = process.cwd(),
  args: readonly string[] = process.argv.slice(2)
): SetupContext {
  const override = directoryOverride(args)
  const searchStart = path.resolve(start, override ?? '.')

  if (override) {
    return resolveSetupContextAtRoot(searchStart)
  }

  for (const candidate of parentDirectories(searchStart)) {
    const source = inspectSourceRoot(candidate)
    if (source === 'valid') return { kind: 'source', root: candidate }
    if (source === 'partial') {
      throw new Error(
        `Incomplete Sim source checkout at ${candidate}; expected package.json plus apps/sim, apps/realtime, and packages/db package manifests.`
      )
    }
  }

  for (const candidate of parentDirectories(searchStart)) {
    if (isStandaloneInstall(candidate)) {
      return { kind: 'standalone', root: candidate, existing: true }
    }
  }

  return resolveSetupContextAtRoot(path.join(path.resolve(start), 'sim'))
}

export const SETUP_CONTEXT = resolveSetupContext()
