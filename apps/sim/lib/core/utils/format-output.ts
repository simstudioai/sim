import { createLogger } from '@sim/logger'

const logger = createLogger('FormatOutput')

// Type definitions for better type safety
type TextFieldName = 'text' | 'content' | 'message' | 'body' | 'value' | 'result' | 'output' | 'response' | 'answer' | 'reply' | 'data'
type FormatMode = 'chat' | 'workflow' | 'raw'

interface FormatOptions {
  mode?: FormatMode
  maxLength?: number
  truncate?: boolean
  preserveWhitespace?: boolean
}

interface TextExtractable {
  [key: string]: unknown
  text?: string
  content?: string
  message?: string
  body?: string
  value?: string
  result?: string
  output?: string
  response?: string
  answer?: string
  reply?: string
  data?: string
}

// Constants
const TEXT_FIELDS: readonly TextFieldName[] = [
  'text', 'content', 'message', 'body', 'value', 'result',
  'output', 'response', 'answer', 'reply', 'data',
] as const

const MAX_STRING_LENGTH = 50000
const MAX_ARRAY_ITEMS = 100
const MAX_DEPTH = 5

/**
 * Extract text content from common LLM response formats
 */
function extractText(value: unknown, depth = 0): string | null {
  // Guard against deep recursion
  if (depth > MAX_DEPTH) return null

  // Handle primitives
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'bigint') return value.toString()

  // Handle special objects
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return value.message
  if (value instanceof RegExp) return value.toString()

  // Handle Buffer/Uint8Array
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    try {
      const text = Buffer.from(value).toString('utf-8')
      // Check if it's readable text (printable ASCII + whitespace)
      if (/^[\x20-\x7E\s]*$/.test(text) && text.trim()) {
        return text
      }
    } catch {}
    return '[Binary Data]'
  }

  // Handle arrays - extract first valid text
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    if (value.length > MAX_ARRAY_ITEMS) {
      return `[Large Array: ${value.length} items]`
    }

    // For arrays, concatenate all text content
    const texts = value
      .map(item => extractText(item, depth + 1))
      .filter(Boolean)

    return texts.length > 0 ? texts.join(' ') : null
  }

  // Handle objects with text fields
  if (typeof value === 'object' && value !== null) {
    const obj = value as TextExtractable

    // Fast path: check common text fields first
    for (const field of TEXT_FIELDS) {
      if (field in obj) {
        const fieldValue = obj[field]
        if (typeof fieldValue === 'string' && fieldValue) {
          return fieldValue
        }
      }
    }

    // Check nested structures (common in LLM responses)
    // OpenAI format: choices[0].message.content
    if ('choices' in obj && Array.isArray(obj.choices) && obj.choices[0]) {
      const extracted = extractText(obj.choices[0], depth + 1)
      if (extracted) return extracted
    }

    // Anthropic format: content[0].text
    if ('content' in obj && Array.isArray(obj.content) && obj.content[0]) {
      const extracted = extractText(obj.content[0], depth + 1)
      if (extracted) return extracted
    }

    // Streaming format: delta.content
    if ('delta' in obj && typeof obj.delta === 'object') {
      const extracted = extractText(obj.delta, depth + 1)
      if (extracted) return extracted
    }

    // Recursive search through all properties for text fields
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        const extracted = extractText(value, depth + 1)
        if (extracted) return extracted
      }
    }

    // Custom toString
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      const str = obj.toString()
      if (str && str !== '[object Object]') return str
    }
  }

  return null
}

/**
 * Safely stringify objects for fallback display
 */
function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet()
    return JSON.stringify(value, (_, val) => {
      if (val === undefined) return '[undefined]'
      if (typeof val === 'function') return '[Function]'
      if (typeof val === 'symbol') return '[Symbol]'
      if (typeof val === 'bigint') return val.toString()

      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }

      return val
    }, 2)
  } catch (error) {
    logger.debug('Stringify failed', { error })
    return '[Unable to display]'
  }
}

/**
 * Format output for display with smart text extraction
 * Optimized for performance and common use cases
 */
export function formatOutputForDisplay(
  output: unknown,
  options: FormatOptions = {}
): string {
  const {
    mode = 'chat',
    maxLength = MAX_STRING_LENGTH,
    truncate = true,
    preserveWhitespace = false,
  } = options

  try {
    // Early return for empty values
    if (!output && output !== 0 && output !== false) return ''

    // Try to extract text content
    const text = extractText(output)

    if (text) {
      let result = text

      // Apply length limit
      if (truncate && result.length > maxLength) {
        result = `${result.substring(0, maxLength)}... [truncated]`
      }

      // Normalize whitespace for chat display only
      if (!preserveWhitespace && mode === 'chat') {
        result = result.replace(/\s+/g, ' ').trim()
      } else if (!preserveWhitespace && mode !== 'raw') {
        result = result.trim()
      }

      return result
    }

    // Fallback to JSON for complex objects
    const json = safeStringify(output)

    // Format based on mode
    if (mode === 'workflow') {
      return `\`\`\`json\n${json}\n\`\`\``
    }

    if (mode === 'raw') {
      return json
    }

    // Chat mode: keep it simple
    if (json.length > 500) {
      return '[Complex object]'
    }

    return json
  } catch (error) {
    logger.error('Format error', { error })
    return '[Display Error]'
  }
}

/**
 * Specialized formatters with optimized defaults
 */
export const formatOutputForChat = (output: unknown): string =>
  formatOutputForDisplay(output, {
    mode: 'chat',
    maxLength: 5000,
    truncate: true,
  })

export const formatOutputForWorkflow = (output: unknown): string =>
  formatOutputForDisplay(output, {
    mode: 'workflow',
    maxLength: 10000,
    truncate: true,
  })

export const formatOutputRaw = (output: unknown): string =>
  formatOutputForDisplay(output, {
    mode: 'raw',
    truncate: false,
    preserveWhitespace: true,
  })

/**
 * Check for potential XSS patterns in output
 */
export function isOutputSafe(output: unknown): boolean {
  try {
    const str = String(output)
    const xssPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe/i,
      /<embed/i,
      /<object/i,
    ]

    return !xssPatterns.some((pattern) => pattern.test(str))
  } catch {
    return false
  }
}

/**
 * Format output with HTML escaping for safety
 */
export function formatOutputSafe(output: unknown): string {
  const formatted = formatOutputForDisplay(output)

  if (!isOutputSafe(formatted)) {
    logger.warn('Unsafe content detected, escaping')
    return formatted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  }

  return formatted
}