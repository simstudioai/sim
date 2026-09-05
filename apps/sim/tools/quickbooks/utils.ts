import { omit } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { ErrorExtractorId, extractErrorMessage } from '@/tools/error-extractors'
import {
  buildQuickBooksCompanyUrl,
  buildQuickBooksHeaders,
  QUICKBOOKS_MAX_RESPONSE_BYTES,
} from '@/tools/quickbooks/client'
import type { SanitizedQuickBooksFault } from '@/tools/quickbooks/fault'
import { sanitizeQuickBooksFaultData } from '@/tools/quickbooks/fault'
import {
  applyQuickBooksReportParams,
  resolveQuickBooksReportEndpoint,
} from '@/tools/quickbooks/reports'
import type {
  QuickBooksAccountingTransactionType,
  QuickBooksAddress,
  QuickBooksAuthParams,
  QuickBooksCustomer,
  QuickBooksEmployee,
  QuickBooksListResponse,
  QuickBooksMasterDataRecordType,
  QuickBooksMutationResponse,
  QuickBooksPaginationParams,
  QuickBooksPurchasingTransactionType,
  QuickBooksReadAccountingTransactionsParams,
  QuickBooksReadMasterDataParams,
  QuickBooksReadPurchasingTransactionsParams,
  QuickBooksReadSalesTransactionsParams,
  QuickBooksReportColumns,
  QuickBooksReportHeader,
  QuickBooksReportRows,
  QuickBooksReportType,
  QuickBooksRunFinancialReportParams,
  QuickBooksRunFinancialReportResponse,
  QuickBooksSalesTransactionType,
  QuickBooksVendor,
} from '@/tools/quickbooks/types'
import {
  optionalQuickBooksString,
  requiredQuickBooksString,
  validateQuickBooksDate,
  validateQuickBooksPagination,
} from '@/tools/quickbooks/values'

export type QuickBooksQueryEntity =
  | 'Account'
  | 'Bill'
  | 'BillPayment'
  | 'Class'
  | 'CreditMemo'
  | 'Customer'
  | 'Deposit'
  | 'Department'
  | 'Employee'
  | 'Estimate'
  | 'Invoice'
  | 'Item'
  | 'JournalEntry'
  | 'Payment'
  | 'PurchaseOrder'
  | 'Purchase'
  | 'RefundReceipt'
  | 'SalesReceipt'
  | 'Transfer'
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
  class: { entity: 'Class', resource: 'class' },
  customer: { entity: 'Customer', resource: 'customer' },
  department: { entity: 'Department', resource: 'department' },
  employee: { entity: 'Employee', resource: 'employee' },
  item: { entity: 'Item', resource: 'item' },
  vendor: { entity: 'Vendor', resource: 'vendor' },
} as const satisfies Record<
  QuickBooksMasterDataRecordType,
  { entity: QuickBooksQueryEntity; resource: string }
>

export function buildQuickBooksReportUrl(params: QuickBooksRunFinancialReportParams): URL {
  const { endpoint, dateParams } = resolveQuickBooksReportEndpoint(params)
  const url = buildQuickBooksCompanyUrl(
    params.realmId,
    `reports/${endpoint}`,
    params.quickBooksEnvironment
  )
  for (const [key, value] of dateParams) url.searchParams.set(key, value)
  applyQuickBooksReportParams(url, params)
  return url
}

interface QuickBooksReportEnvelope {
  Header?: QuickBooksReportHeader
  Columns?: QuickBooksReportColumns
  Rows?: QuickBooksReportRows
}

function assertQuickBooksReportSection<T>(value: unknown, section: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`QuickBooks report response is missing or has malformed ${section}`)
  }
  return value as T
}

export async function transformQuickBooksReportResponse(
  response: Response,
  reportType: QuickBooksReportType
): Promise<QuickBooksRunFinancialReportResponse> {
  const data = await parseQuickBooksJson<QuickBooksReportEnvelope>(
    response,
    `QuickBooks ${reportType} report response`
  )
  const header = assertQuickBooksReportSection<QuickBooksReportHeader>(data.Header, 'Header')
  return {
    success: true,
    output: {
      reportType,
      header,
      columns: assertQuickBooksReportSection<QuickBooksReportColumns>(data.Columns, 'Columns'),
      rows: assertQuickBooksReportSection<QuickBooksReportRows>(data.Rows, 'Rows'),
      time: typeof header.Time === 'string' ? header.Time : null,
    },
  }
}

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
  auth: QuickBooksAuthParams,
  entity: QuickBooksQueryEntity,
  startPosition: number,
  maxResults: number,
  filters: readonly QuickBooksQueryFilter[] = []
): URL {
  const pagination = validateQuickBooksPagination(startPosition, maxResults)
  const url = buildQuickBooksCompanyUrl(auth.realmId, 'query', auth.quickBooksEnvironment)
  const where =
    filters.length > 0
      ? ` WHERE ${filters.map((filter) => buildQuickBooksQueryFilter(filter)).join(' AND ')}`
      : ''
  url.searchParams.set(
    'query',
    `SELECT * FROM ${entity}${where} STARTPOSITION ${pagination.startPosition} MAXRESULTS ${pagination.maxResults}`
  )
  return url
}

