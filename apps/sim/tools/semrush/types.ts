import type { ToolResponse } from '@/tools/types'

/** Trailing 12 months of relative search interest, newest value last. */
export type SemrushTrend = number[]

/** Scope a backlink report resolves its target at. */
export type SemrushTargetType = 'root_domain' | 'domain' | 'url'

export interface SemrushDomainOverviewParams {
  apiKey: string
  domain: string
  database: string
  displayDate?: string
}

export interface SemrushDomainOverviewRow {
  domain?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
}

export interface SemrushDomainOverviewResponse extends ToolResponse {
  output: {
    overview: SemrushDomainOverviewRow | null
  }
}

export interface SemrushDomainOverviewAllParams {
  apiKey: string
  domain: string
  database?: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
}

export interface SemrushDomainOverviewAllRow {
  database?: string | null
  domain?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
  plaKeywords?: number | null
  plaUniques?: number | null
}

export interface SemrushDomainOverviewAllResponse extends ToolResponse {
  output: {
    databases: SemrushDomainOverviewAllRow[]
  }
}

export interface SemrushDomainOverviewHistoryParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
  displayDaily?: boolean
  displaySort?: string
}

export interface SemrushDomainOverviewHistoryRow {
  date?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
}

export interface SemrushDomainOverviewHistoryResponse extends ToolResponse {
  output: {
    history: SemrushDomainOverviewHistoryRow[]
  }
}

export interface SemrushWinnersAndLosersParams {
  apiKey: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
}

export interface SemrushWinnersAndLosersRow {
  domain?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
  organicKeywordsDifference?: number | null
  organicTrafficDifference?: number | null
  organicCostDifference?: number | null
  paidKeywordsDifference?: number | null
  paidTrafficDifference?: number | null
  paidCostDifference?: number | null
}

export interface SemrushWinnersAndLosersResponse extends ToolResponse {
  output: {
    domains: SemrushWinnersAndLosersRow[]
  }
}

export interface SemrushTopDomainsParams {
  apiKey: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displayFilter?: string
}

export interface SemrushTopDomainsRow {
  domain?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
}

export interface SemrushTopDomainsResponse extends ToolResponse {
  output: {
    domains: SemrushTopDomainsRow[]
  }
}

export interface SemrushDomainOrganicKeywordsParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displayDaily?: boolean
  displaySort?: string
  displayFilter?: string
}

export interface SemrushDomainOrganicKeywordsRow {
  keyword?: string | null
  position?: number | null
  previousPosition?: number | null
  positionDifference?: number | null
  searchVolume?: number | null
  cpc?: number | null
  url?: string | null
  trafficPercent?: number | null
  traffic?: number | null
  trafficCost?: number | null
  competition?: number | null
  numberOfResults?: number | null
  keywordDifficulty?: number | null
  intents?: number[]
  trends?: SemrushTrend
}

export interface SemrushDomainOrganicKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushDomainOrganicKeywordsRow[]
  }
}

export interface SemrushDomainPaidKeywordsParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
  displayFilter?: string
}

export interface SemrushDomainPaidKeywordsRow {
  keyword?: string | null
  position?: number | null
  previousPosition?: number | null
  positionDifference?: number | null
  searchVolume?: number | null
  cpc?: number | null
  url?: string | null
  visibleUrl?: string | null
  title?: string | null
  description?: string | null
  traffic?: number | null
  trafficPercent?: number | null
  trafficCost?: number | null
  competition?: number | null
  numberOfResults?: number | null
}

export interface SemrushDomainPaidKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushDomainPaidKeywordsRow[]
  }
}

export interface SemrushDomainAdCopiesParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushDomainAdCopiesRow {
  title?: string | null
  description?: string | null
  visibleUrl?: string | null
  url?: string | null
  numberOfKeywords?: number | null
}

export interface SemrushDomainAdCopiesResponse extends ToolResponse {
  output: {
    ads: SemrushDomainAdCopiesRow[]
  }
}

export interface SemrushDomainAdHistoryParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushDomainAdHistoryRow {
  keyword?: string | null
  date?: string | null
  position?: number | null
  cpc?: number | null
  searchVolume?: number | null
  trafficPercent?: number | null
  url?: string | null
  title?: string | null
  description?: string | null
  visibleUrl?: string | null
}

export interface SemrushDomainAdHistoryResponse extends ToolResponse {
  output: {
    ads: SemrushDomainAdHistoryRow[]
  }
}

export interface SemrushDomainOrganicCompetitorsParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
}

export interface SemrushDomainOrganicCompetitorsRow {
  domain?: string | null
  competitorRelevance?: number | null
  commonKeywords?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
}

export interface SemrushDomainOrganicCompetitorsResponse extends ToolResponse {
  output: {
    competitors: SemrushDomainOrganicCompetitorsRow[]
  }
}

export interface SemrushDomainPaidCompetitorsParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
}

export interface SemrushDomainPaidCompetitorsRow {
  domain?: string | null
  competitorRelevance?: number | null
  commonKeywords?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
  organicKeywords?: number | null
}

export interface SemrushDomainPaidCompetitorsResponse extends ToolResponse {
  output: {
    competitors: SemrushDomainPaidCompetitorsRow[]
  }
}

export interface SemrushDomainPlaKeywordsParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushDomainPlaKeywordsRow {
  keyword?: string | null
  position?: number | null
  previousPosition?: number | null
  positionDifference?: number | null
  searchVolume?: number | null
  shopName?: string | null
  url?: string | null
  title?: string | null
  productPrice?: number | null
  timestamp?: number | null
}

export interface SemrushDomainPlaKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushDomainPlaKeywordsRow[]
  }
}

export interface SemrushDomainPlaCopiesParams {
  apiKey: string
  domain: string
  database: string
  limit?: number
  offset?: number
}

export interface SemrushDomainPlaCopiesRow {
  title?: string | null
  productPrice?: number | null
  shopName?: string | null
  url?: string | null
}

export interface SemrushDomainPlaCopiesResponse extends ToolResponse {
  output: {
    ads: SemrushDomainPlaCopiesRow[]
  }
}

export interface SemrushSubdomainOverviewParams {
  apiKey: string
  subdomain: string
  database: string
  displayDate?: string
}

export interface SemrushSubdomainOverviewRow {
  domain?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
}

export interface SemrushSubdomainOverviewResponse extends ToolResponse {
  output: {
    overview: SemrushSubdomainOverviewRow | null
  }
}

export interface SemrushSubdomainOverviewAllParams {
  apiKey: string
  subdomain: string
  database?: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
}

export interface SemrushSubdomainOverviewAllRow {
  database?: string | null
  domain?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
  plaKeywords?: number | null
  plaUniques?: number | null
}

export interface SemrushSubdomainOverviewAllResponse extends ToolResponse {
  output: {
    databases: SemrushSubdomainOverviewAllRow[]
  }
}

export interface SemrushSubdomainOverviewHistoryParams {
  apiKey: string
  subdomain: string
  database: string
  limit?: number
  offset?: number
  displayDaily?: boolean
  displaySort?: string
}

export interface SemrushSubdomainOverviewHistoryRow {
  date?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
}

export interface SemrushSubdomainOverviewHistoryResponse extends ToolResponse {
  output: {
    history: SemrushSubdomainOverviewHistoryRow[]
  }
}

export interface SemrushSubdomainOrganicKeywordsParams {
  apiKey: string
  subdomain: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displayDaily?: boolean
  displaySort?: string
  displayFilter?: string
}

export interface SemrushSubdomainOrganicKeywordsRow {
  keyword?: string | null
  position?: number | null
  previousPosition?: number | null
  positionDifference?: number | null
  searchVolume?: number | null
  cpc?: number | null
  url?: string | null
  trafficPercent?: number | null
  traffic?: number | null
  trafficCost?: number | null
  competition?: number | null
  numberOfResults?: number | null
  keywordDifficulty?: number | null
  intents?: number[]
  trends?: SemrushTrend
}

export interface SemrushSubdomainOrganicKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushSubdomainOrganicKeywordsRow[]
  }
}

