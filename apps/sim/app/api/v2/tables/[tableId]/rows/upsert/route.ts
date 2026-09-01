import { v2UpsertTableRowContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { upsertTableRow } from '@/lib/table/application/rows'
import { namedRowMapper } from '@/lib/table/cell-format'
import { toApiRow } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2UpsertTableRowContract,
  operation: tableOperations.upsertRow,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    data: body.data,
    conflictTarget: body.conflictTarget,
    strictWrite: true,
    dataKeying: 'names' as const,
  }),
  useCase: upsertTableRow,
  present: ({ table, row, operation }) => ({
    data: {
      row: toApiRow(row, namedRowMapper(table.schema.columns)),
      operation,
    },
  }),
})
