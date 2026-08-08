import type { V2WorkflowVersion } from '@/lib/api/contracts/v2/workflows'
import { v2ListWorkflowVersionsContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { decodeCursor, encodeCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface WorkflowVersionCursor {
  version: number
}

export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowVersionsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.listVersions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => {
    const after = query.cursor ? decodeCursor<WorkflowVersionCursor>(query.cursor) : null
    if (query.cursor && (!after || !Number.isInteger(after.version) || after.version < 1)) {
      throw new OrchestrationError('validation', 'Invalid cursor')
    }
    return {
      workflowId: params.id,
      limit: query.limit,
      afterVersion: after?.version,
    }
  },
  useCase: listWorkflowVersions,
  present: ({ versions, hasMore }) => {
    const data: V2WorkflowVersion[] = versions.map((version) => ({
      id: version.id,
      version: version.version,
      name: version.name,
      description: version.description,
      isActive: version.isActive,
      createdAt: version.createdAt.toISOString(),
      deployedBy: version.deployedByName,
      latestOperationStatus:
        version.latestOperationStatus as V2WorkflowVersion['latestOperationStatus'],
    }))
    return {
      data,
      nextCursor:
        hasMore && data.length > 0
          ? encodeCursor({ version: data[data.length - 1].version })
          : null,
    }
  },
})