export interface SemrushSubdomainPaidKeywordsParams {
  apiKey: string
  subdomain: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
  displayFilter?: string
}

export interface SemrushSubdomainPaidKeywordsRow {
  keyword?: string | null
  position?: number | null
  previousPosition?: number | null
  positionDifference?: number | null
  searchVolume?: number | null
  cpc?: number | null
  url?: string | null
  visibleUrl?: string | null
  title?: string | null
  description?: string | null
  traffic?: number | null
  trafficPercent?: number | null
  trafficCost?: number | null
  competition?: number | null
  numberOfResults?: number | null
}

export interface SemrushSubdomainPaidKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushSubdomainPaidKeywordsRow[]
  }
}

export interface SemrushSubdomainAdCopiesParams {
  apiKey: string
  subdomain: string
  database: string
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushSubdomainAdCopiesRow {
  title?: string | null
  description?: string | null
  visibleUrl?: string | null
  url?: string | null
  numberOfKeywords?: number | null
}

export interface SemrushSubdomainAdCopiesResponse extends ToolResponse {
  output: {
    ads: SemrushSubdomainAdCopiesRow[]
  }
}

export interface SemrushUrlOverviewParams {
  apiKey: string
  url: string
  database: string
  displayDate?: string
}

export interface SemrushUrlOverviewRow {
  domain?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
}

export interface SemrushUrlOverviewResponse extends ToolResponse {
  output: {
    overview: SemrushUrlOverviewRow | null
  }
}

export interface SemrushUrlOverviewAllParams {
  apiKey: string
  url: string
  database?: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
}

export interface SemrushUrlOverviewAllRow {
  database?: string | null
  domain?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
  plaKeywords?: number | null
  plaUniques?: number | null
}

export interface SemrushUrlOverviewAllResponse extends ToolResponse {
  output: {
    databases: SemrushUrlOverviewAllRow[]
  }
}

export interface SemrushUrlOverviewHistoryParams {
  apiKey: string
  url: string
  database: string
  limit?: number
  offset?: number
  displayDaily?: boolean
  displaySort?: string
}

export interface SemrushUrlOverviewHistoryRow {
  date?: string | null
  rank?: number | null
  organicKeywords?: number | null
  organicTraffic?: number | null
  organicCost?: number | null
  paidKeywords?: number | null
  paidTraffic?: number | null
  paidCost?: number | null
}

export interface SemrushUrlOverviewHistoryResponse extends ToolResponse {
  output: {
    history: SemrushUrlOverviewHistoryRow[]
  }
}

export interface SemrushUrlOrganicKeywordsParams {
  apiKey: string
  url: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
  displayFilter?: string
}

export interface SemrushUrlOrganicKeywordsRow {
  keyword?: string | null
  position?: number | null
  previousPosition?: number | null
  searchVolume?: number | null
  cpc?: number | null
  competition?: number | null
  keywordDifficulty?: number | null
  trafficPercent?: number | null
  traffic?: number | null
  trafficCost?: number | null
  numberOfResults?: number | null
  intents?: number[]
  trends?: SemrushTrend
}

export interface SemrushUrlOrganicKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushUrlOrganicKeywordsRow[]
  }
}

export interface SemrushUrlPaidKeywordsParams {
  apiKey: string
  url: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
  displaySort?: string
  displayFilter?: string
}

export interface SemrushUrlPaidKeywordsRow {
  keyword?: string | null
  position?: number | null
  searchVolume?: number | null
  cpc?: number | null
  competition?: number | null
  traffic?: number | null
  trafficPercent?: number | null
  trafficCost?: number | null
  numberOfResults?: number | null
  trends?: SemrushTrend
  title?: string | null
  description?: string | null
}

export interface SemrushUrlPaidKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushUrlPaidKeywordsRow[]
  }
}

export interface SemrushKeywordOverviewParams {
  apiKey: string
  phrase: string
  database: string
  displayDate?: string
}

export interface SemrushKeywordOverviewRow {
  keyword?: string | null
  searchVolume?: number | null
  cpc?: number | null
  competition?: number | null
  numberOfResults?: number | null
  keywordDifficulty?: number | null
  intents?: number[]
  trends?: SemrushTrend
}

