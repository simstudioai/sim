import { upsertTableRowContract } from '@/lib/api/contracts/tables'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { internalTableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { upsertTableRow } from '@/lib/table/application/rows'
import type { RowData } from '@/lib/table/types'
import {
  finalizeTableRowsProvenance,
  negotiateTableRowsProvenance,
  readTableRowProvenanceEnvelope,
} from '@/app/api/table/row-secret-provenance'
import { presentRowForPrincipal, rowKeyingForPrincipal } from '@/app/api/table/row-wire'

export const dynamic = 'force-dynamic'

/** POST /api/table/[tableId]/rows/upsert — inserts or updates based on unique columns. */
export const POST = defineInternalJsonRoute({
  contract: upsertTableRowContract,
  operation: tableOperations.upsertRow,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal table upsert behavior',
  }),
  errorPolicy: internalTableRowsErrorPolicy,
  mapInput: ({ params, body }, { principal, request }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    data: body.data as RowData,
    dataKeying: rowKeyingForPrincipal(principal),
    strictWrite: false,
    // The conflict target follows the same keying as the data; the use case
    // resolves it id-or-name against the canonical schema.
    conflictTarget: body.conflictTarget,
    // Handed over unresolved: interpreting the selections needs the canonical
    // schema, which this adapter must not load.
    secretProvenanceEnvelope: readTableRowProvenanceEnvelope(request, body),
    includePersistedSecretProvenance: negotiateTableRowsProvenance(
      request,
      principal.kind !== 'session'
    ),
  }),
  useCase: upsertTableRow,
  present: ({ table, row, operation }, { principal }) => ({
    success: true as const,
    data: {
      row: presentRowForPrincipal(row, table.schema, principal),
      operation,
      message: `Row ${operation === 'update' ? 'updated' : 'inserted'} successfully`,
    },
  }),
  finalizeResponse: ({ result }) => finalizeTableRowsProvenance(result.secretProvenance),
})
