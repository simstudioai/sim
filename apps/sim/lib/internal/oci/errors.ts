import {
  isSensitiveKey,
  REDACTED_MARKER,
  redactExactSensitiveValues,
} from '@/lib/core/security/redaction'

const MAX_OCI_ERROR_FIELD_LENGTH = 1024
const MAX_OCI_ERROR_INPUT_LENGTH = 65_536
const MAX_NESTED_JSON_DEPTH = 3
const OCI_SENSITIVE_JSON_FIELDS = new Set(['signingstring'])

function normalizeJsonDiagnosticKey(key: string): string | undefined {
  let normalized = key
  for (let depth = 0; depth < MAX_NESTED_JSON_DEPTH; depth += 1) {
    if (!normalized.includes('%')) return normalized
    if (!/%[0-9a-f]{2}/i.test(normalized)) return undefined
    try {
      normalized = decodeURIComponent(normalized)
    } catch {
      return undefined
    }
  }
  return normalized.includes('%') ? undefined : normalized
}

function looksLikeStructuredJson(value: string): boolean {
  const first = value.trimStart()[0]
  return first === '{' || first === '[' || first === '"'
}

function isSensitiveOciJsonKey(key: string): boolean {
  const compactKey = key.replace(/[^a-z]/gi, '').toLowerCase()
  return OCI_SENSITIVE_JSON_FIELDS.has(compactKey) || isSensitiveKey(compactKey)
}

function containsEmbeddedStructuredText(value: string): boolean {
  return (
    !looksLikeStructuredJson(value) &&
    (/[[{]\s*\\*(?:["{[\]}]|-?\d|true\b|false\b|null\b)/.test(value) ||
      /\\*"[^"\\\r\n]{1,128}\\*"\s*:\s*/.test(value))
  )
}

function flattenJsonDiagnostic(value: unknown, depth = 0): string | undefined {
  if (depth > MAX_NESTED_JSON_DEPTH) return undefined
  if (value === null) return 'null'
  if (typeof value === 'string') {
    if (!looksLikeStructuredJson(value)) {
      return containsEmbeddedStructuredText(value) ? undefined : value
    }
    if (depth === MAX_NESTED_JSON_DEPTH) return undefined
    try {
      return flattenJsonDiagnostic(JSON.parse(value), depth + 1)
    } catch {
      return undefined
    }
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (depth === MAX_NESTED_JSON_DEPTH) return undefined
    const flattened = value.map((entry) => flattenJsonDiagnostic(entry, depth + 1))
    if (flattened.some((entry) => entry === undefined)) return undefined
    return flattened.join(' ')
  }
  if (typeof value !== 'object') return undefined
  if (depth === MAX_NESTED_JSON_DEPTH) return undefined
  const flattened = Object.entries(value).map(([key, entry]) => {
    const normalizedKey = normalizeJsonDiagnosticKey(key)
    if (normalizedKey === undefined) return undefined
    if (isSensitiveOciJsonKey(normalizedKey)) return `${key}: ${REDACTED_MARKER}`
    const nested = flattenJsonDiagnostic(entry, depth + 1)
    return nested === undefined ? undefined : `${key}: ${nested}`
  })
  if (flattened.some((entry) => entry === undefined)) return undefined
  return flattened.join(' ')
}

function decodeNestedJsonDiagnostic(value: string): string | undefined {
  if (value.length > MAX_OCI_ERROR_INPUT_LENGTH) return undefined
  if (containsEmbeddedStructuredText(value)) return undefined
  if (!looksLikeStructuredJson(value)) return value
  try {
    return flattenJsonDiagnostic(JSON.parse(value))
  } catch {
    return undefined
  }
}

function sanitizeOciErrorField(
  value: unknown,
  sensitiveValues: readonly string[] = []
): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length > MAX_OCI_ERROR_INPUT_LENGTH) return undefined
  if (/%[0-9a-f]{2}/i.test(value)) return undefined
  if (/\(request-target\)|x-content-sha256/i.test(value)) return undefined
  const decoded = decodeNestedJsonDiagnostic(value)
  if (decoded === undefined) return undefined
  const exactValues = sensitiveValues.flatMap((sensitiveValue) => {
    const jsonEncoded = JSON.stringify(sensitiveValue).slice(1, -1)
    return jsonEncoded === sensitiveValue ? [sensitiveValue] : [sensitiveValue, jsonEncoded]
  })
  let exactRedacted: string
  try {
    exactRedacted = redactExactSensitiveValues(decoded, exactValues)
  } catch {
    return undefined
  }
  const sanitized = exactRedacted
    .replace(/-----BEGIN[\s\S]*/gi, '[redacted-key]')
    .replace(/https?:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/Signature\s+version=\\*"1\\*",[^\r\n]*/gi, '[redacted-authorization]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
  return sanitized ? sanitized.slice(0, MAX_OCI_ERROR_FIELD_LENGTH) : undefined
}

/** A bounded, credential-safe projection of an OCI service error. */
export class OciRequestError extends Error {
  readonly status: number
  readonly code?: string
  readonly opcRequestId?: string

  constructor(params: {
    status: number
    code?: unknown
    message?: unknown
    opcRequestId?: unknown
    sensitiveValues?: readonly string[]
  }) {
    const code = sanitizeOciErrorField(params.code, params.sensitiveValues)
    const message = sanitizeOciErrorField(params.message, params.sensitiveValues)
    super(
      message ? `OCI request failed: ${message}` : `OCI request failed with status ${params.status}`
    )
    this.name = 'OciRequestError'
    this.status = params.status
    this.code = code
    this.opcRequestId = sanitizeOciErrorField(params.opcRequestId, params.sensitiveValues)
  }
}

export function parseOciErrorBody(
  body: string,
  sensitiveValues: readonly string[] = []
): { code?: string; message?: string } {
  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    return {
      code: sanitizeOciErrorField(record.code, sensitiveValues),
      message: sanitizeOciErrorField(record.message, sensitiveValues),
    }
  } catch {
    return {}
  }
}
