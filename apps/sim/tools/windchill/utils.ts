import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, omit } from '@sim/utils/object'
import {
  type WindchillOperationResponse,
  windchillOperationResponseSchema,
} from '@/lib/api/contracts/tools/windchill'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
import type {
  WindchillContent,
  WindchillDocument,
  WindchillDocumentUsageLink,
  WindchillOperation,
  WindchillOutput,
  WindchillParams,
  WindchillResponse,
  WindchillStateTransition,
} from '@/tools/windchill/types'

/**
 * Deepest `DocUsageLinks` expansion this integration ever requests, and therefore the deepest
 * nesting it will normalize. Bounding the walk keeps a pathologically nested provider response
 * from recursing without limit.
 */
const MAX_STRUCTURE_DEPTH = 3

/** Windchill's documented maximum server page size (`Prefer: odata.maxpagesize`). */
const MAX_PAGE_SIZE = 2000

/** Page size requested when the caller does not choose one. */
const DEFAULT_PAGE_SIZE = 200

function stringValue(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null
}

function numberValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function booleanValue(record: Record<string, unknown>, key: string): boolean | null {
  return typeof record[key] === 'boolean' ? record[key] : null
}

const DOCUMENT_RESPONSE_PROPERTIES = [
  'ID',
  'Name',
  'Number',
  'Title',
  'Description',
  'State',
  'VersionID',
  'Revision',
  'Version',
  'Latest',
  'CheckoutState',
  'FolderName',
  'FolderLocation',
] as const

const CONTENT_RESPONSE_PROPERTIES = [
  'ID',
  'FileName',
  'Description',
  'Format',
  'MimeType',
  'FileSize',
  '@odata.type',
  'DisplayName',
  'UrlLocation',
  'ExternalLocation',
] as const

function hasResponseProperty(
  value: Record<string, unknown>,
  properties: readonly string[]
): boolean {
  return properties.some((property) => Object.hasOwn(value, property))
}

export function normalizeWindchillDocument(value: unknown): WindchillDocument | null {
  if (!isRecordLike(value) || !hasResponseProperty(value, DOCUMENT_RESPONSE_PROPERTIES)) return null
  const state = value.State
  return {
    id: stringValue(value, 'ID'),
    name: stringValue(value, 'Name'),
    number: stringValue(value, 'Number'),
    title: stringValue(value, 'Title'),
    description: stringValue(value, 'Description'),
    state:
      (isRecordLike(state) ? stringValue(state, 'Value') : null) ?? stringValue(value, 'State'),
    stateDisplay: isRecordLike(state) ? stringValue(state, 'Display') : null,
    versionId: stringValue(value, 'VersionID'),
    revision: stringValue(value, 'Revision'),
    version: stringValue(value, 'Version'),
    latest: booleanValue(value, 'Latest'),
    checkoutState: stringValue(value, 'CheckoutState'),
    folderName: stringValue(value, 'FolderName'),
    folderLocation: stringValue(value, 'FolderLocation'),
  }
}

export function normalizeWindchillContent(value: unknown): WindchillContent | null {
  if (!isRecordLike(value) || !hasResponseProperty(value, CONTENT_RESPONSE_PROPERTIES)) return null
  return {
    id: stringValue(value, 'ID'),
    fileName: stringValue(value, 'FileName'),
    description: stringValue(value, 'Description'),
    format: stringValue(value, 'Format'),
    mimeType: stringValue(value, 'MimeType'),
    fileSize: numberValue(value, 'FileSize'),
    contentType: stringValue(value, '@odata.type'),
    displayName: stringValue(value, 'DisplayName'),
    urlLocation: stringValue(value, 'UrlLocation'),
    externalLocation: stringValue(value, 'ExternalLocation'),
  }
}

/**
 * Redacts this integration's own transport credentials out of an error string.
 *
 * Targets exactly three artifacts Sim itself puts on the wire: the `Basic` header built by
 * {@link createBasicAuthHeader}, the CSRF nonce pair from `createWindchillSession`, and the
 * short-lived signed vault URL from `resolveWindchillContentUrl`, whose bearer token lives in the
 * query string. None of these can reach the shared resolved-secret registry — it matches
 * `{{...}}`-resolved plaintext, never a base64 derivative or a provider-issued token.
 *
 * Applied to error strings only. Successful provider payloads are returned untouched.
 */
export function sanitizeWindchillError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrlForLog(url, 512))
    .replace(/\b(?:CSRF_NONCE|NonceValue|NonceKey)\b\s*[:=]\s*\S+/gi, '[redacted nonce]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .slice(0, 4096)
}

