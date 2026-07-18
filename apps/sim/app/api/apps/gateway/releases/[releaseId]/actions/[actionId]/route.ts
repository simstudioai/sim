import { db } from '@sim/db'
import {
  appDeploymentPin,
  appProject,
  appRelease,
  appReleaseAction,
  workflow,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { gatewayActionContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { verifyAppsAbuseToken } from '@/lib/apps/abuse-token'
import { executeDeployedAction } from '@/lib/apps/execute-deployed-action'
import { requireAppsHopFromRequest } from '@/lib/apps/hop-proof'
import { APP_REQUEST_BODY_MAX_BYTES } from '@/lib/apps/manifest'
import { APP_ABUSE_TOKEN_HEADER } from '@/lib/apps/origin'
import { enforceAppsActionRateLimit, enforceAppsIpRateLimit } from '@/lib/apps/rate-limit'
import { validateAppActionInput } from '@/lib/apps/schema-validate'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('AppsGatewayAction')

export const maxDuration = 3600

export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ releaseId: string; actionId: string }> }
  ) => {
    const requestId = generateRequestId()

    const hop = requireAppsHopFromRequest(request)
    if (!hop.ok) {
      return createErrorResponse(hop.message, hop.status)
    }

    const ipLimit = await enforceAppsIpRateLimit('gateway', request)
    if (ipLimit) return ipLimit

    const ticket = tryAdmit()
    if (!ticket) return admissionRejectedResponse()

    try {
      const parsed = await parseRequest(gatewayActionContract, request, context, {
        maxBodyBytes: APP_REQUEST_BODY_MAX_BYTES,
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      })
      if (!parsed.success) return parsed.response

      const { releaseId, actionId } = parsed.data.params
      const actionLimit = await enforceAppsActionRateLimit(releaseId, actionId, request)
      if (actionLimit) return actionLimit

      const [release] = await db
        .select()
        .from(appRelease)
        .where(eq(appRelease.id, releaseId))
        .limit(1)

      if (!release || release.state !== 'published' || release.revokedAt) {
        return createErrorResponse('This app is not available', 404)
      }

      const [project] = await db
        .select()
        .from(appProject)
        .where(and(eq(appProject.id, release.projectId), isNull(appProject.archivedAt)))
        .limit(1)

      // Pointer-only model: only the current publishedReleaseId is callable.
      // Publish/rollback always revoke the vacated release so pins stay aligned.
      if (!project || project.publishedReleaseId !== releaseId) {
        return createErrorResponse('This app is not available', 404)
      }

      const abuseHeader = request.headers.get(APP_ABUSE_TOKEN_HEADER)
      const abuse = verifyAppsAbuseToken(abuseHeader, project.publicId)
      if (!abuse.ok) {
        return createErrorResponse('Abuse challenge required', 403, 'ABUSE_TOKEN_REQUIRED')
      }

      const [action] = await db
        .select()
        .from(appReleaseAction)
        .where(
          and(eq(appReleaseAction.releaseId, releaseId), eq(appReleaseAction.actionId, actionId))
        )
        .limit(1)

      if (!action) {
        return createErrorResponse('Unknown action', 404)
      }

      // Exact-action pin: multi-action releases must pin each workflow version.
      const [actionPin] = await db
        .select({ id: appDeploymentPin.id })
        .from(appDeploymentPin)
        .where(
          and(
            eq(appDeploymentPin.kind, 'release'),
            eq(appDeploymentPin.releaseId, releaseId),
            eq(appDeploymentPin.workflowId, action.workflowId),
            eq(appDeploymentPin.deploymentVersionId, action.deploymentVersionId)
          )
        )
        .limit(1)

      if (!actionPin) {
        return createErrorResponse('This app is not available', 404)
      }

      const inputValidation = validateAppActionInput({
        schemaHash: action.schemaHash,
        inputSchema: action.inputSchema,
        input: parsed.data.body.input || {},
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
        return createErrorResponse('This app is not available', 404)
      }

      const [ws] = await db
        .select({ id: workspace.id, archivedAt: workspace.archivedAt })
        .from(workspace)
        .where(eq(workspace.id, wf.workspaceId))
        .limit(1)

      if (!ws || (ws as { archivedAt?: Date | null }).archivedAt) {
        return createErrorResponse('This app is not available', 404)
      }

      const outputConfigs = (
        action.outputAllowlist as Array<{
          key: string
          blockId: string
          path: string
          schema?: unknown
        }>
      ).map((o) => ({ key: o.key, blockId: o.blockId, path: o.path, schema: o.schema }))

      logger.info(`[${requestId}] Executing app action`, {
        appProjectId: project.id,
        publicId: project.publicId,
        releaseId,
        actionId,
      })

      const result = await executeDeployedAction({
        workflowId: action.workflowId,
        userId: wf.userId,
        workspaceId: wf.workspaceId,
        deploymentGate: 'pinned',
        deploymentVersionId: action.deploymentVersionId,
        input: parsed.data.body.input || {},
        outputConfigs,
        executionPolicy: (action.executionPolicy as 'sync' | 'async') || 'sync',
        triggerIdentity: 'app',
        requestId,
        abortSignal: request.signal,
      })

      if (!result.success) {
        return createErrorResponse(result.message, result.statusCode, result.code)
      }

      return createSuccessResponse({
        success: true,
        executionId: result.executionId,
        outputs: result.outputs,
      })
    } catch (error) {
      logger.error(`[${requestId}] Gateway action failed`, { error })
      return createErrorResponse('Execution failed', 500)
    } finally {
      ticket.release()
    }
  }
)
