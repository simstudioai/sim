import type { SessionPrincipal, WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { AuthType, type AuthTypeValue } from '@/lib/auth/hybrid'
import type {
  Filter,
  RowData,
  Sort,
  SortSpec,
  TablePredicate,
  TableRow,
  TableSchema,
} from '@/lib/table'
import type { TableRowDataKeying } from '@/lib/table/application/rows'
import { namedRowMapper } from '@/lib/table/cell-format'
import {
  buildIdByName,
  filterNamesToIds,
  rowDataNameToId,
  sortNamesToIds,
  sortSpecNamesToIds,
} from '@/lib/table/column-keys'
import { predicateToStorage, resolveFilterSelectValues } from '@/lib/table/select-values'
import { toWireTimestamp } from '@/lib/table/wire'

export interface RowWireTranslators {
  /** Inbound row data: wire keys → storage column ids. */
  dataIn: (data: RowData) => RowData
  /** Outbound row data: storage column ids → wire keys. */
  dataOut: (data: RowData) => RowData
  /** Inbound filter: wire field refs → storage column ids. */
  filterIn: (filter: Filter) => Filter
  /** Inbound sort: wire field refs → storage column ids. */
  sortIn: (sort: Sort) => Sort
  /** Inbound v2 predicate: wire field refs → storage column ids. */
  predicateIn: (predicate: TablePredicate) => TablePredicate
  /** Inbound v2 sort spec: wire field refs → storage column ids. */
  sortSpecIn: (sort: SortSpec) => SortSpec
}

/**
 * Wire-keying translators for the internal table row routes, which serve two
 * caller kinds: the first-party UI (session auth) speaks stable column ids and
 * passes through untouched, while workflow tool executions (internal JWT) speak
 * column names — tool enrichment surfaces names to the LLM — and translate
 * name↔id at this boundary, mirroring the public v1 routes.
 */
export function rowWireTranslators(
  authType: AuthTypeValue | undefined,
  schema: TableSchema
): RowWireTranslators {
  if (authType !== AuthType.INTERNAL_JWT) {
    const identity = <T>(value: T): T => value
    return {
      dataIn: identity,
      dataOut: identity,
      filterIn: identity,
      sortIn: identity,
      predicateIn: identity,
      sortSpecIn: identity,
    }
  }
  const idByName = buildIdByName(schema)
  return {
    dataOut: namedRowMapper(schema.columns),
    dataIn: (data) => rowDataNameToId(data, idByName),
    // Rekey field refs name → id, then resolve select operand names → ids. Both
    // grammars need that second step: a select cell stores an option id, so a
    // filter written with the option NAME matches nothing without it.
    filterIn: (filter) =>
      resolveFilterSelectValues(filterNamesToIds(filter, idByName), schema.columns),
    sortIn: (sort) => sortNamesToIds(sort, idByName),
    predicateIn: (predicate) => predicateToStorage(predicate, schema),
    sortSpecIn: (sort) => sortSpecNamesToIds(sort, idByName),
  }
}

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
  // Only the outbound mapper is needed here; building the full translator set
  // would also index the schema name→id for inbound paths a presenter cannot reach.
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

function identity<T>(value: T): T {
  return value
}
