/**
 * Centralized redaction utilities for sensitive data
 */

import { filterUserFileForDisplay, isUserFile } from '@/lib/core/utils/user-file'

export const REDACTED_MARKER = '[REDACTED]'
export const TRUNCATED_MARKER = '[TRUNCATED]'

const BYPASS_REDACTION_KEYS = new Set(['nextPageToken'])

/** Keys that contain large binary/encoded data that should be truncated in logs */
const LARGE_DATA_KEYS = new Set(['base64'])

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /^api[_-]?key$/i,
  /^access[_-]?token$/i,
  /^refresh[_-]?token$/i,
  /^client[_-]?secret$/i,
  /^private[_-]?key$/i,
  /^auth[_-]?token$/i,
  /^.*secret$/i,
  /^.*password$/i,
  /^.*token$/i,
  /^.*credential$/i,
  /^authorization$/i,
  /^bearer$/i,
  /^private$/i,
  /^auth$/i,
]

/**
 * Patterns for sensitive values in strings (for redacting values, not keys)
 * Each pattern has a replacement function
 */
const SENSITIVE_VALUE_PATTERNS: Array<{
  pattern: RegExp
  replacement: string
}> = [
  // Bearer tokens
  {
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: `Bearer ${REDACTED_MARKER}`,
  },
  // Basic auth
  {
    pattern: /Basic\s+[A-Za-z0-9+/]+=*/gi,
    replacement: `Basic ${REDACTED_MARKER}`,
  },
  // API keys that look like sk-..., pk-..., etc.
  {
    pattern: /\b(sk|pk|api|key)[_-][A-Za-z0-9\-._]{20,}\b/gi,
    replacement: REDACTED_MARKER,
  },
  // JSON-style password fields: password: "value" or password: 'value'
  {
    pattern: /password['":\s]*['"][^'"]+['"]/gi,
    replacement: `password: "${REDACTED_MARKER}"`,
  },
  // JSON-style token fields: token: "value" or token: 'value'
  {
    pattern: /token['":\s]*['"][^'"]+['"]/gi,
    replacement: `token: "${REDACTED_MARKER}"`,
  },
  // JSON-style api_key fields: api_key: "value" or api-key: "value"
  {
    pattern: /api[_-]?key['":\s]*['"][^'"]+['"]/gi,
    replacement: `api_key: "${REDACTED_MARKER}"`,
  },
]

export function isSensitiveKey(key: string): boolean {
  if (BYPASS_REDACTION_KEYS.has(key)) {
    return false
  }
  const lowerKey = key.toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(lowerKey))
}

/**
 * Redacts sensitive patterns from a string value
 * @param value - The string to redact
 * @returns The string with sensitive patterns redacted
 */
export function redactSensitiveValues(value: string): string {
  if (!value || typeof value !== 'string') {
    return value
  }

  let result = value
  for (const { pattern, replacement } of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

export function isLargeDataKey(key: string): boolean {
  return LARGE_DATA_KEYS.has(key)
}

export function redactApiKeys(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactApiKeys(item))
  }

  if (isUserFile(obj)) {
    const filtered = filterUserFileForDisplay(obj)
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(filtered)) {
      if (isLargeDataKey(key) && typeof value === 'string') {
        result[key] = TRUNCATED_MARKER
      } else {
        result[key] = value
      }
    }
    return result
  }

  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED_MARKER
    } else if (isLargeDataKey(key) && typeof value === 'string') {
      result[key] = TRUNCATED_MARKER
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactApiKeys(value)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Sanitizes a string for safe logging by truncating and redacting sensitive patterns
 *
 * @param value - The string to sanitize
 * @param maxLength - Maximum length of the output (default: 100)
 * @returns The sanitized string
 */
export function sanitizeForLogging(value: string, maxLength = 100): string {
  if (!value) return ''

  let sanitized = value.substring(0, maxLength)

  sanitized = redactSensitiveValues(sanitized)

  return sanitized
}

/**
 * Sanitizes event data for error reporting/analytics
 *
 * @param event - The event data to sanitize
 * @returns Sanitized event data safe for external reporting
 */
export function sanitizeEventData(event: any): any {
  if (event === null || event === undefined) {
    return event
  }

  if (typeof event === 'string') {
    return redactSensitiveValues(event)
  }

  if (typeof event !== 'object') {
    return event
  }

  if (Array.isArray(event)) {
    return event.map((item) => sanitizeEventData(item))
  }

  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(event)) {
    if (isSensitiveKey(key)) {
      continue
    }

    if (typeof value === 'string') {
      sanitized[key] = redactSensitiveValues(value)
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((v) => sanitizeEventData(v))
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeEventData(value)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}
