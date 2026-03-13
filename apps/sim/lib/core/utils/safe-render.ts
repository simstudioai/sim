/**
 * Safely converts a value to a string suitable for rendering in JSX.
 *
 * Prevents React error #31 ("Objects are not valid as a React child") by
 * ensuring that structured objects (e.g. `{ text, type }` content blocks
 * returned by LLM providers) are converted to a displayable string instead
 * of being passed directly as React children.
 *
 * @param value - The value to convert. Can be a string, number, boolean,
 *   null, undefined, array, or object.
 * @returns A string representation safe for rendering in JSX.
 */
export function safeRenderValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (typeof value === 'object') {
    // Handle content block objects like { text, type } from LLM providers
    // by extracting the text property when available
    if (
      !Array.isArray(value) &&
      'text' in value &&
      typeof (value as Record<string, unknown>).text === 'string'
    ) {
      return (value as Record<string, unknown>).text as string
    }

    // Handle arrays of content blocks (e.g. Anthropic's content array)
    if (Array.isArray(value)) {
      const textParts = value
        .map((item) => {
          if (typeof item === 'string') return item
          if (
            item &&
            typeof item === 'object' &&
            'text' in item &&
            typeof item.text === 'string'
          ) {
            return item.text
          }
          return JSON.stringify(item)
        })
        .filter(Boolean)

      if (textParts.length > 0) {
        return textParts.join('')
      }
    }

    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  return String(value)
}
