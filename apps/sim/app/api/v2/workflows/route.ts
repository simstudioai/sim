import type { V2WorkflowListItem } from '@/lib/api/contracts/v2/workflows'
import { v2CreateWorkflowContract, v2ListWorkflowsContract } from '@/lib/api/contracts/v2/workflows'
import { INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createWorkflow } from '@/lib/workflows/application/create-workflow'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { cursorSortKey, decodeSortedCursor, encodeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => {
    const sort = cursorSortKey(query.sortBy, query.sortOrder)
    const decoded = decodeSortedCursor(query.cursor, sort)
    if (decoded.status === 'invalid') {
      throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
    }
    return {
      workspaceId: query.workspaceId,
      folderPath: query.folderPath,
      deployedOnly: query.deployedOnly,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      cursorKeys: decoded.status === 'ok' ? decoded.keys : undefined,
      limit: query.limit,
    }
  },
  useCase: listWorkflows,
  present: ({ workflows, nextCursorKeys, sortBy, sortOrder }) => ({
    data: workflows.map(
      (workflow): V2WorkflowListItem => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        folderPath: workflow.folderPath,
        workspaceId: workflow.workspaceId,
        isDeployed: workflow.isDeployed,
        deployedAt: workflow.deployedAt?.toISOString() ?? null,
        runCount: workflow.runCount,
        lastRunAt: workflow.lastRunAt?.toISOString() ?? null,
        createdAt: workflow.createdAt.toISOString(),
        updatedAt: workflow.updatedAt.toISOString(),
      })
    ),
    nextCursor: nextCursorKeys
      ? encodeSortedCursor(cursorSortKey(sortBy, sortOrder), nextCursorKeys)
      : null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: createWorkflow,
  present: ({ workflow, folderPath }) => ({
    data: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? null,
      folderPath,
      workspaceId: workflow.workspaceId,
      isDeployed: false,
      deployedAt: null,
      runCount: 0,
      lastRunAt: null,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    },
  }),
})
