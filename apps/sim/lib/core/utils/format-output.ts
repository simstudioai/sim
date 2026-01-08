import { createLogger } from '@sim/logger'

const logger = createLogger('FormatOutput')

// Cache for circular reference detection
const seenObjects = new WeakSet()

// Common text field names to search for
const TEXT_FIELD_NAMES = [
  'text', 'content', 'message', 'body', 'value', 'result',
  'output', 'response', 'answer', 'reply', 'data'
] as const

// Maximum depth for recursive traversal
const MAX_DEPTH = 10
const MAX_STRING_LENGTH = 50000
const MAX_ARRAY_ITEMS = 1000

/**
 * Deep traversal to find text content in nested structures
 */
function deepExtractText(
  obj: any,
  depth = 0,
  visited = new Set<any>()
): string | null {
  // Prevent infinite recursion
  if (depth > MAX_DEPTH) return null
  if (!obj || typeof obj !== 'object') return null
  if (visited.has(obj)) return null

  visited.add(obj)

  try {
    // Check direct text fields first
    for (const field of TEXT_FIELD_NAMES) {
      if (field in obj) {
        const value = obj[field]
        if (typeof value === 'string' && value.trim()) {
          return value
        }
        // Recursively check if the field itself contains text
        const nestedText = deepExtractText(value, depth + 1, visited)
        if (nestedText) return nestedText
      }
    }

    // Check for toString method (custom objects)
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      const str = obj.toString()
      if (str && str !== '[object Object]') {
        return str
      }
    }

    // Traverse nested objects
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const nestedText = deepExtractText(obj[key], depth + 1, visited)
        if (nestedText) return nestedText
      }
    }
  } catch (error) {
    logger.debug('Error during deep text extraction', { error })
  }

  return null
}

/**
 * Safely stringify with circular reference handling
 */
function safeStringify(obj: any, indent = 2): string {
  const seen = new Set()

  try {
    return JSON.stringify(obj, (key, value) => {
      // Handle undefined, functions, symbols
      if (value === undefined) return '[undefined]'
      if (typeof value === 'function') return '[Function]'
      if (typeof value === 'symbol') return '[Symbol]'

      // Handle BigInt
      if (typeof value === 'bigint') return value.toString()

      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }

      return value
    }, indent)
  } catch (error) {
    logger.warn('Failed to stringify object', { error })
    return '[Serialization Error]'
  }
}

/**
 * Extract meaningful content from various output formats
 */
function extractContent(item: any): string | null {
  // Primitives
  if (item === null || item === undefined) return null
  if (typeof item === 'string') return item.trim() || null
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (typeof item === 'bigint') return item.toString()

  // Special objects
  if (item instanceof Date) return item.toISOString()
  if (item instanceof Error) return item.message || item.toString()
  if (item instanceof RegExp) return item.toString()

  // Buffer or Uint8Array (might be binary data)
  if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
    try {
      // Try to decode as UTF-8
      const text = Buffer.from(item).toString('utf-8')
      // Check if it's actually readable text
      if (/^[\x20-\x7E\s]+$/.test(text)) {
        return text
      }
    } catch {}
    return '[Binary Data]'
  }

  // Arrays - process recursively
  if (Array.isArray(item)) {
    if (item.length > MAX_ARRAY_ITEMS) {
      return `[Large Array: ${item.length} items]`
    }

    const contents = item
      .slice(0, MAX_ARRAY_ITEMS)
      .map(extractContent)
      .filter(Boolean)

    return contents.length > 0 ? contents.join('\n') : null
  }

  // Objects - try deep extraction
  if (typeof item === 'object') {
    return deepExtractText(item)
  }

  return null
}

/**
 * Main formatting function - BEAST MODE
 */
export function formatOutputForDisplay(
  output: unknown,
  options: {
    mode?: 'chat' | 'workflow' | 'raw'
    maxLength?: number
    truncate?: boolean
    preserveWhitespace?: boolean
  } = {}
): string {
  const {
    mode = 'chat',
    maxLength = MAX_STRING_LENGTH,
    truncate = true,
    preserveWhitespace = false
  } = options

  try {
    // Quick return for simple cases
    if (!output && output !== 0 && output !== false) return ''

    // Try to extract content
    const extracted = extractContent(output)

    if (extracted) {
      let result = extracted

      // Apply length limits
      if (truncate && result.length > maxLength) {
        result = result.substring(0, maxLength) + '... [truncated]'
      }

      // Clean whitespace unless preserved
      if (!preserveWhitespace) {
        result = result.replace(/\s+/g, ' ').trim()
      }

      return result
    }

    // Fallback to JSON representation
    const json = safeStringify(output)

    // Apply formatting based on mode
    switch (mode) {
      case 'workflow':
        return `\`\`\`json\n${json}\n\`\`\``
      case 'raw':
        return json
      case 'chat':
      default:
        // For chat, try to make it more readable
        if (json.length > 500) {
          return '[Complex Object - See logs for details]'
        }
        return json
    }
  } catch (error) {
    logger.error('Critical error in formatOutputForDisplay', { error, output })
    return '[Display Error]'
  }
}

/**
 * Specialized formatters with sensible defaults
 */
export const formatOutputForChat = (output: unknown) =>
  formatOutputForDisplay(output, {
    mode: 'chat',
    maxLength: 5000,
    truncate: true
  })

export const formatOutputForWorkflow = (output: unknown) =>
  formatOutputForDisplay(output, {
    mode: 'workflow',
    maxLength: 10000,
    truncate: true
  })

export const formatOutputRaw = (output: unknown) =>
  formatOutputForDisplay(output, {
    mode: 'raw',
    truncate: false,
    preserveWhitespace: true
  })

/**
 * Validate and sanitize output before display
 */
export function isOutputSafe(output: unknown): boolean {
  try {
    // Check for potential XSS patterns
    const str = String(output)
    const dangerous = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i, // onclick, onload, etc.
      /<iframe/i,
      /<embed/i,
      /<object/i
    ]

    return !dangerous.some(pattern => pattern.test(str))
  } catch {
    return false
  }
}

/**
 * Format with HTML escaping for safety
 */
export function formatOutputSafe(output: unknown): string {
  const formatted = formatOutputForDisplay(output)

  if (!isOutputSafe(formatted)) {
    logger.warn('Potentially unsafe output detected, escaping HTML')
    return formatted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  }

  return formatted
}