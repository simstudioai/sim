/**
 * Narrows a `turbo prune --docker` output to what one package runs in production, so a
 * following `bun install --omit=dev` installs only its runtime dependencies.
 *
 * `--omit=dev` leaves out the root's devDependencies, but Bun still installs every workspace
 * member, each member's devDependencies, and their peers. A pruned image therefore carried the
 * build and test toolchain (drizzle-kit and its bundled esbuild, vitest, vite, tsx) that its
 * members declare for development, along with members such as `@sim/testing` that only tests
 * import. This keeps the members the target reaches through `dependencies`,
 * `optionalDependencies`, or a `tsconfig.json` `extends` (Bun reads each member's tsconfig when it
 * runs TypeScript source), drops every other member, and strips the devDependencies of the root
 * and the kept members.
 *
 * Usage: `bun scripts/prune-production-workspace.ts <package> <full-dir> [<json-dir>]`. The closure is
 * computed from `<full-dir>`, which holds the tsconfig files, and applied to every directory given.
 * The lockfile no longer matches the narrowed manifests, so install without `--frozen-lockfile`:
 * Bun keeps each locked resolution whose range still matches and only drops the entries the
 * narrowed workspace no longer reaches, so no version changes.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface PackageManifest {
  name?: string
  workspaces?: string[]
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface WorkspaceMember {
  /** Member directory relative to the workspace root, e.g. `packages/db`. */
  dir: string
  manifest: PackageManifest
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function listMembers(rootDir: string): Map<string, WorkspaceMember> {
  const root = readJson<PackageManifest>(join(rootDir, 'package.json'))
  const members = new Map<string, WorkspaceMember>()
  for (const pattern of root.workspaces ?? []) {
    for (const manifestPath of new Bun.Glob(`${pattern}/package.json`).scanSync(rootDir)) {
      const manifest = readJson<PackageManifest>(join(rootDir, manifestPath))
      if (manifest.name) members.set(manifest.name, { dir: dirname(manifestPath), manifest })
    }
  }
  return members
}

/** The package a module specifier names, e.g. `@sim/tsconfig` for `@sim/tsconfig/base.json`. */
function packageName(specifier: string): string {
  const segments = specifier.split('/')
  return segments.slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
}

function tsconfigParents(rootDir: string, member: WorkspaceMember): string[] {
  const tsconfigPath = join(rootDir, member.dir, 'tsconfig.json')
  if (!existsSync(tsconfigPath)) return []
  const { extends: parents } = readJson<{ extends?: string | string[] }>(tsconfigPath)
  return [parents ?? []].flat().map(packageName)
}

function productionClosure(
  rootDir: string,
  members: Map<string, WorkspaceMember>,
  target: string
): Set<string> {
  const kept = new Set<string>()
  const queue = [target]
  for (let name = queue.pop(); name; name = queue.pop()) {
    if (kept.has(name)) continue
    const member = members.get(name)
    if (!member) throw new Error(`${name} is not a member of the workspace in ${rootDir}`)
    kept.add(name)
    const { dependencies = {}, optionalDependencies = {} } = member.manifest
    const reached = [
      ...Object.keys(dependencies),
      ...Object.keys(optionalDependencies),
      ...tsconfigParents(rootDir, member),
    ]
    queue.push(...reached.filter((next) => members.has(next)))
  }
  return kept
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Drops the members outside `kept`, from disk and from the root's workspace list. */
function narrow(rootDir: string, kept: Set<string>) {
  const dropped = new Set<string>()
  for (const [name, member] of listMembers(rootDir)) {
    const memberDir = join(rootDir, member.dir)
    if (!kept.has(name)) {
      rmSync(memberDir, { recursive: true, force: true })
      dropped.add(member.dir)
      continue
    }
    const { devDependencies: _, ...manifest } = member.manifest
    writeJson(join(memberDir, 'package.json'), manifest)
  }
  // `turbo prune` lists each member's path, and Bun refuses a listed path that no longer exists.
  // The root's devDependencies go too: `--omit=dev` skips them, but while they stay in the
  // lockfile Bun still links them to satisfy optional peers (better-auth's on vitest).
  const rootPath = join(rootDir, 'package.json')
  const { devDependencies: _, ...root } = readJson<PackageManifest>(rootPath)
  writeJson(rootPath, {
    ...root,
    workspaces: (root.workspaces ?? []).filter((pattern) => !dropped.has(pattern)),
  })
}

const [target, fullDir, ...otherDirs] = process.argv.slice(2)
if (!target || !fullDir) {
  console.error(
    'Usage: bun scripts/prune-production-workspace.ts <package> <full-dir> [<json-dir>]'
  )
  process.exit(1)
}

const kept = productionClosure(fullDir, listMembers(fullDir), target)
for (const dir of [fullDir, ...otherDirs]) narrow(dir, kept)
console.log(`Production workspace for ${target}: ${[...kept].sort().join(', ')}`)