type QuickBooksQueryField = 'Active' | 'CustomerRef' | 'EntityRef' | 'TxnDate' | 'VendorRef'
type QuickBooksQueryOperator = '=' | '>=' | '<='

interface QuickBooksQueryFilter {
  field: QuickBooksQueryField
  operator: QuickBooksQueryOperator
  value: string | boolean
}

function buildQuickBooksQueryFilter(filter: QuickBooksQueryFilter): string {
  if (typeof filter.value === 'boolean') {
    return `${filter.field} ${filter.operator} ${String(filter.value)}`
  }
  const value = requiredQuickBooksString(filter.value, filter.field)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
  return `${filter.field} ${filter.operator} '${value}'`
}

function getQuickBooksDateRangeFilters(
  startDate: string | undefined,
  endDate: string | undefined
): QuickBooksQueryFilter[] {
  const start = validateQuickBooksDate(startDate, 'startDate')
  const end = validateQuickBooksDate(endDate, 'endDate')
  if (start && end && start > end) throw new Error('startDate cannot be after endDate')
  return [
    ...(start ? [{ field: 'TxnDate', operator: '>=', value: start } as const] : []),
    ...(end ? [{ field: 'TxnDate', operator: '<=', value: end } as const] : []),
  ]
}

export function buildQuickBooksMasterDataQueryUrl(params: QuickBooksReadMasterDataParams): URL {
  const config = getQuickBooksMasterDataEntity(params.recordType)
  const activeStatus = params.activeStatus ?? 'default'
  if (!['default', 'active', 'inactive'].includes(activeStatus)) {
    throw new Error(`Unsupported QuickBooks active status filter: ${String(activeStatus)}`)
  }
  const filters: QuickBooksQueryFilter[] =
    activeStatus === 'default'
      ? []
      : [{ field: 'Active', operator: '=', value: activeStatus === 'active' }]
  return buildQuickBooksQueryUrl(
    params,
    config.entity,
    params.startPosition ?? 1,
    params.maxResults ?? 25,
    filters
  )
}

export function buildQuickBooksSalesQueryUrl(params: QuickBooksReadSalesTransactionsParams): URL {
  const config = getQuickBooksSalesEntity(params.transactionType)
  const filters = getQuickBooksDateRangeFilters(params.startDate, params.endDate)
  const customerId = optionalQuickBooksString(params.customerId)
  if (customerId) filters.push({ field: 'CustomerRef', operator: '=', value: customerId })
  return buildQuickBooksQueryUrl(
    params,
    config.entity,
    params.startPosition ?? 1,
    params.maxResults ?? 25,
    filters
  )
}

const QUICKBOOKS_PURCHASING_VENDOR_FILTER_TYPES = new Set<QuickBooksPurchasingTransactionType>([
  'bill',
  'bill_payment',
  'purchase_order',
  'vendor_credit',
])

export function buildQuickBooksPurchasingQueryUrl(
  params: QuickBooksReadPurchasingTransactionsParams
): URL {
  const config = getQuickBooksPurchasingEntity(params.transactionType)
  const filters = getQuickBooksDateRangeFilters(params.startDate, params.endDate)
  const vendorId = optionalQuickBooksString(params.vendorId)
  if (vendorId) {
    if (!QUICKBOOKS_PURCHASING_VENDOR_FILTER_TYPES.has(params.transactionType)) {
      throw new Error(`${params.transactionType} does not support vendorId filtering`)
    }
    filters.push({ field: 'VendorRef', operator: '=', value: vendorId })
  }
  return buildQuickBooksQueryUrl(
    params,
    config.entity,
    params.startPosition ?? 1,
    params.maxResults ?? 25,
    filters
  )
}

export function buildQuickBooksAccountingQueryUrl(
  params: QuickBooksReadAccountingTransactionsParams
): URL {
  const config = getQuickBooksAccountingEntity(params.transactionType)
  return buildQuickBooksQueryUrl(
    params,
    config.entity,
    params.startPosition ?? 1,
    params.maxResults ?? 25,
    getQuickBooksDateRangeFilters(params.startDate, params.endDate)
  )
}

export const QUICKBOOKS_ACCOUNTING_ENTITIES = {
  deposit: { entity: 'Deposit', resource: 'deposit' },
  journal_entry: { entity: 'JournalEntry', resource: 'journalentry' },
  transfer: { entity: 'Transfer', resource: 'transfer' },
} as const satisfies Record<
  QuickBooksAccountingTransactionType,
  { entity: QuickBooksQueryEntity; resource: string }
