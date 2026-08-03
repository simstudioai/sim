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
  QuickBooksCustomer,
  QuickBooksListResponse,
  QuickBooksMasterDataRecordType,
  QuickBooksMutationResponse,
  QuickBooksPaginationParams,
  QuickBooksPurchasingTransactionType,
  QuickBooksReference,
  QuickBooksSalesTransactionType,
  QuickBooksVendor,
  QuickBooksWritableItemType,
} from '@/tools/quickbooks/types'

export type QuickBooksQueryEntity =
  | 'Account'
  | 'Bill'
  | 'BillPayment'
  | 'CreditMemo'
  | 'Customer'
  | 'Employee'
  | 'Estimate'
  | 'Invoice'
  | 'Item'
  | 'Payment'
  | 'PurchaseOrder'
  | 'Purchase'
  | 'RefundReceipt'
  | 'SalesReceipt'
  | 'Vendor'
  | 'VendorCredit'

interface QuickBooksQueryResponse<T> {
  QueryResponse?: Partial<Record<QuickBooksQueryEntity, T[]>> & {
    startPosition?: number
    maxResults?: number
  }
  time?: string
}

function assertQuickBooksEntity<T>(candidate: unknown, entity: QuickBooksQueryEntity): T {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`QuickBooks ${entity} response contains a malformed ${entity} record`)
  }
  const recordId = (candidate as { Id?: unknown }).Id
  if (typeof recordId !== 'string' || !recordId.trim()) {
    throw new Error(`QuickBooks ${entity} response contains a record without an Id`)
  }
  return candidate as T
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

export const QUICKBOOKS_SALES_ENTITIES = {
  credit_memo: { entity: 'CreditMemo', resource: 'creditmemo' },
  estimate: { entity: 'Estimate', resource: 'estimate' },
  invoice: { entity: 'Invoice', resource: 'invoice' },
  payment: { entity: 'Payment', resource: 'payment' },
  refund_receipt: { entity: 'RefundReceipt', resource: 'refundreceipt' },
  sales_receipt: { entity: 'SalesReceipt', resource: 'salesreceipt' },
} as const satisfies Record<
  QuickBooksSalesTransactionType,
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

export const QUICKBOOKS_PURCHASING_ENTITIES = {
  bill: { entity: 'Bill', resource: 'bill' },
  bill_payment: { entity: 'BillPayment', resource: 'billpayment' },
  purchase: { entity: 'Purchase', resource: 'purchase' },
  purchase_order: { entity: 'PurchaseOrder', resource: 'purchaseorder' },
  vendor_credit: { entity: 'VendorCredit', resource: 'vendorcredit' },
} as const satisfies Record<
  QuickBooksPurchasingTransactionType,
  { entity: QuickBooksQueryEntity; resource: string }
>

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

export function getQuickBooksSalesEntity(transactionType: QuickBooksSalesTransactionType) {
  const config = QUICKBOOKS_SALES_ENTITIES[transactionType]
  if (!config) {
    throw new Error(`Unsupported QuickBooks sales transaction type: ${String(transactionType)}`)
  }
  return config
}

export function getQuickBooksPurchasingEntity(
  transactionType: QuickBooksPurchasingTransactionType
) {
  const config = QUICKBOOKS_PURCHASING_ENTITIES[transactionType]
  if (!config) {
    throw new Error(
      `Unsupported QuickBooks purchasing transaction type: ${String(transactionType)}`
    )
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

export function addQuickBooksRequestId(url: URL, requestId?: string): URL {
  const normalized = optionalQuickBooksString(requestId)
  if (!normalized) return url
  if (normalized.length > 50) throw new Error('requestId cannot exceed 50 characters')
  url.searchParams.set('requestid', normalized)
  return url
}

export async function parseQuickBooksJson<T>(
  response: Response,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  if (!response.ok) {
    throw new Error(`QuickBooks request failed with HTTP ${response.status}`)
  }
  const data = await readResponseJsonWithLimit<T>(response, {
    maxBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
    label,
    signal,
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

  const items = (candidate ?? []).map((item) => assertQuickBooksEntity<T>(item, entity))
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

export async function transformQuickBooksEntityResponse<
  T extends { Id: string; SyncToken?: string },
>(
  response: Response,
  entity: QuickBooksQueryEntity,
  signal?: AbortSignal
): Promise<{ item: T; time: string | null }> {
  const data = await parseQuickBooksJson<Record<string, unknown> & { time?: string }>(
    response,
    `QuickBooks ${entity} response`,
    signal
  )
  const candidate = data[entity]
  if (!candidate) {
    throw new Error(`QuickBooks ${entity} response is missing ${entity}`)
  }
  return {
    item: assertQuickBooksEntity<T>(candidate, entity),
    time: typeof data.time === 'string' ? data.time : null,
  }
}

export async function transformQuickBooksMutationResponse<
  T extends { Id: string; SyncToken?: string },
>(
  response: Response,
  entity: QuickBooksQueryEntity,
  sanitize: (item: T) => T = (item) => item,
  signal?: AbortSignal
): Promise<QuickBooksMutationResponse<T>> {
  const parsed = await transformQuickBooksEntityResponse<T>(response, entity, signal)
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

export function sanitizeQuickBooksCustomer(customer: QuickBooksCustomer): QuickBooksCustomer {
  return omit(customer, ['TaxIdentifier']) as QuickBooksCustomer
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

const QUICKBOOKS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function validateQuickBooksDate(
  value: string | undefined,
  fieldName: string
): string | undefined {
  const normalized = optionalQuickBooksString(value)
  if (!normalized) return undefined
  if (!QUICKBOOKS_DATE_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`)
  }
  const date = new Date(`${normalized}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${fieldName} must be a valid date`)
  }
  return normalized
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
  Line1: 'Line1',
  line2: 'Line2',
  Line2: 'Line2',
  city: 'City',
  City: 'City',
  countrySubDivisionCode: 'CountrySubDivisionCode',
  CountrySubDivisionCode: 'CountrySubDivisionCode',
  postalCode: 'PostalCode',
  PostalCode: 'PostalCode',
  country: 'Country',
  Country: 'Country',
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

export function quickBooksActiveValue(
  activeStatus: QuickBooksActiveStatus | undefined
): boolean | undefined {
  if (activeStatus === undefined || activeStatus === 'unchanged') return undefined
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
