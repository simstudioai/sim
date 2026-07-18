import { randomBytes } from 'node:crypto'
import { db } from '@sim/db'
import { appProject, appRelease } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { publicServeMetaContract } from '@/lib/api/contracts/apps'
import { parseRequest } from '@/lib/api/server'
import { requireAppsHopFromRequest } from '@/lib/apps/hop-proof'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { renderSimAppConfigScript } from '@/lib/apps/safe-json'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ publicId: string }> }) => {
    const hop = requireAppsHopFromRequest(request)
    if (!hop.ok) return createErrorResponse(hop.message, hop.status)

    const parsed = await parseRequest(publicServeMetaContract, request, context)
    if (!parsed.success) return parsed.response

    const { publicId } = parsed.data.params
    const slug = parsed.data.query.slug

    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.publicId, publicId), isNull(appProject.archivedAt)))
      .limit(1)

    if (!project || !project.publishedReleaseId) {
      return createErrorResponse('Unavailable', 410)
    }

    const [release] = await db
      .select()
      .from(appRelease)
      .where(
        and(
          eq(appRelease.id, project.publishedReleaseId),
          eq(appRelease.state, 'published'),
          isNull(appRelease.revokedAt)
        )
      )
      .limit(1)

    if (!release) {
      return createErrorResponse('Unavailable', 410)
    }

    const origin = getAppOriginStatus()
    if (!origin.enabled) {
      return createErrorResponse('Apps origin misconfigured', 503)
    }

    const htmlNonce = randomBytes(16).toString('base64')
    const configScript = renderSimAppConfigScript(
      {
        publicId: project.publicId,
        slug: project.slug,
        releaseId: release.id,
        gatewayOrigin: origin.appPublicOrigin,
      },
      htmlNonce
    )

    const fixtureOnly = release.artifactManifestHash.startsWith('fixture:')

    return createSuccessResponse({
      releaseId: release.id,
      slug: project.slug,
      requestedSlug: slug,
      htmlNonce,
      configScript,
      // Content-addressed: apps-host resolves paths via the manifest, not releaseId disk trees.
      artifactManifestHash: release.artifactManifestHash,
      fixtureOnly,
      // Deprecated alias — kept briefly for older apps-host processes during local restarts.
      artifactRoot: release.artifactManifestHash,
    })
  }
)
