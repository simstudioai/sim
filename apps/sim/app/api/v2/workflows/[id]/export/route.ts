import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { v2ExportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildWorkflowExportPayload } from '@/lib/workflows/operations/export-workflow'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowExportAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[id]/export
 *
 * Exports a workflow as a portable JSON envelope that
 * `POST /api/v2/workflows/import` accepts verbatim. Payload assembly and the
 * sanitization guarantees are documented on the shared
 * {@link buildWorkflowExportPayload}; this route authenticates and renders the
 * v2 envelope.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-export')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2ExportWorkflowContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      logger.info(`[${requestId}] Exporting workflow ${id}`, { userId })

      const workflowData = await getActiveWorkflowRecord(id)
      if (!workflowData?.workspaceId) return v2Error('NOT_FOUND', 'Workflow not found')

      // Mask an authorization failure as 404 so existence is not leaked.
      const access = await resolveWorkspaceAccess(rateLimit, userId, workflowData.workspaceId)
      if (access) return v2Error('NOT_FOUND', 'Workflow not found')

      const payload = await buildWorkflowExportPayload(workflowData)
      if (!payload) return v2Error('NOT_FOUND', 'Workflow state not found')

      recordAudit({
        workspaceId: workflowData.workspaceId,
        actorId: userId,
        action: AuditAction.WORKFLOW_EXPORTED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: workflowData.id,
        resourceName: workflowData.name,
        description: `Exported workflow "${workflowData.name}" via the API`,
        metadata: {
          workspaceId: workflowData.workspaceId,
          folderId: workflowData.folderId || undefined,
          blocksCount: Object.keys(payload.state.blocks).length,
          edgesCount: payload.state.edges.length,
        },
        request,
      })

      return v2Data(payload, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Workflow export error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
