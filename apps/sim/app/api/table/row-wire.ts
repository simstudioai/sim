import { AuthType, type AuthTypeValue } from '@/lib/auth/hybrid'
import type { Filter, RowData, Sort, SortSpec, TablePredicate, TableSchema } from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import {
  buildIdByName,
  filterNamesToIds,
  predicateNamesToIds,
  rowDataNameToId,
  sortNamesToIds,
  sortSpecNamesToIds,
} from '@/lib/table/column-keys'
import { resolveFilterSelectValues, resolvePredicateSelectValues } from '@/lib/table/select-values'

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
    predicateIn: (predicate) =>
      resolvePredicateSelectValues(predicateNamesToIds(predicate, idByName), schema.columns),
    sortSpecIn: (sort) => sortSpecNamesToIds(sort, idByName),
  }
}
