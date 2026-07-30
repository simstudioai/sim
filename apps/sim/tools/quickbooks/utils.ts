import { truncate } from '@sim/utils/string'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { normalizeQuickBooksAccessToken } from '@/lib/oauth/quickbooks-token'
import type {
  QuickBooksApiEnvelope,
  QuickBooksAttachmentEntityName,
  QuickBooksEntityName,
  QuickBooksEnvironment,
  QuickBooksFault,
  QuickBooksPdfEntityName,
  QuickBooksRecord,
  QuickBooksReportName,
  QuickBooksSendableEntityName,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_ATTACHMENT_ENTITIES,
  QUICKBOOKS_CDC_ENTITIES,
  QUICKBOOKS_CREATABLE_ENTITIES,
  QUICKBOOKS_DELETABLE_ENTITIES,
  QUICKBOOKS_PDF_ENTITIES,
  QUICKBOOKS_QUERYABLE_ENTITIES,
  QUICKBOOKS_READABLE_ENTITIES,
  QUICKBOOKS_REPORTS,
  QUICKBOOKS_SENDABLE_ENTITIES,
  QUICKBOOKS_SIMPLIFIED_DELETE_ENTITIES,
  QUICKBOOKS_UPDATABLE_ENTITIES,
} from '@/tools/quickbooks/types'

export const QUICKBOOKS_API_BASES: Record<QuickBooksEnvironment, string> = {
  production: 'https://quickbooks.api.intuit.com',
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
}
export const QUICKBOOKS_MINOR_VERSION = '75'

const QUICKBOOKS_MAX_RESULTS_LIMIT = 1000
const QUICKBOOKS_MAX_BATCH_ITEMS = 10
const QUICKBOOKS_MAX_CDC_RESULTS = 1000
const QUICKBOOKS_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const QUICKBOOKS_CDC_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const QUICKBOOKS_CLOCK_SKEW_MS = 5 * 60 * 1000
const QUICKBOOKS_ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/
const QUICKBOOKS_METADATA_KEYS = new Set(['startPosition', 'maxResults', 'totalCount'])
const QUICKBOOKS_RESOURCE_NAMES: Record<QuickBooksEntityName, string> = {
  Account: 'account',
  Attachable: 'attachable',
  Bill: 'bill',
  BillPayment: 'billpayment',
  Budget: 'budget',
  Class: 'class',
  CompanyCurrency: 'companycurrency',
  CompanyInfo: 'companyinfo',
  CreditCardPayment: 'creditcardpayment',
  CreditMemo: 'creditmemo',
  Customer: 'customer',
  Department: 'department',
  Deposit: 'deposit',
  Employee: 'employee',
  Estimate: 'estimate',
  Invoice: 'invoice',
  InventoryAdjustment: 'inventoryadjustment',
  Item: 'item',
  JournalCode: 'journalcode',
  JournalEntry: 'journalentry',
  Payment: 'payment',
  PaymentMethod: 'paymentmethod',
  Purchase: 'purchase',
  PurchaseOrder: 'purchaseorder',
  RecurringTransaction: 'recurringtransaction',
  RefundReceipt: 'refundreceipt',
  SalesReceipt: 'salesreceipt',
  TaxAgency: 'taxagency',
  TaxCode: 'taxcode',
  TaxPayment: 'taxpayment',
  TaxRate: 'taxrate',
  Term: 'term',
  TimeActivity: 'timeactivity',
  Transfer: 'transfer',
  Vendor: 'vendor',
  VendorCredit: 'vendorcredit',
}

export function buildQuickBooksHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${normalizeQuickBooksAccessToken(accessToken)}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

