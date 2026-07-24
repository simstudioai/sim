import { searchDocs } from '@/lib/copilot/docs/docs-search'
import { SearchDocs } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

interface SearchDocsParams {
  query: string
  topK?: number
  path?: string
}

interface SearchDocsOutput {
  results: Awaited<ReturnType<typeof searchDocs>>
  query: string
  totalResults: number
}

/**
 * Vector search over Sim's product documentation, scoped to the same pages the
 * agent can `read` from the `docs/` VFS tree. Search-agent only; the corpus
 * logic lives in `@/lib/copilot/docs/docs-search`.
 */
export const searchDocsServerTool: BaseServerTool<SearchDocsParams, SearchDocsOutput> = {
  name: SearchDocs.id,
  async execute(params: SearchDocsParams): Promise<SearchDocsOutput> {
    const results = await searchDocs(params.query, { path: params.path, topK: params.topK })
    return { results, query: params.query, totalResults: results.length }
  },
}
