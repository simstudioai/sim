const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
const ISO_WITH_TZ_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/

/**
 * Check if a string is a valid date format (YYYY-MM-DD or ISO 8601 timestamp)
 */
function isValidDateFormat(value: string): boolean {
  return DATE_ONLY_REGEX.test(value) || DATETIME_REGEX.test(value) || ISO_WITH_TZ_REGEX.test(value)
}

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
      // Check format first - accept YYYY-MM-DD or ISO 8601 datetime
      if (!isValidDateFormat(stringValue)) {
        return `Tag "${tagName}" expects a date in YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss format, but received "${value}"`
      }

      // Extract date parts for validation
      const datePart = stringValue.split('T')[0]
      const [year, month, day] = datePart.split('-').map(Number)

      // Validate the date is actually valid (e.g., reject 2024-02-31)
      const date = new Date(year, month - 1, day)
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return `Tag "${tagName}" has an invalid date: "${value}"`
      }

      // If timestamp is included, validate time components
      if (stringValue.includes('T')) {
        const timePart = stringValue.split('T')[1]
        // Extract hours and minutes, ignoring timezone
        const timeMatch = timePart.match(/^(\d{2}):(\d{2})/)
        if (timeMatch) {
          const hours = Number.parseInt(timeMatch[1], 10)
          const minutes = Number.parseInt(timeMatch[2], 10)
          if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return `Tag "${tagName}" has an invalid time: "${value}"`
          }
        }
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
 * Parse a string to Date with validation for YYYY-MM-DD or ISO 8601 timestamp
 * Returns null if invalid format or invalid date
 */
export function parseDateValue(value: string): Date | null {
  const stringValue = String(value).trim()

  // Must be valid date format
  if (!isValidDateFormat(stringValue)) {
    return null
  }

  // Extract date parts
  const datePart = stringValue.split('T')[0]
  const [year, month, day] = datePart.split('-').map(Number)

  // Validate the date is actually valid (e.g., reject 2024-02-31)
  // First check date-only validity
  const testDate = new Date(year, month - 1, day)
  if (
    testDate.getFullYear() !== year ||
    testDate.getMonth() !== month - 1 ||
    testDate.getDate() !== day
  ) {
    return null
  }

  // If timestamp is included, parse with time
  if (stringValue.includes('T')) {
    // Use native Date parsing for ISO strings
    const date = new Date(stringValue)
    if (Number.isNaN(date.getTime())) {
      return null
    }
    return date
  }

  // Date-only: return date at midnight local time
  return new Date(year, month - 1, day)
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
