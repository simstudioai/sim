import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  type AppBuildIdentity,
  computeLocalViteBuildImageDigest,
} from '@/lib/apps/build/build-identity'
import {
  APP_LOCKFILE_HASH_PLACEHOLDER,
  APP_SDK_VERSION,
  APP_TEMPLATE_VERSION,
} from '@/lib/apps/template/versions'
import { getEnv } from '@/lib/core/config/env'

/**
 * Resolve the Sim monorepo root for local Vite builds.
 * Prefer APPS_MONOREPO_ROOT / APPS_TOOLCHAIN_ROOT; otherwise assume Next cwd is apps/sim.
 * Never uses import.meta.url (Turbopack cannot bundle deep relative URL walks).
 */
export function resolveMonorepoRoot(): string {
  const configured = (getEnv('APPS_MONOREPO_ROOT') || getEnv('APPS_TOOLCHAIN_ROOT') || '').trim()
  if (configured) return resolve(configured)
  return resolve(process.cwd(), '../..')
}

function readPackageVersion(monorepoRoot: string, packageName: string): string {
  try {
    const pkgPath = join(monorepoRoot, 'node_modules', packageName, 'package.json')
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return raw.version || 'missing'
  } catch {
    return 'missing'
  }
}

function readToolchainFileHash(monorepoRoot: string, path: string): string {
  try {
    return createHash('sha256')
      .update(readFileSync(join(monorepoRoot, path)))
      .digest('hex')
  } catch {
    return 'missing'
  }
}

/**
 * Hash of the local curated toolchain (Node + template/SDK + key package versions).
 * Not a real npm lockfile — detects Vite/React/plugin bumps that should invalidate reuse.
 */
export function computeLocalViteLockfileHash(monorepoRoot = resolveMonorepoRoot()): string {
  const parts = [
    process.version,
    APP_TEMPLATE_VERSION,
    APP_SDK_VERSION,
    readPackageVersion(monorepoRoot, 'react'),
    readPackageVersion(monorepoRoot, 'react-dom'),
    readPackageVersion(monorepoRoot, 'vite'),
    readPackageVersion(monorepoRoot, '@vitejs/plugin-react'),
    readPackageVersion(monorepoRoot, 'playwright'),
    readToolchainFileHash(monorepoRoot, 'apps/sim/scripts/e2b-app-build/capture-thumbnail.mjs'),
    APP_LOCKFILE_HASH_PLACEHOLDER,
  ]
  return createHash('sha256').update(parts.join('\n')).digest('hex')
}

export function currentLocalViteBuildIdentity(
  monorepoRoot = resolveMonorepoRoot()
): AppBuildIdentity {
  const lockfileHash = computeLocalViteLockfileHash(monorepoRoot)
  return {
    templateVersion: APP_TEMPLATE_VERSION,
    sdkVersion: APP_SDK_VERSION,
    lockfileHash,
    buildImageDigest: computeLocalViteBuildImageDigest(lockfileHash),
    mode: 'local-vite',
  }
}

export function getLocalToolchainPaths(monorepoRoot = resolveMonorepoRoot()) {
  return {
    monorepoRoot,
    appSdkSrc: join(monorepoRoot, 'packages/app-sdk/src'),
    nodeModules: join(monorepoRoot, 'node_modules'),
    viteCli: join(monorepoRoot, 'node_modules/vite/bin/vite.js'),
    viteEntry: join(monorepoRoot, 'node_modules/vite/dist/node/index.js'),
    viteReactPlugin: join(monorepoRoot, 'node_modules/@vitejs/plugin-react/dist/index.js'),
    reactDir: join(monorepoRoot, 'node_modules/react'),
    reactDomDir: join(monorepoRoot, 'node_modules/react-dom'),
    schedulerDir: join(monorepoRoot, 'node_modules/scheduler'),
    thumbnailCaptureScript: join(
      monorepoRoot,
      'apps/sim/scripts/e2b-app-build/capture-thumbnail.mjs'
    ),
  }
}
