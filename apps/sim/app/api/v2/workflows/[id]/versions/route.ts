import type { V2WorkflowVersion } from '@/lib/api/contracts/v2/workflows'
import {
  v2ListWorkflowVersionsContract,
  v2WorkflowVersionCursorSchema,
} from '@/lib/api/contracts/v2/workflows'
import { UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { decodeCursor, encodeCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowVersionsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.listVersions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => {
    const decoded = query.cursor
      ? v2WorkflowVersionCursorSchema.safeParse(decodeCursor(query.cursor))
      : undefined
    if (decoded && !decoded.success) {
      throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
    }
    return {
      workflowId: params.id,
      limit: query.limit,
      afterVersion: decoded?.data.version,
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
