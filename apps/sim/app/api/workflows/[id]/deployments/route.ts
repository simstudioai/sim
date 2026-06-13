import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { listDeploymentVersionsContract } from '@/lib/api/contracts/deployments'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkflowVersions } from '@/lib/workflows/persistence/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeploymentsListAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const parsed = await parseRequest(listDeploymentVersionsContract, request, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params

    try {
      const { error } = await validateWorkflowPermissions(id, requestId, 'read')
      if (error) {
        return createErrorResponse(error.message, error.status)
      }

      const { versions: rows } = await listWorkflowVersions(id)
      const versions = rows.map(({ deployedByName, ...version }) => ({
        ...version,
        deployedBy: deployedByName,
      }))

      return createSuccessResponse({ versions })
    } catch (error: any) {
      logger.error(`[${requestId}] Error listing deployments for workflow: ${id}`, error)
      return createErrorResponse(error.message || 'Failed to list deployments', 500)
    }
  }
)