>

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

export function getQuickBooksAccountingEntity(
  transactionType: QuickBooksAccountingTransactionType
) {
  const config = QUICKBOOKS_ACCOUNTING_ENTITIES[transactionType]
  if (!config) {
    throw new Error(
      `Unsupported QuickBooks accounting transaction type: ${String(transactionType)}`
    )
  }
  return config
}

export function buildQuickBooksEntityUrl(
  auth: QuickBooksAuthParams,
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
    auth.realmId,
    normalizedRecordId
      ? `${encodeURIComponent(normalizedResource)}/${encodeURIComponent(normalizedRecordId)}`
      : encodeURIComponent(normalizedResource),
    auth.quickBooksEnvironment
  )
}

export function addQuickBooksRequestId(url: URL, requestId?: string): URL {
  const normalized = optionalQuickBooksString(requestId)
  if (!normalized) return url
  if (normalized.length > 50) throw new Error('requestId cannot exceed 50 characters')
  url.searchParams.set('requestid', normalized)
  return url
}

/**
 * Locates a fault anywhere Intuit is documented to place one.
 *
 * A transport-level fault sits at the top level of `IntuitResponse`, but a
 * rejected *query* nests its fault inside `QueryResponse`: "If the query
 * contains an error, the `<QueryResponse>` element will contain `<Fault>`."
 * Only checking the top level lets a rejected query fall through to an absent
 * entity array and be reported as an empty, successful result set.
 */
function findQuickBooksFault(data: unknown): SanitizedQuickBooksFault | null {
  const topLevel = sanitizeQuickBooksFaultData(data)
  if (topLevel) return topLevel
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return sanitizeQuickBooksFaultData((data as Record<string, unknown>).QueryResponse)
}

/**
 * Builds the error an internal operation throws for a failed QuickBooks
 * response.
 *
 * `parseQuickBooksJson` cannot be reused here: it rejects on a non-OK status
 * before it ever reads the body, so the Intuit fault describing *why* the call
 * failed would be discarded. `entity` names the QuickBooks entity the call
 * targeted and only shapes the read label used for diagnostics.
 */
export async function getQuickBooksOperationError(
  response: Response,
  entity: QuickBooksQueryEntity,
  signal?: AbortSignal
): Promise<Error> {
  let data: unknown = null
  try {
    data = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
      label: `QuickBooks ${entity} error response`,
      signal,
    })
  } catch {
    signal?.throwIfAborted()
  }

  const errorInfo = {
    status: response.status,
    statusText: response.statusText,
    data: findQuickBooksFault(data),
    headers: response.headers,
  }
  return Object.assign(
    new Error(extractErrorMessage(errorInfo, ErrorExtractorId.QUICKBOOKS_FAULT)),
    errorInfo
  )
}

interface QuickBooksFullUpdateOptions<
  P extends QuickBooksAuthParams,
  T extends { Id: string; SyncToken?: string },
> {
  params: P
  signal?: AbortSignal
  entity: QuickBooksQueryEntity
  resource: string
  recordId: string
  syncToken: string
  buildPatch: (params: P) => Record<string, unknown>
  sanitize?: (record: T) => T
}

export function buildQuickBooksFullUpdateBody(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  recordId: string,
  syncToken: string
): Record<string, unknown> {
  const currentFields = omit(current, [
    'HeaderFull',
    'HeaderLite',
    'MetaData',
    'NameAndId',
    'Overview',
    'domain',
    'sparse',
    'status',
  ])
  const patchFields = omit(patch, ['sparse'])
  return {
    ...currentFields,
    ...patchFields,
    Id: recordId,
    SyncToken: syncToken,
  }
}

/**
 * Implements Intuit's documented full-update sequence: read the complete live
 * entity, reject stale caller state, apply only the requested patch, and post
 * the resulting entity back without the sparse marker or response metadata.
 */
export async function executeQuickBooksFullUpdate<
  P extends QuickBooksAuthParams,
  T extends { Id: string; SyncToken?: string },
