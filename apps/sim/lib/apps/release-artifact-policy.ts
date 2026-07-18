import { isRealArtifactHash } from '@/lib/apps/artifacts/manifest'
import { assertArtifactBundleReady } from '@/lib/apps/artifacts/store'
import { isLocalViteBuildImageDigest } from '@/lib/apps/build/build-identity'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/env-flags'

/**
 * Fixture artifact hashes (`fixture:…`) may only become / stay current while
 * APPS_ALLOW_FIXTURE_BUILDS is explicitly enabled.
 * Real hashes (`sha256:…`) must have a persisted manifest + blobs.
 * Local-vite digests are rejected in production even if blobs were copied in.
 */
export async function assertReleaseArtifactAllowed(
  artifactManifestHash: string,
  opts?: {
    buildImageDigest?: string | null
    buildMode?: string | null
  }
): Promise<
  | { ok: true }
  | {
      ok: false
      error: string
      code:
        | 'FIXTURE_BUILDS_DISABLED'
        | 'ARTIFACT_MISSING'
        | 'INVALID_ARTIFACT_HASH'
        | 'LOCAL_BUILD_NOT_ALLOWED'
        | 'E2B_BUILD_REQUIRED'
    }
> {
  if (artifactManifestHash.startsWith('fixture:')) {
    if (!isProd && isTruthy(getEnv('APPS_ALLOW_FIXTURE_BUILDS'))) {
      return { ok: true }
    }
    return {
      ok: false,
      code: 'FIXTURE_BUILDS_DISABLED',
      error:
        'Fixture releases are local/dev only and cannot become current in production. Rebuild with the E2B app-build image.',
    }
  }

  if (!isRealArtifactHash(artifactManifestHash)) {
    return {
      ok: false,
      code: 'INVALID_ARTIFACT_HASH',
      error: 'Release artifact hash must be sha256:… (real) or fixture:… (dev-only).',
    }
  }

  const localBackend =
    isLocalViteBuildImageDigest(opts?.buildImageDigest) || opts?.buildMode === 'local-vite'
  if (isProd && localBackend) {
    return {
      ok: false,
      code: 'LOCAL_BUILD_NOT_ALLOWED',
      error:
        'Artifacts built with the local Vite backend cannot be published in production. Rebuild with the E2B app-build image.',
    }
  }

  if (isProd && (opts?.buildMode !== 'e2b' || !opts?.buildImageDigest?.startsWith('e2b-build:'))) {
    return {
      ok: false,
      code: 'E2B_BUILD_REQUIRED',
      error: 'Production releases require an artifact built by the immutable E2B app-build image.',
    }
  }

  return assertArtifactBundleReady(artifactManifestHash)
}

export function isFixtureArtifactHash(artifactManifestHash: string): boolean {
  return artifactManifestHash.startsWith('fixture:')
}
