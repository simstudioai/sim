import type { ToolResponse } from '@/tools/types'

/** Shared report response shape (visibility, sentiment, citations, bots, referrals, query fanouts, prompt volume) */
export interface ProfoundReportResponse extends ToolResponse {
  output: {
    totalRows: number
    data: Array<{
      metrics: number[]
      dimensions: string[]
    }>
  }
}

/** Shared report query params for category-based reports */
export interface ProfoundCategoryReportParams {
  apiKey: string
  categoryId: string
  startDate: string
  endDate: string
  metrics: string
  dimensions?: string
  dateInterval?: string
  filters?: string
  limit?: number
}

/** Shared report query params for domain-based reports */
export interface ProfoundDomainReportParams {
  apiKey: string
  domain: string
  startDate: string
  endDate?: string
  metrics: string
  dimensions?: string
  dateInterval?: string
  filters?: string
  limit?: number
}

// --- Organization endpoints ---

export interface ProfoundListCategoriesParams {
  apiKey: string
}

export interface ProfoundListCategoriesResponse extends ToolResponse {
  output: {
    categories: Array<{
      id: string
      name: string
    }>
  }
}

export interface ProfoundListRegionsParams {
  apiKey: string
}

export interface ProfoundListRegionsResponse extends ToolResponse {
  output: {
    regions: Array<{
      id: string
      name: string
    }>
  }
}

export interface ProfoundListModelsParams {
  apiKey: string
}

export interface ProfoundListModelsResponse extends ToolResponse {
  output: {
    models: Array<{
      id: string
      name: string
    }>
  }
}

export interface ProfoundListDomainsParams {
  apiKey: string
}

export interface ProfoundListDomainsResponse extends ToolResponse {
  output: {
    domains: Array<{
      id: string
      name: string
      createdAt: string
    }>
  }
}

export interface ProfoundListAssetsParams {
  apiKey: string
}

export interface ProfoundListAssetsResponse extends ToolResponse {
  output: {
    assets: Array<{
      id: string
      name: string
      website: string
      alternateDomains: string[] | null
      isOwned: boolean
      createdAt: string
      logoUrl: string
      categoryId: string
      categoryName: string
    }>
  }
}

export interface ProfoundListPersonasParams {
  apiKey: string
}

export interface ProfoundListPersonasResponse extends ToolResponse {
  output: {
    personas: Array<{
      id: string
      name: string
      categoryId: string
      categoryName: string
      persona: {
        behavior: { painPoints: string | null; motivations: string | null }
        employment: {
          industry: string[]
          jobTitle: string[]
          companySize: string[]
          roleSeniority: string[]
        }
        demographics: { ageRange: string[] }
      }
    }>
  }
}

// --- Category-specific endpoints ---

export interface ProfoundCategoryTopicsParams {
  apiKey: string
  categoryId: string
}

export interface ProfoundCategoryTopicsResponse extends ToolResponse {
  output: {
    topics: Array<{
      id: string
      name: string
    }>
  }
}

export interface ProfoundCategoryTagsParams {
  apiKey: string
  categoryId: string
}

export interface ProfoundCategoryTagsResponse extends ToolResponse {
  output: {
    tags: Array<{
      id: string
      name: string
    }>
  }
}

export interface ProfoundCategoryPromptsParams {
  apiKey: string
  categoryId: string
  limit?: number
  cursor?: string
  orderDir?: string
  promptType?: string
  topicId?: string
  tagId?: string
  regionId?: string
  platformId?: string
}

export interface ProfoundCategoryPromptsResponse extends ToolResponse {
  output: {
    totalRows: number
    nextCursor: string | null
    prompts: Array<{
      id: string
      prompt: string
      promptType: string
      topicId: string
      topicName: string
      tags: Array<{ id: string; name: string }>
      regions: Array<{ id: string; name: string }>
      platforms: Array<{ id: string; name: string }>
      createdAt: string
    }>
  }
}

export interface ProfoundCategoryAssetsParams {
  apiKey: string
  categoryId: string
}

export interface ProfoundCategoryAssetsResponse extends ToolResponse {
  output: {
    assets: Array<{
      id: string
      name: string
      website: string
      alternateDomains: string[] | null
      isOwned: boolean
      createdAt: string
      logoUrl: string
    }>
  }
}

