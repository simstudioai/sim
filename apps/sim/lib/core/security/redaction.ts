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
  /^proxy[_-]?authorization$/i,
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
  // Single-token authorization headers retain their scheme for diagnostics.
  {
    pattern: /\b((?:proxy[_-]?)?authorization[ \t]*:[ \t]*(?:Bearer|Basic)[ \t]+)[^\r\n]*/gi,
    replacement: `$1${REDACTED_MARKER}`,
  },
  // Parameterized and unknown authorization headers fail closed through the line ending.
  {
    pattern:
      /\b((?:proxy[_-]?)?authorization[ \t]*:)(?![ \t]*(?:Bearer|Basic)[ \t])[ \t]*[^\r\n]*/gi,
    replacement: `$1 ${REDACTED_MARKER}`,
  },
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

const FORM_FIELD_MARKER_PATTERN = /=|%(?:25)*3D/i
const ENCODED_FORM_KEY_COMPONENT_PATTERN = /%[0-9A-F]{2}/i
const FORM_WHITESPACE_PATTERN = /\s/u
const AUTHORIZATION_FORM_KEYS = new Set(['authorization', 'proxyauthorization'])
const SINGLE_TOKEN_AUTHORIZATION_PATTERN = /^(?:Bearer|Basic)\s+\S+/i
const MAX_EXACT_SECRET_ENCODING_LAYERS = 3

interface ActiveSensitiveFormField {
  start: number
  encodingDepth: number
  whitespaceBoundaryAfter?: number
}

interface NormalizedFormKey {
  value: string
  complete: boolean
}

interface FormKeySpan {
  endIndex: number
  malformed: boolean
}

type EncodedFormMarkerKind = 'delimiter' | 'field' | 'query'

interface EncodedFormMarker {
  kind: EncodedFormMarkerKind
  text: string
}

type FormFieldPrefixKind =
  | 'start'
  | 'delimiter'
  | 'encoded-delimiter'
  | 'encoded-query'
  | 'whitespace'
  | 'other'

interface FormFieldToken {
  kind: 'field'
  index: number
  endIndex: number
  key: string
  fieldMarker: string
  prefixKind: FormFieldPrefixKind
  prefixMarker?: string
}

interface FormDelimiterToken {
  kind: 'delimiter'
  index: number
  delimiter: string
}

type FormToken = FormFieldToken | FormDelimiterToken

export function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase()
  if (BYPASS_REDACTION_KEYS.has(lowerKey)) return false
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(lowerKey))
}

function getFormEncodingDepth(marker: string): number {
  return marker.length === 1 ? 0 : (marker.length - 1) / 2
}

function normalizeFormKey(key: string): string {
  return key.toLowerCase().replaceAll('_', '').replaceAll('-', '')
}

function decodeFormKey(key: string): NormalizedFormKey {
  let value = key
  let decodedLayer = false
  for (let layer = 0; layer < MAX_EXACT_SECRET_ENCODING_LAYERS; layer++) {
    if (!ENCODED_FORM_KEY_COMPONENT_PATTERN.test(value)) {
      return { value, complete: decodedLayer || !value.includes('%') }
    }
    try {
      value = decodeURIComponent(value)
      decodedLayer = true
    } catch {
      return { value, complete: false }
    }
  }
  return { value, complete: !ENCODED_FORM_KEY_COMPONENT_PATTERN.test(value) }
}

function isAuthorizationFormKey(key: string): boolean {
  return AUTHORIZATION_FORM_KEYS.has(normalizeFormKey(key))
}

function isRawFormKeyCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    character === '_' ||
    character === '-'
  )
}

function readEncodedFormMarker(value: string, index: number): EncodedFormMarker | undefined {
  if (value[index] !== '%') return undefined

  let cursor = index + 1
  while (value.slice(cursor, cursor + 2).toLowerCase() === '25') cursor += 2

  const code = value.slice(cursor, cursor + 2).toLowerCase()
  const kind: EncodedFormMarkerKind | undefined =
    code === '26' ? 'delimiter' : code === '3d' ? 'field' : code === '3f' ? 'query' : undefined
  if (!kind) return undefined
  return { kind, text: value.slice(index, cursor + 2) }
}

function readFormKeySpan(value: string, start: number): FormKeySpan {
  let cursor = start
  let malformed = false
  while (cursor < value.length) {
    if (isRawFormKeyCharacter(value[cursor])) {
      cursor++
      continue
    }
    if (value[cursor] !== '%') break

    const encodedMarker = readEncodedFormMarker(value, cursor)
    if (encodedMarker) {
      if (encodedMarker.kind === 'field') break
      if (!malformed && !decodeFormKey(value.slice(start, cursor)).complete) malformed = true
      if (!malformed) break
      cursor += encodedMarker.text.length
      continue
    }

    const componentStart = cursor
    cursor++
    for (let offset = 0; offset < 2 && cursor < value.length; offset++) {
      const character = value[cursor]
      if (
        character === '%' ||
        character === '&' ||
        character === '=' ||
        FORM_WHITESPACE_PATTERN.test(character)
      ) {
        break
      }
      cursor++
    }
    if (!ENCODED_FORM_KEY_COMPONENT_PATTERN.test(value.slice(componentStart, cursor))) {
      malformed = true
    }
  }
  return { endIndex: cursor, malformed }
}

