import type { SessionPrincipal, WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import type { TableRow, TableSchema } from '@/lib/table'
import type { TableRowDataKeying } from '@/lib/table/application/rows'
import { namedRowMapper } from '@/lib/table/cell-format'
import { toWireTimestamp } from '@/lib/table/wire'

/**
 * The principal kinds the internal table row routes admit — the auth policy
 * yields exactly these two. Typed as the union rather than `Principal` so a
 * third kind becomes an exhaustiveness error here instead of silently taking
 * the name-keyed branch, which would drop every id-keyed cell of a write and
 * report success.
 */
type TableRowRoutePrincipal = SessionPrincipal | WorkflowExecutionDelegatedPrincipal

/**
 * The internal table routes serve two caller kinds on the same paths, and they
 * speak different column keyings: the first-party grid holds the schema it
 * rendered and addresses cells by stable id, while a workflow tool execution
 * speaks column names, because names are what tool enrichment surfaces to the
 * model. Keying is therefore a property of the caller, not of the endpoint.
 */
export function rowKeyingForPrincipal(principal: TableRowRoutePrincipal): TableRowDataKeying {
  switch (principal.kind) {
    case 'session':
      return 'ids'
    case 'delegated':
      return 'names'
  }
}

/**
 * One row in the narrower projection the single-row and upsert routes return:
 * the stored cells in the caller's keying, plus position, with timestamps
 * already serialized. See `tableRowWireSchema`, which is its contract.
 */
export function presentRowForPrincipal(
  row: Pick<TableRow, 'id' | 'data' | 'position' | 'createdAt' | 'updatedAt'>,
  schema: TableSchema,
  principal: TableRowRoutePrincipal
) {
  const dataOut =
    rowKeyingForPrincipal(principal) === 'names' ? namedRowMapper(schema.columns) : identity
  return {
    id: row.id,
    data: dataOut(row.data),
    position: row.position,
    createdAt: toWireTimestamp(row.createdAt),
    updatedAt: toWireTimestamp(row.updatedAt),
  }
}

export function presentQueryRowForPrincipal(
  row: TableRow,
  schema: TableSchema,
  principal: TableRowRoutePrincipal
) {
  const dataOut =
    rowKeyingForPrincipal(principal) === 'names' ? namedRowMapper(schema.columns) : identity
  return {
    id: row.id,
    data: dataOut(row.data),
    executions: row.executions,
    position: row.position,
    orderKey: row.orderKey ?? undefined,
    createdAt: toWireTimestamp(row.createdAt),
    updatedAt: toWireTimestamp(row.updatedAt),
  }
}

function identity<T>(value: T): T {
  return value
}
