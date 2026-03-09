type BadgeVariant = 'green' | 'blue' | 'purple' | 'orange' | 'teal' | 'gray'

/**
 * Returns the appropriate badge color variant for a column type
 */
export function getTypeBadgeVariant(type: string): BadgeVariant {
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