export interface ProfoundCategoryPersonasParams {
  apiKey: string
  categoryId: string
}

export interface ProfoundCategoryPersonasResponse extends ToolResponse {
  output: {
    personas: Array<{
      id: string
      name: string
      persona: {
        behavior: { painPoints: string | null; motivations: string | null }
        employment: {
          industry: string[]
          jobTitle: string[]
          companySize: string[]
          roleSeniority: string[]
        }
        demographics: { ageRange: string[] }
      }
    }>
  }
}

// --- Reports ---

export type ProfoundVisibilityReportParams = ProfoundCategoryReportParams
export type ProfoundVisibilityReportResponse = ProfoundReportResponse

export type ProfoundSentimentReportParams = ProfoundCategoryReportParams
export type ProfoundSentimentReportResponse = ProfoundReportResponse

export type ProfoundCitationsReportParams = ProfoundCategoryReportParams
export type ProfoundCitationsReportResponse = ProfoundReportResponse

export type ProfoundQueryFanoutsParams = ProfoundCategoryReportParams
export type ProfoundQueryFanoutsResponse = ProfoundReportResponse

export type ProfoundBotsReportParams = ProfoundDomainReportParams
export type ProfoundBotsReportResponse = ProfoundReportResponse

export type ProfoundReferralsReportParams = ProfoundDomainReportParams
export type ProfoundReferralsReportResponse = ProfoundReportResponse

// --- Prompts ---

export interface ProfoundPromptAnswersParams {
  apiKey: string
  categoryId: string
  startDate: string
  endDate: string
  filters?: string
  limit?: number
}

export interface ProfoundPromptAnswersResponse extends ToolResponse {
  output: {
    totalRows: number
    data: Array<{
      prompt: string | null
      promptType: string | null
      response: string | null
      mentions: string[] | null
      citations: string[] | null
      topic: string | null
      region: string | null
      model: string | null
      asset: string | null
      createdAt: string | null
    }>
  }
}

// --- Agent Analytics ---

export interface ProfoundRawLogsParams {
  apiKey: string
  domain: string
  startDate: string
  endDate?: string
  dimensions?: string
  filters?: string
  limit?: number
}

export interface ProfoundRawLogsResponse extends ToolResponse {
  output: {
    totalRows: number
    data: Array<{
      metrics: number[]
      dimensions: string[]
    }>
  }
}

export interface ProfoundBotLogsParams {
  apiKey: string
  domain: string
  startDate: string
  endDate?: string
  dimensions?: string
  filters?: string
  limit?: number
}

export interface ProfoundBotLogsResponse extends ToolResponse {
  output: {
    totalRows: number
    data: Array<{
      metrics: number[]
      dimensions: string[]
    }>
  }
}

// --- Content ---

export interface ProfoundListOptimizationsParams {
  apiKey: string
  assetId: string
  limit?: number
  offset?: number
}

export interface ProfoundListOptimizationsResponse extends ToolResponse {
  output: {
    totalRows: number
    optimizations: Array<{
      id: string
      title: string
      createdAt: string
      extractedInput: string | null
      type: string
      status: string
    }>
  }
}

export interface ProfoundOptimizationAnalysisParams {
  apiKey: string
  assetId: string
  contentId: string
}

export interface ProfoundOptimizationAnalysisResponse extends ToolResponse {
  output: {
    content: {
      format: string
      value: string
    }
    aeoContentScore: {
      value: number
      targetZone: { low: number; high: number }
    } | null
    analysis: {
      breakdown: Array<{
        title: string
        weight: number
        score: number
      }>
    }
    recommendations: Array<{
      title: string
      status: string
      impact: { section: string; score: number } | null
      suggestion: { text: string; rationale: string }
    }>
  }
}

// --- Prompt Volumes ---

export interface ProfoundPromptVolumeParams {
  apiKey: string
  startDate: string
  endDate: string
  metrics: string
  dimensions?: string
  dateInterval?: string
  filters?: string
  limit?: number
}

export interface ProfoundPromptVolumeResponse extends ToolResponse {
  output: {
    totalRows: number
    data: Array<{
      metrics: number[]
      dimensions: string[]
    }>
  }
}

export interface ProfoundCitationPromptsParams {
  apiKey: string
  inputDomain: string
}

export interface ProfoundCitationPromptsResponse extends ToolResponse {
  output: {
    data: unknown
  }
}
