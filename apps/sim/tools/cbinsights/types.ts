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
