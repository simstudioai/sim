/**
 * The table codec, made from the column-type registry: every column type, what metadata each owns,
 * which may be unique, how many one table holds and what a column is stamped with all come from
 * `@/lib/table/column-types`, so a type added there is declarable here with no edit.
 */
import {
  createTableCodec,
  type TableColumnCatalog,
  type TableColumnTypeDescriptor,
} from '@sim/workspace-code/kinds/table'
import { ALL_COLUMN_TYPES, type ColumnTypeDefinition } from '@/lib/table/column-types'
import { MAX_SELECT_OPTIONS } from '@/lib/table/constants'

function describe(definition: ColumnTypeDefinition): TableColumnTypeDescriptor {
  const stamped = definition.defaultMetadata?.({ name: definition.id, type: definition.id }) ?? {}
  const defaults = Object.fromEntries(
    definition.ownedMetadata.flatMap((key) => {
      const value = stamped[key]
      return typeof value === 'string' || typeof value === 'boolean' ? [[key, value]] : []
    })
  )
  return {
    owns: definition.ownedMetadata,
    unique: definition.supportsUnique,
    ...(definition.maxPerTable !== undefined ? { maxPerTable: definition.maxPerTable } : {}),
    ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
  }
}

/** The column types a table declaration may use, as the registry defines them. */
export const TABLE_COLUMN_CATALOG: TableColumnCatalog = {
  types: Object.fromEntries(
    ALL_COLUMN_TYPES.map((definition) => [definition.id, describe(definition)])
  ),
  maxOptions: MAX_SELECT_OPTIONS,
}

/** Reads and prints `tables/<key>.ts` for the registry's column types. */
export const tableCodec = createTableCodec(TABLE_COLUMN_CATALOG)