function collection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecordLike(value) && Array.isArray(value.value)) return value.value
  return []
}

function requiredCollection(value: unknown, operation: WindchillOperation): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecordLike(value) && Array.isArray(value.value)) return value.value
  throw new Error(`Windchill returned an incompatible response for ${operation}`)
}

function requireAllNormalized<T>(
  values: unknown[],
  normalize: (value: unknown) => T | null,
  operation: WindchillOperation
): T[] {
  const normalized = values.map(normalize)
  if (normalized.some((value) => value === null)) {
    throw new Error(`Windchill returned an incompatible response for ${operation}`)
  }
  return normalized as T[]
}

function normalizeState(value: unknown): WindchillStateTransition | null {
  if (
    !isRecordLike(value) ||
    (!Object.hasOwn(value, 'Value') && !Object.hasOwn(value, 'Display'))
  ) {
    return null
  }
  return {
    value: stringValue(value, 'Value'),
    display: stringValue(value, 'Display'),
  }
}

function normalizeUsageLink(
  value: unknown,
  parentFallback: WindchillDocument | null = null,
  depth = 0
): WindchillDocumentUsageLink | null {
  if (
    !isRecordLike(value) ||
    (!Object.hasOwn(value, 'ID') &&
      !Object.hasOwn(value, 'DocUsedBy') &&
      !Object.hasOwn(value, 'DocUses'))
  ) {
    return null
  }
  const childValue = value.DocUses
  const child = normalizeWindchillDocument(childValue)
  const children =
    isRecordLike(childValue) && depth < MAX_STRUCTURE_DEPTH
      ? collection(childValue.DocUsageLinks)
          .map((link) => normalizeUsageLink(link, child, depth + 1))
          .filter((link): link is WindchillDocumentUsageLink => link !== null)
      : []
  return {
    id: stringValue(value, 'ID'),
    parent: normalizeWindchillDocument(value.DocUsedBy) ?? parentFallback,
    child,
    children,
  }
}

export function normalizeWindchillDocuments(value: unknown): WindchillDocument[] {
  return collection(value)
    .map(normalizeWindchillDocument)
    .filter((document): document is WindchillDocument => document !== null)
}

export function windchillPageInfo(value: unknown, pageCount: number) {
  const record = isRecordLike(value) ? value : {}
  return {
    count: pageCount,
    totalCount: numberValue(record, '@odata.count'),
    nextLink: stringValue(record, '@odata.nextLink'),
  }
}

export function normalizeServiceRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'https:') throw new Error('Windchill base URL must use HTTPS')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Windchill base URL must not include credentials, query parameters, or a hash')
  }
  if (!/\/servlet\/odata\/v\d+$/i.test(parsed.pathname)) {
    throw new Error('Windchill base URL must end with a versioned /servlet/odata/vN path')
  }
  return parsed.toString().replace(/\/$/, '')
}

export function createBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export function encodeWindchillOid(oid: string): string {
  const trimmed = oid.trim()
  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    throw new Error('Windchill OID contains unsupported characters')
  }
  return encodeURIComponent(trimmed)
}

function documentPath(baseUrl: string, oid: string): string {
  return `${normalizeServiceRoot(baseUrl)}/DocMgmt/Documents('${encodeWindchillOid(oid)}')`
}

function decodedPathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

export function resolveWindchillNextLink(
  baseUrl: string,
  nextLink: string,
  expectedCollectionUrl: string
): string {
  const serviceRoot = new URL(normalizeServiceRoot(baseUrl))
  const resolved = new URL(nextLink, `${serviceRoot.toString()}/`)
  const expected = new URL(expectedCollectionUrl)
  if (
    resolved.protocol !== 'https:' ||
    resolved.origin !== serviceRoot.origin ||
    resolved.username ||
    resolved.password ||
    resolved.hash
  ) {
    throw new Error('Windchill nextLink must remain on the configured HTTPS origin')
  }
  if (
    expected.origin !== serviceRoot.origin ||
    decodedPathname(resolved.pathname) !== decodedPathname(expected.pathname)
  ) {
    throw new Error('Windchill nextLink must continue the originating collection')
  }
  return resolved.toString()
}

function structureExpand(depth: number): string {
  let child = 'DocUses'
  for (let level = 1; level < depth; level += 1) {
    child = `DocUses($expand=DocUsageLinks($expand=${child}))`
  }
  return `DocUsedBy,${child}`
}

