import type { ToolResponse } from '@/tools/types'

/** Domain filters shared by Search, Answer, and Research source control. */
export interface YouComDomainFilterParams {
  includeDomains?: string | string[]
  excludeDomains?: string | string[]
  boostDomains?: string | string[]
}

export interface YouComSearchParams extends YouComDomainFilterParams {
  apiKey: string
  query: string
  count?: number
  offset?: number
  freshness?: string
  country?: string
  language?: string
  safesearch?: string
  knowledge?: string
  extractionMode?: string
  extractionSource?: string
  extractionFormats?: string | string[]
  crawlTimeout?: number
}

interface YouComWebResult {
  url: string | null
  title: string | null
  description: string | null
  snippets: string[]
  thumbnailUrl: string | null
  faviconUrl: string | null
  pageAge: string | null
  highlights: string[]
  html: string | null
  markdown: string | null
}

interface YouComNewsResult {
  url: string | null
  title: string | null
  description: string | null
  thumbnailUrl: string | null
  pageAge: string | null
  html: string | null
  markdown: string | null
}

interface YouComKnowledgeResult {
  type: string
  title: string
  description: string | null
  asOf: string | null
  attribution: Array<{ name: string; sourceDescription: string | null }>
}

export interface YouComSearchResponse extends ToolResponse {
  output: {
    web: YouComWebResult[]
    news: YouComNewsResult[]
    knowledge: YouComKnowledgeResult[]
    searchUuid: string | null
    query: string | null
    latency: number | null
  }
}

export interface YouComGetContentsParams {
  apiKey: string
  urls: string | string[]
  formats?: string | string[]
  crawlTimeout?: number
  maxAge?: number
}

interface YouComContentsResult {
  url: string | null
  title: string | null
  html: string | null
  markdown: string | null
  siteName: string | null
  faviconUrl: string | null
}

export interface YouComGetContentsResponse extends ToolResponse {
  output: {
    pages: YouComContentsResult[]
  }
}

export interface YouComAnswerParams extends YouComDomainFilterParams {
  apiKey: string
  query: string
  freshness?: string
  country?: string
  language?: string
  safesearch?: string
}

export interface YouComAnswerResponse extends ToolResponse {
  output: {
    answer: string
    citations: Array<{ source: string; excerpts: string[] }>
    results: Array<{
      url: string
      title: string
      snippets: string[]
      description: string | null
      thumbnailUrl: string | null
      pageAge: string | null
    }>
  }
}

export interface YouComResearchSource {
  url: string
  title: string | null
  snippets: string[]
}

export interface YouComResearchParams extends YouComDomainFilterParams {
  apiKey: string
  input: string
  researchEffort?: string
  outputSchema?: string | Record<string, unknown>
  background?: boolean
  freshness?: string
  country?: string
}

export interface YouComResearchResponse extends ToolResponse {
  output: {
    content: string | Record<string, unknown> | null
    contentType: string | null
    sources: YouComResearchSource[]
    warnings: string[]
    taskId: string | null
    status: string | null
    streamUrl: string | null
    createdAt: string | null
  }
}

export interface YouComGetResearchTaskParams {
  apiKey: string
  taskId: string
}

export interface YouComGetResearchTaskResponse extends ToolResponse {
  output: {
    taskId: string
    taskType: string
    status: string
    createdAt: string
    updatedAt: string | null
    completedAt: string | null
    error: string | null
    taskInput: {
      input: string
      researchEffort: string
      background: boolean
      outputSchema: Record<string, unknown> | null
      sourceControl: Record<string, unknown> | null
      type: string
    } | null
    content: string | Record<string, unknown> | null
    contentType: string | null
    sources: YouComResearchSource[]
    warnings: string[]
  }
}

export interface YouComFinanceResearchParams {
  apiKey: string
  input: string
  researchEffort?: string
}

export interface YouComFinanceResearchResponse extends ToolResponse {
  output: {
    content: string
    contentType: string
    sources: YouComResearchSource[]
    warnings: string[]
  }
}

export interface YouComSearchImagesParams {
  apiKey: string
  query: string
  count?: number
}

export interface YouComSearchImagesResponse extends ToolResponse {
  output: {
    images: Array<{
      title: string | null
      pageUrl: string | null
      imageUrl: string | null
      thumbnail: string | null
      largeThumbnail: string | null
    }>
    query: string | null
    searchUuid: string | null
  }
}

export interface YouComGetAccountBalanceParams {
  apiKey: string
}

export interface YouComGetAccountBalanceResponse extends ToolResponse {
  output: {
    accountId: string
    accountType: string
    balance: number
  }
}
