import type { TableRow } from '@/tools/types'

/**
 * Transforms a table from the store format to a key-value object.
 */
export const transformTable = (
  table: TableRow[] | Record<string, any> | string | null
): Record<string, any> => {
  if (!table) return {}

  if (typeof table === 'string') {
    try {
      const parsed = JSON.parse(table) as TableRow[] | Record<string, any>
      return transformTable(parsed)
    } catch {
      return {}
    }
  }

  if (Array.isArray(table)) {
    return table.reduce(
      (acc, row) => {
        if (row.cells?.Key && row.cells?.Value !== undefined) {
          const value = row.cells.Value
          acc[row.cells.Key] = value
        }
        return acc
      },
      {} as Record<string, any>
    )
  }

  if (typeof table === 'object') {
    return table
  }

  return {}
}