export function assertQuickBooksPdfResponse(
  response: Response,
  buffer: Buffer,
  label: string
): void {
  const header = buffer.subarray(0, Math.min(buffer.length, 1024))
  if (header.indexOf(Buffer.from('%PDF-')) >= 0) return

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
  const detail = truncate(buffer.toString('utf8').trim(), 500)
  const contentTypeDetail = contentType ? ` (${contentType})` : ''
  throw new Error(
    `QuickBooks ${label} returned a non-PDF response${contentTypeDetail}: ${detail || 'Empty response'}`
  )
}

export function buildQuickBooksQueryEndpoint(params: {
  realmId: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): string {
  const realmId = params.realmId.trim()
  if (!realmId) {
    throw new Error('QuickBooks Company ID is required')
  }

  const url = new URL(
    `${getQuickBooksApiBase(params.apiEnvironment)}/v3/company/${encodeURIComponent(realmId)}/query`
  )
  url.searchParams.set('minorversion', normalizeMinorVersion(params.minorVersion))
  return url.toString()
}

export function buildQuickBooksQueryUrl(params: {
  realmId: string
  query: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): string {
  const url = new URL(buildQuickBooksQueryEndpoint(params))
  url.searchParams.set('query', normalizeQuickBooksQuery(params.query))
  return url.toString()
}

export function buildQuickBooksListRecordsQuery(params: {
  entity: QuickBooksEntityName | string
  whereClause?: string
  orderBy?: string
  startPosition?: string
  maxResults?: string
}): { entity: QuickBooksEntityName; query: string } {
  const entity = normalizeQuickBooksEntity(params.entity, QUICKBOOKS_QUERYABLE_ENTITIES, 'queried')
  const clauses = [`SELECT * FROM ${entity}`]
  const whereClause = params.whereClause?.trim()
  if (whereClause) clauses.push(`WHERE ${whereClause}`)
  const orderBy = params.orderBy?.trim()
  if (orderBy) clauses.push(`ORDERBY ${orderBy}`)
  appendPagination(clauses, params)
  return { entity, query: clauses.join(' ') }
}

export function buildQuickBooksRecordUrl(params: {
  realmId: string
  entity: QuickBooksEntityName | string
  operation: 'read' | 'create' | 'update' | 'delete'
  recordId?: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): { entity: QuickBooksEntityName; url: string } {
  const supportedEntities =
    params.operation === 'read'
      ? QUICKBOOKS_READABLE_ENTITIES
      : params.operation === 'create'
        ? QUICKBOOKS_CREATABLE_ENTITIES
        : params.operation === 'update'
          ? QUICKBOOKS_UPDATABLE_ENTITIES
          : QUICKBOOKS_DELETABLE_ENTITIES
  const operationLabel = {
    read: 'read',
    create: 'created',
    update: 'updated',
    delete: 'deleted',
  }[params.operation]
  const entity = normalizeQuickBooksEntity(params.entity, supportedEntities, operationLabel)
  const resource = QUICKBOOKS_RESOURCE_NAMES[entity]
  const url = buildQuickBooksCompanyUrl(params.realmId, resource, params)

  if (params.operation === 'read') {
    const recordId = normalizeRequiredString(params.recordId, 'QuickBooks record ID')
    url.pathname = `${url.pathname}/${encodeURIComponent(recordId)}`
  }
  if (params.operation === 'delete') {
    url.searchParams.set('operation', 'delete')
  }

  return { entity, url: url.toString() }
}

export function buildQuickBooksCreateBody(payload: QuickBooksRecord | string): QuickBooksRecord {
  return normalizeQuickBooksPayload(payload, 'QuickBooks record payload')
}

export function buildQuickBooksUpdateBody(params: {
  entity: QuickBooksEntityName | string
  payload: QuickBooksRecord | string
  recordId: string
  syncToken: string
  sparse?: boolean | string
}): QuickBooksRecord {
  const entity = normalizeQuickBooksEntity(params.entity, QUICKBOOKS_UPDATABLE_ENTITIES, 'updated')
  return {
    ...normalizeQuickBooksPayload(params.payload, 'QuickBooks record payload'),
    Id: normalizeRequiredString(params.recordId, 'QuickBooks record ID'),
    SyncToken: normalizeRequiredString(params.syncToken, 'QuickBooks sync token'),
    sparse: entity === 'InventoryAdjustment' ? true : toBoolean(params.sparse, true),
  }
}

export function buildQuickBooksDeleteBody(params: {
  entity: QuickBooksEntityName | string
  recordId: string
  syncToken: string
  payload?: QuickBooksRecord | string
}): QuickBooksRecord {
  const entity = normalizeQuickBooksEntity(params.entity, QUICKBOOKS_DELETABLE_ENTITIES, 'deleted')
  if (!QUICKBOOKS_SIMPLIFIED_DELETE_ENTITIES.some((candidate) => candidate === entity)) {
    const payload = normalizeOptionalQuickBooksPayload(params.payload, 'QuickBooks delete payload')
    if (Object.keys(payload).length === 0) {
      throw new Error(`QuickBooks ${entity} deletion requires the full entity payload`)
    }
    return {
      ...payload,
      Id: normalizeRequiredString(params.recordId, 'QuickBooks record ID'),
      SyncToken: normalizeRequiredString(params.syncToken, 'QuickBooks sync token'),
    }
  }
  return {
    Id: normalizeRequiredString(params.recordId, 'QuickBooks record ID'),
    SyncToken: normalizeRequiredString(params.syncToken, 'QuickBooks sync token'),
  }
}

export function buildQuickBooksPreferencesUrl(params: {
  realmId: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): string {
  return buildQuickBooksCompanyUrl(params.realmId, 'preferences', params).toString()
}

export function buildQuickBooksPreferencesBody(
  payload: QuickBooksRecord | string
): QuickBooksRecord {
  return normalizeQuickBooksPayload(payload, 'QuickBooks preferences payload')
}

export function buildQuickBooksExchangeRateUrl(params: {
  realmId: string
  sourceCurrencyCode?: string
  asOfDate?: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): string {
  const url = buildQuickBooksCompanyUrl(params.realmId, 'exchangerate', params)
  const sourceCurrencyCode = normalizeRequiredString(
    params.sourceCurrencyCode,
    'Source currency code'
  ).toUpperCase()
  if (!/^[A-Z]{3}$/.test(sourceCurrencyCode)) {
    throw new Error('Source currency code must be a three-letter ISO 4217 code')
  }
  url.searchParams.set('sourcecurrencycode', sourceCurrencyCode)
  if (params.asOfDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.asOfDate)) {
      throw new Error('Exchange rate date must use YYYY-MM-DD format')
    }
    url.searchParams.set('asofdate', params.asOfDate)
  }
  return url.toString()
}

export function buildQuickBooksExchangeRateUpdateUrl(params: {
  realmId: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): string {
  return buildQuickBooksCompanyUrl(params.realmId, 'exchangerate', params).toString()
}

export function buildQuickBooksExchangeRateBody(
  payload: QuickBooksRecord | string | undefined
): QuickBooksRecord {
  return normalizeQuickBooksPayload(payload ?? '', 'QuickBooks exchange rate payload')
}

export function buildQuickBooksDocumentUrl(params: {
  realmId: string
  entity: QuickBooksPdfEntityName | string
  recordId: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): { entity: QuickBooksPdfEntityName; url: string } {
  const entity = normalizeQuickBooksPdfEntity(params.entity)
  const recordId = normalizeRequiredString(params.recordId, 'QuickBooks record ID')
  const resource = QUICKBOOKS_RESOURCE_NAMES[entity]
  const url = buildQuickBooksCompanyUrl(
    params.realmId,
    `${resource}/${encodeURIComponent(recordId)}/pdf`,
    params
  )
  return { entity, url: url.toString() }
}

export function buildQuickBooksSendDocumentUrl(params: {
  realmId: string
  entity: QuickBooksSendableEntityName | string
  recordId: string
  sendTo?: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): { entity: QuickBooksSendableEntityName; url: string } {
  const entity = normalizeQuickBooksSendableEntity(params.entity)
  const recordId = normalizeRequiredString(params.recordId, 'QuickBooks record ID')
  const resource = QUICKBOOKS_RESOURCE_NAMES[entity]
  const url = buildQuickBooksCompanyUrl(
    params.realmId,
    `${resource}/${encodeURIComponent(recordId)}/send`,
    params
  )
  const sendTo = params.sendTo?.trim()
  if (sendTo) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sendTo)) {
      throw new Error('QuickBooks recipient must be a valid email address')
    }
    url.searchParams.set('sendTo', sendTo)
  }
  return { entity, url: url.toString() }
}

export function buildQuickBooksAttachmentUrl(params: {
  realmId: string
  attachmentId: string
  thumbnail?: boolean | string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): { thumbnail: boolean; url: string } {
  const attachmentId = normalizeRequiredString(params.attachmentId, 'QuickBooks attachment ID')
  const thumbnail = toBoolean(params.thumbnail)
  const resource = thumbnail ? 'attachable-thumbnail' : 'download'
  return {
    thumbnail,
    url: buildQuickBooksCompanyUrl(
      params.realmId,
      `${resource}/${encodeURIComponent(attachmentId)}`,
      params
    ).toString(),
  }
}

export function buildQuickBooksUploadUrl(params: {
  realmId: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): string {
  return buildQuickBooksCompanyUrl(params.realmId, 'upload', params).toString()
}

export function buildQuickBooksReportUrl(params: {
  realmId: string
  report: QuickBooksReportName | string
  reportParams?: QuickBooksRecord | string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): { report: QuickBooksReportName; url: string } {
  const report = normalizeQuickBooksReport(params.report)
  const url = buildQuickBooksCompanyUrl(params.realmId, `reports/${report}`, params)
  const reportParams = normalizeOptionalQuickBooksPayload(
    params.reportParams,
    'QuickBooks report parameters'
  )

  for (const [key, value] of Object.entries(reportParams)) {
    if (value == null || value === '') continue
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`QuickBooks report parameter "${key}" must be a scalar value`)
    }
    url.searchParams.set(key, String(value))
  }

  return { report, url: url.toString() }
}

export function buildQuickBooksCdcUrl(params: {
  realmId: string
  entities: QuickBooksEntityName[] | string
  changedSince: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): string {
  const rawEntities = Array.isArray(params.entities) ? params.entities : params.entities.split(',')
  const entities = rawEntities
    .map((entity) => entity.trim())
    .filter(Boolean)
    .map((entity) => normalizeQuickBooksEntity(entity, QUICKBOOKS_CDC_ENTITIES, 'tracked by CDC'))
  if (entities.length === 0) {
    throw new Error('At least one QuickBooks CDC entity is required')
  }
  const changedSince = normalizeRequiredString(params.changedSince, 'Changed since')
  validateQuickBooksCdcDate(changedSince)

  const url = buildQuickBooksCompanyUrl(params.realmId, 'cdc', params)
  url.searchParams.set('entities', [...new Set(entities)].join(','))
  url.searchParams.set('changedSince', changedSince)
  return url.toString()
}

export function buildQuickBooksBatchBody(batch: QuickBooksRecord | string): QuickBooksRecord {
  const payload = normalizeQuickBooksPayload(batch, 'QuickBooks batch payload')
  const items = payload.BatchItemRequest
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('QuickBooks batch payload must contain a non-empty BatchItemRequest array')
  }
  if (items.length > QUICKBOOKS_MAX_BATCH_ITEMS) {
    throw new Error(
      `QuickBooks batch payload must contain ${QUICKBOOKS_MAX_BATCH_ITEMS} items or less`
    )
  }
  return payload
}

export function buildQuickBooksBatchUrl(params: {
  realmId: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}): string {
  return buildQuickBooksCompanyUrl(params.realmId, 'batch', params).toString()
}

export function getQuickBooksApiBase(environment?: QuickBooksEnvironment | string): string {
  const normalized = environment?.trim() || 'production'
  if (normalized === 'production' || normalized === 'sandbox') {
    return QUICKBOOKS_API_BASES[normalized]
  }
  throw new Error('QuickBooks environment must be production or sandbox')
}

export function normalizeQuickBooksQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error('QuickBooks query is required')
  }
  return trimmed
}

export function buildQuickBooksListQuery(
  entity: QuickBooksEntityName,
  params: { startPosition?: string; maxResults?: string; activeOnly?: boolean | string }
): string {
  const clauses = [`SELECT * FROM ${entity}`]

  if (entity === 'Vendor' && toBoolean(params.activeOnly)) {
    clauses.push('WHERE Active = true')
  }

  appendPagination(clauses, params)

  return clauses.join(' ')
}

export async function parseQuickBooksJson(response: Response): Promise<QuickBooksApiEnvelope> {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
    label: 'QuickBooks API response',
  })
  let data: QuickBooksApiEnvelope = {}

  if (text.trim()) {
    try {
      data = JSON.parse(text) as QuickBooksApiEnvelope
    } catch {
      throw new Error(
        `QuickBooks API error (${response.status}): ${truncate(text.trim(), 500) || 'Invalid JSON response'}`
      )
    }
  }

  const faultMessage = extractQuickBooksError(data)
  if (!response.ok || faultMessage) {
    throw new Error(
      `QuickBooks API error (${response.status}): ${
        faultMessage || response.statusText || 'Request failed'
      }`
    )
  }

  return data
}

