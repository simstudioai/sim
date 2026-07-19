import { db } from '@sim/db'
import { appProject } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { previewAbortCandidateContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { assertAppPermission } from '@/lib/apps/permissions'
import { abortPreviewCandidate } from '@/lib/apps/pins'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)
    const parsed = await parseRequest(previewAbortCandidateContract, request, context, {
      validationErrorResponse: (error) =>
        createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
    })
    if (!parsed.success) return parsed.response

    const { projectId } = parsed.data.params
    const [project] = await db
      .select({ workspaceId: appProject.workspaceId })
      .from(appProject)
      .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
      .limit(1)
    if (!project) return createErrorResponse('Project not found', 404)
    const permission = await assertAppPermission(session.user.id, project.workspaceId, 'preview')
    if (!permission.ok) return createErrorResponse(permission.message, permission.status)

    const result = await abortPreviewCandidate({
      projectId,
      userId: session.user.id,
      sessionId: parsed.data.body.sessionId,
    })
    if (!result.ok) {
      return createErrorResponse('Preview candidate is no longer available', 409, 'PREVIEW_STALE')
    }
    return createSuccessResponse({ aborted: true })
  }
)
