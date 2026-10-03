import type { ToolResponse } from '@/tools/types'

interface AhrefsBaseParams {
  apiKey: string
}

type AhrefsTargetMode = 'domain' | 'prefix' | 'subdomains' | 'exact'

/**
 * Historical scope for backlink-profile endpoints (no `date` param on these endpoints).
 * `since:YYYY-MM-DD` is also valid.
 */
type AhrefsHistory = 'live' | 'all_time' | string

export interface AhrefsDomainRatingParams extends AhrefsBaseParams {
  target: string
  /** Date in YYYY-MM-DD format, defaults to today */
  date?: string
}

export interface AhrefsDomainRatingResponse extends ToolResponse {
  output: {
    domainRating: number
    ahrefsRank: number | null
  }
}

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

export interface AhrefsBacklinksStatsParams extends AhrefsBaseParams {
  target: string
  mode?: AhrefsTargetMode
  /** Date in YYYY-MM-DD format, defaults to today */
  date?: string
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

export interface AhrefsOrganicKeywordsParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  /** Date in YYYY-MM-DD format, defaults to today */
  date?: string
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

export interface AhrefsTopPagesParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  /** Date in YYYY-MM-DD format, defaults to today */
  date?: string
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

/** Metrics tool types (single-call organic + paid search overview) */
export interface AhrefsMetricsParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  /** Date in YYYY-MM-DD format, defaults to today */
  date?: string
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

export interface AhrefsOrganicCompetitorsParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  /** Date in YYYY-MM-DD format, defaults to today */
  date?: string
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

type AhrefsRankTrackerDevice = 'desktop' | 'mobile'

/** Rank Tracker search volume calculation mode */
type AhrefsVolumeMode = 'monthly' | 'average'

export interface AhrefsRankTrackerOverviewParams extends AhrefsBaseParams {
  projectId: number
  /** Date in YYYY-MM-DD format (required by the API) */
  date: string
  device: AhrefsRankTrackerDevice
  dateCompared?: string
  volumeMode?: AhrefsVolumeMode
  limit?: number
}

interface AhrefsRankTrackerOverviewItem {
  keyword: string
  position: number | null
  volume: number | null
  keywordDifficulty: number | null
  url: string | null
  traffic: number | null
  serpFeatures: string[]
  bestPositionKind: string | null
}

export interface AhrefsRankTrackerOverviewResponse extends ToolResponse {
  output: {
    overviews: AhrefsRankTrackerOverviewItem[]
  }
}

export interface AhrefsRankTrackerSerpOverviewParams extends AhrefsBaseParams {
  projectId: number
  keyword: string
  country: string
  device: AhrefsRankTrackerDevice
  topPositions?: number
  /** ISO date-time (YYYY-MM-DDThh:mm:ss) */
  date?: string
  locationId?: number
  languageCode?: string
}

interface AhrefsSerpPosition {
  position: number
  url: string
  title: string
  type: string[]
  domainRating: number
  urlRating: number
  backlinks: number
  refdomains: number
  traffic: number
  value: number | null
  topKeyword: string | null
  topKeywordVolume: number | null
  updateDate: string
}

export interface AhrefsRankTrackerSerpOverviewResponse extends ToolResponse {
  output: {
    positions: AhrefsSerpPosition[]
  }
}

export interface AhrefsRankTrackerCompetitorsOverviewParams extends AhrefsBaseParams {
  projectId: number
  date: string
  device: AhrefsRankTrackerDevice
  dateCompared?: string
  volumeMode?: AhrefsVolumeMode
  limit?: number
}

interface AhrefsCompetitorListItem {
  url: string
  position: number | null
  bestPositionKind: string | null
  traffic: number | null
  value: number | null
}

interface AhrefsRankTrackerCompetitorsOverviewItem {
  keyword: string
  volume: number | null
  keywordDifficulty: number | null
  serpFeatures: string[]
  competitorsList: AhrefsCompetitorListItem[]
}

export interface AhrefsRankTrackerCompetitorsOverviewResponse extends ToolResponse {
  output: {
    competitorKeywords: AhrefsRankTrackerCompetitorsOverviewItem[]
  }
}

export interface AhrefsRankTrackerCompetitorsStatsParams extends AhrefsBaseParams {
  projectId: number
  date: string
  device: AhrefsRankTrackerDevice
  volumeMode?: AhrefsVolumeMode
}

interface AhrefsCompetitorStat {
  competitor: string
  traffic: number | null
  trafficValue: number | null
  averagePosition: number | null
  pos1To3: number
  pos4To10: number
  shareOfVoice: number
  shareOfTrafficValue: number
}

export interface AhrefsRankTrackerCompetitorsStatsResponse extends ToolResponse {
  output: {
    competitorsStats: AhrefsCompetitorStat[]
  }
}

export interface AhrefsBatchAnalysisParams extends AhrefsBaseParams {
  /** Comma-separated list of domains/URLs */
  targets: string
  mode?: AhrefsTargetMode
  protocol?: 'both' | 'http' | 'https'
  country?: string
  volumeMode?: AhrefsVolumeMode
}

interface AhrefsBatchAnalysisResult {
  url: string
  index: number
  domainRating: number | null
  ahrefsRank: number | null
  backlinks: number | null
  referringDomains: number | null
  organicTraffic: number | null
  organicKeywords: number | null
  paidTraffic: number | null
  error: string | null
}

export interface AhrefsBatchAnalysisResponse extends ToolResponse {
  output: {
    results: AhrefsBatchAnalysisResult[]
  }
}

export interface AhrefsSiteAuditPageExplorerParams extends AhrefsBaseParams {
  projectId: number
  /** ISO date-time (YYYY-MM-DDThh:mm:ss), defaults to most recent crawl */
  date?: string
  limit?: number
  offset?: number
  issueId?: string
}

interface AhrefsPageExplorerResult {
  url: string
  httpCode: number | null
  title: string[]
  internalLinks: number
  externalLinks: number
  backlinks: number | null
  compliant: boolean | null
  traffic: number | null
}

export interface AhrefsSiteAuditPageExplorerResponse extends ToolResponse {
  output: {
    auditPages: AhrefsPageExplorerResult[]
  }
}

export interface AhrefsDomainRatingHistoryParams extends AhrefsBaseParams {
  target: string
  dateFrom: string
  dateTo?: string
  historyGrouping?: 'daily' | 'weekly' | 'monthly'
}

interface AhrefsDomainRatingHistoryItem {
  date: string
  domainRating: number
}

export interface AhrefsDomainRatingHistoryResponse extends ToolResponse {
  output: {
    domainRatings: AhrefsDomainRatingHistoryItem[]
  }
}

export interface AhrefsMetricsHistoryParams extends AhrefsBaseParams {
  target: string
  dateFrom: string
  dateTo?: string
  volumeMode?: AhrefsVolumeMode
  historyGrouping?: 'daily' | 'weekly' | 'monthly'
  country?: string
  mode?: AhrefsTargetMode
}

interface AhrefsMetricsHistoryItem {
  date: string
  organicTraffic: number
  organicCost: number | null
  paidTraffic: number
  paidCost: number | null
}

export interface AhrefsMetricsHistoryResponse extends ToolResponse {
  output: {
    metricsHistory: AhrefsMetricsHistoryItem[]
  }
}

export interface AhrefsRefdomainsHistoryParams extends AhrefsBaseParams {
  target: string
  dateFrom: string
  dateTo?: string
  historyGrouping?: 'daily' | 'weekly' | 'monthly'
  mode?: AhrefsTargetMode
}

interface AhrefsRefdomainsHistoryItem {
  date: string
  referringDomains: number
}

export interface AhrefsRefdomainsHistoryResponse extends ToolResponse {
  output: {
    referringDomainsHistory: AhrefsRefdomainsHistoryItem[]
  }
}

export interface AhrefsKeywordsHistoryParams extends AhrefsBaseParams {
  target: string
  dateFrom: string
  dateTo?: string
  historyGrouping?: 'daily' | 'weekly' | 'monthly'
  country?: string
  mode?: AhrefsTargetMode
}

interface AhrefsKeywordsHistoryItem {
  date: string
  top3: number
  top4To10: number
  top11To20: number
  top21To50: number
  top51Plus: number
}

export interface AhrefsKeywordsHistoryResponse extends ToolResponse {
  output: {
    keywordsHistory: AhrefsKeywordsHistoryItem[]
  }
}

export interface AhrefsRelatedTermsParams extends AhrefsBaseParams {
  keyword: string
  country?: string
  terms?: 'also_rank_for' | 'also_talk_about' | 'all'
  viewFor?: 'top_10' | 'top_100'
  limit?: number
}

interface AhrefsRelatedTerm {
  keyword: string
  volume: number | null
  keywordDifficulty: number | null
  cpc: number | null
  parentTopic: string | null
  trafficPotential: number | null
  intents: Record<string, boolean> | null
  serpFeatures: string[]
}

export interface AhrefsRelatedTermsResponse extends ToolResponse {
  output: {
    relatedTerms: AhrefsRelatedTerm[]
  }
}

export interface AhrefsAnchorsParams extends AhrefsBaseParams {
  target: string
  mode?: AhrefsTargetMode
  history?: AhrefsHistory
  limit?: number
}

interface AhrefsAnchor {
  anchor: string
  backlinks: number
  dofollowBacklinks: number
  referringDomains: number
  firstSeen: string
  lastSeen: string | null
}

export interface AhrefsAnchorsResponse extends ToolResponse {
  output: {
    anchors: AhrefsAnchor[]
  }
}

export interface AhrefsPaidPagesParams extends AhrefsBaseParams {
  target: string
  country?: string
  mode?: AhrefsTargetMode
  /** Date in YYYY-MM-DD format, defaults to today */
  date?: string
  limit?: number
}

interface AhrefsPaidPage {
  url: string | null
  traffic: number | null
  keywords: number | null
  topKeyword: string | null
  value: number | null
  adsCount: number | null
}

export interface AhrefsPaidPagesResponse extends ToolResponse {
  output: {
    paidPages: AhrefsPaidPage[]
  }
}
