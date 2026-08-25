/**
 * Centralized redaction utilities for sensitive data
 */

import { filterUserFileForDisplay, isUserFile } from '@/lib/core/utils/user-file'

export const REDACTED_MARKER = '[REDACTED]'
export const TRUNCATED_MARKER = '[TRUNCATED]'

const BYPASS_REDACTION_KEYS = new Set(['nextpagetoken'])

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
  // Suffix form of the anchored `api_key` pattern above, which misses prefixed
  // credential fields such as `searchApiKey`, `projectApiKey`, and `resendApiKey`.
  /^.*api[_-]?key$/i,
  /^passphrase$/i,
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

const FORM_FIELD_MARKER_PATTERN = /\b([A-Za-z0-9_-]+)=/gi
const ENCODED_FORM_FIELD_MARKER_PATTERN = /\b([A-Za-z0-9_-]+)%3D/gi
const FORM_VALUE_DELIMITER_PATTERN = /&|\s+(?=[A-Za-z0-9_-]+(?:=|%3D))/gi
const ENCODED_FORM_VALUE_DELIMITER_PATTERN = /%26|&|\s+(?=[A-Za-z0-9_-]+(?:=|%3D))/gi

interface SensitiveValueSpan {
  start: number
  end: number
}

export function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase()
  if (BYPASS_REDACTION_KEYS.has(lowerKey)) return false
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(lowerKey))
}

function findFormValueEnd(delimiterPositions: number[], start: number): number {
  let lower = 0
  let upper = delimiterPositions.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (delimiterPositions[middle] < start) lower = middle + 1
    else upper = middle
  }
  return delimiterPositions[lower]
}

function collectSensitiveValueSpans(
  value: string,
  markerPattern: RegExp,
  delimiterPositions: number[]
): SensitiveValueSpan[] {
  const spans: SensitiveValueSpan[] = []
  for (const match of value.matchAll(markerPattern)) {
    if (match.index === undefined || !isSensitiveKey(match[1])) continue
    const start = match.index + match[0].length
    const end = findFormValueEnd(delimiterPositions, start)
    if (end > start) spans.push({ start, end })
  }
  return spans
}

function collectDelimiterPositions(value: string, pattern: RegExp): number[] {
  const delimiterPositions: number[] = []
  for (const match of value.matchAll(pattern)) {
    if (match.index !== undefined) delimiterPositions.push(match.index)
  }
  delimiterPositions.push(value.length)
  return delimiterPositions
}

function redactSensitiveFormFields(value: string): string {
  const formDelimiterPositions = collectDelimiterPositions(value, FORM_VALUE_DELIMITER_PATTERN)
  const encodedDelimiterPositions = collectDelimiterPositions(
    value,
    ENCODED_FORM_VALUE_DELIMITER_PATTERN
  )
  const spans = [
    ...collectSensitiveValueSpans(value, FORM_FIELD_MARKER_PATTERN, formDelimiterPositions),
    ...collectSensitiveValueSpans(
      value,
      ENCODED_FORM_FIELD_MARKER_PATTERN,
      encodedDelimiterPositions
    ),
  ].sort((left, right) => left.start - right.start || right.end - left.end)

  if (spans.length === 0) return value

  const merged: SensitiveValueSpan[] = []
  for (const span of spans) {
    const previous = merged.at(-1)
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }

  let result = ''
  let cursor = 0
  for (const span of merged) {
    result += `${value.slice(cursor, span.start)}${REDACTED_MARKER}`
    cursor = span.end
  }
  return result + value.slice(cursor)
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

  let result = redactSensitiveFormFields(value)
  for (const { pattern, replacement } of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/**
 * Redacts known secret values in all literal and URL-encoded forms before the
 * generic pattern pass. Exact replacement must run first because a credential
 * can itself contain form delimiters that would otherwise split it and leave a
 * suffix visible before the exact matcher sees the original value.
 */
export function redactKnownSensitiveValues(value: string, secrets: string[]): string {
  let result = value
  const orderedSecrets = [...new Set(secrets.filter(Boolean))].sort(
    (left, right) => right.length - left.length
  )
  for (const secret of orderedSecrets) {
    result = result.replaceAll(secret, REDACTED_MARKER)
    const encodedVariants = new Set([
      encodeURIComponent(secret),
      new URLSearchParams({ value: secret }).toString().slice('value='.length),
    ])
    for (const encoded of encodedVariants) {
      if (encoded !== secret) {
        const escaped = encoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        result = result.replace(new RegExp(escaped, 'gi'), REDACTED_MARKER)
      }
    }
  }
  return result
}

export function redactExactSensitiveValues(value: string, secrets: string[]): string {
  return redactSensitiveValues(redactKnownSensitiveValues(value, secrets))
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
