import type { ToolResponse } from '@/tools/types'

/**
 * Common parameters for all SimilarWeb API endpoints
 */
export interface SimilarwebBaseParams {
  apiKey: string
  domain: string
}

/**
 * Parameters for time-series endpoints (visits, bounce rate, etc.)
 */
export interface SimilarwebTimeSeriesParams extends SimilarwebBaseParams {
  country: string
  granularity: 'daily' | 'weekly' | 'monthly'
  startDate?: string
  endDate?: string
  mainDomainOnly?: boolean
}

/**
 * Website Overview (API Lite) parameters
 */
export interface SimilarwebWebsiteOverviewParams extends SimilarwebBaseParams {}

/**
 * Website Overview response
 */
export interface SimilarwebWebsiteOverviewResponse extends ToolResponse {
  output: {
    siteName: string
    description: string | null
    globalRank: number | null
    countryRank: number | null
    categoryRank: number | null
    category: string | null
    monthlyVisits: number | null
    engagementVisitDuration: number | null
    engagementPagesPerVisit: number | null
    engagementBounceRate: number | null
    topCountries: Array<{
      country: string
      share: number
    }>
    trafficSources: {
      direct: number | null
      referrals: number | null
      search: number | null
      social: number | null
      mail: number | null
      paidReferrals: number | null
    }
  }
}

/**
 * Traffic Visits parameters
 */
export interface SimilarwebTrafficVisitsParams extends SimilarwebTimeSeriesParams {}

/**
 * Traffic Visits response
 */
export interface SimilarwebTrafficVisitsResponse extends ToolResponse {
  output: {
    domain: string
    country: string
    granularity: string
    lastUpdated: string | null
    visits: Array<{
      date: string
      visits: number
    }>
  }
}

/**
 * Bounce Rate parameters
 */
export interface SimilarwebBounceRateParams extends SimilarwebTimeSeriesParams {}

/**
 * Bounce Rate response
 */
export interface SimilarwebBounceRateResponse extends ToolResponse {
  output: {
    domain: string
    country: string
    granularity: string
    lastUpdated: string | null
    bounceRate: Array<{
      date: string
      bounceRate: number
    }>
  }
}

/**
 * Pages Per Visit parameters
 */
export interface SimilarwebPagesPerVisitParams extends SimilarwebTimeSeriesParams {}

/**
 * Pages Per Visit response
 */
export interface SimilarwebPagesPerVisitResponse extends ToolResponse {
  output: {
    domain: string
    country: string
    granularity: string
    lastUpdated: string | null
    pagesPerVisit: Array<{
      date: string
      pagesPerVisit: number
    }>
  }
}

/**
 * Average Visit Duration parameters
 */
export interface SimilarwebVisitDurationParams extends SimilarwebTimeSeriesParams {}

/**
 * Average Visit Duration response
 */
export interface SimilarwebVisitDurationResponse extends ToolResponse {
  output: {
    domain: string
    country: string
    granularity: string
    lastUpdated: string | null
    averageVisitDuration: Array<{
      date: string
      durationSeconds: number
    }>
  }
}
