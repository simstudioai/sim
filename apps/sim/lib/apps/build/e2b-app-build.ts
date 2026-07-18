import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import type { AppBuildRequest, AppBuildResult } from '@/lib/apps/build/types'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/env-flags'

export type { AppBuildRequest, AppBuildResult } from '@/lib/apps/build/types'

const logger = createLogger('AppBuild')

const MAX_FILES = 200
const MAX_FILE_BYTES = 256_000
const MAX_TOTAL_BYTES = 2_000_000

export function validateSourceCaps(
  files: Record<string, string>
): { ok: true } | { ok: false; error: string } {
  const fileCount = Object.keys(files).length
  if (fileCount === 0 || fileCount > MAX_FILES) {
    return { ok: false, error: `File count must be 1–${MAX_FILES}` }
  }
  let total = 0
  for (const [path, content] of Object.entries(files)) {
    if (path.includes('..') || path.startsWith('/')) {
      return { ok: false, error: `Illegal path: ${path}` }
    }
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > MAX_FILE_BYTES) {
      return { ok: false, error: `File too large: ${path}` }
    }
    total += bytes
  }
  if (total > MAX_TOTAL_BYTES) {
    return { ok: false, error: 'Source tree exceeds size cap' }
  }
  return { ok: true }
}

async function runFixtureBuild(request: AppBuildRequest): Promise<AppBuildResult> {
  const artifactManifestHash = createHash('sha256')
    .update(JSON.stringify({ mode: 'fixture', files: request.files }))
    .digest('hex')

  logger.info('App build fixture hash (not a deployable artifact)', {
    projectId: request.projectId,
    revisionId: request.revisionId,
  })

  return {
    success: true,
    artifactManifestHash: `fixture:${artifactManifestHash}`,
    buildImageDigest: 'fixture-hash-only',
    diagnostics: {
      mode: 'fixture-hash-only',
      note: 'No Vite/artifacts. apps-host serves fixture HTML until a real build runs.',
    },
  }
}

/**
 * App build entrypoint.
 *
 * Selection (never silent fallback from a failed real build → fixture):
 * - Production: E2B only.
 * - Non-production: explicit local Vite, explicit fixture, then E2B.
 *
 * Local Vite is dynamically imported so Turbopack/lifecycle routes never evaluate
 * filesystem toolchain paths at module load.
 */
export async function runAppBuild(request: AppBuildRequest): Promise<AppBuildResult> {
  const caps = validateSourceCaps(request.files)
  if (!caps.ok) return { success: false, error: caps.error }

  if (!request.actions?.length) {
    return { success: false, error: 'Revision has no actions to build' }
  }

  const allowLocalVite = isTruthy(getEnv('APPS_ALLOW_LOCAL_VITE_BUILDS'))
  const allowFixture = isTruthy(getEnv('APPS_ALLOW_FIXTURE_BUILDS'))
  const templateId = (getEnv('E2B_APP_BUILD_TEMPLATE_ID') || '').trim()
  const e2bOn = isTruthy(getEnv('E2B_ENABLED') || getEnv('NEXT_PUBLIC_E2B_ENABLED'))
  const e2bConfigured = e2bOn && Boolean(templateId)

  if (isProd) {
    if (!e2bConfigured) {
      return {
        success: false,
        error:
          'Production app builds require E2B_ENABLED and E2B_APP_BUILD_TEMPLATE_ID. Local and fixture backends are disabled.',
        diagnostics: { mode: 'e2b-not-configured' },
      }
    }
    const { runE2BViteBuild } = await import('@/lib/apps/build/e2b-vite-build')
    return runE2BViteBuild(request)
  }

  if (allowLocalVite) {
    const { runLocalViteBuild } = await import('@/lib/apps/build/local-vite-build')
    return runLocalViteBuild(request)
  }

  if (allowFixture) {
    return runFixtureBuild(request)
  }

  if (e2bConfigured) {
    const { runE2BViteBuild } = await import('@/lib/apps/build/e2b-vite-build')
    return runE2BViteBuild(request)
  }

  return {
    success: false,
    error:
      'No app build backend enabled. Set APPS_ALLOW_LOCAL_VITE_BUILDS=true (recommended for local) or APPS_ALLOW_FIXTURE_BUILDS=true.',
    diagnostics: { mode: 'no-backend' },
  }
}