export function assertQuickBooksAttachmentUploadResponse(
  data: QuickBooksApiEnvelope
): QuickBooksApiEnvelope {
  const uploaded = data.AttachableResponse?.some((item) => hasQuickBooksRecordId(item.Attachable))
  if (!uploaded) {
    throw new Error('QuickBooks attachment upload returned no attachment')
  }
  return data
}

export function normalizeQuickBooksAttachmentEntity(value: string): QuickBooksAttachmentEntityName {
  return normalizeQuickBooksEntity(value, QUICKBOOKS_ATTACHMENT_ENTITIES, 'linked to an attachment')
}

export function extractQuickBooksRecords(
  data: QuickBooksApiEnvelope,
  preferredEntity?: QuickBooksEntityName
): { entity: string | null; items: QuickBooksRecord[] } {
  const queryResponse = data.QueryResponse ?? {}

  if (preferredEntity) {
    const records = queryResponse[preferredEntity]
    return {
      entity: preferredEntity,
      items: Array.isArray(records) ? normalizeRecords(records) : [],
    }
  }

  const entity = Object.keys(queryResponse).find((key) => {
    return !QUICKBOOKS_METADATA_KEYS.has(key) && Array.isArray(queryResponse[key])
  })

  if (!entity) {
    return { entity: null, items: [] }
  }

  return { entity, items: normalizeRecords(queryResponse[entity]) }
}

