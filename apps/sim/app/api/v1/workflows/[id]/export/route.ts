import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import type { Edge } from 'reactflow'
import {
  type V1WorkflowExportPayload,
  v1ExportWorkflowContract,
} from '@/lib/api/contracts/v1/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  checkRateLimit,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1WorkflowExportAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

type ExportedEdge = V1WorkflowExportPayload['state']['edges'][number]

/**
 * Projects a persisted ReactFlow edge onto the wire shape declared by the
 * response contract. Field-by-field rather than a spread because ReactFlow's
 * `Edge` is looser than the contract in three places: handles are `null` when
 * unset (the contract and the importer both model absent as `undefined`),
 * `label` is a `ReactNode`, and the marker fields accept an `EdgeMarker`
 * object. Non-serializable values in those slots are dropped rather than
 * emitted as `{}`.
 */
function toExportedEdge(edge: Edge): ExportedEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: edge.type,
    animated: edge.animated,
    style: edge.style as Record<string, unknown> | undefined,
    data: edge.data,
    label: typeof edge.label === 'string' ? edge.label : undefined,
    labelStyle: edge.labelStyle as Record<string, unknown> | undefined,
    labelShowBg: edge.labelShowBg,
    labelBgStyle: edge.labelBgStyle as Record<string, unknown> | undefined,
    labelBgPadding: edge.labelBgPadding,
    labelBgBorderRadius: edge.labelBgBorderRadius,
    markerStart: typeof edge.markerStart === 'string' ? edge.markerStart : undefined,
    markerEnd: typeof edge.markerEnd === 'string' ? edge.markerEnd : undefined,
  }
}

/**
 * GET /api/v1/workflows/[id]/export
 *
 * Exports a workflow as a portable JSON envelope that
 * `POST /api/v1/workflows/import` accepts verbatim.
 *
 * Unlike the admin export (`/api/v1/admin/workflows/[id]/export`), which emits
 * the raw state for backup/restore, this surface runs the payload through
 * `sanitizeForExport`: block sub-block values declared `password: true` or
 * `oauth-input` are nulled, while `{{ENV_VAR}}` references and block positions
 * are preserved.
 *
 * Workflow **variables** are emitted as stored, matching `GET
 * /api/v1/workflows/[id]` and the in-app export. Variables are plaintext
 * workflow configuration readable by anyone with workspace read (the same
 * permission this route requires); secrets belong in environment variables,
 * which travel as unresolved `{{ENV_VAR}}` references. Redacting them here
 * would break import round-trips without narrowing access.
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

      const normalizedData = await loadWorkflowFromNormalizedTables(id)
      if (!normalizedData) {
        return NextResponse.json({ error: 'Workflow state not found' }, { status: 404 })
      }

      const sanitized = sanitizeForExport({
        blocks: normalizedData.blocks,
        edges: normalizedData.edges,
        loops: normalizedData.loops,
        parallels: normalizedData.parallels,
        metadata: {
          name: workflowData.name,
          description: workflowData.description ?? undefined,
        },
        variables: parseWorkflowVariables(workflowData.variables),
      })

      const payload: V1WorkflowExportPayload = {
        version: '1.0',
        exportedAt: sanitized.exportedAt,
        workflow: {
          id: workflowData.id,
          name: workflowData.name,
          description: workflowData.description,
          workspaceId: workflowData.workspaceId,
          folderId: workflowData.folderId,
        },
        state: {
          ...sanitized.state,
          edges: sanitized.state.edges.map(toExportedEdge),
          metadata: {
            ...sanitized.state.metadata,
            name: workflowData.name,
            description: workflowData.description ?? undefined,
            exportedAt: sanitized.exportedAt,
          },
        },
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
