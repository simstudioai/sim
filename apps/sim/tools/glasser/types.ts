import type { ToolResponse } from '@/tools/types'

/** Lifecycle of a Glasser Run. QUEUED and RUNNING are still in flight. */
export type GlasserRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED'

export interface GlasserRunFailure {
  kind: 'TIMED_OUT' | 'INTERNAL'
  message: string
}

/**
 * The Run that every Solution call returns and that `GET /v1/runs/{id}` reads back.
 * `output` is the provider's own payload, so its shape depends on which Endpoint served the call.
 */
export interface GlasserRun {
  id: string
  run_url: string
  provider: string
  endpoint: string
  endpoint_version: number
  status: GlasserRunStatus
  failure: GlasserRunFailure | null
  input: Record<string, unknown>
  output: unknown
  provider_response: { http_status: number; error?: unknown } | null
  charge_usd: string | null
  charge_basis: { clause: string; quantity: number | null } | null
  stoppable: boolean
  stop_requested_at: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  task_id: string | null
}

export interface GlasserRunOutput {
  id: string
  run_url: string
  status: GlasserRunStatus
  provider: string
  endpoint: string
  output: unknown
  charge_usd: string | null
  failure: GlasserRunFailure | null
  task_id: string | null
}

export interface GlasserResponse extends ToolResponse {
  output: GlasserRunOutput
}

interface GlasserBaseParams {
  apiKey: string
  provider?: string
  task_id?: string
}

export type GlasserPeopleSearchAction = 'search' | 'enrich' | 'find_email'

export interface GlasserPeopleSearchParams extends GlasserBaseParams {
  action?: GlasserPeopleSearchAction
  job_titles?: string
  seniorities?: string
  locations?: string
  company_domain?: string
  keywords?: string
  full_name?: string
  email?: string
  linkedin_url?: string
  limit?: number
}

export type GlasserCompanyIntelligenceAction =
  | 'enrich'
  | 'tech_stack'
  | 'traffic'
  | 'competitors'
  | 'funding'
  | 'news'

export interface GlasserCompanyIntelligenceParams extends GlasserBaseParams {
  action?: GlasserCompanyIntelligenceAction
  domain: string
  country?: string
  query?: string
  limit?: number
}

export type GlasserSeoResearchAction =
  | 'keyword_overview'
  | 'keyword_ideas'
  | 'serp'
  | 'domain_overview'
  | 'ranked_keywords'
  | 'organic_competitors'
  | 'backlinks_overview'
  | 'backlinks'
  | 'referring_domains'
  | 'domain_rating'

export interface GlasserSeoResearchParams extends GlasserBaseParams {
  action?: GlasserSeoResearchAction
  keywords?: string
  domain?: string
  country?: string
  limit?: number
}

export type GlasserWebResearchAction =
  | 'search'
  | 'news'
  | 'places'
  | 'scholar'
  | 'shopping'
  | 'images'
  | 'videos'
  | 'answer'
  | 'scrape'
  | 'similar'

export interface GlasserWebResearchParams extends GlasserBaseParams {
  action?: GlasserWebResearchAction
  query?: string
  url?: string
  country?: string
  language?: string
  limit?: number
}

export type GlasserSocialPlatform = 'reddit' | 'x' | 'youtube' | 'tiktok' | 'instagram' | 'linkedin'
export type GlasserSocialMode = 'search' | 'profile' | 'feed' | 'post' | 'find'

export interface GlasserSocialResearchParams extends GlasserBaseParams {
  platform: GlasserSocialPlatform
  mode?: GlasserSocialMode
  query?: string
  handle?: string
  url?: string
}

export type GlasserMarketDataAction =
  | 'property_value'
  | 'property_rent'
  | 'property_search'
  | 'listings_sale'
  | 'listings_rental'
  | 'market_stats'
  | 'stock_quote'

export interface GlasserMarketDataParams extends GlasserBaseParams {
  action: GlasserMarketDataAction
  address?: string
  city?: string
  state?: string
  zip?: string
  symbol?: string
  limit?: number
}