export function getQuickBooksQueryMetadata(data: QuickBooksApiEnvelope): {
  totalCount: number | null
  startPosition: number | null
  maxResults: number | null
} {
  const queryResponse = data.QueryResponse ?? {}
  return {
    totalCount: typeof queryResponse.totalCount === 'number' ? queryResponse.totalCount : null,
    startPosition:
      typeof queryResponse.startPosition === 'number' ? queryResponse.startPosition : null,
    maxResults: typeof queryResponse.maxResults === 'number' ? queryResponse.maxResults : null,
  }
}

export function extractQuickBooksRecord(
  data: QuickBooksApiEnvelope,
  entity: string
): QuickBooksRecord {
  const record = data[entity]
  const requiresId = entity !== 'Preferences' && entity !== 'ExchangeRate'
  if (!isNonEmptyQuickBooksRecord(record) || (requiresId && !hasQuickBooksRecordId(record))) {
    throw new Error(`QuickBooks API response did not include ${entity}`)
  }
  return record
}

export function extractQuickBooksCdcChanges(data: QuickBooksApiEnvelope): QuickBooksRecord[] {
  const changes: QuickBooksRecord[] = []
  for (const cdcResponse of data.CDCResponse ?? []) {
    for (const queryResponse of cdcResponse.QueryResponse ?? []) {
      for (const [entity, records] of Object.entries(queryResponse)) {
        if (QUICKBOOKS_METADATA_KEYS.has(entity) || !Array.isArray(records)) continue
        changes.push({
          entity,
          records: normalizeRecords(records),
          startPosition:
            typeof queryResponse.startPosition === 'number' ? queryResponse.startPosition : null,
          maxResults:
            typeof queryResponse.maxResults === 'number' ? queryResponse.maxResults : null,
          totalCount:
            typeof queryResponse.totalCount === 'number' ? queryResponse.totalCount : null,
        })
      }
    }
  }
  return changes
}

