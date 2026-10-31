/**
 * Fetches the node-pty prebuilt binaries for every architecture the host
 * platform's package ships: both halves of the macOS universal build, or the
 * x64 Windows build.
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
 *
 * Windows packages are x64-only for now. The Windows prebuild ships ConPTY
 * (`conpty.node` plus its bundled `conpty/` helper) instead of `pty.node`.
 */
import { execFileSync } from 'node:child_process'
import { createHash, timingSafeEqual } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DesktopPtyPrebuilds')

interface RequiredPrebuild {
  arch: string
  /** The binary whose presence proves the package was fully extracted. */
  binary: string
}

const REQUIRED_PREBUILDS: Partial<Record<NodeJS.Platform, readonly RequiredPrebuild[]>> = {
  darwin: [
    { arch: 'darwin-arm64', binary: 'pty.node' },
    { arch: 'darwin-x64', binary: 'pty.node' },
  ],
  win32: [{ arch: 'win32-x64', binary: 'conpty.node' }],
}

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

function expectedIntegrity(arch: string, version: string): string {
  const packageName = `@lydell/node-pty-${arch}`
  const prefix = `"${packageName}": ["${packageName}@${version}"`
  const entry = readFileSync(join(workspaceRoot, 'bun.lock'), 'utf8')
    .split('\n')
    .find((line) => line.trimStart().startsWith(prefix))
  const integrity = entry ? /,\s*"(sha512-[^"]+)"\],?$/.exec(entry)?.[1] : undefined
  if (!integrity) {
    throw new Error(`Could not find the pinned integrity for ${packageName}@${version}`)
  }
  return integrity
}

function verifyIntegrity(bytes: Buffer, integrity: string, packageName: string): void {
  const expected = Buffer.from(integrity.slice('sha512-'.length), 'base64')
  const actual = createHash('sha512').update(bytes).digest()
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error(`Integrity check failed for ${packageName}`)
  }
}

async function fetchPrebuild(arch: string, version: string): Promise<void> {
  const name = `node-pty-${arch}`
  const packageName = `@lydell/${name}`
  const url = `https://registry.npmjs.org/@lydell/${name}/-/${name}-${version}.tgz`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  const target = packageDir(arch)
  mkdirSync(dirname(target), { recursive: true })
  // Staged beside the target, not in the OS temp dir: a CI workspace on
  // another drive (D:\a on Windows runners) would make the rename fail.
  const staging = mkdtempSync(join(dirname(target), '.sim-pty-prebuild-'))
  try {
    const tarball = join(staging, 'package.tgz')
    const bytes = Buffer.from(await response.arrayBuffer())
    verifyIntegrity(bytes, expectedIntegrity(arch, version), packageName)
    writeFileSync(tarball, bytes)
    execFileSync(tarExecutable(), ['-xzf', tarball, '-C', staging], { stdio: 'pipe' })

    rmSync(target, { recursive: true, force: true })
    renameSync(join(staging, 'package'), target)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Windows' own bsdtar. Under Git Bash, a bare `tar` resolves to GNU tar, which
 * reads the `C:` in an absolute path as a remote host.
 */
function tarExecutable(): string {
  if (process.platform !== 'win32') return 'tar'
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

async function run(): Promise<void> {
  const required = REQUIRED_PREBUILDS[process.platform]
  if (!required) {
    logger.info('No packaged node-pty prebuilds for this platform', {
      platform: process.platform,
    })
    return
  }
  const version = await pinnedVersion()
  for (const { arch, binary } of required) {
    const binaryPath = join(packageDir(arch), 'prebuilds', arch, binary)
    if (existsSync(binaryPath)) {
      logger.info('node-pty prebuild present', { arch })
      continue
    }
    logger.info('Fetching node-pty prebuild', { arch, version })
    await fetchPrebuild(arch, version)
    if (!existsSync(binaryPath)) {
      throw new Error(`Downloaded @lydell/node-pty-${arch} but ${binary} is missing`)
    }
  }
}

run().catch((error) => {
  logger.error('Could not ensure node-pty prebuilds', { message: getErrorMessage(error) })
  process.exit(1)
})
