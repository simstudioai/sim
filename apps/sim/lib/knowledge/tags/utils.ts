/**
 * Validate a tag value against its expected field type
 * Returns an error message if invalid, or null if valid
 */
export function validateTagValue(tagName: string, value: string, fieldType: string): string | null {
  const stringValue = String(value).trim()

  switch (fieldType) {
    case 'boolean': {
      const lowerValue = stringValue.toLowerCase()
      if (lowerValue !== 'true' && lowerValue !== 'false') {
        return `Tag "${tagName}" expects a boolean value (true/false), but received "${value}"`
      }
      return null
    }
    case 'number': {
      const numValue = Number(stringValue)
      if (Number.isNaN(numValue)) {
        return `Tag "${tagName}" expects a number value, but received "${value}"`
      }
      return null
    }
    case 'date': {
      // Check format first
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
        return `Tag "${tagName}" expects a date in YYYY-MM-DD format, but received "${value}"`
      }
      // Validate the date is actually valid (e.g., reject 2024-02-31)
      const [year, month, day] = stringValue.split('-').map(Number)
      const date = new Date(year, month - 1, day)
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return `Tag "${tagName}" has an invalid date: "${value}"`
      }
      return null
    }
    default:
      return null
  }
}

/**
 * Build error message for undefined tags
 */
export function buildUndefinedTagsError(undefinedTags: string[]): string {
  const tagList = undefinedTags.map((t) => `"${t}"`).join(', ')
  return `The following tags are not defined in this knowledge base: ${tagList}. Please define them at the knowledge base level first.`
}

/**
 * Parse a string to number with strict validation
 * Returns null if invalid
 */
export function parseNumberValue(value: string): number | null {
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

/**
 * Parse a string to Date with strict YYYY-MM-DD validation
 * Returns null if invalid format or invalid date
 */
export function parseDateValue(value: string): Date | null {
  const stringValue = String(value).trim()

  // Must be YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return null
  }

  // Validate the date is actually valid (e.g., reject 2024-02-31)
  const [year, month, day] = stringValue.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return date
}

/**
 * Parse a string to boolean with strict validation
 * Returns null if not 'true' or 'false'
 */
export function parseBooleanValue(value: string): boolean | null {
  const lowerValue = String(value).trim().toLowerCase()
  if (lowerValue === 'true') return true
  if (lowerValue === 'false') return false
  return null
}