export function quickBooksCdcMayBeTruncated(changes: QuickBooksRecord[]): boolean {
  return (
    changes.reduce((count, change) => {
      return count + (Array.isArray(change.records) ? change.records.length : 0)
    }, 0) >= QUICKBOOKS_MAX_CDC_RESULTS
  )
}

function normalizeMinorVersion(value?: string): string {
  const trimmed = value?.trim()
  return trimmed || QUICKBOOKS_MINOR_VERSION
}

function buildQuickBooksCompanyUrl(
  realmIdValue: string,
  resourcePath: string,
  params: {
    apiEnvironment?: QuickBooksEnvironment | string
    minorVersion?: string
  }
): URL {
  const realmId = normalizeRequiredString(realmIdValue, 'QuickBooks Company ID')
  const url = new URL(
    `${getQuickBooksApiBase(params.apiEnvironment)}/v3/company/${encodeURIComponent(realmId)}/${resourcePath}`
  )
  url.searchParams.set('minorversion', normalizeMinorVersion(params.minorVersion))
  return url
}

function normalizeQuickBooksEntity<T extends QuickBooksEntityName>(
  value: string,
  supportedEntities: readonly T[],
  operation: string
): T {
  const normalized = value.trim().toLowerCase()
  const entity = supportedEntities.find((candidate) => {
    return (
      candidate.toLowerCase() === normalized ||
      QUICKBOOKS_RESOURCE_NAMES[candidate].toLowerCase() === normalized
    )
  })
  if (!entity) {
    throw new Error(`QuickBooks entity "${value.trim()}" cannot be ${operation}`)
  }
  return entity
}

