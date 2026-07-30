import type { ToolResponse } from '@/tools/types'

interface ExaBaseParams {
  apiKey: string
}

/** Cost breakdown returned by Exa API responses. */
interface ExaCostDollars {
  total: number
}

/**
 * Exa's content-freshness controls. `maxAgeHours` (-1 cache-only, 0 always live
 * crawl, 1-720 cache-if-younger-than) replaced `livecrawl`, which is deprecated
 * but still accepted. Sending both is a 400 — see `applyFreshness`.
 */
export interface ExaFreshnessParams {
  maxAgeHours?: number
  livecrawlTimeout?: number
  /** @deprecated Superseded by `maxAgeHours`; retained for saved workflows. */
  livecrawl?: 'always' | 'fallback' | 'never' | 'preferred'
}

/**
 * Search modes Exa accepts. `instant` through `deep-reasoning` are the current
 * documented set; `neural`, `keyword`, and `hybrid` are legacy values the API
 * still honors, kept so workflows saved against the old dropdown keep running.
 */
export type ExaSearchType =
  | 'instant'
  | 'fast'
  | 'auto'
  | 'deep-lite'
  | 'deep'
  | 'deep-reasoning'
  | 'neural'
  | 'keyword'
  | 'hybrid'

/** Field-level citations Exa returns alongside structured output. */
interface ExaGrounding {
  field: string
  citations: { url: string; title?: string }[]
  confidence?: number
}

interface ExaEntity {
  id: string
  type: string
  version: number
  properties: Record<string, unknown>
}

interface ExaSubpage {
  title?: string
  url: string
  publishedDate?: string
  author?: string
  id?: string
}

export interface ExaSearchParams extends ExaBaseParams, ExaFreshnessParams {
  query: string
  numResults?: number
  type?: ExaSearchType
  includeDomains?: string
  excludeDomains?: string
  category?: string
  text?: boolean
  highlights?: boolean
  summary?: boolean
  summaryQuery?: string
  subpages?: number
  subpageTarget?: string
  extrasLinks?: number
  extrasImageLinks?: number
  outputSchema?: string | Record<string, unknown>
  systemPrompt?: string
  userLocation?: string
  startPublishedDate?: string
  endPublishedDate?: string
  /** @deprecated Crawl-date filters are deprecated; use the published-date pair. */
  startCrawlDate?: string
  /** @deprecated Crawl-date filters are deprecated; use the published-date pair. */
  endCrawlDate?: string
}

interface ExaSearchResult {
  id?: string
  title: string
  url: string
  publishedDate?: string
  author?: string
  summary?: string
  favicon?: string
  image?: string
  text?: string
  highlights?: string[]
  highlightScores?: number[]
  subpages?: ExaSubpage[]
  entities?: ExaEntity[]
  extras?: Record<string, unknown>
  /** Only returned by the legacy `neural` search type. */
  score?: number
}

export interface ExaSearchResponse extends ToolResponse {
  output: {
    results: ExaSearchResult[]
    requestId?: string
    structuredOutput?: unknown
    grounding?: ExaGrounding[]
    __costDollars?: ExaCostDollars
  }
}

export interface ExaGetContentsParams extends ExaBaseParams, ExaFreshnessParams {
  urls?: string
  /** Result IDs from a prior search; mutually exclusive with `urls`. */
  ids?: string
  text?: boolean
  summary?: boolean
  summaryQuery?: string
  subpages?: number
  subpageTarget?: string
  highlights?: boolean
  extrasLinks?: number
  extrasImageLinks?: number
}

interface ExaGetContentsResult {
  id?: string
  url: string
  title: string
  text?: string
  summary?: string
  highlights?: string[]
  highlightScores?: number[]
  subpages?: ExaSubpage[]
  entities?: ExaEntity[]
  extras?: Record<string, unknown>
}

/** Per-URL crawl outcome, so partial failures are visible to the caller. */
interface ExaContentsStatus {
  id: string
  status: 'success' | 'error'
  source?: 'cached' | 'crawled'
  error?: Record<string, unknown>
}

export interface ExaGetContentsResponse extends ToolResponse {
  output: {
    results: ExaGetContentsResult[]
    statuses?: ExaContentsStatus[]
    requestId?: string
    __costDollars?: ExaCostDollars
  }
}

export interface ExaFindSimilarLinksParams extends ExaBaseParams, ExaFreshnessParams {
  url: string
  numResults?: number
  text?: boolean
  includeDomains?: string
  excludeDomains?: string
  excludeSourceDomain?: boolean
  category?: string
  highlights?: boolean
  summary?: boolean
}

interface ExaSimilarLink {
  id?: string
  title: string
  url: string
  text?: string
  summary?: string
  highlights?: string[]
  score?: number
}

export interface ExaFindSimilarLinksResponse extends ToolResponse {
  output: {
    similarLinks: ExaSimilarLink[]
    requestId?: string
    __costDollars?: ExaCostDollars
  }
}

export interface ExaAnswerParams extends ExaBaseParams {
  query: string
  /** Includes each cited source's full page text — not the answer's own text. */
  text?: boolean
  outputSchema?: string | Record<string, unknown>
}

export interface ExaAnswerResponse extends ToolResponse {
  output: {
    /** A string, or an object matching `outputSchema` when one is supplied. */
    answer: string | Record<string, unknown>
    citations: {
      id?: string
      title: string
      url: string
      text?: string
      author?: string
      publishedDate?: string
    }[]
    requestId?: string
    __costDollars?: ExaCostDollars
  }
}

/** Effort levels the Agent API accepts, trading cost against depth. */
export type ExaAgentEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto'

export interface ExaAgentParams extends ExaBaseParams {
  query: string
  effort?: ExaAgentEffort
  outputSchema?: string | Record<string, unknown>
  systemPrompt?: string
  previousRunId?: string
}

export interface ExaAgentResponse extends ToolResponse {
  output: {
    runId?: string
    status?: string
    stopReason?: string | null
    text: string
    structured?: unknown
    grounding?: ExaGrounding[]
    /** Legacy shape kept so workflows saved against the retired Research op resolve. */
    research?: {
      title: string
      url: string
      summary: string
      text: string
      score: number
    }[]
    __costDollars?: ExaCostDollars
  }
}

export type ExaResponse =
  | ExaSearchResponse
  | ExaGetContentsResponse
  | ExaFindSimilarLinksResponse
  | ExaAnswerResponse
  | ExaAgentResponse