export interface SemrushKeywordOverviewResponse extends ToolResponse {
  output: {
    overview: SemrushKeywordOverviewRow | null
  }
}

export interface SemrushKeywordOverviewAllParams {
  apiKey: string
  phrase: string
  database?: string
}

export interface SemrushKeywordOverviewAllRow {
  date?: string | null
  database?: string | null
  keyword?: string | null
  searchVolume?: number | null
  cpc?: number | null
  competition?: number | null
  numberOfResults?: number | null
  intents?: number[]
  keywordDifficulty?: number | null
}

export interface SemrushKeywordOverviewAllResponse extends ToolResponse {
  output: {
    databases: SemrushKeywordOverviewAllRow[]
  }
}

export interface SemrushBatchKeywordOverviewParams {
  apiKey: string
  phrases: string
  database: string
  displayDate?: string
}

export interface SemrushBatchKeywordOverviewRow {
  keyword?: string | null
  searchVolume?: number | null
  cpc?: number | null
  competition?: number | null
  numberOfResults?: number | null
  keywordDifficulty?: number | null
  intents?: number[]
  trends?: SemrushTrend
}

export interface SemrushBatchKeywordOverviewResponse extends ToolResponse {
  output: {
    keywords: SemrushBatchKeywordOverviewRow[]
  }
}

export interface SemrushKeywordDifficultyParams {
  apiKey: string
  phrases: string
  database: string
}

export interface SemrushKeywordDifficultyRow {
  keyword?: string | null
  keywordDifficulty?: number | null
}

export interface SemrushKeywordDifficultyResponse extends ToolResponse {
  output: {
    keywords: SemrushKeywordDifficultyRow[]
  }
}

export interface SemrushRelatedKeywordsParams {
  apiKey: string
  phrase: string
  database: string
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushRelatedKeywordsRow {
  keyword?: string | null
  searchVolume?: number | null
  cpc?: number | null
  competition?: number | null
  numberOfResults?: number | null
  keywordDifficulty?: number | null
  relatedRelevance?: number | null
  keywordSerpFeatures?: number[]
  intents?: number[]
  trends?: SemrushTrend
}

export interface SemrushRelatedKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushRelatedKeywordsRow[]
  }
}

