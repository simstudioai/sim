import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'

const OPAQUE_KEY_MAX_LENGTH = 2048
const UNSAFE_OPAQUE_KEY = /[\\/?#\u0000-\u001f\u007f]/

export interface OracleFusionCollection<T> {
  items: T[]
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults?: number
  nextOffset?: number
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
  return value
}

/** Validates and projects an Oracle collection envelope with pagination invariants. */
export function parseOracleFusionCollection<T>(
  value: unknown,
  parseItem: (item: unknown, index: number) => T
): OracleFusionCollection<T> {
  const envelope = asObject(value, 'Oracle collection')
  if (!Array.isArray(envelope.items)) throw new Error('Oracle collection items must be an array')
  const count = nonNegativeInteger(envelope.count, 'Oracle collection count')
  const limit = nonNegativeInteger(envelope.limit, 'Oracle collection limit')
  const offset = nonNegativeInteger(envelope.offset, 'Oracle collection offset')
  if (limit === 0) throw new Error('Oracle collection limit must be positive')
  if (typeof envelope.hasMore !== 'boolean') {
    throw new Error('Oracle collection hasMore must be a boolean')
  }
  if (count !== envelope.items.length) {
    throw new Error('Oracle collection count must match the item count')
  }
  if (envelope.hasMore && count === 0) {
    throw new Error('Oracle collection cannot report hasMore for an empty page')
  }

  const totalResults =
    envelope.totalResults === undefined
      ? undefined
      : nonNegativeInteger(envelope.totalResults, 'Oracle collection totalResults')
  const pageEnd = offset + count
  if (!Number.isSafeInteger(pageEnd)) {
    throw new Error('Oracle collection next offset exceeds the safe integer range')
  }
  if (totalResults !== undefined && totalResults < pageEnd) {
    throw new Error('Oracle collection totalResults is smaller than the returned page')
  }

  return {
    items: envelope.items.map(parseItem),
    count,
    hasMore: envelope.hasMore,
    limit,
    offset,
    ...(totalResults !== undefined ? { totalResults } : {}),
    ...(envelope.hasMore ? { nextOffset: pageEnd } : {}),
  }
}

function getOnlySelfLink(value: unknown): URL {
  const resource = asObject(value, 'Oracle resource')
  if (!Array.isArray(resource.links)) {
    throw new Error('Oracle response must include exactly one self link')
  }
  const selfLinks = resource.links.filter((link) => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) return false
    return (link as Record<string, unknown>).rel === 'self'
  })
  if (selfLinks.length !== 1) {
    throw new Error('Oracle response must include exactly one self link')
  }
  const href = (selfLinks[0] as Record<string, unknown>).href
  if (typeof href !== 'string') throw new Error('Oracle self link is malformed')
  try {
    return new URL(href)
  } catch {
    throw new Error('Oracle self link is malformed')
  }
}

function validateSelfLinkBase(link: URL, instanceUrl: string): void {
  const origin = normalizeOracleFusionApplicationOrigin(instanceUrl)
  if (
    !origin ||
    link.origin !== origin ||
    link.username ||
    link.password ||
    link.search ||
    link.hash
  ) {
    throw new Error('Oracle self link does not match the credential-bound origin')
  }
}

/** Requires one canonical same-origin self link for the expected resource path. */
export function validateOracleFusionSelfLink(
  value: unknown,
  instanceUrl: string,
  expectedPath: string
): void {
  const link = getOnlySelfLink(value)
  validateSelfLinkBase(link, instanceUrl)
  if (!expectedPath.startsWith('/') || link.pathname !== expectedPath) {
    throw new Error('Oracle response self link does not match the requested resource path')
  }
}

function validateOpaqueKey(key: string): string {
  if (
    !key ||
    key.length > OPAQUE_KEY_MAX_LENGTH ||
    key === '.' ||
    key === '..' ||
    UNSAFE_OPAQUE_KEY.test(key)
  ) {
    throw new Error('Oracle resource key is not a safe opaque path segment')
  }
  return key
}

/** Derives one opaque key from a canonical same-origin collection self link. */
export function extractOracleFusionOpaqueKey(
  value: unknown,
  instanceUrl: string,
  collectionPath: string
): string {
  const link = getOnlySelfLink(value)
  validateSelfLinkBase(link, instanceUrl)
  if (!collectionPath.startsWith('/')) {
    throw new Error('Oracle collection path must be absolute')
  }
  const prefix = `${collectionPath}/`
  if (!link.pathname.startsWith(prefix)) {
    throw new Error('Oracle self link does not match the requested collection path')
  }
  const encodedKey = link.pathname.slice(prefix.length)
  if (!encodedKey || encodedKey.includes('/') || /%(?:2f|5c)/i.test(encodedKey)) {
    throw new Error('Oracle self link does not contain one opaque key segment')
  }
  try {
    return validateOpaqueKey(decodeURIComponent(encodedKey))
  } catch (error) {
    if (error instanceof URIError) throw new Error('Oracle self link contains invalid URL encoding')
    throw error
  }
}

/** Encodes a validated opaque Oracle resource key for one URL path segment. */
export function encodeOracleFusionPathSegment(key: string): string {
  return encodeURIComponent(validateOpaqueKey(key))
}
