/**
 * Maximum length for string values in display output
 * Prevents database storage issues with very large trace spans
 */
const MAX_STRING_LENGTH = 10000

/**
 * Truncates a string if it exceeds the maximum length
 */
function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.substring(0, maxLength)}... [truncated ${value.length - maxLength} chars]`
}

/**
 * Type guard to check if an object is a UserFile
 */
export function isUserFile(candidate: unknown): candidate is {
  id: string
  name: string
  url: string
  key: string
  size: number
  type: string
  context?: string
} {
  if (!candidate || typeof candidate !== 'object') {
    return false
  }

  const value = candidate as Record<string, unknown>
  return (
    typeof value.id === 'string' &&
    typeof value.key === 'string' &&
    typeof value.url === 'string' &&
    typeof value.name === 'string'
  )
}

/**
 * Filter function that transforms UserFile objects for display
 * Removes internal fields: key, context
 * Keeps user-friendly fields: id, name, url, size, type
 */
function filterUserFile(data: any): any {
  if (isUserFile(data)) {
    const { id, name, url, size, type } = data
    return { id, name, url, size, type }
  }
  return data
}

/**
 * Registry of filter functions to apply to data for cleaner display in logs/console.
 * Add new filter functions here to handle additional data types.
 */
const DISPLAY_FILTERS = [
  filterUserFile,
  // Add more filters here as needed
]

/**
 * Generic helper to filter internal/technical fields from data for cleaner display in logs and console.
 * Applies all registered filters recursively to the data structure.
 * Also truncates long strings to prevent database storage issues.
 *
 * To add a new filter:
 * 1. Create a filter function that checks and transforms a specific data type
 * 2. Add it to the DISPLAY_FILTERS array above
 *
 * @param data - Data to filter (objects, arrays, primitives)
 * @returns Filtered data with internal fields removed and long strings truncated
 */
export function filterForDisplay(data: any): any {
  // Handle null/undefined
  if (data === null || data === undefined) {
    return data
  }

  // Truncate long strings
  if (typeof data === 'string') {
    return truncateString(data)
  }

  // Return primitives as-is
  if (typeof data !== 'object') {
    return data
  }

  // Apply all registered filters
  const filtered = data
  for (const filterFn of DISPLAY_FILTERS) {
    const result = filterFn(filtered)
    if (result !== filtered) {
      // Filter matched and transformed the data
      return result
    }
  }

  // No filters matched - recursively filter nested structures
  if (Array.isArray(filtered)) {
    return filtered.map(filterForDisplay)
  }

  // Recursively filter object properties
  const result: any = {}
  for (const [key, value] of Object.entries(filtered)) {
    result[key] = filterForDisplay(value)
  }
  return result
}
