import type { DocsSearchResult } from '@/lib/copilot/docs/docs-search'
import { searchDocs } from '@/lib/copilot/docs/docs-search'
import { SearchDocs } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

interface SearchDocsParams {
  query: string
  topK?: number
  path?: string
}

interface SearchDocsOutput {
  results: DocsSearchResult[]
  query: string
  totalResults: number
  /**
   * Present only when the vector search matched chunks that were then filtered
   * out. Without it an empty result set reads as "the docs do not cover this",
   * which sends the caller off to guess instead of rephrasing or falling back
   * to glob.
   */
  note?: string
}

/**
 * Explain a short or empty result set in terms the caller can act on. Returns
 * undefined when nothing was dropped — the common case needs no commentary.
 */
function shortfallNote(outcome: Awaited<ReturnType<typeof searchDocs>>): string | undefined {
  const { results, candidatesConsidered, droppedBelowThreshold, droppedStale } = outcome
  if (droppedBelowThreshold === 0 && droppedStale === 0) return undefined

  const reasons: string[] = []
  if (droppedBelowThreshold > 0)
    reasons.push(`${droppedBelowThreshold} scored too low to be relevant`)
  if (droppedStale > 0) {
    reasons.push(
      `${droppedStale} point at pages no longer in the docs (the search index lags the site)`
    )
  }
  const dropped = reasons.join(' and ')

  return results.length === 0
    ? `No relevant matches. The search index returned ${candidatesConsidered} candidate(s), but ${dropped} — this does NOT mean the docs lack this topic. Rephrase the query, widen it by dropping the path scope, or browse with glob("docs/**").`
    : `Returned ${results.length} of ${candidatesConsidered} candidate(s); ${dropped}. Rephrase or widen the query if these look off-topic.`
}

/**
 * Vector search over Sim's product documentation, scoped to the same pages the
 * agent can `read` from the `docs/` VFS tree. Search-agent only; the corpus
 * logic lives in `@/lib/copilot/docs/docs-search`.
 */
export const searchDocsServerTool: BaseServerTool<SearchDocsParams, SearchDocsOutput> = {
  name: SearchDocs.id,
  async execute(params: SearchDocsParams): Promise<SearchDocsOutput> {
    const outcome = await searchDocs(params.query, { path: params.path, topK: params.topK })
    const note = shortfallNote(outcome)
    return {
      results: outcome.results,
      query: params.query,
      totalResults: outcome.results.length,
      ...(note ? { note } : {}),
    }
  },
}
