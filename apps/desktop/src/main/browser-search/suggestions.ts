import { net } from 'electron'

const GOOGLE_SUGGESTIONS_ENDPOINT = 'https://suggestqueries.google.com/complete/search'
const SEARCH_SUGGESTION_TIMEOUT_MS = 2_500
const SEARCH_SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1_000
const MAX_SEARCH_SUGGESTION_CACHE_ENTRIES = 100
const MAX_SEARCH_SUGGESTION_QUERY_LENGTH = 200
const MAX_SEARCH_SUGGESTION_LENGTH = 256
const MAX_SEARCH_SUGGESTIONS = 7

type SearchSuggestionFetch = (url: string, init: RequestInit) => Promise<Response>

interface CachedSearchSuggestions {
  expiresAt: number
  values: string[]
}

/**
 * Validates the small portion of Google's Firefox-completion response that the
 * omnibox consumes. Everything else in the provider payload is ignored.
 */
export function parseSearchSuggestionResponse(payload: unknown, query: string): string[] {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return []

  const queryKey = query.toLocaleLowerCase()
  const seen = new Set([queryKey])
  const suggestions: string[] = []
  for (const candidate of payload[1]) {
    if (typeof candidate !== 'string') continue
    const value = candidate.trim()
    const key = value.toLocaleLowerCase()
    if (!value || value.length > MAX_SEARCH_SUGGESTION_LENGTH || seen.has(key)) continue
    seen.add(key)
    suggestions.push(value)
    if (suggestions.length === MAX_SEARCH_SUGGESTIONS) break
  }
  return suggestions
}

/**
 * In-memory, bounded search completion client. Queries go only to the fixed
 * Google suggestions origin and are never logged or written to disk.
 */
export class SearchSuggestionService {
  private readonly cache = new Map<string, CachedSearchSuggestions>()

  constructor(
    private readonly fetcher: SearchSuggestionFetch,
    private readonly now: () => number = Date.now
  ) {}

  async suggest(rawQuery: unknown): Promise<string[]> {
    if (typeof rawQuery !== 'string') return []
    const query = rawQuery.trim()
    if (query.length < 2 || query.length > MAX_SEARCH_SUGGESTION_QUERY_LENGTH) return []

    const cacheKey = query.toLocaleLowerCase()
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) return [...cached.values]
    if (cached) this.cache.delete(cacheKey)

    const url = new URL(GOOGLE_SUGGESTIONS_ENDPOINT)
    url.searchParams.set('client', 'firefox')
    url.searchParams.set('q', query)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SEARCH_SUGGESTION_TIMEOUT_MS)

    try {
      const response = await this.fetcher(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) return []
      const values = parseSearchSuggestionResponse(await response.json(), query)
      this.remember(cacheKey, values)
      return [...values]
    } catch {
      return []
    } finally {
      clearTimeout(timeout)
    }
  }

  private remember(key: string, values: string[]): void {
    if (this.cache.size >= MAX_SEARCH_SUGGESTION_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (typeof oldest === 'string') this.cache.delete(oldest)
    }
    this.cache.set(key, {
      expiresAt: this.now() + SEARCH_SUGGESTION_CACHE_TTL_MS,
      values: [...values],
    })
  }
}

const searchSuggestionService = new SearchSuggestionService((url, init) => net.fetch(url, init))

/** Fetches live Google completions, failing closed to an empty local-only list. */
export function getSearchSuggestions(query: unknown): Promise<string[]> {
  return searchSuggestionService.suggest(query)
}
