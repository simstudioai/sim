import { db } from '@sim/db'
import { appProject, appSourceRevision } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { previewSessionContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { assertAppPermission } from '@/lib/apps/permissions'
import { activatePreviewPins } from '@/lib/apps/pins'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const origin = getAppOriginStatus()
    if (!origin.enabled) {
      return createErrorResponse(origin.reason, 503, 'APPS_ORIGIN_MISCONFIGURED')
    }

    const parsed = await parseRequest(previewSessionContract, request, context, {
      validationErrorResponse: (error) =>
        createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
    })
    if (!parsed.success) return parsed.response

    const { projectId } = parsed.data.params
    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
      .limit(1)

    if (!project) return createErrorResponse('Project not found', 404)

    const perm = await assertAppPermission(session.user.id, project.workspaceId, 'preview')
    if (!perm.ok) return createErrorResponse(perm.message, perm.status)

    const [revision] = await db
      .select()
      .from(appSourceRevision)
      .where(
        and(
          eq(appSourceRevision.id, parsed.data.body.revisionId),
          eq(appSourceRevision.projectId, projectId)
        )
      )
      .limit(1)

    if (!revision) return createErrorResponse('Revision not found', 404)

    try {
      const result = await activatePreviewPins({
        projectId,
        revisionId: parsed.data.body.revisionId,
        userId: session.user.id,
      })

      return createSuccessResponse({
        sessionId: result.sessionId,
        channelNonce: result.channelNonce,
        expiresAt: result.expiresAt.toISOString(),
        appPublicOrigin: origin.appPublicOrigin,
        buildId: result.buildId,
        artifactManifestHash: result.artifactManifestHash,
        artifactPreview: result.artifactPreview,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview session failed'
      if (message.includes('Build the revision')) {
        return createErrorResponse(message, 400, 'BUILD_REQUIRED')
      }
      if (message.includes('already active')) {
        return createErrorResponse(message, 409, 'PREVIEW_IN_PROGRESS')
      }
      return createErrorResponse(message, 400, 'PREVIEW_FAILED')
    }
  }
)
