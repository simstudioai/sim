import { db } from '@sim/db'
import { appPreviewSession, appProject, workflow } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { bindAppRevisionContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { buildBoundActionEntry } from '@/lib/apps/bind-actions'
import { assertAppPermission } from '@/lib/apps/permissions'
import { stopPreviewSession } from '@/lib/apps/pins'
import { createRevisionWithActions } from '@/lib/apps/revisions'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(bindAppRevisionContract, request, context, {
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

    const perm = await assertAppPermission(session.user.id, project.workspaceId, 'bind')
    if (!perm.ok) return createErrorResponse(perm.message, perm.status)

    const actions = []
    for (const raw of parsed.data.body.actions) {
      const [wf] = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(
          and(
            eq(workflow.id, raw.workflowId),
            eq(workflow.workspaceId, project.workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .limit(1)

      if (!wf) {
        return createErrorResponse(`Workflow ${raw.workflowId} not found in workspace`, 400)
      }

      // Version existence, API start, HITL, and output paths are resolved in
      // buildBoundActionEntry (single load of the deployment snapshot).
      const bound = await buildBoundActionEntry({
        workspaceId: project.workspaceId,
        request: {
          actionId: raw.actionId,
          workflowId: raw.workflowId,
          deploymentVersionId: raw.deploymentVersionId,
          outputAllowlist: raw.outputAllowlist,
          executionPolicy: raw.executionPolicy,
        },
      })
      if (!bound.ok) {
        const status = bound.code === 'DEPLOYMENT_VERSION_MISSING' ? 409 : 400
        return createErrorResponse(bound.error, status, bound.code)
      }
      actions.push(bound.action)
    }

    // Rebind invalidates prior draft previews for this project.
    const priorSessions = await db
      .select({ id: appPreviewSession.id })
      .from(appPreviewSession)
      .where(and(eq(appPreviewSession.projectId, projectId), isNull(appPreviewSession.stoppedAt)))
    for (const row of priorSessions) {
      await stopPreviewSession(row.id)
    }

    const { revisionId } = await createRevisionWithActions({
      projectId,
      userId: session.user.id,
      actions,
    })

    return createSuccessResponse({ revisionId })
  }
)