/**
 * Serializes a built OData URL.
 *
 * `URLSearchParams` uses the form-urlencoded serializer, which writes a space as `+`. OData
 * readers percent-decode but never form-decode, so `$orderby=Name desc` would reach Windchill as
 * the literal `Name+desc`. Re-encoding the query's `+` as `%20` keeps multi-token `$filter` and
 * `$orderby` expressions intact.
 */
function serializeODataUrl(url: URL): string {
  if (!url.search) return url.toString()
  return `${url.origin}${url.pathname}${url.search.replace(/\+/g, '%20')}`
}

/** Treats a cleared subblock (`''`) exactly like an absent one. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function integerInRange(value: number, field: string, minimum: number, maximum?: number): number {
  if (!Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
    const range =
      maximum === undefined ? `at least ${minimum}` : `between ${minimum} and ${maximum}`
    throw new Error(`Windchill ${field} must be an integer ${range}`)
  }
  return value
}

const DOCUMENT_SELECT_PROPERTIES = new Set([
  'ID',
  'Name',
  'Number',
  'Title',
  'Description',
  'State',
  'VersionID',
  'Revision',
  'Version',
  'Latest',
  'CheckoutState',
  'FolderName',
  'FolderLocation',
])

function normalizedSelect(select: string): string {
  const properties = select
    .split(',')
    .map((property) => property.trim())
    .filter(Boolean)
  if (
    properties.length === 0 ||
    properties.some((property) => !DOCUMENT_SELECT_PROPERTIES.has(property))
  ) {
    throw new Error(
      `Windchill select supports only normalized document properties: ${[...DOCUMENT_SELECT_PROPERTIES].join(', ')}`
    )
  }
  return [...new Set(properties)].join(',')
}

export function buildWindchillReadUrl(
  operation: WindchillOperation,
  params: WindchillParams
): string {
  const root = normalizeServiceRoot(params.baseUrl)
  if (operation === 'windchill_list_documents') {
    const url = new URL(`${root}/DocMgmt/Documents`)
    if (params.nextLink) return resolveWindchillNextLink(root, params.nextLink, url.toString())
    if (params.select) url.searchParams.set('$select', normalizedSelect(params.select))
    if (params.filter) url.searchParams.set('$filter', params.filter.trim())
    if (params.orderBy) url.searchParams.set('$orderby', params.orderBy.trim())
    if (!isBlank(params.top)) {
      url.searchParams.set(
        '$top',
        String(integerInRange(params.top as number, 'top', 1, MAX_PAGE_SIZE))
      )
    }
    if (!isBlank(params.skip)) {
      url.searchParams.set('$skip', String(integerInRange(params.skip as number, 'skip', 0)))
    }
    if (!isBlank(params.count)) url.searchParams.set('$count', String(params.count))
    if (!isBlank(params.latestVersion)) {
      url.searchParams.set('ptc.search.latestversion', String(params.latestVersion))
    }
    return serializeODataUrl(url)
  }

  if (!params.documentOid) throw new Error('Document OID is required')
  const path = documentPath(root, params.documentOid)
  if (operation === 'windchill_get_document') {
    const url = new URL(path)
    if (params.select) url.searchParams.set('$select', normalizedSelect(params.select))
    return serializeODataUrl(url)
  }
  if (operation === 'windchill_get_document_structure') {
    const depth = integerInRange(
      isBlank(params.structureDepth) ? 1 : (params.structureDepth as number),
      'structureDepth',
      1,
      MAX_STRUCTURE_DEPTH
    )
    const url = new URL(`${path}/DocUsageLinks`)
    if (params.nextLink) return resolveWindchillNextLink(root, params.nextLink, url.toString())
    url.searchParams.set('$expand', structureExpand(depth))
    return serializeODataUrl(url)
  }
  if (operation === 'windchill_get_valid_state_transitions') {
    return `${path}/PTC.DocMgmt.GetValidStateTransitions()`
  }
  if (operation === 'windchill_get_primary_content') return `${path}/PrimaryContent`
  if (operation === 'windchill_list_attachments') {
    const url = `${path}/Attachments`
    return params.nextLink ? resolveWindchillNextLink(root, params.nextLink, url) : url
  }
  throw new Error(`Operation ${operation} is not a direct Windchill read`)
}

export function normalizeWindchillReadOutput(
  operation: WindchillOperation,
  value: unknown
): WindchillOutput {
  if (operation === 'windchill_list_documents') {
    const documents = requireAllNormalized(
      requiredCollection(value, operation),
      normalizeWindchillDocument,
      operation
    )
    return { operation, documents, pageInfo: windchillPageInfo(value, documents.length) }
  }
  if (operation === 'windchill_get_document') {
    const document = normalizeWindchillDocument(value)
    if (!document) throw new Error(`Windchill returned an incompatible response for ${operation}`)
    return { operation, document }
  }
  if (operation === 'windchill_get_document_structure') {
    const structure = requireAllNormalized(
      requiredCollection(value, operation),
      (link) => normalizeUsageLink(link),
      operation
    )
    return { operation, structure, pageInfo: windchillPageInfo(value, structure.length) }
  }
  if (operation === 'windchill_get_valid_state_transitions') {
    const states = requireAllNormalized(
      requiredCollection(value, operation),
      normalizeState,
      operation
    )
    return { operation, states }
  }
  if (operation === 'windchill_get_primary_content') {
    const contentValues =
      Array.isArray(value) || (isRecordLike(value) && Array.isArray(value.value))
        ? requiredCollection(value, operation)
        : null
    if (contentValues?.length === 0) return { operation, content: null }
    const content = normalizeWindchillContent(contentValues ? contentValues[0] : value)
    if (!content) throw new Error(`Windchill returned an incompatible response for ${operation}`)
    return { operation, content }
  }
  if (operation === 'windchill_list_attachments') {
    const attachments = requireAllNormalized(
      requiredCollection(value, operation),
      normalizeWindchillContent,
      operation
    )
    return { operation, attachments, pageInfo: windchillPageInfo(value, attachments.length) }
  }
  throw new Error(`Operation ${operation} does not have a direct-read response transform`)
}

/**
 * Builds the internal-route body.
 *
 * Cleared subblocks arrive as `''`. The executor merges the raw block inputs before the block's
 * own param transform, so a cleared optional field cannot be dropped upstream — strip blanks here,
 * where every internal-route tool passes through, rather than trusting the caller.
 */