function normalizeQuickBooksReport(value: string): QuickBooksReportName {
  const normalized = value.trim().toLowerCase()
  const report = QUICKBOOKS_REPORTS.find((candidate) => candidate.toLowerCase() === normalized)
  if (!report) {
    throw new Error(`Unsupported QuickBooks report "${value.trim()}"`)
  }
  return report
}

function normalizeQuickBooksPdfEntity(value: string): QuickBooksPdfEntityName {
  const normalized = value.trim().toLowerCase()
  const entity = QUICKBOOKS_PDF_ENTITIES.find((candidate) => candidate.toLowerCase() === normalized)
  if (!entity) {
    throw new Error(`QuickBooks entity "${value.trim()}" does not support PDF download`)
  }
  return entity
}

function normalizeQuickBooksSendableEntity(value: string): QuickBooksSendableEntityName {
  const normalized = value.trim().toLowerCase()
  const entity = QUICKBOOKS_SENDABLE_ENTITIES.find(
    (candidate) => candidate.toLowerCase() === normalized
  )
  if (!entity) {
    throw new Error(`QuickBooks entity "${value.trim()}" does not support email delivery`)
  }
  return entity
}

function normalizeRequiredString(value: string | undefined, fieldLabel: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required`)
  }
  return trimmed
}

function validateQuickBooksCdcDate(value: string): void {
  if (!QUICKBOOKS_ISO_DATE_PATTERN.test(value)) {
    throw new Error('Changed since must be an ISO date or date-time')
  }
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    throw new Error('Changed since must be an ISO date or date-time')
  }
  const now = Date.now()
  if (timestamp > now + QUICKBOOKS_CLOCK_SKEW_MS) {
    throw new Error('Changed since cannot be in the future')
  }
  if (timestamp < now - QUICKBOOKS_CDC_LOOKBACK_MS) {
    throw new Error('Changed since must be within the last 30 days')
  }
}

function normalizeQuickBooksPayload(
  value: QuickBooksRecord | string,
  fieldLabel: string
): QuickBooksRecord {
  const payload =
    typeof value === 'string' ? parseQuickBooksPayloadString(value, fieldLabel) : value
  if (!isQuickBooksRecord(payload)) {
    throw new Error(`${fieldLabel} must be a JSON object`)
  }
  return payload
}

function normalizeOptionalQuickBooksPayload(
  value: QuickBooksRecord | string | undefined,
  fieldLabel: string
): QuickBooksRecord {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return {}
  return normalizeQuickBooksPayload(value, fieldLabel)
}

function parseQuickBooksPayloadString(value: string, fieldLabel: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${fieldLabel} must be valid JSON`)
  }
}