export interface SemrushBroadMatchKeywordsParams {
  apiKey: string
  phrase: string
  database: string
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushBroadMatchKeywordsRow {
  keyword?: string | null
  searchVolume?: number | null
  cpc?: number | null
  competition?: number | null
  numberOfResults?: number | null
  keywordDifficulty?: number | null
  keywordSerpFeatures?: number[]
  intents?: number[]
  trends?: SemrushTrend
}

export interface SemrushBroadMatchKeywordsResponse extends ToolResponse {
  output: {
    keywords: SemrushBroadMatchKeywordsRow[]
  }
}

export interface SemrushKeywordQuestionsParams {
  apiKey: string
  phrase: string
  database: string
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushKeywordQuestionsRow {
  keyword?: string | null
  searchVolume?: number | null
  cpc?: number | null
  competition?: number | null
  numberOfResults?: number | null
  keywordDifficulty?: number | null
  intents?: number[]
  trends?: SemrushTrend
}

export interface SemrushKeywordQuestionsResponse extends ToolResponse {
  output: {
    keywords: SemrushKeywordQuestionsRow[]
  }
}

export interface SemrushOrganicResultsParams {
  apiKey: string
  phrase: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
}

export interface SemrushOrganicResultsRow {
  position?: number | null
  positionType?: string | null
  domain?: string | null
  url?: string | null
  keywordSerpFeatures?: number[]
  serpFeatures?: number[]
}

export interface SemrushOrganicResultsResponse extends ToolResponse {
  output: {
    results: SemrushOrganicResultsRow[]
  }
}

export interface SemrushPaidResultsParams {
  apiKey: string
  phrase: string
  database: string
  limit?: number
  offset?: number
  displayDate?: string
}

export interface SemrushPaidResultsRow {
  domain?: string | null
  url?: string | null
  visibleUrl?: string | null
}

export interface SemrushPaidResultsResponse extends ToolResponse {
  output: {
    results: SemrushPaidResultsRow[]
  }
}

export interface SemrushKeywordAdHistoryParams {
  apiKey: string
  phrase: string
  database: string
  limit?: number
  offset?: number
}

export interface SemrushKeywordAdHistoryRow {
  domain?: string | null
  date?: string | null
  position?: number | null
  url?: string | null
  title?: string | null
  description?: string | null
  visibleUrl?: string | null
}

export interface SemrushKeywordAdHistoryResponse extends ToolResponse {
  output: {
    ads: SemrushKeywordAdHistoryRow[]
  }
}

export interface SemrushBacklinksOverviewParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
}

export interface SemrushBacklinksOverviewRow {
  authorityScore?: number | null
  total?: number | null
  domainsNum?: number | null
  urlsNum?: number | null
  ipsNum?: number | null
  ipClassCNum?: number | null
  followsNum?: number | null
  nofollowsNum?: number | null
  sponsoredNum?: number | null
  ugcNum?: number | null
  textsNum?: number | null
  imagesNum?: number | null
  formsNum?: number | null
  framesNum?: number | null
}

export interface SemrushBacklinksOverviewResponse extends ToolResponse {
  output: {
    overview: SemrushBacklinksOverviewRow | null
  }
}

export interface SemrushBacklinksParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushBacklinksRow {
  pageAuthorityScore?: number | null
  sourceTitle?: string | null
  sourceUrl?: string | null
  targetUrl?: string | null
  anchor?: string | null
  nofollow?: string | null
  externalLinksNum?: number | null
  internalLinksNum?: number | null
  firstSeen?: number | null
  lastSeen?: number | null
}

export interface SemrushBacklinksResponse extends ToolResponse {
  output: {
    backlinks: SemrushBacklinksRow[]
  }
}

export interface SemrushReferringDomainsParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushReferringDomainsRow {
  domainAuthorityScore?: number | null
  domain?: string | null
  backlinksNum?: number | null
  ip?: string | null
  country?: string | null
  firstSeen?: number | null
  lastSeen?: number | null
}

export interface SemrushReferringDomainsResponse extends ToolResponse {
  output: {
    domains: SemrushReferringDomainsRow[]
  }
}

export interface SemrushReferringIpsParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
  limit?: number
  offset?: number
  displaySort?: string
}

export interface SemrushReferringIpsRow {
  ip?: string | null
  country?: string | null
  domainsNum?: number | null
  backlinksNum?: number | null
  firstSeen?: number | null
  lastSeen?: number | null
}

export interface SemrushReferringIpsResponse extends ToolResponse {
  output: {
    ips: SemrushReferringIpsRow[]
  }
}

export interface SemrushBacklinksTldDistributionParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
  limit?: number
  offset?: number
  displaySort?: string
}

export interface SemrushBacklinksTldDistributionRow {
  zone?: string | null
  domainsNum?: number | null
  backlinksNum?: number | null
}

export interface SemrushBacklinksTldDistributionResponse extends ToolResponse {
  output: {
    zones: SemrushBacklinksTldDistributionRow[]
  }
}

export interface SemrushBacklinksGeoDistributionParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
  limit?: number
  offset?: number
  displaySort?: string
}

export interface SemrushBacklinksGeoDistributionRow {
  country?: string | null
  domainsNum?: number | null
  backlinksNum?: number | null
}

export interface SemrushBacklinksGeoDistributionResponse extends ToolResponse {
  output: {
    countries: SemrushBacklinksGeoDistributionRow[]
  }
}

export interface SemrushBacklinksAnchorsParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
  limit?: number
  offset?: number
  displaySort?: string
}

export interface SemrushBacklinksAnchorsRow {
  anchor?: string | null
  domainsNum?: number | null
  backlinksNum?: number | null
  firstSeen?: number | null
  lastSeen?: number | null
}