/** Iterates form fields and delimiters without regex backtracking over provider-controlled input. */
function* iterateFormTokens(value: string): Generator<FormToken> {
  let index = 0

  while (index < value.length) {
    const encodedPrefix = readEncodedFormMarker(value, index)
    let prefixKind: FormFieldPrefixKind | undefined
    let keyStart = index
    let prefixMarker: string | undefined

    if (encodedPrefix?.kind === 'delimiter' || encodedPrefix?.kind === 'query') {
      prefixKind = encodedPrefix.kind === 'delimiter' ? 'encoded-delimiter' : 'encoded-query'
      prefixMarker = encodedPrefix.text
      keyStart += encodedPrefix.text.length
    } else if (value[index] === '&') {
      prefixKind = 'delimiter'
      keyStart++
    } else if (FORM_WHITESPACE_PATTERN.test(value[index])) {
      prefixKind = 'whitespace'
      while (keyStart < value.length && FORM_WHITESPACE_PATTERN.test(value[keyStart])) keyStart++
    } else if (!isRawFormKeyCharacter(value[index]) && value[index] !== '%') {
      prefixKind = 'other'
      keyStart++
    } else if (index === 0) {
      prefixKind = 'start'
    }

    if (prefixKind) {
      const { endIndex: keyEnd } = readFormKeySpan(value, keyStart)
      const encodedFieldMarker = readEncodedFormMarker(value, keyEnd)
      const fieldMarker =
        value[keyEnd] === '='
          ? '='
          : encodedFieldMarker?.kind === 'field'
            ? encodedFieldMarker.text
            : undefined

      if (keyEnd > keyStart && fieldMarker) {
        const endIndex = keyEnd + fieldMarker.length
        yield {
          kind: 'field',
          index,
          endIndex,
          key: value.slice(keyStart, keyEnd),
          fieldMarker,
          prefixKind,
          prefixMarker,
        }
        index = endIndex
        continue
      }

      if (encodedPrefix?.kind === 'delimiter') {
        yield { kind: 'delimiter', index, delimiter: encodedPrefix.text }
        index += encodedPrefix.text.length
        continue
      }
      if (value[index] === '&') {
        yield { kind: 'delimiter', index, delimiter: '&' }
        index++
        continue
      }

      index = Math.max(index + 1, keyEnd)
      continue
    }

    if (isRawFormKeyCharacter(value[index])) {
      do index++
      while (index < value.length && isRawFormKeyCharacter(value[index]))
      continue
    }
    index++
  }
}

function findWhitespaceRunStart(value: string, end: number): number {
  let start = end
  while (start > 0 && /\s/u.test(value[start - 1])) start--
  return start
}

function redactSensitiveFormFields(value: string): string {
  if (!FORM_FIELD_MARKER_PATTERN.test(value)) return value

  let result = ''
  let cursor = 0
  let activeField: ActiveSensitiveFormField | undefined

  const closeActiveField = (end: number) => {
    if (!activeField) return
    if (end > activeField.start) {
      result += `${value.slice(cursor, activeField.start)}${REDACTED_MARKER}`
      cursor = end
    }
    activeField = undefined
  }

  for (const token of iterateFormTokens(value)) {
    if (token.kind === 'field') {
      if (activeField && token.prefixKind !== 'start') {
        const boundaryIndex =
          token.prefixKind === 'whitespace'
            ? findWhitespaceRunStart(value, token.index)
            : token.index
        const closesActiveField =
          token.prefixKind === 'delimiter' ||
          (token.prefixKind === 'encoded-delimiter' &&
            token.prefixMarker !== undefined &&
            getFormEncodingDepth(token.prefixMarker) === activeField.encodingDepth) ||
          (token.prefixKind === 'whitespace' &&
            activeField.whitespaceBoundaryAfter !== undefined &&
            boundaryIndex >= activeField.whitespaceBoundaryAfter)
        if (closesActiveField) closeActiveField(boundaryIndex)
      }

      const normalizedKey = decodeFormKey(token.key)
      if (!activeField && (!normalizedKey.complete || isSensitiveKey(normalizedKey.value))) {
        const start = token.endIndex
        const authorization = normalizedKey.complete && isAuthorizationFormKey(normalizedKey.value)
        const singleTokenAuthorization = authorization
          ? value.slice(start).match(SINGLE_TOKEN_AUTHORIZATION_PATTERN)?.[0]
          : undefined
        activeField = {
          start,
          encodingDepth: getFormEncodingDepth(token.fieldMarker),
          whitespaceBoundaryAfter: authorization
            ? singleTokenAuthorization === undefined
              ? undefined
              : start + singleTokenAuthorization.length
            : normalizedKey.complete
              ? start
              : undefined,
        }
      }
      continue
    }

    if (!activeField) continue

    if (
      token.delimiter === '&' ||
      getFormEncodingDepth(token.delimiter) === activeField.encodingDepth
    ) {
      closeActiveField(token.index)
    }
  }

  closeActiveField(value.length)
  return cursor === 0 ? value : result + value.slice(cursor)
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
    const encodedVariants = new Set<string>()
    let uriEncoded = secret
    let formEncoded = secret
    for (let layer = 0; layer < MAX_EXACT_SECRET_ENCODING_LAYERS; layer++) {
      uriEncoded = encodeURIComponent(uriEncoded)
      formEncoded = new URLSearchParams({ value: formEncoded }).toString().slice('value='.length)
      encodedVariants.add(uriEncoded)
      encodedVariants.add(formEncoded)
    }
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
