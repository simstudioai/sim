import { TableRow } from './types'

/**
 * Transforms a table from the store format to a key-value object
 * @param table Array of table rows from the store
 * @returns Record of key-value pairs
 */
export const transformTable = (table: TableRow[] | null): Record<string, string> => {
  if (!table) return {}

  return table.reduce(
    (acc, row) => {
      if (row.cells?.Key && row.cells?.Value !== undefined) {
        acc[row.cells.Key] = row.cells.Value
      }
      return acc
    },
    {} as Record<string, string>
  )
}
