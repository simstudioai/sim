import { randomBytes } from 'node:crypto'
import { db } from '@sim/db'
import { appPreviewSession, appProject } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { previewServeMetaContract } from '@/lib/api/contracts/apps'
import { parseRequest } from '@/lib/api/server'
import { requireAppsHopFromRequest } from '@/lib/apps/hop-proof'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { stopPreviewSession } from '@/lib/apps/pins'
import { isPreviewSessionPastHardMax } from '@/lib/apps/preview-ttl'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

/**
 * Private preview meta for apps-host.
 * Pins serving to the session's frozen buildId / artifactManifestHash (or fixture shell).
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ sessionId: string }> }) => {
    const hop = requireAppsHopFromRequest(request)
    if (!hop.ok) return createErrorResponse(hop.message, hop.status)

    const parsed = await parseRequest(previewServeMetaContract, request, context)
    if (!parsed.success) return parsed.response
    const { sessionId } = parsed.data.params
    const { nonce } = parsed.data.query

    const [session] = await db
      .select()
      .from(appPreviewSession)
      .where(and(eq(appPreviewSession.id, sessionId), isNull(appPreviewSession.stoppedAt)))
      .limit(1)

    if (!session || session.channelNonce !== nonce) {
      return createErrorResponse('Unavailable', 410)
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await stopPreviewSession(sessionId)
      return createErrorResponse('Unavailable', 410)
    }
    if (isPreviewSessionPastHardMax(session.startedAt)) {
      await stopPreviewSession(sessionId)
      return createErrorResponse('Unavailable', 410)
    }

    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, session.projectId), isNull(appProject.archivedAt)))
      .limit(1)
    if (!project) return createErrorResponse('Unavailable', 410)

    const origin = getAppOriginStatus()
    if (!origin.enabled) {
      return createErrorResponse('Apps origin misconfigured', 503)
    }

    const htmlNonce = randomBytes(16).toString('base64')
    const artifactManifestHash = session.artifactManifestHash?.startsWith('sha256:')
      ? session.artifactManifestHash
      : null

    return createSuccessResponse({
      sessionId: session.id,
      buildId: session.buildId,
      artifactManifestHash,
      fixtureOnly: !artifactManifestHash,
      channelNonce: session.channelNonce,
      htmlNonce,
      publicId: project.publicId,
      slug: project.slug,
      gatewayOrigin: origin.appPublicOrigin,
    })
  }
)
