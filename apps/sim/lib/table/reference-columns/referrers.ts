import { columnTypeOf } from '@/lib/table/column-types'
import type { TableDefinition } from '@/lib/table/types'

type ReferenceScanTable = Pick<TableDefinition, 'id' | 'name' | 'schema'>

/**
 * Tables outside a deletion whose Reference columns target a table inside it, sorted by name.
 * Deleting a referenced table is allowed; its references resolve as not found afterwards.
 */
export function findReferencingTables(
  tables: readonly ReferenceScanTable[],
  deletedTableIds: ReadonlySet<string>
): Array<Pick<TableDefinition, 'id' | 'name'>> {
  if (deletedTableIds.size === 0) return []

  const referencing: Array<Pick<TableDefinition, 'id' | 'name'>> = []
  for (const table of tables) {
    if (deletedTableIds.has(table.id)) continue
    const referencesDeletedTable = table.schema.columns.some((column) => {
      const referenceTableId = columnTypeOf(column).referencePreview?.getTableId(column)
      return referenceTableId !== undefined && deletedTableIds.has(referenceTableId)
    })
    if (referencesDeletedTable) referencing.push({ id: table.id, name: table.name })
  }
  return referencing.sort((left, right) => left.name.localeCompare(right.name))
}