export interface SemrushBacklinksAnchorsResponse extends ToolResponse {
  output: {
    anchors: SemrushBacklinksAnchorsRow[]
  }
}

export interface SemrushBacklinksIndexedPagesParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
  limit?: number
  offset?: number
  displaySort?: string
}

export interface SemrushBacklinksIndexedPagesRow {
  sourceUrl?: string | null
  sourceTitle?: string | null
  responseCode?: number | null
  backlinksNum?: number | null
  domainsNum?: number | null
  lastSeen?: number | null
  externalLinksNum?: number | null
  internalLinksNum?: number | null
}

export interface SemrushBacklinksIndexedPagesResponse extends ToolResponse {
  output: {
    pages: SemrushBacklinksIndexedPagesRow[]
  }
}

export interface SemrushBacklinksCompetitorsParams {
  apiKey: string
  target: string
  targetType?: SemrushTargetType
  limit?: number
  offset?: number
}

export interface SemrushBacklinksCompetitorsRow {
  authorityScore?: number | null
  domain?: string | null
  similarity?: number | null
  commonRefdomains?: number | null
  domainsNum?: number | null
  backlinksNum?: number | null
}

export interface SemrushBacklinksCompetitorsResponse extends ToolResponse {
  output: {
    competitors: SemrushBacklinksCompetitorsRow[]
  }
}

export interface SemrushDomainVsDomainParams {
  apiKey: string
  domains: string
  database: string
  competitionType?: 'or' | 'ad'
  limit?: number
  offset?: number
  displaySort?: string
  displayFilter?: string
}

export interface SemrushDomainVsDomainRow {
  keyword: string | null
  positions: Record<string, number | null>
  competition: number | null
  searchVolume: number | null
  cpc: number | null
}

export interface SemrushDomainVsDomainResponse extends ToolResponse {
  output: {
    domains: string[]
    keywords: SemrushDomainVsDomainRow[]
  }
}

export type SemrushResponse =
  | SemrushDomainOverviewResponse
  | SemrushDomainOverviewAllResponse
  | SemrushDomainOverviewHistoryResponse
  | SemrushWinnersAndLosersResponse
  | SemrushTopDomainsResponse
  | SemrushDomainOrganicKeywordsResponse
  | SemrushDomainPaidKeywordsResponse
  | SemrushDomainAdCopiesResponse
  | SemrushDomainAdHistoryResponse
  | SemrushDomainOrganicCompetitorsResponse
  | SemrushDomainPaidCompetitorsResponse
  | SemrushDomainPlaKeywordsResponse
  | SemrushDomainPlaCopiesResponse
  | SemrushSubdomainOverviewResponse
  | SemrushSubdomainOverviewAllResponse
  | SemrushSubdomainOverviewHistoryResponse
  | SemrushSubdomainOrganicKeywordsResponse
  | SemrushSubdomainPaidKeywordsResponse
  | SemrushSubdomainAdCopiesResponse
  | SemrushUrlOverviewResponse
  | SemrushUrlOverviewAllResponse
  | SemrushUrlOverviewHistoryResponse
  | SemrushUrlOrganicKeywordsResponse
  | SemrushUrlPaidKeywordsResponse
  | SemrushKeywordOverviewResponse
  | SemrushKeywordOverviewAllResponse
  | SemrushBatchKeywordOverviewResponse
  | SemrushKeywordDifficultyResponse
  | SemrushRelatedKeywordsResponse
  | SemrushBroadMatchKeywordsResponse
  | SemrushKeywordQuestionsResponse
  | SemrushOrganicResultsResponse
  | SemrushPaidResultsResponse
  | SemrushKeywordAdHistoryResponse
  | SemrushBacklinksOverviewResponse
  | SemrushBacklinksResponse
  | SemrushReferringDomainsResponse
  | SemrushReferringIpsResponse
  | SemrushBacklinksTldDistributionResponse
  | SemrushBacklinksGeoDistributionResponse
  | SemrushBacklinksAnchorsResponse
  | SemrushBacklinksIndexedPagesResponse
  | SemrushBacklinksCompetitorsResponse
  | SemrushDomainVsDomainResponse
