import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  buildOracleFusionResourcePath,
  type OracleFusionResourceAddress,
} from '@/lib/internal/oracle-fusion/paths'

const OPAQUE_KEY_MAX_LENGTH = 2048
const UNSAFE_OPAQUE_KEY = /[\\/?#\u0000-\u001f\u007f]/
const UNSAFE_SELF_LINK_TEXT = /[\s\u0000-\u001f\u007f]/
const RAW_SELF_LINK_DOT_SEGMENT = /(?:^|[\\/])(?:\.|%2e){1,2}(?=[\\/?#]|$)/i

function hasWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

export interface OracleFusionCollection<T> {
  items: T[]
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults?: number
  nextOffset: number
}

export interface OracleFusionCollectionOptions {
  expectedOffset?: number
  maxItems?: number
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
  parseItem: (item: unknown, index: number) => T,
  options: OracleFusionCollectionOptions = {}
): OracleFusionCollection<T> {
  const envelope = asObject(value, 'Oracle collection')
  const count = nonNegativeInteger(envelope.count, 'Oracle collection count')
  const limit = nonNegativeInteger(envelope.limit, 'Oracle collection limit')
  const offset = nonNegativeInteger(envelope.offset, 'Oracle collection offset')
  if (limit === 0) throw new Error('Oracle collection limit must be positive')
  if (typeof envelope.hasMore !== 'boolean') {
    throw new Error('Oracle collection hasMore must be a boolean')
  }
  const items =
    envelope.items === undefined && count === 0 && !envelope.hasMore ? [] : envelope.items
  if (!Array.isArray(items)) throw new Error('Oracle collection items must be an array')
  if (count !== items.length) {
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
  if (totalResults !== undefined && count > 0 && totalResults < pageEnd) {
    throw new Error('Oracle collection totalResults is smaller than the returned page')
  }
  if (totalResults !== undefined && !envelope.hasMore && totalResults > pageEnd) {
    throw new Error('Oracle collection hasMore contradicts totalResults')
  }
  if (totalResults !== undefined && envelope.hasMore && totalResults <= pageEnd) {
    throw new Error('Oracle collection hasMore contradicts totalResults')
  }
  if (options.expectedOffset !== undefined) {
    const expectedOffset = nonNegativeInteger(
      options.expectedOffset,
      'Oracle collection expected offset'
    )
    if (offset !== expectedOffset) {
      throw new Error('Oracle collection offset does not match the requested offset')
    }
  }
  if (options.maxItems !== undefined) {
    const maxItems = nonNegativeInteger(options.maxItems, 'Oracle collection item limit')
    if (items.length > maxItems) {
      throw new Error('Oracle collection exceeds the requested item limit')
    }
  }

  return {
    items: items.map(parseItem),
    count,
    hasMore: envelope.hasMore,
    limit,
    offset,
    ...(totalResults !== undefined ? { totalResults } : {}),
    nextOffset: pageEnd,
  }
}

function readSelfLink(links: unknown): { href: string; url: URL } {
  if (!Array.isArray(links)) {
    throw new Error('Oracle response must include exactly one self link')
  }
  const selfLinks = links.filter((link) => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) return false
    return (link as Record<string, unknown>).rel === 'self'
  })
  if (selfLinks.length !== 1) {
    throw new Error('Oracle response must include exactly one self link')
  }
  const href = (selfLinks[0] as Record<string, unknown>).href
  if (
    typeof href !== 'string' ||
    UNSAFE_SELF_LINK_TEXT.test(href) ||
    href.includes('\\') ||
    RAW_SELF_LINK_DOT_SEGMENT.test(href) ||
    !hasWellFormedUtf16(href)
  ) {
    throw new Error('Oracle self link is malformed')
  }
  try {
    return { href, url: new URL(href) }
  } catch {
    throw new Error('Oracle self link is malformed')
  }
}

function getOnlySelfLink(value: unknown): URL {
  const resource = asObject(value, 'Oracle resource')
  const context = Object.hasOwn(resource, '@context')
    ? asObject(resource['@context'], 'Oracle resource context')
    : undefined
  const legacyLink = Object.hasOwn(resource, 'links') ? readSelfLink(resource.links) : undefined
  const contextLink =
    context && Object.hasOwn(context, 'links') ? readSelfLink(context.links) : undefined
  if (legacyLink && contextLink && legacyLink.href !== contextLink.href) {
    throw new Error('Oracle response self-link representations conflict')
  }
  const link = contextLink ?? legacyLink
  if (!link) throw new Error('Oracle response must include exactly one self link')
  return link.url
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
  address: OracleFusionResourceAddress
): void {
  const link = getOnlySelfLink(value)
  validateSelfLinkBase(link, instanceUrl)
  if (link.pathname !== buildOracleFusionResourcePath(address)) {
    throw new Error('Oracle response self link does not match the requested resource path')
  }
}

function validateOpaqueKey(key: string): string {
  if (
    !key ||
    !key.trim() ||
    key.length > OPAQUE_KEY_MAX_LENGTH ||
    key === '.' ||
    key === '..' ||
    UNSAFE_OPAQUE_KEY.test(key)
  ) {
    throw new Error('Oracle resource key is not a safe opaque path segment')
  }
  if (!hasWellFormedUtf16(key)) {
    throw new Error('Oracle resource key contains malformed Unicode')
  }
  return key
}

/** Derives one opaque key from a canonical same-origin collection self link. */
export function extractOracleFusionOpaqueKey(
  value: unknown,
  instanceUrl: string,
  collectionAddress: OracleFusionResourceAddress
): string {
  const link = getOnlySelfLink(value)
  validateSelfLinkBase(link, instanceUrl)
  const collectionPath = buildOracleFusionResourcePath(collectionAddress)
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
  try {
    return encodeURIComponent(validateOpaqueKey(key))
  } catch (error) {
    if (error instanceof URIError) {
      throw new Error('Oracle resource key contains malformed Unicode')
    }
    throw error
  }
}
