import { createHash } from 'node:crypto'
import { APP_SDK_VERSION, APP_TEMPLATE_VERSION } from '@/lib/apps/template/versions'

/**
 * Pure build-identity helpers — safe to import from publish/lifecycle paths.
 * Filesystem/toolchain resolution lives in `local-toolchain.ts` (dev build only).
 */

export type AppBuildIdentity = {
  templateVersion: string
  sdkVersion: string
  lockfileHash: string
  buildImageDigest: string
  mode: 'local-vite' | 'fixture-hash-only' | 'e2b'
}

export function computeLocalViteBuildImageDigest(lockfileHash: string): string {
  const digest = createHash('sha256')
    .update(
      `local-vite:${process.version}:${APP_TEMPLATE_VERSION}:${APP_SDK_VERSION}:${lockfileHash}`
    )
    .digest('hex')
  return `local-vite:${digest.slice(0, 32)}`
}

export function currentE2BBuildIdentity(imageDigest: string): AppBuildIdentity {
  const lockfileHash = createHash('sha256').update(imageDigest).digest('hex')
  return {
    templateVersion: APP_TEMPLATE_VERSION,
    sdkVersion: APP_SDK_VERSION,
    lockfileHash,
    buildImageDigest: imageDigest,
    mode: 'e2b',
  }
}

export function isLocalViteBuildImageDigest(digest: string | null | undefined): boolean {
  return typeof digest === 'string' && digest.startsWith('local-vite:')
}

/** Strict reuse predicate — all identity fields required and exact. */
export function buildIdentityMatches(
  prior: {
    diagnostics: unknown
    buildImageDigest: string | null
  },
  current: AppBuildIdentity
): boolean {
  const d = (prior.diagnostics || {}) as Partial<AppBuildIdentity>
  return (
    d.templateVersion === current.templateVersion &&
    d.sdkVersion === current.sdkVersion &&
    d.lockfileHash === current.lockfileHash &&
    d.mode === current.mode &&
    prior.buildImageDigest === current.buildImageDigest
  )
}