function appendPagination(
  clauses: string[],
  params: { startPosition?: string; maxResults?: string }
): void {
  const startPosition = normalizePositiveInteger(params.startPosition, 'Start position')
  if (startPosition) clauses.push(`STARTPOSITION ${startPosition}`)

  const maxResults = normalizePositiveInteger(
    params.maxResults,
    'Max results',
    QUICKBOOKS_MAX_RESULTS_LIMIT
  )
  if (maxResults) clauses.push(`MAXRESULTS ${maxResults}`)
}

function normalizePositiveInteger(
  value: string | undefined,
  fieldLabel: string,
  max?: number
): string | null {
  if (value == null || value.trim() === '') return null

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldLabel} must be a positive integer`)
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`${fieldLabel} must be ${max} or less`)
  }

  return String(parsed)
}

function toBoolean(value: boolean | string | undefined, defaultValue = false): boolean {
  if (typeof value === 'boolean') return value
  if (!value) return defaultValue
  return value.toLowerCase() === 'true'
}

function normalizeRecords(value: unknown): QuickBooksRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is QuickBooksRecord => {
    return item != null && typeof item === 'object' && !Array.isArray(item)
  })
}

function isQuickBooksRecord(value: unknown): value is QuickBooksRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyQuickBooksRecord(value: unknown): value is QuickBooksRecord {
  return isQuickBooksRecord(value) && Object.keys(value).length > 0
}

function hasQuickBooksRecordId(value: unknown): value is QuickBooksRecord {
  return isQuickBooksRecord(value) && typeof value.Id === 'string' && value.Id.trim().length > 0
}

function extractQuickBooksError(data: QuickBooksApiEnvelope): string | null {
  const errors = [
    ...extractFaultErrors(data.Fault),
    ...extractFaultErrors(data.QueryResponse?.Fault),
    ...(data.AttachableResponse ?? []).flatMap((item) => extractFaultErrors(item.Fault)),
  ]
  const message = errors
    .map((error) => error.Detail || error.Message || error.code)
    .filter(Boolean)
    .join('; ')
  return message || null
}

function extractFaultErrors(
  fault: QuickBooksFault | undefined
): NonNullable<QuickBooksFault['Error']> {
  return Array.isArray(fault?.Error) ? fault.Error : []
}
