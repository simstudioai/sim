import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import {
  type V2WorkflowVersionDetail,
  v2GetWorkflowVersionContract,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkflowDeploymentVersion } from '@/lib/workflows/persistence/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowVersionDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[id]/versions/[version] — Fetch one deployment version
 * and the workflow state it pins.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; version: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-version-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2GetWorkflowVersionContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id, version } = parsed.data.params

      const workflowData = await getActiveWorkflowRecord(id)
      if (!workflowData?.workspaceId) return v2Error('NOT_FOUND', 'Workflow not found')

      // Mask an authorization failure as 404 so existence is not leaked.
      const access = await resolveWorkspaceAccess(rateLimit, userId, workflowData.workspaceId)
      if (access) return v2Error('NOT_FOUND', 'Workflow not found')

      const row = await getWorkflowDeploymentVersion(id, version)
      if (!row?.state) return v2Error('NOT_FOUND', 'Deployment version not found')

      const detail: V2WorkflowVersionDetail = {
        id: row.id,
        version: row.version,
        name: row.name,
        description: row.description,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        state: row.state as V2WorkflowVersionDetail['state'],
      }

      return v2Data(detail, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Workflow version fetch error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
