import type { ToolResponse } from '@/tools/types'

const NUMERIC_ID_REGEX = /^\d+$/
const DATE_RANGE_VALUE_REGEX = /^(\d{4}-\d{2}-\d{2}|today|yesterday|\d+daysAgo)$/

/**
 * Normalizes a GA4 property reference to the `properties/{id}` resource name the
 * Data and Admin APIs expect. Accepts a bare numeric id or a `properties/123`
 * resource name.
 */
export function normalizePropertyName(value: string): string {
  const trimmed = String(value ?? '').trim()
  const id = trimmed.startsWith('properties/') ? trimmed.slice('properties/'.length) : trimmed
  if (!NUMERIC_ID_REGEX.test(id)) {
    throw new Error(
      `Property ID must be numeric (e.g. 123456789 or properties/123456789), got: ${value}`
    )
  }
  return `properties/${id}`
}

/**
 * Normalizes an account reference to the `accounts/{id}` resource name used by the
 * Admin API `filter` and `parent` fields.
 */
export function normalizeAccountName(value: string): string {
  const trimmed = String(value ?? '').trim()
  const id = trimmed.startsWith('accounts/') ? trimmed.slice('accounts/'.length) : trimmed
  if (!NUMERIC_ID_REGEX.test(id)) {
    throw new Error(
      `Account ID must be numeric (e.g. 12345678 or accounts/12345678), got: ${value}`
    )
  }
  return `accounts/${id}`
}

/** Validates a GA4 date-range bound: `YYYY-MM-DD`, `today`, `yesterday`, or `NdaysAgo`. */
export function validateDateRangeValue(value: string, fieldName: string): string {
  const trimmed = String(value ?? '').trim()
  if (!DATE_RANGE_VALUE_REGEX.test(trimmed)) {
    throw new Error(
      `${fieldName} must be YYYY-MM-DD, "today", "yesterday", or "NdaysAgo", got: ${value}`
    )
  }
  return trimmed
}

/**
 * Accepts either a comma/newline separated string or an array and returns a
 * de-duplicated list of trimmed, non-empty entries. Dimension and metric fields are
 * authored as free text in the block but arrive as arrays from an LLM.
 */
export function toNameList(value: string | string[] | undefined | null): string[] {
  if (value === undefined || value === null) return []
  const raw = Array.isArray(value) ? value : String(value).split(/[,\n]/)
  const seen = new Set<string>()
  for (const entry of raw) {
    const name = String(entry).trim()
    if (name) seen.add(name)
  }
  return [...seen]
}

/**
 * Parses an optional JSON object/array param. Non-string values pass through
 * untouched so both hand-written JSON strings and structured LLM output are accepted.
 */
export function parseJsonParam<T>(value: unknown, fieldName: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`${fieldName} must be valid JSON`)
  }
}

const METRIC_AGGREGATIONS = new Set(['TOTAL', 'MINIMUM', 'MAXIMUM', 'COUNT'])

/**
 * Normalizes a boolean-ish param. `switch` sub-blocks serialize as the strings
 * `'true'`/`'false'` and as `null` when never touched, so `Boolean(value)` would
 * read `'false'` as true. Returns `undefined` for anything unset so the request
 * omits the field and GA4's own default applies.
 */
