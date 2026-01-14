/**
 * Utility functions for the table data viewer.
 *
 * @module tables/[tableId]/table-data-viewer/utils
 */

/**
 * Gets the badge variant for a column type.
 *
 * @param type - The column type
 * @returns Badge variant name
 */
export function getTypeBadgeVariant(
  type: string
): 'green' | 'blue' | 'purple' | 'orange' | 'teal' | 'gray' {
  switch (type) {
    case 'string':
      return 'green'
    case 'number':
      return 'blue'
    case 'boolean':
      return 'purple'
    case 'json':
      return 'orange'
    case 'date':
      return 'teal'
    default:
      return 'gray'
  }
}
