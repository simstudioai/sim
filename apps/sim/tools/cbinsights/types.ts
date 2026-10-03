import type { ToolResponse } from '@/tools/types'

/**
 * CB Insights authorizes with a client-credential exchange rather than a static
 * key: `POST /v2/authorize` trades these for a short-lived bearer token.
 */
export interface CbInsightsAuthParams {
  clientId: string
  clientSecret: string
}

/** Endpoints scoped to one organization take its ID on the path. */
export interface CbInsightsOrgParams extends CbInsightsAuthParams {
  orgId: number | string
}

/** Endpoints covering many organizations take 1-100 IDs in the body. */
export interface CbInsightsOrgListParams extends CbInsightsAuthParams {
  orgIds: number[] | string
}

/** Every paged list endpoint carries the same opaque continuation token. */
export interface CbInsightsPagedParams {
  limit?: number | string
  nextPageToken?: string
}

/** A response page shared by the endpoints that report a total. */
export interface CbInsightsPageInfo {
  nextPageToken: string | null
  totalHits: number | null
  totalHitsRelation: string | null
}

export type CbInsightsRecord = Record<string, unknown>

export interface CbInsightsListResponse extends ToolResponse {
  output: CbInsightsPageInfo & {
    orgs: CbInsightsRecord[]
  }
}

export interface CbInsightsOrgListResponse extends ToolResponse {
  output: {
    orgs: CbInsightsRecord[]
  }
}

/**
 * Business relationships is the one paged multi-organization endpoint that
 * reports no total — its documented response carries `orgs` and `nextPageToken`
 * only.
 */
export interface CbInsightsPagedOrgListResponse extends ToolResponse {
  output: {
    orgs: CbInsightsRecord[]
    nextPageToken: string | null
  }
}

export interface CbInsightsPagedItemsResponse extends ToolResponse {
  output: CbInsightsPageInfo & {
    items: CbInsightsRecord[]
  }
}

export interface CbInsightsItemsResponse extends ToolResponse {
  output: {
    items: CbInsightsRecord[]
  }
}

export interface CbInsightsObjectResponse extends ToolResponse {
  output: {
    data: CbInsightsRecord
  }
}

export interface CbInsightsChatResponse extends ToolResponse {
  output: {
    chatId: string | null
    title: string | null
    message: string | null
    sources: CbInsightsRecord[]
    relatedContent: CbInsightsRecord[]
    suggestions: string[]
  }
}

export interface CbInsightsRagResponse extends ToolResponse {
  output: {
    data: string | null
    guidance: string[]
  }
}

export interface CbInsightsScoutingReportResponse extends ToolResponse {
  output: {
    orgInfo: CbInsightsRecord | null
    reportMarkdown: string | null
    reportJson: string | null
  }
}

export interface CbInsightsStrategyMapResponse extends ToolResponse {
  output: {
    orgName: string | null
    logoUrl: string | null
    categories: CbInsightsRecord[]
  }
}

export interface CbInsightsMosaicHistoryResponse extends ToolResponse {
  output: {
    overall: CbInsightsRecord[]
    management: CbInsightsRecord[]
    market: CbInsightsRecord[]
    momentum: CbInsightsRecord[]
    money: CbInsightsRecord[]
  }
}

export interface CbInsightsExitProbabilityHistoryResponse extends ToolResponse {
  output: {
    ipo: CbInsightsRecord[]
    mna: CbInsightsRecord[]
    incompleteRoundType: string | null
  }
}

export interface CbInsightsFundingWindowResponse extends ToolResponse {
  output: {
    windowStart: string | null
    windowEnd: string | null
    cohortNextRoundRate: number | null
    cohortCriteria: CbInsightsRecord | null
    latestFunding: CbInsightsRecord | null
  }
}

export interface CbInsightsRevenueResponse extends ToolResponse {
  output: {
    orgId: number | null
    orgName: string | null
    orgUrl: string | null
    revenue: CbInsightsRecord[]
  }
}

export interface CbInsightsFundingsResponse extends ToolResponse {
  output: CbInsightsPageInfo & {
    fundings: CbInsightsRecord[]
    capTableHistory: CbInsightsRecord[]
  }
}

export type CbInsightsResponse =
  | CbInsightsListResponse
  | CbInsightsOrgListResponse
  | CbInsightsPagedOrgListResponse
  | CbInsightsPagedItemsResponse
  | CbInsightsItemsResponse
  | CbInsightsObjectResponse
  | CbInsightsChatResponse
  | CbInsightsRagResponse
  | CbInsightsScoutingReportResponse
  | CbInsightsStrategyMapResponse
  | CbInsightsMosaicHistoryResponse
  | CbInsightsExitProbabilityHistoryResponse
  | CbInsightsFundingWindowResponse
  | CbInsightsRevenueResponse
  | CbInsightsFundingsResponse