export function buildWindchillInternalBody(operation: WindchillOperation, params: WindchillParams) {
  const supplied = Object.entries(omit(params, ['_context'])).filter(([, value]) => value !== '')
  return { ...Object.fromEntries(supplied), operation }
}

function providerError(value: unknown, fallback: string): string {
  if (!isRecordLike(value)) return fallback
  if (typeof value.message === 'string') return value.message
  if (isRecordLike(value.error)) {
    if (typeof value.error.message === 'string') return value.error.message
    if (isRecordLike(value.error.message) && typeof value.error.message.value === 'string') {
      return value.error.message.value
    }
  }
  return fallback
}

export function windchillReadHeaders(params: WindchillParams) {
  return {
    Authorization: createBasicAuthHeader(params.username, params.password),
    Accept: 'application/json',
    Prefer: `odata.maxpagesize=${isBlank(params.top) ? DEFAULT_PAGE_SIZE : params.top}`,
  }
}

export async function transformWindchillDirectRead(
  operation: WindchillOperation,
  response: Response
): Promise<WindchillResponse> {
  let data: unknown
  try {
    data = await response.json()
  } catch {
    if (response.ok) {
      throw new Error(`Windchill returned invalid JSON with status ${response.status}`)
    }
    data = null
  }
  if (!response.ok) {
    throw new Error(
      sanitizeWindchillError(
        providerError(data, `Windchill request failed with status ${response.status}`)
      )
    )
  }
  return { success: true, output: normalizeWindchillReadOutput(operation, data) }
}

export async function transformWindchillInternalResponse(
  operation: WindchillOperation,
  response: Response
): Promise<WindchillResponse> {
  try {
    const data: unknown = await response.json()
    const parsed = windchillOperationResponseSchema.safeParse(data)
    if (!parsed.success) {
      return {
        success: false,
        output: { operation },
        error: 'Windchill route returned an invalid response',
      }
    }
    if (!response.ok || !parsed.data.success) {
      return {
        success: false,
        output: { operation },
        error:
          parsed.data.success === false
            ? sanitizeWindchillError(parsed.data.error)
            : `Windchill request failed with status ${response.status}`,
      }
    }
    const result: WindchillOperationResponse = parsed.data
    if (result.output.operation !== operation) {
      return {
        success: false,
        output: { operation },
        error: 'Windchill route returned a response for a different operation',
      }
    }
    return { success: true, output: result.output }
  } catch (error) {
    return {
      success: false,
      output: { operation },
      error: sanitizeWindchillError(
        getErrorMessage(error, 'Failed to read Windchill route response')
      ),
    }
  }
}
