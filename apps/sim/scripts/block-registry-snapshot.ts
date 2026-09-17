import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { z } from 'zod'

const registryIdsSchema = z.record(z.string().min(1), z.array(z.string().min(1)))

interface WorkspacePackage {
  name: string
  path: string
  relativePath: string
}

function readWorkspacePackages(snapshot: string): WorkspacePackage[] {
  const workspaces: WorkspacePackage[] = []
  for (const group of ['apps', 'packages']) {
    const directory = join(snapshot, group)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const relativePath = join(group, entry.name)
      const path = join(snapshot, relativePath)
      const manifestPath = join(path, 'package.json')
      if (!existsSync(manifestPath)) continue
      const { name } = z
        .object({ name: z.string().min(1) })
        .parse(JSON.parse(readFileSync(manifestPath, 'utf8')))
      workspaces.push({ name, path, relativePath })
    }
  }
  return workspaces
}

function linkInstalledDependencies(
  source: string,
  target: string,
  root: string,
  workspaceNames: Set<string>,
  scope = ''
) {
  if (!existsSync(source)) return
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name)
    const targetPath = join(target, entry.name)
    if (entry.name.startsWith('@')) {
      linkInstalledDependencies(sourcePath, targetPath, root, workspaceNames, `${entry.name}/`)
      continue
    }
    if (workspaceNames.has(scope + entry.name)) continue
    const resolved = realpathSync(sourcePath)
    if (['apps', 'packages'].some((group) => resolved.startsWith(join(root, group) + sep))) continue
    symlinkSync(sourcePath, targetPath, 'dir')
  }
}

function linkWorkspaceDependencies(root: string, snapshot: string) {
  const workspaces = readWorkspacePackages(snapshot)
  const workspaceNames = new Set(workspaces.map(({ name }) => name))
  const modules = join(snapshot, 'node_modules')
  linkInstalledDependencies(join(root, 'node_modules'), modules, root, workspaceNames)
  for (const workspace of workspaces) {
    const packageLink = resolve(modules, workspace.name)
    if (!packageLink.startsWith(modules + sep)) {
      throw new Error(`Invalid workspace package name: ${workspace.name}`)
    }
    mkdirSync(dirname(packageLink), { recursive: true })
    symlinkSync(workspace.path, packageLink, 'dir')
    linkInstalledDependencies(
      join(root, workspace.relativePath, 'node_modules'),
      join(workspace.path, 'node_modules'),
      root,
      workspaceNames
    )
  }
}

/**
 * Reads effective subblock IDs from the base revision's complete source tree.
 * Workspace packages resolve inside the snapshot; only installed third-party
 * dependencies are shared. A failed import or missing revision fails the audit.
 */
export function readBlockRegistryAtRef(root: string, ref: string): Record<string, string[]> {
  root = realpathSync(root)
  const gitOptions = { cwd: root, encoding: 'utf8' as const, stdio: 'pipe' as const }
  const commit = execFileSync(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    gitOptions
  ).trim()
  const temporary = mkdtempSync(join(tmpdir(), 'sim-block-registry-'))
  try {
    const archive = join(temporary, 'source.tar')
    const snapshot = join(temporary, 'source')
    mkdirSync(snapshot)
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, commit], gitOptions)
    execFileSync('tar', ['-xf', archive, '-C', snapshot])
    linkWorkspaceDependencies(root, snapshot)

    const script = join(snapshot, 'apps/sim/.block-registry-snapshot.ts')
    const output = join(temporary, 'ids.json')
    writeFileSync(
      script,
      `
import { writeFileSync } from 'node:fs'
import { getBlockRegistry } from '@/blocks/registry'

const entries = Object.values(getBlockRegistry()).map(block => [block.type, block.subBlocks.map(field => field.id)])
writeFileSync(process.argv[2], JSON.stringify(Object.fromEntries(entries)))
`
    )
    execFileSync('bun', ['--no-env-file', 'run', script, output], {
      cwd: join(snapshot, 'apps/sim'),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return registryIdsSchema.parse(JSON.parse(readFileSync(output, 'utf8')))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
