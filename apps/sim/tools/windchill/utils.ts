import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
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

export function normalizeWindchillDocument(value: unknown): WindchillDocument | null {
  if (!isRecordLike(value)) return null
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
  if (!isRecordLike(value)) return null
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

function normalizeState(value: unknown): WindchillStateTransition | null {
  if (!isRecordLike(value)) return null
  return {
    value: stringValue(value, 'Value'),
    display: stringValue(value, 'Display'),
  }
}

function normalizeUsageLink(
  value: unknown,
  parentFallback: WindchillDocument | null = null
): WindchillDocumentUsageLink | null {
  if (!isRecordLike(value)) return null
  const childValue = value.DocUses
  const child = normalizeWindchillDocument(childValue)
  const children = isRecordLike(childValue)
    ? collection(childValue.DocUsageLinks)
        .map((link) => normalizeUsageLink(link, child))
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

export function resolveWindchillNextLink(baseUrl: string, nextLink: string): string {
  const serviceRoot = new URL(normalizeServiceRoot(baseUrl))
  const resolved = new URL(nextLink, serviceRoot)
  const rootPath = `${serviceRoot.pathname}/`
  if (resolved.protocol !== 'https:' || resolved.origin !== serviceRoot.origin) {
    throw new Error('Windchill nextLink must remain on the configured HTTPS origin')
  }
  if (!resolved.pathname.startsWith(rootPath)) {
    throw new Error('Windchill nextLink must remain under the configured service root')
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
  if (
    params.nextLink &&
    (operation === 'windchill_list_documents' ||
      operation === 'windchill_get_document_structure' ||
      operation === 'windchill_list_attachments')
  ) {
    return resolveWindchillNextLink(root, params.nextLink)
  }
  if (operation === 'windchill_list_documents') {
    const url = new URL(`${root}/DocMgmt/Documents`)
    if (params.select) url.searchParams.set('$select', normalizedSelect(params.select))
    if (params.filter) url.searchParams.set('$filter', params.filter.trim())
    if (params.orderBy) url.searchParams.set('$orderby', params.orderBy.trim())
    if (params.top !== undefined) {
      url.searchParams.set('$top', String(integerInRange(params.top, 'top', 1, 200)))
    }
    if (params.skip !== undefined) {
      url.searchParams.set('$skip', String(integerInRange(params.skip, 'skip', 0)))
    }
    if (params.count !== undefined) url.searchParams.set('$count', String(params.count))
    if (params.latestVersion !== undefined) {
      url.searchParams.set('ptc.search.latestversion', String(params.latestVersion))
    }
    return url.toString()
  }

  if (!params.documentOid) throw new Error('Document OID is required')
  const path = documentPath(root, params.documentOid)
  if (operation === 'windchill_get_document') {
    const url = new URL(path)
    if (params.select) url.searchParams.set('$select', normalizedSelect(params.select))
    return url.toString()
  }
  if (operation === 'windchill_get_document_structure') {
    const depth = integerInRange(params.structureDepth ?? 1, 'structureDepth', 1, 3)
    const url = new URL(`${path}/DocUsageLinks`)
    url.searchParams.set('$expand', structureExpand(depth))
    return url.toString()
  }
  if (operation === 'windchill_get_valid_state_transitions') {
    return `${path}/PTC.DocMgmt.GetValidStateTransitions()`
  }
  if (operation === 'windchill_get_primary_content') return `${path}/PrimaryContent`
  if (operation === 'windchill_list_attachments') return `${path}/Attachments`
  throw new Error(`Operation ${operation} is not a direct Windchill read`)
}

export function normalizeWindchillReadOutput(
  operation: WindchillOperation,
  value: unknown
): WindchillOutput {
  if (operation === 'windchill_list_documents') {
    const documents = normalizeWindchillDocuments(value)
    return { operation, documents, pageInfo: windchillPageInfo(value, documents.length) }
  }
  if (operation === 'windchill_get_document') {
    return { operation, document: normalizeWindchillDocument(value) }
  }
  if (operation === 'windchill_get_document_structure') {
    const structure = collection(value)
      .map((link) => normalizeUsageLink(link))
      .filter((link): link is WindchillDocumentUsageLink => link !== null)
    return { operation, structure, pageInfo: windchillPageInfo(value, structure.length) }
  }
  if (operation === 'windchill_get_valid_state_transitions') {
    const states = collection(value)
      .map(normalizeState)
      .filter((state): state is WindchillStateTransition => state !== null)
    return { operation, states }
  }
  if (operation === 'windchill_get_primary_content') {
    const first = collection(value)[0]
    return { operation, content: normalizeWindchillContent(first ?? value) }
  }
  if (operation === 'windchill_list_attachments') {
    const attachments = collection(value)
      .map(normalizeWindchillContent)
      .filter((content): content is WindchillContent => content !== null)
    return { operation, attachments, pageInfo: windchillPageInfo(value, attachments.length) }
  }
  throw new Error(`Operation ${operation} does not have a direct-read response transform`)
}

export function buildWindchillInternalBody(operation: WindchillOperation, params: WindchillParams) {
  const { _context, ...input } = params
  return {
    ...input,
    operation,
    workspaceId: typeof _context?.workspaceId === 'string' ? _context.workspaceId : undefined,
    workflowId: typeof _context?.workflowId === 'string' ? _context.workflowId : undefined,
    executionId: typeof _context?.executionId === 'string' ? _context.executionId : undefined,
  }
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
