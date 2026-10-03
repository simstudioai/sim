import type { V2WorkflowListItem } from '@/lib/api/contracts/v2/workflows'
import { v2CreateWorkflowContract, v2ListWorkflowsContract } from '@/lib/api/contracts/v2/workflows'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { workspaceResourceWebUrl } from '@/lib/resources'
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
  scope: 'active' | 'archived'
  deployedOnly: boolean
  search?: string
}) {
  return cursorScopeKey(cursorRoute(v2ListWorkflowsContract), {
    workspaceId: query.workspaceId,
    folderPath: query.folderPath,
    // Stamped only when it is not the default. `scope` carries
    // `.default('active')`, so it is always present on the parsed query;
    // binding it unconditionally would put a constant in every fingerprint and
    // reject every cursor minted before the field existed — including on
    // callers who never sent it.
    scope: query.scope === 'active' ? undefined : query.scope,
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
    scope: query.scope,
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
  present: ({ workflows, nextCursorKeys }, { query }) => {
    const baseUrl = getBaseUrl()
    return {
      data: workflows.map(
        (workflow): V2WorkflowListItem => ({
          id: workflow.id,
          webUrl: workspaceResourceWebUrl(baseUrl, workflow.workspaceId, 'workflow', workflow.id),
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
    }
  },
})

export const POST = defineV2JsonRoute({
  contract: v2CreateWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: createWorkflow,
  present: ({ workflow, folderPath, normalizedState }) => ({
    data: {
      blocks: Object.values(normalizedState.blocks).map((block) => ({
        id: block.id,
        type: block.type,
        name: block.name,
      })),
      id: workflow.id,
      webUrl: workspaceResourceWebUrl(getBaseUrl(), workflow.workspaceId, 'workflow', workflow.id),
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