>(options: QuickBooksFullUpdateOptions<P, T>): Promise<QuickBooksMutationResponse<T>> {
  const recordId = requiredQuickBooksString(options.recordId, 'recordId')
  const syncToken = requiredQuickBooksString(options.syncToken, 'syncToken')
  const patch = options.buildPatch(options.params)
  const readResponse = await fetch(
    buildQuickBooksEntityUrl(options.params, options.resource, recordId),
    {
      method: 'GET',
      headers: getQuickBooksToolHeaders(options.params.accessToken),
      signal: options.signal,
    }
  )
  if (!readResponse.ok) {
    throw await getQuickBooksOperationError(readResponse, options.entity, options.signal)
  }
  const { item } = await transformQuickBooksEntityResponse<T>(
    readResponse,
    options.entity,
    options.signal
  )
  const current = item as T & Record<string, unknown>
  const currentId = typeof current.Id === 'string' ? current.Id.trim() : ''
  const currentSyncToken = typeof current.SyncToken === 'string' ? current.SyncToken.trim() : ''
  if (currentId !== recordId) {
    throw new Error(`QuickBooks ${options.entity} read returned an unexpected record ID`)
  }
  if (currentSyncToken !== syncToken) {
    throw new Error(
      `QuickBooks ${options.entity} ${recordId} changed since sync token ${syncToken} was read (current sync token ${currentSyncToken}). Re-read the record and retry.`
    )
  }
  options.signal?.throwIfAborted()

  const fullBody = buildQuickBooksFullUpdateBody(current, patch, recordId, syncToken)
  const updateResponse = await fetch(buildQuickBooksEntityUrl(options.params, options.resource), {
    method: 'POST',
    headers: getQuickBooksToolHeaders(options.params.accessToken, 'application/json'),
    body: JSON.stringify(fullBody),
    signal: options.signal,
  })
  if (!updateResponse.ok) {
    throw await getQuickBooksOperationError(updateResponse, options.entity, options.signal)
  }
  return transformQuickBooksMutationResponse<T>(
    updateResponse,
    options.entity,
    options.sanitize,
    options.signal
  )
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
  const faultData = findQuickBooksFault(data)
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

export function getQuickBooksRecordVersion(record: { SyncToken?: string }): string | undefined {
  const recordVersion = typeof record.SyncToken === 'string' ? record.SyncToken.trim() : ''
  return recordVersion || undefined
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
  const syncToken = getQuickBooksRecordVersion(item) ?? ''
  if (!recordId || !syncToken) {
    throw new Error(`QuickBooks ${entity} response is missing Id or SyncToken`)
  }
  return {
    success: true,
    output: { record: item, recordId, syncToken, recordVersion: syncToken, time: parsed.time },
  }
}

export function sanitizeQuickBooksVendor(vendor: QuickBooksVendor): QuickBooksVendor {
  return omit(vendor, ['TaxIdentifier']) as QuickBooksVendor
}

export function sanitizeQuickBooksCustomer(customer: QuickBooksCustomer): QuickBooksCustomer {
  return omit(customer, ['TaxIdentifier']) as QuickBooksCustomer
}

export function sanitizeQuickBooksEmployee(employee: QuickBooksEmployee): QuickBooksEmployee {
  const id = typeof employee.Id === 'string' ? employee.Id.trim() : ''
  if (!id) throw new Error('QuickBooks Employee response is missing Id')

  const sanitized: QuickBooksEmployee = { Id: id }
  for (const key of [
    'SyncToken',
    'DisplayName',
    'GivenName',
    'MiddleName',
    'FamilyName',
    'Suffix',
    'Title',
    'PrintOnCheckName',
  ] as const) {
    const value = employee[key]
    if (typeof value === 'string') sanitized[key] = value
  }
  if (typeof employee.domain === 'string') sanitized.domain = employee.domain
  for (const key of ['Active', 'BillableTime', 'sparse'] as const) {
    const value = employee[key]
    if (typeof value === 'boolean') sanitized[key] = value
  }
  for (const key of ['PrimaryPhone', 'Mobile'] as const) {
    const value = employee[key]
    if (value && typeof value.FreeFormNumber === 'string') {
      sanitized[key] = { FreeFormNumber: value.FreeFormNumber }
    }
  }
  if (employee.PrimaryEmailAddr && typeof employee.PrimaryEmailAddr.Address === 'string') {
    sanitized.PrimaryEmailAddr = { Address: employee.PrimaryEmailAddr.Address }
  }
  if (employee.PrimaryAddr && typeof employee.PrimaryAddr === 'object') {
    const address: QuickBooksAddress = {}
    for (const key of [
      'Id',
      'Line1',
      'Line2',
      'Line3',
      'Line4',
      'Line5',
      'City',
      'Country',
      'CountrySubDivisionCode',
      'PostalCode',
      'Lat',
      'Long',
    ] as const) {
      const value = employee.PrimaryAddr[key]
      if (typeof value === 'string') address[key] = value
    }
    if (Object.keys(address).length > 0) sanitized.PrimaryAddr = address
  }
  if (employee.MetaData && typeof employee.MetaData === 'object') {
    sanitized.MetaData = {
      ...(typeof employee.MetaData.CreateTime === 'string'
        ? { CreateTime: employee.MetaData.CreateTime }
        : {}),
      ...(typeof employee.MetaData.LastUpdatedTime === 'string'
        ? { LastUpdatedTime: employee.MetaData.LastUpdatedTime }
        : {}),
    }
  }
  return sanitized
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
