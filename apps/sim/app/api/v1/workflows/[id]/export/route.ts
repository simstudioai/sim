import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { v1ExportWorkflowContract } from '@/lib/api/contracts/v1/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildWorkflowExportPayload } from '@/lib/workflows/operations/export-workflow'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  checkRateLimit,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1WorkflowExportAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v1/workflows/[id]/export
 *
 * Exports a workflow as a portable JSON envelope that
 * `POST /api/v1/workflows/import` accepts verbatim. Payload assembly and the
 * sanitization guarantees are documented on the shared
 * {@link buildWorkflowExportPayload}; this route authenticates and renders the
 * v1 envelope.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-export')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1ExportWorkflowContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid workflow ID' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      logger.info(`[${requestId}] Exporting workflow ${id}`, { userId })

      const workflowData = await getActiveWorkflowRecord(id)
      if (!workflowData?.workspaceId) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const accessError = await validateWorkspaceAccess(rateLimit, userId, workflowData.workspaceId)
      if (accessError) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const payload = await buildWorkflowExportPayload(workflowData)
      if (!payload) {
        return NextResponse.json({ error: 'Workflow state not found' }, { status: 404 })
      }

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

      const limits = await getUserLimits(userId)
      const apiResponse = createApiResponse({ data: payload }, limits, rateLimit)

      return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unknown error')
      logger.error(`[${requestId}] Workflow export error`, { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
