import { readClientId } from '@/lib/api/client-id'
import {
  deleteTableRowContract,
  getTableRowContract,
  updateTableRowContract,
} from '@/lib/api/contracts/tables'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { internalTableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { deleteTableRow, readTableRow, updateTableRow } from '@/lib/table/application/rows'
import type { RowData } from '@/lib/table/types'
import {
  finalizeTableRowsProvenance,
  negotiateTableRowsProvenance,
  readTableRowProvenanceEnvelope,
} from '@/app/api/table/row-secret-provenance'
import { presentRowForPrincipal, rowKeyingForPrincipal } from '@/app/api/table/row-wire'

export const dynamic = 'force-dynamic'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing internal single-row table behavior',
})

export const GET = defineInternalJsonRoute({
  contract: getTableRowContract,
  operation: tableOperations.readRow,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: internalTableRowsErrorPolicy,
  mapInput: ({ params, query }, { principal, request }) => ({
    tableId: params.tableId,
    rowId: params.rowId,
    assertedWorkspaceId: query.workspaceId,
    includePersistedSecretProvenance: negotiateTableRowsProvenance(
      request,
      principal.kind !== 'session'
    ),
  }),
  useCase: readTableRow,
  present: ({ table, row }, { principal }) => ({
    success: true as const,
    data: { row: presentRowForPrincipal(row, table.schema, principal) },
  }),
  finalizeResponse: ({ result }) => finalizeTableRowsProvenance(result.secretProvenance),
})

export const PATCH = defineInternalJsonRoute({
  contract: updateTableRowContract,
  operation: tableOperations.updateRow,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: internalTableRowsErrorPolicy,
  mapInput: ({ params, body }, { principal, request }) => {
    return {
      tableId: params.tableId,
      rowId: params.rowId,
      assertedWorkspaceId: body.workspaceId,
      data: body.data as RowData,
      dataKeying: rowKeyingForPrincipal(principal),
      strictWrite: false,
      // Handed over unresolved: interpreting the selections needs the canonical
      // schema, which this adapter must not load.
      secretProvenanceEnvelope: readTableRowProvenanceEnvelope(request, body),
      includePersistedSecretProvenance: negotiateTableRowsProvenance(
        request,
        principal.kind !== 'session'
      ),
      actorClientId: readClientId(request),
    }
  },
  useCase: updateTableRow,
  present: ({ table, row }, { principal }) => ({
    success: true as const,
    data: {
      row: presentRowForPrincipal(row, table.schema, principal),
      message: 'Row updated successfully',
    },
  }),
  finalizeResponse: ({ result }) => finalizeTableRowsProvenance(result.secretProvenance),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteTableRowContract,
  operation: tableOperations.deleteRow,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: internalTableRowsErrorPolicy,
  mapInput: ({ params, body }, { request }) => ({
    tableId: params.tableId,
    rowId: params.rowId,
    assertedWorkspaceId: body.workspaceId,
    actorClientId: readClientId(request),
  }),
  useCase: deleteTableRow,
  present: () => ({
    success: true as const,
    data: { message: 'Row deleted successfully', deletedCount: 1 },
  }),
})
