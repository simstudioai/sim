#!/usr/bin/env bun
/**
 * Asserts every place the repo pins a Bun version agrees with the root `packageManager` field.
 *
 * The pin is duplicated by necessity — `engines.bun` in each workspace package.json, the `FROM
 * oven/bun:...` base image in every Dockerfile, `bun-version:` in every CI workflow, and the
 * `PI_BUN_VERSION` mirror in `apps/sim/scripts/pi-sandbox-packages.ts` — and nothing enforced that
 * duplication. A version bump that misses one of these leaves that surface running (or asserting)
 * a stale Bun, silently: the Pi sandbox miss on the 1.3.13 -> 1.3.14 bump shipped and needed a
 * follow-up commit. This script makes the root `packageManager` field the single source of truth
 * and fails on any file that disagrees with it.
 *
 * Run: `bun run scripts/check-bun-version-pins.ts`
 */
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

interface Mismatch {
  file: string
  found: string
}

const rootManifest = await Bun.file(path.join(ROOT, 'package.json')).json()
const packageManager = rootManifest.packageManager as string | undefined
const versionMatch = /^bun@(\d+\.\d+\.\d+)$/.exec(packageManager ?? '')
if (!versionMatch) {
  console.error(
    `Bun version pin audit failed: root package.json "packageManager" is "${packageManager}", ` +
      'expected "bun@<major>.<minor>.<patch>".'
  )
  process.exit(1)
}
const expectedVersion = versionMatch[1]

const mismatches: Mismatch[] = []

/** Packages that opt into the `engines.bun` floor; others are skipped, not flagged. */
async function checkEnginesBun(relativePath: string): Promise<void> {
  const manifest = await Bun.file(path.join(ROOT, relativePath)).json()
  const engines = manifest.engines as Record<string, string> | undefined
  const found = engines?.bun
  if (found !== undefined && found !== `>=${expectedVersion}`) {
    mismatches.push({ file: relativePath, found })
  }
}

async function checkDockerfileBunTag(relativePath: string): Promise<void> {
  const text = await Bun.file(path.join(ROOT, relativePath)).text()
  for (const match of text.matchAll(/FROM oven\/bun:(\d+\.\d+\.\d+)-\S+/g)) {
    if (match[1] !== expectedVersion) {
      mismatches.push({ file: relativePath, found: match[1] })
    }
  }
}

async function checkWorkflowBunVersion(relativePath: string): Promise<void> {
  const text = await Bun.file(path.join(ROOT, relativePath)).text()
  for (const match of text.matchAll(/bun-version:\s*(\d+\.\d+\.\d+)/g)) {
    if (match[1] !== expectedVersion) {
      mismatches.push({ file: relativePath, found: match[1] })
    }
  }
}

async function checkPiSandboxBunVersion(): Promise<void> {
  const relativePath = 'apps/sim/scripts/pi-sandbox-packages.ts'
  const text = await Bun.file(path.join(ROOT, relativePath)).text()
  const match = /export const PI_BUN_VERSION = '(\d+\.\d+\.\d+)'/.exec(text)
  if (!match) {
    mismatches.push({ file: relativePath, found: '(PI_BUN_VERSION not found)' })
    return
  }
  if (match[1] !== expectedVersion) {
    mismatches.push({ file: relativePath, found: match[1] })
  }
}

const enginesFiles = [
  ...(await Array.fromAsync(new Bun.Glob('apps/*/package.json').scan({ cwd: ROOT }))),
  ...(await Array.fromAsync(new Bun.Glob('packages/*/package.json').scan({ cwd: ROOT }))),
]
const dockerfiles = [
  ...(await Array.fromAsync(new Bun.Glob('docker/*.Dockerfile').scan({ cwd: ROOT }))),
  '.devcontainer/Dockerfile',
]
const workflowFiles = await Array.fromAsync(
  new Bun.Glob('.github/workflows/*.yml').scan({ cwd: ROOT })
)

await Promise.all([
  ...enginesFiles.map(checkEnginesBun),
  ...dockerfiles.map(checkDockerfileBunTag),
  ...workflowFiles.map(checkWorkflowBunVersion),
  checkPiSandboxBunVersion(),
])

if (mismatches.length > 0) {
  console.error(
    `Bun version pin audit failed: expected every pin to match root packageManager ` +
      `"bun@${expectedVersion}".\n`
  )
  for (const { file, found } of mismatches.sort((a, b) => a.file.localeCompare(b.file))) {
    console.error(`  ${file}: found ${found}`)
  }
  process.exit(1)
}

console.log(`Bun version pin audit passed (every pin matches bun@${expectedVersion}).`)
