import type { ToolResponse } from '@/tools/types'

export interface GoogleAdsBaseParams {
  accessToken: string
  customerId: string
  developerToken: string
  managerCustomerId?: string
}

export interface GoogleAdsListCustomersParams {
  accessToken: string
  developerToken: string
}

export interface GoogleAdsSearchParams extends GoogleAdsBaseParams {
  query: string
  pageSize?: number
  pageToken?: string
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

export interface GoogleAdsCampaign {
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
  }
}

export interface GoogleAdsCampaignPerformance {
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
  }
}

export interface GoogleAdsAdGroup {
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
  }
}

export interface GoogleAdsAdPerformance {
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
  }
}
