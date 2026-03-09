// Common types for Ahrefs API tools
import type { ToolResponse } from '@/tools/types'

// Common parameters for all Ahrefs tools
export interface AhrefsBaseParams {
  apiKey: string
  date?: string // Date in YYYY-MM-DD format, defaults to today
}

// Target mode for analysis
export type AhrefsTargetMode = 'domain' | 'prefix' | 'subdomains' | 'exact'

// Domain Rating tool types
export interface AhrefsDomainRatingParams extends AhrefsBaseParams {
  target: string
}

export interface AhrefsDomainRatingResult {
  domain_rating: number
  ahrefs_rank: number
}

export interface AhrefsDomainRatingResponse extends ToolResponse {
  output: {
    domainRating: number
    ahrefsRank: number
  }
}

// Backlinks tool types
export interface AhrefsBacklinksParams extends AhrefsBaseParams {
  target: string
  mode?: AhrefsTargetMode
  limit?: number
  offset?: number
}

export interface AhrefsBacklink {
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
}

export interface AhrefsBacklinksStatsResult {
  total: number
  dofollow: number
  nofollow: number
  text: number
  image: number
  redirect: number
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
  limit?: number
  offset?: number
}

export interface AhrefsReferringDomain {
  domain: string
  domainRating: number
  backlinks: number
  dofollowBacklinks: number
  firstSeen: string
  lastVisited: string
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
  limit?: number
  offset?: number
}

export interface AhrefsOrganicKeyword {
  keyword: string
  volume: number
  position: number
  url: string
  traffic: number
  keywordDifficulty: number
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
  limit?: number
  offset?: number
  select?: string // Comma-separated list of fields to return (e.g., "url,traffic,keywords,top_keyword,value")
}

export interface AhrefsTopPage {
  url: string
  traffic: number
  keywords: number
  topKeyword: string
  value: number
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

export interface AhrefsKeywordOverviewResult {
  keyword: string
  searchVolume: number
  keywordDifficulty: number
  cpc: number
  clicks: number
  clicksPercentage: number
  parentTopic: string
  trafficPotential: number
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
  offset?: number
}

export interface AhrefsBrokenBacklink {
  urlFrom: string
  urlTo: string
  httpCode: number
  anchor: string
  domainRatingSource: number
}

export interface AhrefsBrokenBacklinksResponse extends ToolResponse {
  output: {
    brokenBacklinks: AhrefsBrokenBacklink[]
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
