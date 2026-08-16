import type { V2WorkflowListItem } from '@/lib/api/contracts/v2/workflows'
import { v2CreateWorkflowContract, v2ListWorkflowsContract } from '@/lib/api/contracts/v2/workflows'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { createWorkflow } from '@/lib/workflows/application/create-workflow'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which workflows, in which order, this list returns. */
function workflowCursorFilters(query: {
  workspaceId: string
  folderPath?: string
  deployedOnly: boolean
  search?: string
}) {
  return cursorScopeKey(cursorRoute(v2ListWorkflowsContract), {
    workspaceId: query.workspaceId,
    folderPath: query.folderPath,
    deployedOnly: query.deployedOnly,
    search: query.search,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    folderPath: query.folderPath,
    deployedOnly: query.deployedOnly,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      workflowCursorFilters(query)
    ),
    limit: query.limit,
  }),
  useCase: listWorkflows,
  present: ({ workflows, nextCursorKeys }, { query }) => ({
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
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      workflowCursorFilters(query)
    ),
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
