import { omit } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { ErrorExtractorId, extractErrorMessage } from '@/tools/error-extractors'
import {
  buildQuickBooksCompanyUrl,
  buildQuickBooksHeaders,
  QUICKBOOKS_MAX_RESPONSE_BYTES,
} from '@/tools/quickbooks/client'
import { sanitizeQuickBooksFaultData } from '@/tools/quickbooks/fault'
import type {
  QuickBooksActiveStatus,
  QuickBooksAddress,
  QuickBooksListResponse,
  QuickBooksMasterDataRecord,
  QuickBooksMasterDataRecordType,
  QuickBooksMutationResponse,
  QuickBooksPaginationParams,
  QuickBooksReference,
  QuickBooksVendor,
  QuickBooksWritableItemType,
} from '@/tools/quickbooks/types'

export type QuickBooksQueryEntity =
  | 'Account'
  | 'Bill'
  | 'Customer'
  | 'Employee'
  | 'Item'
  | 'PurchaseOrder'
  | 'Vendor'

interface QuickBooksQueryResponse<T> {
  QueryResponse?: Partial<Record<QuickBooksQueryEntity, T[]>> & {
    startPosition?: number
    maxResults?: number
  }
  time?: string
}

export const QUICKBOOKS_MASTER_DATA_ENTITIES = {
  account: { entity: 'Account', resource: 'account' },
  customer: { entity: 'Customer', resource: 'customer' },
  employee: { entity: 'Employee', resource: 'employee' },
  item: { entity: 'Item', resource: 'item' },
  vendor: { entity: 'Vendor', resource: 'vendor' },
} as const satisfies Record<
  QuickBooksMasterDataRecordType,
  { entity: QuickBooksQueryEntity; resource: string }
>

export function validateQuickBooksPagination(
  startPosition: number,
  maxResults: number
): { startPosition: number; maxResults: number } {
  if (!Number.isInteger(startPosition) || startPosition < 1) {
    throw new Error('startPosition must be a positive integer')
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
    throw new Error('maxResults must be an integer from 1 through 100')
  }
  return { startPosition, maxResults }
}

export function buildQuickBooksQueryUrl(
  realmId: string,
  entity: QuickBooksQueryEntity,
  startPosition: number,
  maxResults: number
): URL {
  const pagination = validateQuickBooksPagination(startPosition, maxResults)
  const url = buildQuickBooksCompanyUrl(realmId, 'query')
  url.searchParams.set(
    'query',
    `SELECT * FROM ${entity} STARTPOSITION ${pagination.startPosition} MAXRESULTS ${pagination.maxResults}`
  )
  return url
}

export function getQuickBooksMasterDataEntity(recordType: QuickBooksMasterDataRecordType) {
  const config = QUICKBOOKS_MASTER_DATA_ENTITIES[recordType]
  if (!config) {
    throw new Error(`Unsupported QuickBooks master data record type: ${String(recordType)}`)
  }
  return config
}

export function buildQuickBooksEntityUrl(
  realmId: string,
  resource: string,
  recordId?: string
): URL {
  const normalizedResource = resource.trim()
  if (!normalizedResource) throw new Error('QuickBooks resource is required')
  const normalizedRecordId = recordId?.trim()
  if (recordId !== undefined && !normalizedRecordId) {
    throw new Error('QuickBooks record ID is required')
  }
  return buildQuickBooksCompanyUrl(
    realmId,
    normalizedRecordId
      ? `${encodeURIComponent(normalizedResource)}/${encodeURIComponent(normalizedRecordId)}`
      : encodeURIComponent(normalizedResource)
  )
}

export async function parseQuickBooksJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`QuickBooks request failed with HTTP ${response.status}`)
  }
  const data = await readResponseJsonWithLimit<T>(response, {
    maxBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
    label,
  })
  const faultData = sanitizeQuickBooksFaultData(data)
  if (faultData) {
    const errorInfo = {
      status: response.status,
      statusText: response.statusText,
      data: faultData,
      headers: response.headers,
    }
    throw Object.assign(
      new Error(extractErrorMessage(errorInfo, ErrorExtractorId.QUICKBOOKS_FAULT)),
      errorInfo
    )
  }
  return data
}

export async function transformQuickBooksListResponse<T>(
  response: Response,
  params: QuickBooksPaginationParams,
  entity: QuickBooksQueryEntity
): Promise<QuickBooksListResponse<T>> {
  const data = await parseQuickBooksJson<QuickBooksQueryResponse<T>>(
    response,
    `QuickBooks ${entity} query response`
  )
  const queryResponse = data.QueryResponse
  if (!queryResponse || typeof queryResponse !== 'object' || Array.isArray(queryResponse)) {
    throw new Error(`QuickBooks ${entity} response is missing QueryResponse`)
  }

  const candidate = queryResponse[entity]
  if (candidate !== undefined && !Array.isArray(candidate)) {
    throw new Error(`QuickBooks ${entity} response contains a malformed entity list`)
  }

  const items = (candidate ?? []) as T[]
  const startPosition = Number.isInteger(queryResponse.startPosition)
    ? (queryResponse.startPosition as number)
    : params.startPosition
  const maxResults = Number.isInteger(queryResponse.maxResults)
    ? (queryResponse.maxResults as number)
    : items.length

  return {
    success: true,
    output: {
      items,
      startPosition,
      maxResults,
      nextStartPosition: startPosition + items.length,
      hasMore: items.length === params.maxResults,
      time: typeof data.time === 'string' ? data.time : null,
    },
  }
}

