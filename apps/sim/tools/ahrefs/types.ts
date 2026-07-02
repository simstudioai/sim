// Common types for Ahrefs API tools
import type { ToolResponse } from '@/tools/types'

// Common parameters for all Ahrefs tools
interface AhrefsBaseParams {
  apiKey: string
}

// Target mode for analysis
export type AhrefsTargetMode = 'domain' | 'prefix' | 'subdomains' | 'exact'

// Historical scope for backlink-profile endpoints (no `date` param on these endpoints)
export type AhrefsHistory = 'live' | 'all_time' | string // `since:YYYY-MM-DD` is also valid

// Domain Rating tool types
export interface AhrefsDomainRatingParams extends AhrefsBaseParams {
  target: string
  date?: string // Date in YYYY-MM-DD format, defaults to today
}

export interface AhrefsDomainRatingResponse extends ToolResponse {
  output: {
    domainRating: number
    ahrefsRank: number | null
  }
}

// Backlinks tool types
export interface AhrefsBacklinksParams extends AhrefsBaseParams {
  target: string
  mode?: AhrefsTargetMode
  history?: AhrefsHistory
  limit?: number
}

interface AhrefsBacklink {
  urlFrom: string
  urlTo: string
  anchor: string
  domainRatingSource: number
  isDofollow: boolean
  firstSeen: string
  lastVisited: string
}

export interface AhrefsBacklinksResponse extends ToolResponse {
  output: {
    backlinks: AhrefsBacklink[]
  }
}

// Backlinks Stats tool types
export interface AhrefsBacklinksStatsParams extends AhrefsBaseParams {
  target: string
  mode?: AhrefsTargetMode
  date?: string // Date in YYYY-MM-DD format, defaults to today
}

interface AhrefsBacklinksStatsResult {
  liveBacklinks: number
  liveReferringDomains: number
  allTimeBacklinks: number
  allTimeReferringDomains: number
}

export interface AhrefsBacklinksStatsResponse extends ToolResponse {
  output: {
    stats: AhrefsBacklinksStatsResult
  }
}

// Referring Domains tool types
export interface AhrefsReferringDomainsParams extends AhrefsBaseParams {
  target: string
  mode?: AhrefsTargetMode
  history?: AhrefsHistory
  limit?: number
}

interface AhrefsReferringDomain {
  domain: string
  domainRating: number
  backlinks: number
  dofollowBacklinks: number
  firstSeen: string
  lastVisited: string | null
}

export interface AhrefsReferringDomainsResponse extends ToolResponse {
  output: {
    referringDomains: AhrefsReferringDomain[]
  }
}

// Organic Keywords tool types
export interface AhrefsOrganicKeywordsParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  date?: string // Date in YYYY-MM-DD format, defaults to today
  limit?: number
}

interface AhrefsOrganicKeyword {
  keyword: string
  volume: number
  position: number | null
  url: string | null
  traffic: number
  keywordDifficulty: number | null
}

export interface AhrefsOrganicKeywordsResponse extends ToolResponse {
  output: {
    keywords: AhrefsOrganicKeyword[]
  }
}

// Top Pages tool types
export interface AhrefsTopPagesParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  date?: string // Date in YYYY-MM-DD format, defaults to today
  limit?: number
}

interface AhrefsTopPage {
  url: string | null
  traffic: number
  keywords: number | null
  topKeyword: string | null
  value: number | null
}

export interface AhrefsTopPagesResponse extends ToolResponse {
  output: {
    pages: AhrefsTopPage[]
  }
}

// Keyword Overview tool types
export interface AhrefsKeywordOverviewParams extends AhrefsBaseParams {
  keyword: string
  country?: string
}

interface AhrefsKeywordIntents {
  informational: boolean
  navigational: boolean
  commercial: boolean
  transactional: boolean
  branded: boolean
  local: boolean
}

interface AhrefsKeywordOverviewResult {
  keyword: string
  searchVolume: number
  keywordDifficulty: number | null
  cpc: number | null
  clicks: number | null
  clicksPercentage: number | null
  parentTopic: string | null
  trafficPotential: number | null
  intents: AhrefsKeywordIntents | null
}

export interface AhrefsKeywordOverviewResponse extends ToolResponse {
  output: {
    overview: AhrefsKeywordOverviewResult
  }
}

// Broken Backlinks tool types
export interface AhrefsBrokenBacklinksParams extends AhrefsBaseParams {
  target: string
  mode?: AhrefsTargetMode
  limit?: number
}

interface AhrefsBrokenBacklink {
  urlFrom: string
  urlTo: string
  httpCode: number | null
  anchor: string
  domainRatingSource: number
}

export interface AhrefsBrokenBacklinksResponse extends ToolResponse {
  output: {
    brokenBacklinks: AhrefsBrokenBacklink[]
  }
}

// Metrics tool types (single-call organic + paid search overview)
export interface AhrefsMetricsParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  date?: string // Date in YYYY-MM-DD format, defaults to today
}

interface AhrefsMetricsResult {
  organicTraffic: number
  organicKeywords: number
  organicKeywordsTop3: number
  organicCost: number | null
  paidTraffic: number
  paidKeywords: number
  paidPages: number
  paidCost: number | null
}

export interface AhrefsMetricsResponse extends ToolResponse {
  output: {
    metrics: AhrefsMetricsResult
  }
}

// Organic Competitors tool types
export interface AhrefsOrganicCompetitorsParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  date?: string // Date in YYYY-MM-DD format, defaults to today
  limit?: number
}

interface AhrefsOrganicCompetitor {
  domain: string | null
  domainRating: number
  commonKeywords: number
  targetKeywords: number
  competitorKeywords: number
  traffic: number | null
}

export interface AhrefsOrganicCompetitorsResponse extends ToolResponse {
  output: {
    competitors: AhrefsOrganicCompetitor[]
  }
}

// Union type for all possible responses
export type AhrefsResponse =
  | AhrefsDomainRatingResponse
  | AhrefsBacklinksResponse
  | AhrefsBacklinksStatsResponse
  | AhrefsReferringDomainsResponse
  | AhrefsOrganicKeywordsResponse
  | AhrefsTopPagesResponse
  | AhrefsKeywordOverviewResponse
  | AhrefsBrokenBacklinksResponse
  | AhrefsMetricsResponse
  | AhrefsOrganicCompetitorsResponse
