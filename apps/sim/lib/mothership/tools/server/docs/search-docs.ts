import type { DocsSearchResult } from '@/lib/mothership/docs/docs-search'
import { searchDocs } from '@/lib/mothership/docs/docs-search'
import { SearchDocs } from '@/lib/mothership/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { ServerToolModelInputError } from '@/lib/mothership/tools/server/model-input'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

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
  if (results.length === 0 && candidatesConsidered === 0) {
    return 'No indexed candidates were returned. The search index may lag the live docs. Rephrase the query, or read the block definition and tips directly (blocks get / blocks tips).'
  }
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
    ? `No relevant matches. The search index returned ${candidatesConsidered} candidate(s), but ${dropped} — this does NOT mean the docs lack this topic. Rephrase the query, widen it by dropping the path scope, or read the block definition and tips directly (blocks get / blocks tips).`
    : `Returned ${results.length} of ${candidatesConsidered} candidate(s); ${dropped}. Rephrase or widen the query if these look off-topic.`
}

/**
 * Vector search over Sim's product documentation, scoped to the same pages the
 * agent can `read` from the `docs/` VFS tree. Normal delegation exposes it to
 * the platform agent; the `@Docs` compatibility path also invokes it directly.
 * Corpus logic lives in `@/lib/mothership/docs/docs-search`.
 */
export const searchDocsServerTool: BaseServerTool<SearchDocsParams, SearchDocsOutput> = {
  name: SearchDocs.id,
  async execute(params: SearchDocsParams, context?: ServerToolContext): Promise<SearchDocsOutput> {
    const queryProjection = projectResolvedSecretModelContent(
      params.query,
      context?.resolvedSecretTraceRegistry
    )
    if (!queryProjection.safe || typeof queryProjection.value !== 'string') {
      throw new ServerToolModelInputError('Docs search query could not be processed safely')
    }
    const query = queryProjection.value
    const outcome = await searchDocs(query, { path: params.path, topK: params.topK })
    const note = shortfallNote(outcome)
    return {
      results: outcome.results,
      query,
      totalResults: outcome.results.length,
      ...(note ? { note } : {}),
    }
  },
}