export async function transformQuickBooksEntityResponse<T extends QuickBooksMasterDataRecord>(
  response: Response,
  entity: QuickBooksQueryEntity
): Promise<{ item: T; time: string | null }> {
  const data = await parseQuickBooksJson<Record<string, unknown> & { time?: string }>(
    response,
    `QuickBooks ${entity} response`
  )
  const candidate = data[entity]
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`QuickBooks ${entity} response is missing ${entity}`)
  }
  return {
    item: candidate as T,
    time: typeof data.time === 'string' ? data.time : null,
  }
}

export async function transformQuickBooksMutationResponse<T extends QuickBooksMasterDataRecord>(
  response: Response,
  entity: QuickBooksQueryEntity,
  sanitize: (item: T) => T = (item) => item
): Promise<QuickBooksMutationResponse<T>> {
  const parsed = await transformQuickBooksEntityResponse<T>(response, entity)
  const item = sanitize(parsed.item)
  const recordId = typeof item.Id === 'string' ? item.Id.trim() : ''
  const syncToken = typeof item.SyncToken === 'string' ? item.SyncToken.trim() : ''
  if (!recordId || !syncToken) {
    throw new Error(`QuickBooks ${entity} response is missing Id or SyncToken`)
  }
  return {
    success: true,
    output: { record: item, recordId, syncToken, time: parsed.time },
  }
}

export function sanitizeQuickBooksVendor(vendor: QuickBooksVendor): QuickBooksVendor {
  return omit(vendor, ['TaxIdentifier']) as QuickBooksVendor
}

export function quickBooksWritableItemType(itemType: QuickBooksWritableItemType): string {
  const types: Record<QuickBooksWritableItemType, string> = {
    service: 'Service',
    non_inventory: 'NonInventory',
  }
  const type = types[itemType]
  if (!type) throw new Error(`Unsupported writable QuickBooks item type: ${String(itemType)}`)
  return type
}

export function quickBooksReference(value: string, fieldName: string): QuickBooksReference {
  return { value: requiredQuickBooksString(value, fieldName) }
}

export function requiredQuickBooksString(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${fieldName} is required`)
  return normalized
}

export function optionalQuickBooksString(value?: string): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  return normalized || undefined
}

export function quickBooksEmailAddress(value?: string): { Address: string } | undefined {
  const normalized = optionalQuickBooksString(value)
  return normalized ? { Address: normalized } : undefined
}

export function quickBooksPhoneNumber(value?: string): { FreeFormNumber: string } | undefined {
  const normalized = optionalQuickBooksString(value)
  return normalized ? { FreeFormNumber: normalized } : undefined
}

export function validateQuickBooksOptionalNumber(
  value: number | undefined,
  fieldName: string
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a finite number`)
  return value
}

const QUICKBOOKS_ADDRESS_FIELDS = {
  line1: 'Line1',
  line2: 'Line2',
  city: 'City',
  countrySubDivisionCode: 'CountrySubDivisionCode',
  postalCode: 'PostalCode',
  country: 'Country',
} as const

export function parseQuickBooksAddress(
  value: unknown,
  fieldName: string
): QuickBooksAddress | undefined {
  if (value == null || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${fieldName} must be valid JSON`)
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }

  const result: QuickBooksAddress = {}
  for (const [key, fieldValue] of Object.entries(parsed)) {
    const quickBooksKey = QUICKBOOKS_ADDRESS_FIELDS[key as keyof typeof QUICKBOOKS_ADDRESS_FIELDS]
    if (!quickBooksKey) {
      throw new Error(`${fieldName} contains unsupported field "${key}"`)
    }
    if (typeof fieldValue !== 'string') {
      throw new Error(`${fieldName}.${key} must be a string`)
    }
    result[quickBooksKey] = fieldValue
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`${fieldName} must contain at least one supported address field`)
  }
  return result
}

export function quickBooksActiveValue(activeStatus: QuickBooksActiveStatus): boolean | undefined {
  if (activeStatus === 'unchanged') return undefined
  if (activeStatus === 'active') return true
  if (activeStatus === 'inactive') return false
  throw new Error(`Unsupported QuickBooks active status: ${String(activeStatus)}`)
}

export function assertQuickBooksSparseUpdate(
  body: Record<string, unknown>,
  requiredFieldCount = 3
): void {
  if (Object.keys(body).length <= requiredFieldCount) {
    throw new Error('Provide at least one field to update')
  }
}

export function getQuickBooksToolHeaders(
  accessToken: string,
  contentType?: 'application/json'
): Record<string, string> {
  return {
    ...buildQuickBooksHeaders(accessToken),
    ...(contentType ? { 'Content-Type': contentType } : {}),
  }
}
