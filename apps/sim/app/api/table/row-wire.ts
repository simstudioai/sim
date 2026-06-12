import { AuthType, type AuthTypeValue } from '@/lib/auth/hybrid'
import type { Filter, RowData, Sort, TableSchema } from '@/lib/table'
import {
  buildIdByName,
  buildNameById,
  filterNamesToIds,
  rowDataIdToName,
  rowDataNameToId,
  sortNamesToIds,
} from '@/lib/table'

export interface RowWireTranslators {
  /** Inbound row data: wire keys → storage column ids. */
  dataIn: (data: RowData) => RowData
  /** Outbound row data: storage column ids → wire keys. */
  dataOut: (data: RowData) => RowData
  /** Inbound filter: wire field refs → storage column ids. */
  filterIn: (filter: Filter) => Filter
  /** Inbound sort: wire field refs → storage column ids. */
  sortIn: (sort: Sort) => Sort
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
    return { dataIn: identity, dataOut: identity, filterIn: identity, sortIn: identity }
  }
  const idByName = buildIdByName(schema)
  const nameById = buildNameById(schema)
  return {
    dataIn: (data) => rowDataNameToId(data, idByName),
    dataOut: (data) => rowDataIdToName(data, nameById),
    filterIn: (filter) => filterNamesToIds(filter, idByName),
    sortIn: (sort) => sortNamesToIds(sort, idByName),
  }
}