export function toBooleanParam(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

/**
 * Normalizes an optional numeric param. An untouched sub-block resolves to `null`
 * and an emptied one to `''`; both are omissions, so `!== undefined` alone would
 * serialize the string `"null"` into a query string or a JSON null into a body.
 * An explicit `0` is meaningful and is preserved.
 */
export function toOptionalNumberParam(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Validates the `metricAggregations` list. Without at least one aggregation GA4
 * returns no `totals`, `maximums`, or `minimums` rows at all.
 */
export function toMetricAggregations(value: string | string[] | undefined | null): string[] {
  const names = toNameList(value).map((name) => name.toUpperCase())
  for (const name of names) {
    if (!METRIC_AGGREGATIONS.has(name)) {
      throw new Error(
        `Invalid metric aggregation: ${name}. Must be one of: ${[...METRIC_AGGREGATIONS].join(', ')}`
      )
    }
  }
  return names
}

/** Extracts the Google API error message from a failed response payload. */
export function extractGoogleApiError(data: unknown): string {
  const error = (data as { error?: { message?: string; status?: string } } | undefined)?.error
  return error?.message ?? error?.status ?? 'Unknown error'
}

interface RawDimensionHeader {
  name?: string
}

interface RawMetricHeader {
  name?: string
  type?: string
}

interface RawRow {
  dimensionValues?: Array<{ value?: string }>
  metricValues?: Array<{ value?: string }>
}

export interface GoogleAnalyticsMetricHeader {
  name: string
  type: string | null
}

export interface GoogleAnalyticsReportMetadata {
  currencyCode: string | null
  timeZone: string | null
  emptyReason: string | null
  dataLossFromOtherRow: boolean
  subjectToThresholding: boolean
}

/** A report row flattened to `{ [dimensionOrMetricApiName]: value }`. */
export type GoogleAnalyticsFlatRow = Record<string, string | null>

export function toDimensionHeaderNames(headers: RawDimensionHeader[] | undefined): string[] {
  return (headers ?? []).map((header, index) => header?.name ?? `dimension_${index}`)
}

export function toMetricHeaders(
  headers: RawMetricHeader[] | undefined
): GoogleAnalyticsMetricHeader[] {
  return (headers ?? []).map((header, index) => ({
    name: header?.name ?? `metric_${index}`,
    type: header?.type ?? null,
  }))
}

/**
 * Flattens GA4 `rows[]` — positional `dimensionValues`/`metricValues` arrays — into
 * objects keyed by the header API names, which is what downstream blocks consume.
 */
export function flattenRows(
  rows: RawRow[] | undefined,
  dimensionNames: string[],
  metricHeaders: GoogleAnalyticsMetricHeader[]
): GoogleAnalyticsFlatRow[] {
  return (rows ?? []).map((row) => {
    const flat: GoogleAnalyticsFlatRow = {}
    ;(row?.dimensionValues ?? []).forEach((cell, index) => {
      flat[dimensionNames[index] ?? `dimension_${index}`] = cell?.value ?? null
    })
    ;(row?.metricValues ?? []).forEach((cell, index) => {
      flat[metricHeaders[index]?.name ?? `metric_${index}`] = cell?.value ?? null
    })
    return flat
  })
}

/** Projects `metadata` into the subset of ResponseMetaData fields Sim surfaces. */
export function toReportMetadata(metadata: unknown): GoogleAnalyticsReportMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = metadata as {
    currencyCode?: string
    timeZone?: string
    emptyReason?: string
    dataLossFromOtherRow?: boolean
    subjectToThresholding?: boolean
  }
  return {
    currencyCode: raw.currencyCode ?? null,
    timeZone: raw.timeZone ?? null,
    emptyReason: raw.emptyReason ?? null,
    dataLossFromOtherRow: raw.dataLossFromOtherRow ?? false,
    subjectToThresholding: raw.subjectToThresholding ?? false,
  }
}

interface GoogleAnalyticsBaseParams {
  accessToken: string
}

export interface GoogleAnalyticsRunReportParams extends GoogleAnalyticsBaseParams {
  propertyId: string
  dimensions?: string | string[]
  metrics: string | string[]
  startDate?: string
  endDate?: string
  dateRanges?: string
  dimensionFilter?: string
  metricFilter?: string
  orderBys?: string
  metricAggregations?: string | string[]
  limit?: number
  offset?: number
  currencyCode?: string
  keepEmptyRows?: boolean
}

export interface GoogleAnalyticsRunReportResponse extends ToolResponse {
  output: {
    rows: GoogleAnalyticsFlatRow[]
    dimensionHeaders: string[]
    metricHeaders: GoogleAnalyticsMetricHeader[]
    totals: GoogleAnalyticsFlatRow[]
    maximums: GoogleAnalyticsFlatRow[]
    minimums: GoogleAnalyticsFlatRow[]
    rowCount: number
    metadata: GoogleAnalyticsReportMetadata | null
  }
}

export interface GoogleAnalyticsRunRealtimeReportParams extends GoogleAnalyticsBaseParams {
  propertyId: string
  dimensions?: string | string[]
  metrics: string | string[]
  dimensionFilter?: string
  metricFilter?: string
  orderBys?: string
  minuteRanges?: string
  metricAggregations?: string | string[]
  limit?: number
}

export interface GoogleAnalyticsRunRealtimeReportResponse extends ToolResponse {
  output: {
    rows: GoogleAnalyticsFlatRow[]
    dimensionHeaders: string[]
    metricHeaders: GoogleAnalyticsMetricHeader[]
    totals: GoogleAnalyticsFlatRow[]
    maximums: GoogleAnalyticsFlatRow[]
    minimums: GoogleAnalyticsFlatRow[]
    rowCount: number
  }
}

export interface GoogleAnalyticsRunPivotReportParams extends GoogleAnalyticsBaseParams {
  propertyId: string
  dimensions: string | string[]
  metrics: string | string[]
  pivots: string
  startDate?: string
  endDate?: string
  dateRanges?: string
  dimensionFilter?: string
  metricFilter?: string
  currencyCode?: string
  keepEmptyRows?: boolean
}

export interface GoogleAnalyticsPivotHeader {
  rowCount: number
  dimensionValues: string[][]
}

export interface GoogleAnalyticsRunPivotReportResponse extends ToolResponse {
  output: {
    rows: GoogleAnalyticsFlatRow[]
    dimensionHeaders: string[]
    metricHeaders: GoogleAnalyticsMetricHeader[]
    aggregates: GoogleAnalyticsFlatRow[]
    pivotHeaders: GoogleAnalyticsPivotHeader[]
    metadata: GoogleAnalyticsReportMetadata | null
  }
}

export interface GoogleAnalyticsCheckCompatibilityParams extends GoogleAnalyticsBaseParams {
  propertyId: string
  dimensions?: string | string[]
  metrics?: string | string[]
  compatibilityFilter?: string
}

export interface GoogleAnalyticsCompatibilityEntry {
  apiName: string
  uiName: string | null
  compatibility: string | null
}

export interface GoogleAnalyticsCheckCompatibilityResponse extends ToolResponse {
  output: {
    dimensionCompatibilities: GoogleAnalyticsCompatibilityEntry[]
    metricCompatibilities: GoogleAnalyticsCompatibilityEntry[]
    incompatible: string[]
  }
}

export interface GoogleAnalyticsGetMetadataParams extends GoogleAnalyticsBaseParams {
  propertyId?: string
  customOnly?: boolean
}

interface GoogleAnalyticsMetadataFieldBase {
  apiName: string
  uiName: string | null
  description: string | null
  category: string | null
  customDefinition: boolean
  deprecatedApiNames: string[]
}

/**
 * `DimensionMetadata` carries no value-type field — unlike `MetricMetadata`, which
 * has `type`. Dimensions are always string-valued, so there is nothing to report.
 */
export type GoogleAnalyticsDimensionMetadata = GoogleAnalyticsMetadataFieldBase

export interface GoogleAnalyticsMetricMetadata extends GoogleAnalyticsMetadataFieldBase {
  type: string | null
  expression: string | null
}

export interface GoogleAnalyticsGetMetadataResponse extends ToolResponse {
  output: {
    name: string | null
    dimensions: GoogleAnalyticsDimensionMetadata[]
    metrics: GoogleAnalyticsMetricMetadata[]
    totalDimensions: number
    totalMetrics: number
  }
}

export interface GoogleAnalyticsAccount {
  name: string
  displayName: string | null
  regionCode: string | null
  createTime: string | null
  updateTime: string | null
  deleted: boolean
  gmpOrganization: string | null
}

export interface GoogleAnalyticsListAccountsParams extends GoogleAnalyticsBaseParams {
  pageSize?: number
  pageToken?: string
  showDeleted?: boolean
}

export interface GoogleAnalyticsListAccountsResponse extends ToolResponse {
  output: {
    accounts: GoogleAnalyticsAccount[]
    totalCount: number
    nextPageToken: string | null
  }
}

export interface GoogleAnalyticsPropertySummary {
  property: string
  displayName: string | null
  propertyType: string | null
  parent: string | null
}

export interface GoogleAnalyticsAccountSummary {
  name: string
  account: string | null
  displayName: string | null
  propertySummaries: GoogleAnalyticsPropertySummary[]
}

export interface GoogleAnalyticsListAccountSummariesParams extends GoogleAnalyticsBaseParams {
  pageSize?: number
  pageToken?: string
}

export interface GoogleAnalyticsListAccountSummariesResponse extends ToolResponse {
  output: {
    accountSummaries: GoogleAnalyticsAccountSummary[]
    properties: GoogleAnalyticsPropertySummary[]
    totalCount: number
    nextPageToken: string | null
  }
}

export interface GoogleAnalyticsProperty {
  name: string
  displayName: string | null
  propertyType: string | null
  parent: string | null
  account: string | null
  industryCategory: string | null
  timeZone: string | null
  currencyCode: string | null
  serviceLevel: string | null
  createTime: string | null
  updateTime: string | null
  deleteTime: string | null
  expireTime: string | null
}

export interface GoogleAnalyticsListPropertiesParams extends GoogleAnalyticsBaseParams {
  accountId: string
  pageSize?: number
  pageToken?: string
  showDeleted?: boolean
}

export interface GoogleAnalyticsListPropertiesResponse extends ToolResponse {
  output: {
    properties: GoogleAnalyticsProperty[]
    totalCount: number
    nextPageToken: string | null
  }
}

export interface GoogleAnalyticsGetPropertyParams extends GoogleAnalyticsBaseParams {
  propertyId: string
}

export interface GoogleAnalyticsGetPropertyResponse extends ToolResponse {
  output: {
    property: GoogleAnalyticsProperty | null
  }
}

export interface GoogleAnalyticsDataStream {
  name: string
  displayName: string | null
  type: string | null
  createTime: string | null
  updateTime: string | null
  measurementId: string | null
  defaultUri: string | null
  firebaseAppId: string | null
  packageName: string | null
  bundleId: string | null
}

export interface GoogleAnalyticsListDataStreamsParams extends GoogleAnalyticsBaseParams {
  propertyId: string
  pageSize?: number
  pageToken?: string
}

export interface GoogleAnalyticsListDataStreamsResponse extends ToolResponse {
  output: {
    dataStreams: GoogleAnalyticsDataStream[]
    totalCount: number
    nextPageToken: string | null
  }
}

/** Maps a raw Admin API Property resource onto Sim's flat property shape. */
export function toProperty(
  raw: Record<string, unknown> | undefined
): GoogleAnalyticsProperty | null {
  if (!raw) return null
  return {
    name: (raw.name as string) ?? '',
    displayName: (raw.displayName as string) ?? null,
    propertyType: (raw.propertyType as string) ?? null,
    parent: (raw.parent as string) ?? null,
    account: (raw.account as string) ?? null,
    industryCategory: (raw.industryCategory as string) ?? null,
    timeZone: (raw.timeZone as string) ?? null,
    currencyCode: (raw.currencyCode as string) ?? null,
    serviceLevel: (raw.serviceLevel as string) ?? null,
    createTime: (raw.createTime as string) ?? null,
    updateTime: (raw.updateTime as string) ?? null,
    deleteTime: (raw.deleteTime as string) ?? null,
    expireTime: (raw.expireTime as string) ?? null,
  }
}
