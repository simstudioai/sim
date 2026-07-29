/**
 * Fetches the node-pty prebuilt binaries for every architecture the macOS
 * universal build ships.
 *
 * `@lydell/node-pty` selects its native binary at runtime from a per-arch
 * package (`@lydell/node-pty-darwin-arm64`, `-darwin-x64`), each declaring a
 * matching `cpu` field. Package managers honour that field, so installing on
 * an arm64 Mac leaves the x64 binary absent and the x64 half of the universal
 * app ships without a working PTY. Fetching the tarball directly is the only
 * way to get both without lying about the host architecture.
 *
 * Both binaries live at distinct paths, so `@electron/universal` never has to
 * lipo them together — it sees byte-identical trees in both halves and keeps
 * one. That is why this build needs no `x64ArchFiles` rule.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_ARCHES = ['darwin-arm64', 'darwin-x64'] as const

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)))
const workspaceRoot = dirname(dirname(desktopDir))

interface DesktopPackageJson {
  dependencies?: Record<string, string>
}

async function pinnedVersion(): Promise<string> {
  const pkg = (await import(join(desktopDir, 'package.json'), {
    with: { type: 'json' },
  })) as { default: DesktopPackageJson }
  const version = pkg.default.dependencies?.['@lydell/node-pty']
  if (!version) {
    throw new Error('@lydell/node-pty is not a dependency of @sim/desktop')
  }
  // Exact pin only: a range would let the two halves of a universal build
  // resolve different binaries.
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`@lydell/node-pty must be pinned to an exact version (got "${version}")`)
  }
  return version
}

/** Where the workspace hoists installed packages. */
function packageDir(arch: string): string {
  return join(workspaceRoot, 'node_modules', '@lydell', `node-pty-${arch}`)
}

async function fetchPrebuild(arch: string, version: string): Promise<void> {
  const name = `node-pty-${arch}`
  const url = `https://registry.npmjs.org/@lydell/${name}/-/${name}-${version}.tgz`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  const staging = mkdtempSync(join(tmpdir(), 'sim-pty-prebuild-'))
  try {
    const tarball = join(staging, 'package.tgz')
    writeFileSync(tarball, Buffer.from(await response.arrayBuffer()))
    execFileSync('tar', ['-xzf', tarball, '-C', staging], { stdio: 'pipe' })

    const target = packageDir(arch)
    mkdirSync(dirname(target), { recursive: true })
    rmSync(target, { recursive: true, force: true })
    renameSync(join(staging, 'package'), target)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function run(): Promise<void> {
  const version = await pinnedVersion()
  for (const arch of REQUIRED_ARCHES) {
    const dir = packageDir(arch)
    if (existsSync(join(dir, 'prebuilds', arch, 'pty.node'))) {
      console.log(`• node-pty prebuild present: ${arch}`)
      continue
    }
    console.log(`• Fetching node-pty prebuild: ${arch}@${version}`)
    await fetchPrebuild(arch, version)
    if (!existsSync(join(dir, 'prebuilds', arch, 'pty.node'))) {
      throw new Error(`Downloaded @lydell/node-pty-${arch} but pty.node is missing`)
    }
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
