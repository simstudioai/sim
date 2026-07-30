import { db } from '@sim/db'
import { workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { type V2WorkflowDetail, v2GetWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowDetailAPI')

export const revalidate = 0

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2GetWorkflowContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const workflowData = await getActiveWorkflowRecord(id)
      if (!workflowData?.workspaceId) return v2Error('NOT_FOUND', 'Workflow not found')

      // Mask an authorization failure as 404 so existence is not leaked.
      const access = await resolveWorkspaceAccess(rateLimit, userId, workflowData.workspaceId)
      if (access) return v2Error('NOT_FOUND', 'Workflow not found')

      const blockRows = await db
        .select({
          id: workflowBlocks.id,
          type: workflowBlocks.type,
          subBlocks: workflowBlocks.subBlocks,
        })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, id))

      const blocksRecord = Object.fromEntries(
        blockRows.map((block) => [block.id, { type: block.type, subBlocks: block.subBlocks }])
      )
      const inputs = extractInputFieldsFromBlocks(blocksRecord)

      const detail: V2WorkflowDetail = {
        id: workflowData.id,
        name: workflowData.name,
        description: workflowData.description,
        folderId: workflowData.folderId,
        workspaceId: workflowData.workspaceId,
        isDeployed: workflowData.isDeployed,
        deployedAt: workflowData.deployedAt?.toISOString() ?? null,
        runCount: workflowData.runCount,
        lastRunAt: workflowData.lastRunAt?.toISOString() ?? null,
        variables: (workflowData.variables as Record<string, unknown> | null) ?? {},
        inputs,
        createdAt: workflowData.createdAt.toISOString(),
        updatedAt: workflowData.updatedAt.toISOString(),
      }

      return v2Data(detail, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Workflow details fetch error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
