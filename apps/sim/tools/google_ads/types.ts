import type { ToolResponse } from '@/tools/types'

export interface GoogleAdsCampaign {
  name: string
  status: string
  clicks: number
  impressions: number
  cost: number
  conversions: number
  conversions_value: number
  ctr: number
  avg_cpc: number
  cost_per_conversion: number
  conversion_rate: number
  impression_share: number
  budget_lost_share: number
  rank_lost_share: number
  roas: number
}

export interface GoogleAdsAccountResult {
  account_id: string
  account_name: string
  campaigns: GoogleAdsCampaign[]
  total_campaigns: number
  account_totals: {
    clicks: number
    impressions: number
    cost: number
    conversions: number
    ctr: number
    avg_cpc: number
    conversion_rate: number
    cost_per_conversion: number
  }
  error?: string
}

export interface GoogleAdsGrandTotals {
  clicks: number
  impressions: number
  cost: number
  conversions: number
  ctr: number
  avg_cpc: number
  conversion_rate: number
  cost_per_conversion: number
}

export interface GoogleAdsDataAvailability {
  overall_status: 'available' | 'partial' | 'unavailable'
  accounts: Array<{
    account_name: string
    account_id: string
    data_available: boolean
    latest_data_date: string
    requested_range: string
    days_behind: number
    message: string
  }>
  summary: string
}

export interface GoogleAdsQueryResponse {
  query: string
  query_type: string
  period_type: string
  date_range: string
  accounts_found: number
  grand_totals: GoogleAdsGrandTotals
  results: GoogleAdsAccountResult[]
  data_availability: GoogleAdsDataAvailability
}

export interface GoogleAdsWeekComparison {
  query: string
  query_type: 'week_comparison'
  comparison_type: string
  month: string
  week1: {
    label: string
    date_range: string
    results: GoogleAdsAccountResult[]
  }
  week2: {
    label: string
    date_range: string
    results: GoogleAdsAccountResult[]
  }
  accounts_found: number
}

export interface GoogleAdsProjection {
  query_type: 'projection'
  query: string
  month: string
  month_context: {
    month_name: string
    year: number
    start_date: string
    current_date: string
    days_elapsed: number
    remaining_days: number
    is_future_month: boolean
  }
  accounts: Array<{
    account_id: string
    account_name: string
    projection: {
      current_spend: number
      projected_total: number
      projected_remaining: number
      daily_average: number
      status: 'success' | 'info' | 'error'
      message?: string
    }
  }>
  totals: {
    current_spend: number
    projected_total: number
    projected_remaining: number
    daily_average: number
  }
  formula: string
  info_messages?: string[]
}

export interface GoogleAdsResponse extends ToolResponse {
  output: GoogleAdsQueryResponse | GoogleAdsWeekComparison | GoogleAdsProjection
}

export type GoogleAdsApiResponse =
  | GoogleAdsQueryResponse
  | GoogleAdsWeekComparison
  | GoogleAdsProjection
