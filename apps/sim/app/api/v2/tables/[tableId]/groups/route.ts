import {
  v2AddWorkflowGroupContract,
  v2DeleteWorkflowGroupContract,
  v2ListWorkflowGroupsContract,
  v2UpdateWorkflowGroupContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import {
  createTableGroupUseCase,
  deleteTableGroupUseCase,
  listTableGroupsUseCase,
  updateTableGroupUseCase,
} from '@/lib/table/application/groups'
import { tableOperations } from '@/lib/table/application/operations'
import { normalizeColumn } from '@/lib/table/wire'
import { presentV2WorkflowGroup } from '@/app/api/v2/tables/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowGroupsContract,
  operation: tableOperations.listGroups,
  useCase: listTableGroupsUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, query }) => ({ tableId: params.tableId, workspaceId: query.workspaceId }),
  present: ({ table, groups }) => ({
    data: groups.map((group) => presentV2WorkflowGroup(group, table.schema)),
    nextCursor: null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2AddWorkflowGroupContract,
  operation: tableOperations.createGroup,
  useCase: createTableGroupUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table, group }) => ({
    data: {
      group: presentV2WorkflowGroup(group, table.schema),
      columns: table.schema.columns.map(normalizeColumn),
    },
  }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkflowGroupContract,
  operation: tableOperations.updateGroup,
  useCase: updateTableGroupUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table, group }) => ({
    data: {
      group: presentV2WorkflowGroup(group, table.schema),
      columns: table.schema.columns.map(normalizeColumn),
    },
  }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteWorkflowGroupContract,
  operation: tableOperations.deleteGroup,
  useCase: deleteTableGroupUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table, groupId }) => ({
    data: {
      id: groupId,
      deleted: true as const,
      columns: table.schema.columns.map(normalizeColumn),
    },
  }),
})
