import { db } from '@sim/db'
import { docsEmbeddings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, like, notLike, or, sql } from 'drizzle-orm'
import { SearchDocs } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { generateSearchEmbedding } from '@/lib/knowledge/embeddings'

interface SearchDocsParams {
  query: string
  topK?: number
  path?: string
}

const DEFAULT_DOCS_SIMILARITY_THRESHOLD = 0.3
const DEFAULT_TOP_K = 10
const MAX_TOP_K = 25
const DOCS_DOCUMENTATION_PREFIX = 'docs/documentation'

/**
 * Maps a docs/documentation/... VFS path onto a docs_embeddings source_document
 * scope tail. VFS paths mirror docs.sim.ai URLs while source_document stores
 * the en-relative mdx path, so a scope tail must cover both layouts a page can
 * have on disk: `<tail>.mdx` and `<tail>/...` (including `<tail>/index.mdx`).
 * Returns undefined for an unscoped search; throws when the path does not
 * address docs/documentation/.
 */
export function docsScopeTail(path?: string): string | undefined {
  if (!path || path.trim() === '') return undefined
  const normalized = path.trim().replace(/^\.?\//, '')
  if (
    normalized !== DOCS_DOCUMENTATION_PREFIX &&
    !normalized.startsWith(`${DOCS_DOCUMENTATION_PREFIX}/`)
  ) {
    throw new Error(`path must start with ${DOCS_DOCUMENTATION_PREFIX}/ (got "${path}")`)
  }
  const tail = normalized
    .slice(DOCS_DOCUMENTATION_PREFIX.length)
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/index\.mdx$/, '')
    .replace(/\.mdx$/, '')
  return tail === '' ? undefined : tail
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Unscoped searches cover exactly the Documentation tab (everything under the
 * docs/documentation/ VFS tree), so Academy and API-reference rows are
 * excluded; a scope tail narrows to one page or directory subtree.
 */
function scopeCondition(tail?: string) {
  if (!tail) {
    return and(
      notLike(docsEmbeddings.sourceDocument, 'academy/%'),
      notLike(docsEmbeddings.sourceDocument, 'api-reference/%')
    )
  }
  return or(
    eq(docsEmbeddings.sourceDocument, `${tail}.mdx`),
    like(docsEmbeddings.sourceDocument, `${escapeLikePattern(tail)}/%`)
  )
}

export const searchDocsServerTool: BaseServerTool<SearchDocsParams, any> = {
  name: SearchDocs.id,
  async execute(params: SearchDocsParams): Promise<any> {
    const logger = createLogger('SearchDocsServerTool')
    const { query, path } = params
    if (!query || typeof query !== 'string') throw new Error('query is required')
    const topK = Math.min(Math.max(Math.trunc(params.topK ?? DEFAULT_TOP_K), 1), MAX_TOP_K)
    const scopeTail = docsScopeTail(path)

    logger.info('Executing docs search', { query, topK, path: path ?? null })

    const { embedding: queryEmbedding } = await generateSearchEmbedding(query)
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return { results: [], query, totalResults: 0 }
    }

    const results = await db
      .select({
        chunkId: docsEmbeddings.chunkId,
        chunkText: docsEmbeddings.chunkText,
        sourceDocument: docsEmbeddings.sourceDocument,
        sourceLink: docsEmbeddings.sourceLink,
        headerText: docsEmbeddings.headerText,
        headerLevel: docsEmbeddings.headerLevel,
        similarity: sql<number>`1 - (${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
      })
      .from(docsEmbeddings)
      .where(scopeCondition(scopeTail))
      .orderBy(sql`${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(topK)

    const filteredResults = results.filter((r) => r.similarity >= DEFAULT_DOCS_SIMILARITY_THRESHOLD)
    const documentationResults = filteredResults.map((r, idx) => ({
      id: idx + 1,
      title: String(r.headerText || 'Untitled Section'),
      url: String(r.sourceLink || '#'),
      content: String(r.chunkText || ''),
      similarity: r.similarity,
    }))

    logger.info('Docs search complete', { count: documentationResults.length })
    return { results: documentationResults, query, totalResults: documentationResults.length }
  },
}
