import type { ToolResponse } from '@/tools/types'

const NUMERIC_ID_REGEX = /^\d+$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const VALID_STATUSES = new Set(['ENABLED', 'PAUSED', 'REMOVED'])
const VALID_DATE_RANGES = new Set([
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_14_DAYS',
  'LAST_30_DAYS',
  'LAST_BUSINESS_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_WEEK_SUN_TODAY',
  'THIS_WEEK_MON_TODAY',
  'LAST_WEEK_SUN_SAT',
  'LAST_WEEK_MON_SUN',
])

/** Validates that a value is a numeric ID (digits only). */
export function validateNumericId(value: string, fieldName: string): string {
  const cleaned = value.trim().replace(/-/g, '')
  if (!NUMERIC_ID_REGEX.test(cleaned)) {
    throw new Error(`${fieldName} must be numeric (digits only), got: ${value}`)
  }
  return cleaned
}

/** Validates that a status value is a known Google Ads status. */
export function validateStatus(value: string): string {
  if (!VALID_STATUSES.has(value)) {
    throw new Error(`Invalid status: ${value}. Must be one of: ${[...VALID_STATUSES].join(', ')}`)
  }
  return value
}

/** Validates a date string is in YYYY-MM-DD format. */
function validateDate(value: string, fieldName: string): string {
  if (
    !DATE_REGEX.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format, got: ${value}`)
  }
  return value
}

/** Validates a date range is a known Google Ads predefined range. */
function validateDateRange(value: string): string {
  if (!VALID_DATE_RANGES.has(value)) {
    throw new Error(
      `Invalid date range: ${value}. Must be one of: ${[...VALID_DATE_RANGES].join(', ')}`
    )
  }
  return value
}

/** Builds a GAQL date predicate without silently discarding incomplete custom bounds. */
export function buildDateCondition(params: {
  startDate?: string
  endDate?: string
  dateRange?: string
}): string {
  if (params.startDate || params.endDate) {
    if (!params.startDate || !params.endDate)
      throw new Error('Custom dates require both startDate and endDate')
    const start = validateDate(params.startDate, 'startDate')
    const end = validateDate(params.endDate, 'endDate')
    if (start > end) throw new Error('startDate must not be after endDate')
    return `segments.date BETWEEN '${start}' AND '${end}'`
  }
  return `segments.date DURING ${validateDateRange(params.dateRange || 'LAST_30_DAYS')}`
}

/** GAQL LIMIT accepts positive integers; invalid limits must not become unbounded queries. */
export function validateLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('limit must be a positive safe integer')
  return value
}

/** Selected fields from the documented GoogleAdsRow JSON mapping (int64 values are strings). */
interface GoogleAdsRow {
  campaign?: {
    id?: string
    name?: string
    status?: string
    advertisingChannelType?: string
    startDateTime?: string
    endDateTime?: string
  }
  campaignBudget?: { amountMicros?: string }
  adGroup?: { id?: string; name?: string; status?: string; type?: string }
  adGroupAd?: { ad?: { id?: string; type?: string } }
  metrics?: {
    impressions?: string
    clicks?: string
    costMicros?: string
    ctr?: number
    conversions?: number
  }
  segments?: { date?: string }
}

export interface GoogleAdsApiResponse<T = GoogleAdsRow> {
  results?: T[]
  resourceNames?: string[]
  nextPageToken?: string
  totalResultsCount?: string
  error?: { message?: string; details?: { errors?: { message?: string }[] }[] }
}

interface GoogleAdsBaseParams {
  accessToken: string
  customerId: string
  managerCustomerId?: string
  pageToken?: string
}

export interface GoogleAdsListCustomersParams {
  accessToken: string
}

export interface GoogleAdsSearchParams extends GoogleAdsBaseParams {
  query: string
}

export interface GoogleAdsListCampaignsParams extends GoogleAdsBaseParams {
  status?: string
  limit?: number
}

export interface GoogleAdsCampaignPerformanceParams extends GoogleAdsBaseParams {
  campaignId?: string
  dateRange?: string
  startDate?: string
  endDate?: string
}

export interface GoogleAdsListAdGroupsParams extends GoogleAdsBaseParams {
  campaignId: string
  status?: string
  limit?: number
}

export interface GoogleAdsAdPerformanceParams extends GoogleAdsBaseParams {
  campaignId?: string
  adGroupId?: string
  dateRange?: string
  startDate?: string
  endDate?: string
  limit?: number
}

export interface GoogleAdsListCustomersResponse extends ToolResponse {
  output: {
    customerIds: string[]
    totalCount: number
  }
}

export interface GoogleAdsSearchResponse extends ToolResponse {
  output: {
    results: Record<string, unknown>[]
    totalResultsCount: number | null
    nextPageToken: string | null
  }
}

interface GoogleAdsCampaign {
  id: string
  name: string
  status: string
  channelType: string | null
  startDate: string | null
  endDate: string | null
  budgetAmountMicros: string | null
}

export interface GoogleAdsListCampaignsResponse extends ToolResponse {
  output: {
    campaigns: GoogleAdsCampaign[]
    totalCount: number
    nextPageToken: string | null
  }
}

interface GoogleAdsCampaignPerformance {
  id: string
  name: string
  status: string
  impressions: string
  clicks: string
  costMicros: string
  ctr: number | null
  conversions: number | null
  date: string | null
}

export interface GoogleAdsCampaignPerformanceResponse extends ToolResponse {
  output: {
    campaigns: GoogleAdsCampaignPerformance[]
    totalCount: number
    nextPageToken: string | null
  }
}

interface GoogleAdsAdGroup {
  id: string
  name: string
  status: string
  type: string | null
  campaignId: string
  campaignName: string | null
}

export interface GoogleAdsListAdGroupsResponse extends ToolResponse {
  output: {
    adGroups: GoogleAdsAdGroup[]
    totalCount: number
    nextPageToken: string | null
  }
}

interface GoogleAdsAdPerformance {
  adId: string
  adGroupId: string
  adGroupName: string | null
  campaignId: string
  campaignName: string | null
  adType: string | null
  impressions: string
  clicks: string
  costMicros: string
  ctr: number | null
  conversions: number | null
  date: string | null
}

export interface GoogleAdsAdPerformanceResponse extends ToolResponse {
  output: {
    ads: GoogleAdsAdPerformance[]
    totalCount: number
    nextPageToken: string | null
  }
}
