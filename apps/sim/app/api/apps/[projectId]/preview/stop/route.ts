import { db } from '@sim/db'
import { appPreviewSession, appProject } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { previewStopContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { assertAppPermission } from '@/lib/apps/permissions'
import { stopPreviewSession } from '@/lib/apps/pins'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(previewStopContract, request, context, {
      validationErrorResponse: (error) =>
        createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
    })
    if (!parsed.success) return parsed.response

    const { projectId } = parsed.data.params
    const { sessionId } = parsed.data.body

    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
      .limit(1)

    if (!project) return createErrorResponse('Project not found', 404)

    const perm = await assertAppPermission(session.user.id, project.workspaceId, 'preview')
    if (!perm.ok) return createErrorResponse(perm.message, perm.status)

    const [preview] = await db
      .select({ id: appPreviewSession.id })
      .from(appPreviewSession)
      .where(
        and(
          eq(appPreviewSession.id, sessionId),
          eq(appPreviewSession.projectId, projectId),
          eq(appPreviewSession.userId, session.user.id)
        )
      )
      .limit(1)

    if (!preview) return createErrorResponse('Preview session not found', 404)

    await stopPreviewSession(sessionId)
    return createSuccessResponse({ stopped: true })
  }
)
