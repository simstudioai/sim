import type { InternalAuthTransport } from '@/lib/api/server/routes'
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
 * Selects the table-row wire dialect from the route's verified authentication
 * transport. The runtime principal remains identity only: a session actor may
 * also be executing a workflow, so its principal kind cannot identify which
 * HTTP dialect reached this adapter.
 */
export function rowKeyingForAuthTransport(
  authTransport: InternalAuthTransport | undefined
): TableRowDataKeying {
  switch (authTransport) {
    case 'session':
      return 'ids'
    case 'executor_jwt':
      return 'names'
    case undefined:
      throw new Error('Table row route requires an authenticated transport')
  }
}

/**
 * One row in the narrower projection the single-row and upsert routes return:
 * the stored cells in the caller's keying, plus position, with timestamps
 * already serialized. See `tableRowWireSchema`, which is its contract.
 */
export function presentRowForKeying(
  row: Pick<TableRow, 'id' | 'data' | 'position' | 'createdAt' | 'updatedAt'>,
  schema: TableSchema,
  keying: TableRowDataKeying
) {
  // Only the outbound mapper is needed here; building the full translator set
  // would also index the schema name→id for inbound paths a presenter cannot reach.
  const dataOut = keying === 'names' ? namedRowMapper(schema.columns) : identity
  return {
    id: row.id,
    data: dataOut(row.data),
    position: row.position,
    createdAt: toWireTimestamp(row.createdAt),
    updatedAt: toWireTimestamp(row.updatedAt),
  }
}

export function presentQueryRowForKeying(
  row: TableRow,
  schema: TableSchema,
  keying: TableRowDataKeying
) {
  const dataOut = keying === 'names' ? namedRowMapper(schema.columns) : identity
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
