import { db } from '@sim/db'
import {
  appDeploymentPin,
  appPreviewSession,
  appProject,
  appRevisionAction,
  workflow,
  workspace,
} from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { previewExecuteContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { isDraftDeploymentVersionId } from '@/lib/apps/draft-binding'
import { executeDeployedAction } from '@/lib/apps/execute-deployed-action'
import { APP_REQUEST_BODY_MAX_BYTES } from '@/lib/apps/manifest'
import { assertAppPermission } from '@/lib/apps/permissions'
import { stopPreviewSession } from '@/lib/apps/pins'
import { isPreviewSessionPastHardMax } from '@/lib/apps/preview-ttl'
import { validateAppActionInput } from '@/lib/apps/schema-validate'
import { getSession } from '@/lib/auth'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const maxDuration = 3600

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const ticket = tryAdmit()
    if (!ticket) return admissionRejectedResponse()

    try {
      const requestId = generateRequestId()
      const parsed = await parseRequest(previewExecuteContract, request, context, {
        maxBodyBytes: APP_REQUEST_BODY_MAX_BYTES,
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      })
      if (!parsed.success) return parsed.response

      const { projectId } = parsed.data.params
      const { sessionId, actionId, input } = parsed.data.body

      const [project] = await db
        .select()
        .from(appProject)
        .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
        .limit(1)

      if (!project) return createErrorResponse('Project not found', 404)

      const [ws] = await db
        .select({ id: workspace.id, archivedAt: workspace.archivedAt })
        .from(workspace)
        .where(eq(workspace.id, project.workspaceId))
        .limit(1)

      if (!ws || ws.archivedAt) {
        return createErrorResponse('Workspace is not available', 404)
      }

      const perm = await assertAppPermission(session.user.id, project.workspaceId, 'preview')
      if (!perm.ok) return createErrorResponse(perm.message, perm.status)

      const [preview] = await db
        .select()
        .from(appPreviewSession)
        .where(
          and(
            eq(appPreviewSession.id, sessionId),
            eq(appPreviewSession.projectId, projectId),
            eq(appPreviewSession.userId, session.user.id),
            isNull(appPreviewSession.stoppedAt)
          )
        )
        .limit(1)

      if (!preview || preview.expiresAt.getTime() < Date.now()) {
        return createErrorResponse('Preview session expired', 410)
      }

      if (isPreviewSessionPastHardMax(preview.startedAt)) {
        await stopPreviewSession(sessionId)
        return createErrorResponse(
          'Preview session exceeded hard maximum age; open a new session',
          410
        )
      }

      const [action] = await db
        .select()
        .from(appRevisionAction)
        .where(
          and(
            eq(appRevisionAction.revisionId, preview.revisionId),
            eq(appRevisionAction.actionId, actionId)
          )
        )
        .limit(1)

      if (!action) {
        return createErrorResponse('Unknown action', 404)
      }

      const isDraftAction = isDraftDeploymentVersionId(action.deploymentVersionId)

      if (!isDraftAction) {
        const [pin] = await db
          .select({ id: appDeploymentPin.id })
          .from(appDeploymentPin)
          .where(
            and(
              eq(appDeploymentPin.kind, 'preview'),
              eq(appDeploymentPin.previewSessionId, sessionId),
              eq(appDeploymentPin.workflowId, action.workflowId),
              eq(appDeploymentPin.deploymentVersionId, action.deploymentVersionId)
            )
          )
          .limit(1)

        if (!pin) {
          return createErrorResponse('Preview pin missing; reopen preview', 410)
        }
      }

      const inputValidation = validateAppActionInput({
        schemaHash: action.schemaHash,
        inputSchema: action.inputSchema,
        input: input || {},
        action: {
          actionId: action.actionId,
          workflowId: action.workflowId,
          deploymentVersionId: action.deploymentVersionId,
          inputSchema: action.inputSchema,
          outputAllowlist: action.outputAllowlist,
          executionPolicy: action.executionPolicy as 'sync' | 'async',
        },
      })
      if (!inputValidation.ok) {
        return createErrorResponse(inputValidation.message, 400, 'INVALID_INPUT')
      }

      const [wf] = await db
        .select({
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
          archivedAt: workflow.archivedAt,
        })
        .from(workflow)
        .where(eq(workflow.id, action.workflowId))
        .limit(1)

      if (!wf || wf.archivedAt || !wf.workspaceId || wf.workspaceId !== project.workspaceId) {
        return createErrorResponse('Workflow is not available', 404)
      }

      const outputConfigs = (
        action.outputAllowlist as Array<{
          key: string
          blockId: string
          path: string
          schema?: unknown
        }>
      ).map((o) => ({ key: o.key, blockId: o.blockId, path: o.path, schema: o.schema }))

      const result = await executeDeployedAction({
        workflowId: action.workflowId,
        userId: wf.userId,
        workspaceId: wf.workspaceId,
        deploymentGate: isDraftAction ? 'draft' : 'pinned',
        deploymentVersionId: isDraftAction ? undefined : action.deploymentVersionId,
        input: input || {},
        outputConfigs,
        executionPolicy: (action.executionPolicy as 'sync' | 'async') || 'sync',
        triggerIdentity: 'app',
        requestId,
        abortSignal: request.signal,
        appsFileContext: {
          projectId: project.id,
          previewSessionId: sessionId,
        },
      })

      if (!result.success) {
        return createErrorResponse(result.message, result.statusCode, result.code)
      }

      return createSuccessResponse({
        success: true,
        executionId: result.executionId,
        outputs: result.outputs,
      })
    } finally {
      ticket.release()
    }
  }
)
