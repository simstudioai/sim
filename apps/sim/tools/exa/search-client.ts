import { readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import type { ExaSearchParams } from '@/tools/exa/types'

export const EXA_SEARCH_URL = 'https://api.exa.ai/search'
export const PI_EXA_MAX_RESPONSE_BYTES = 1024 * 1024

export interface PiExaSearchResult {
  title: string
  url: string
  snippet: string
  publishedDate?: string
}

export interface PiExaSearchResponse {
  results: PiExaSearchResult[]
}

interface ExaResultRecord {
  title?: unknown
  url?: unknown
  publishedDate?: unknown
  highlights?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildExaSearchBody(params: ExaSearchParams): Record<string, unknown> {
  const body: Record<string, unknown> = { query: params.query }
  if (params.numResults) body.numResults = Number(params.numResults)
  if (params.useAutoprompt !== undefined) body.useAutoprompt = params.useAutoprompt
  if (params.type) body.type = params.type
  if (params.includeDomains) {
    body.includeDomains = params.includeDomains
      .split(',')
      .map((domain) => domain.trim())
      .filter(Boolean)
  }
  if (params.excludeDomains) {
    body.excludeDomains = params.excludeDomains
      .split(',')
      .map((domain) => domain.trim())
      .filter(Boolean)
  }
  if (params.category) body.category = params.category
  if (params.startCrawlDate) body.startCrawlDate = params.startCrawlDate
  if (params.endCrawlDate) body.endCrawlDate = params.endCrawlDate
  if (params.startPublishedDate) body.startPublishedDate = params.startPublishedDate
  if (params.endPublishedDate) body.endPublishedDate = params.endPublishedDate

  const contents: Record<string, unknown> = {}
  if (params.text !== undefined) contents.text = params.text
  if (params.highlights !== undefined) contents.highlights = params.highlights
  if (params.summary !== undefined) contents.summary = params.summary
  if (params.livecrawl) contents.livecrawl = params.livecrawl
  if (Object.keys(contents).length > 0) body.contents = contents
  return body
}

function toPiResult(value: unknown): PiExaSearchResult | null {
  if (!isRecord(value)) return null
  const record = value as ExaResultRecord
  if (typeof record.url !== 'string' || !record.url) return null
  const highlights = Array.isArray(record.highlights)
    ? record.highlights.filter((item): item is string => typeof item === 'string')
    : []
  return {
    title: typeof record.title === 'string' ? record.title.slice(0, 500) : '',
    url: record.url.slice(0, 2_000),
    snippet: highlights.join('\n').slice(0, 4_000),
    ...(typeof record.publishedDate === 'string'
      ? { publishedDate: record.publishedDate.slice(0, 100) }
      : {}),
  }
}

export async function executePiExaSearch(params: {
  apiKey: string
  query: string
  numResults: number
  signal?: AbortSignal
}): Promise<PiExaSearchResponse> {
  const response = await fetch(EXA_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    },
    body: JSON.stringify({
      query: params.query,
      numResults: params.numResults,
      type: 'auto',
      contents: {
        highlights: { numSentences: 2, highlightsPerUrl: 1 },
      },
    }),
    signal: params.signal,
    redirect: 'error',
  })
  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: PI_EXA_MAX_RESPONSE_BYTES,
    label: 'Exa search response',
  })
  if (!response.ok) {
    throw new Error(`Exa search failed with status ${response.status}`)
  }

  const parsed: unknown = JSON.parse(buffer.toString('utf8'))
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    throw new Error('Exa search response is malformed')
  }
  return {
    results: parsed.results
      .map(toPiResult)
      .filter((result): result is PiExaSearchResult => result !== null)
      .slice(0, params.numResults),
  }
}
