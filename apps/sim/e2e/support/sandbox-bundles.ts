import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readAppResolvedPackageVersion } from '@/lib/execution/sandbox/bundles/dependency-resolution'
import { REPO_ROOT, SIM_APP_DIR } from './paths'

const INTEGRITY_PATH = 'apps/sim/lib/execution/sandbox/bundles/integrity.json'

interface SandboxBundleIntegrity {
  schemaVersion: 1
  bunVersion: string
  sources: Record<string, string>
  dependencies: Record<string, string>
  outputs: Record<string, string>
}

export function verifySandboxBundleIntegrity(options?: { runningBunVersion?: string }): void {
  const integrity = readJson<SandboxBundleIntegrity>(path.join(REPO_ROOT, INTEGRITY_PATH))
  if (integrity.schemaVersion !== 1) {
    throw new Error(`Unsupported sandbox bundle integrity version: ${integrity.schemaVersion}`)
  }
  const repositoryPackage = readJson<{ packageManager?: string }>(
    path.join(REPO_ROOT, 'package.json')
  )
  if (repositoryPackage.packageManager !== `bun@${integrity.bunVersion}`) {
    throw new Error(
      `Sandbox bundle Bun fingerprint is ${integrity.bunVersion}, but package.json declares ${repositoryPackage.packageManager ?? 'nothing'}`
    )
  }
  const runningBunVersion = options?.runningBunVersion ?? process.versions.bun
  if (runningBunVersion !== integrity.bunVersion) {
    throw new Error(
      `Sandbox bundles require Bun ${integrity.bunVersion}, but verification is running under ${runningBunVersion ?? 'Node'}`
    )
  }

  verifyHashes('source', integrity.sources)
  verifyHashes('output', integrity.outputs)
  for (const [packageName, expectedVersion] of Object.entries(integrity.dependencies)) {
    const resolvedVersion = readAppResolvedPackageVersion(packageName, SIM_APP_DIR)
    if (resolvedVersion !== expectedVersion) {
      throw new Error(
        `Sandbox bundle dependency ${packageName} changed: expected ${expectedVersion}, received ${resolvedVersion}`
      )
    }
  }
}

export function verifyGeneratedSandboxBundles(outputDirectory: string): void {
  const integrity = readJson<SandboxBundleIntegrity>(path.join(REPO_ROOT, INTEGRITY_PATH))
  for (const [relativePath, expectedHash] of Object.entries(integrity.outputs)) {
    const outputPath = path.join(outputDirectory, path.basename(relativePath))
    const actualHash = hashFile(outputPath)
    if (actualHash !== expectedHash) {
      throw new Error(
        `Fresh sandbox bundle output changed for ${relativePath}; regenerate bundles and review integrity.json`
      )
    }
  }
}

function verifyHashes(kind: string, expected: Record<string, string>): void {
  for (const [relativePath, expectedHash] of Object.entries(expected)) {
    const actualHash = hashFile(path.join(REPO_ROOT, relativePath))
    if (actualHash !== expectedHash) {
      throw new Error(
        `Sandbox bundle ${kind} fingerprint changed for ${relativePath}; regenerate bundles and review integrity.json`
      )
    }
  }
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}
