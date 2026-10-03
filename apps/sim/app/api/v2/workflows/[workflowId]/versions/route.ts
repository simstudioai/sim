import type { V2WorkflowVersion } from '@/lib/api/contracts/v2/workflows'
import {
  v2ListWorkflowVersionsContract,
  v2WorkflowVersionCursorSchema,
} from '@/lib/api/contracts/v2/workflows'
import { cursorRoute, cursorScopeKey, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  decodeCursor,
  encodeCursor,
  encodeScopedCursor,
  readScopedCursor,
} from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The sequence a version cursor names a position in: this list, on THIS
 * workflow.
 *
 * The payload is a bare `version` ordinal and every workflow numbers its
 * history from 1, so an unscoped token minted on one workflow decoded cleanly
 * against another and answered 200 from a position the caller never reached.
 * The workflow id lives in the path, so the route is the only place that knows
 * which history the ordinal counts within.
 */
function versionCursorScope(workflowId: string): string {
  return cursorScopeKey(cursorRoute(v2ListWorkflowVersionsContract, { workflowId }))
}

export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowVersionsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.listVersions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => {
    const inner = readScopedCursor(query.cursor, versionCursorScope(params.workflowId))
    const decoded = inner ? v2WorkflowVersionCursorSchema.safeParse(decodeCursor(inner)) : undefined
    if (decoded && !decoded.success) {
      throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
    }
    return {
      workflowId: params.workflowId,
      limit: query.limit,
      afterVersion: decoded?.data.version,
    }
  },
  useCase: listWorkflowVersions,
  present: ({ versions, hasMore }, { params }) => {
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
          ? encodeScopedCursor(
              versionCursorScope(params.workflowId),
              encodeCursor({ version: data[data.length - 1].version })
            )
          : null,
    }
  },
})
