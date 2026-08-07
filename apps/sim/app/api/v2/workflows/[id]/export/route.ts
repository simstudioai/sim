import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import { v2ExportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { buildWorkflowExportPayload } from '@/lib/workflows/operations/export-workflow'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { folderPathForId } from '@/app/api/v2/lib/folders'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'

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
export const GET = withPublicApiRouteHandler({
  contract: v2ExportWorkflowContract,
  rateLimitEndpoint: 'workflow-export',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    const { id } = input.params

    logger.info(`[${requestId}] Exporting workflow ${id}`, { userId })

    const workflowData = await getActiveWorkflowRecord(id)
    if (!workflowData?.workspaceId) return v2Error('NOT_FOUND', 'Workflow not found')

    // Mask an authorization failure as 404 so existence is not leaked.
    const access = await resolveWorkspaceAccess(rateLimit, userId, workflowData.workspaceId)
    if (access) return v2Error('NOT_FOUND', 'Workflow not found')

    const payload = await buildWorkflowExportPayload(workflowData)
    if (!payload) return v2Error('NOT_FOUND', 'Workflow state not found')
    const folderIndex = await loadActiveFolderPathIndex(workflowData.workspaceId, 'workflow')
    const folderPath = folderPathForId(folderIndex, workflowData.folderId)

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
        folderPath,
        blocksCount: Object.keys(payload.state.blocks).length,
        edgesCount: payload.state.edges.length,
      },
      request,
    })

    return v2Data(
      {
        ...payload,
        workflow: {
          id: payload.workflow.id,
          name: payload.workflow.name,
          description: payload.workflow.description,
          workspaceId: payload.workflow.workspaceId,
          folderPath,
        },
      },
      { rateLimit }
    )
  },
})
