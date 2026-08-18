import type { Principal } from '@sim/auth/principal'
import { readClientId } from '@/lib/api/client-id'
import {
  deleteTableRowContract,
  getTableRowContract,
  updateTableRowContract,
} from '@/lib/api/contracts/tables'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { AuthType, type AuthTypeValue } from '@/lib/auth/hybrid'
import { internalTableRowsErrorPolicy, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import type { TableRowDataKeying } from '@/lib/table/application/rows'
import { deleteTableRow, readTableRow, updateTableRow } from '@/lib/table/application/rows'
import type { RowData, TableDefinition, TableRow } from '@/lib/table/types'
import {
  finalizeTableRowsProvenance,
  negotiateTableRowsProvenance,
  readTableRowProvenanceEnvelope,
} from '@/app/api/table/row-secret-provenance'
import { rowWireTranslators } from '@/app/api/table/row-wire'

export const dynamic = 'force-dynamic'

/**
 * One path, two caller kinds, two column keyings.
 *
 * The first-party grid holds the schema it rendered and addresses cells by
 * stable column id; a workflow tool execution speaks column names, because names
 * are what tool enrichment surfaces to the model. The keying is a property of
 * the caller rather than of the endpoint, which is why it is derived from the
 * principal here and passed to the use case rather than assumed by it.
 */
function authTypeFor(principal: Principal): AuthTypeValue {
  return principal.kind === 'session' ? AuthType.SESSION : AuthType.INTERNAL_JWT
}

function keyingFor(authType: AuthTypeValue): TableRowDataKeying {
  return authType === AuthType.INTERNAL_JWT ? 'names' : 'ids'
}

/** The narrower projection these routes have always returned. */
function presentRow(row: TableRow, table: TableDefinition, principal: Principal) {
  const wire = rowWireTranslators(authTypeFor(principal), table.schema)
  return {
    id: row.id,
    data: wire.dataOut(row.data),
    position: row.position,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}

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
    includePersistedSecretProvenance: negotiateTableRowsProvenance(request, authTypeFor(principal)),
  }),
  useCase: readTableRow,
  present: ({ table, row }, { principal }) => ({
    success: true as const,
    data: { row: presentRow(row, table, principal) },
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
    const authType = authTypeFor(principal)
    return {
      tableId: params.tableId,
      rowId: params.rowId,
      assertedWorkspaceId: body.workspaceId,
      data: body.data as RowData,
      dataKeying: keyingFor(authType),
      strictWrite: false,
      // Handed over unresolved: interpreting the selections needs the canonical
      // schema, which this adapter must not load.
      secretProvenanceEnvelope: readTableRowProvenanceEnvelope(request, body),
      includePersistedSecretProvenance: negotiateTableRowsProvenance(request, authType),
      actorClientId: readClientId(request),
    }
  },
  useCase: updateTableRow,
  present: ({ table, row }, { principal }) => ({
    success: true as const,
    data: {
      row: presentRow(row, table, principal),
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
