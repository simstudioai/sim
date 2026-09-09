import type { OracleEpmDestination } from '@/lib/internal/oracle-epm/types'

const MAX_DESTINATION_LENGTH = 2_048
const MAX_PATH_SEGMENTS = 32
const MAX_PATH_SEGMENT_BYTES = 255
const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f\\]/
const MALFORMED_UTF16 = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const destinations = new WeakMap<object, { origin: string; baseSegments: readonly string[] }>()

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new Error('Oracle EPM environment URL has invalid path encoding')
  }
}

function rawPathSegments(value: string): string[] {
  const match = /^https:\/\/[^/?#]+(\/[^?#]*)?(?:[?#].*)?$/i.exec(value)
  if (!match) throw new Error('Oracle EPM environment URL is invalid')
  return (match[1] ?? '').split('/').filter(Boolean)
}

function validateAndDecodeSegment(encoded: string): string {
  const decoded = decodeSegment(encoded)
  let safetyValue = decoded
  for (let depth = 0; depth < 4 && /%[0-9A-Fa-f]{2}/.test(safetyValue); depth += 1) {
    safetyValue = decodeSegment(safetyValue)
  }
  if (
    !decoded ||
    /%[0-9A-Fa-f]{2}/.test(safetyValue) ||
    safetyValue === '.' ||
    safetyValue === '..' ||
    safetyValue.includes('/') ||
    FORBIDDEN_TEXT.test(safetyValue) ||
    MALFORMED_UTF16.test(decoded) ||
    Buffer.byteLength(decoded, 'utf8') > MAX_PATH_SEGMENT_BYTES
  ) {
    throw new Error('Oracle EPM environment URL base path is invalid')
  }
  return decoded
}

/** Validates and freezes the credential-bound Oracle EPM environment URL. */
export function defineOracleEpmDestination(rawUrl: string): OracleEpmDestination {
  const value = rawUrl.trim()
  if (
    !value ||
    value.length > MAX_DESTINATION_LENGTH ||
    FORBIDDEN_TEXT.test(value) ||
    MALFORMED_UTF16.test(value)
  ) {
    throw new Error('Oracle EPM environment URL is invalid')
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Oracle EPM environment URL is invalid')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'Oracle EPM environment URL must be an HTTPS destination without credentials, query, or fragment'
    )
  }

  const encodedSegments = rawPathSegments(value)
  if (encodedSegments.length > MAX_PATH_SEGMENTS) {
    throw new Error('Oracle EPM environment URL base path has too many segments')
  }
  const baseSegments = encodedSegments.map(validateAndDecodeSegment)

  const destination = Object.freeze({}) as OracleEpmDestination
  destinations.set(destination, {
    origin: parsed.origin,
    baseSegments: Object.freeze(baseSegments),
  })
  return destination
}

/** Returns module-private destination data after rejecting forged values. */
export function getOracleEpmDestination(destination: OracleEpmDestination): {
  origin: string
  baseSegments: readonly string[]
  canonicalUrl: string
} {
  const value = destinations.get(destination)
  if (!value) throw new Error('Oracle EPM destination is not a valid declaration')
  const suffix = value.baseSegments.map(encodeURIComponent).join('/')
  return { ...value, canonicalUrl: suffix ? `${value.origin}/${suffix}` : value.origin }
}

/** Canonical public value stored in the credential token result. */
export function normalizeOracleEpmDestination(rawUrl: string): string {
  return getOracleEpmDestination(defineOracleEpmDestination(rawUrl)).canonicalUrl
}
