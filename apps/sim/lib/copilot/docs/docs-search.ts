import { db } from '@sim/db'
import { docsEmbeddings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, like, notLike, or, sql } from 'drizzle-orm'
import { docsPathForSourceDocument, isDocsDir, isDocsPage } from '@/lib/copilot/docs/docs-corpus'
import { generateSearchEmbedding } from '@/lib/knowledge/embeddings'

const logger = createLogger('DocsSearch')

const SIMILARITY_THRESHOLD = 0.3
const DEFAULT_TOP_K = 10
const MAX_TOP_K = 25

export interface DocsSearchResult {
  /** The `docs/` VFS path this chunk came from — pass it to `read` for the full page. */
  path: string
  /** Public docs.sim.ai URL for the section, for citation. */
  url: string
  title: string
  content: string
  similarity: number
}

/**
 * Thrown when the caller scopes a search to a `path` that is not a real page or
 * section in the docs corpus. Surfaced verbatim so the model can correct itself
 * rather than reading an empty result as "the docs say nothing about this".
 */
export class DocsSearchScopeError extends Error {
  readonly code = 'DOCS_SEARCH_SCOPE' as const
  constructor(message: string) {
    super(message)
    this.name = 'DocsSearchScopeError'
  }
}

/**
 * Translate an optional `docs/` VFS path into a `source_document` filter.
 *
 * `source_document` stores the en-relative mdx file path, while VFS paths mirror
 * the public URL — so a section overview is `docs/workflows.mdx` in the VFS but
 * `workflows/index.mdx` (or `workflows.mdx`) on disk. A directory scope covers
 * the whole subtree, including that overview page.
 *
 * Returns undefined for an unscoped search, which excludes `academy/` and
 * `api-reference/`: both are indexed but neither is mounted in the VFS, so a hit
 * there would be a chunk the agent cannot then read.
 */
function scopeCondition(path?: string) {
  const normalized = (path ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (normalized === '' || normalized === 'docs') {
    return and(
      notLike(docsEmbeddings.sourceDocument, 'academy/%'),
      notLike(docsEmbeddings.sourceDocument, 'api-reference/%')
    )
  }

  if (!normalized.startsWith('docs/')) {
    throw new DocsSearchScopeError(
      `path must be a docs/ VFS path (got "${path}"). Use glob("docs/**") to find one, or omit path to search everything.`
    )
  }

  const tail = normalized.slice('docs/'.length)

  if (isDocsPage(normalized)) {
    // One page: on disk it is either `<tail>.mdx` or `<tail>/index.mdx`.
    const stem = tail.replace(/\.mdx$/, '')
    return or(
      eq(docsEmbeddings.sourceDocument, `${stem}.mdx`),
      eq(docsEmbeddings.sourceDocument, `${stem}/index.mdx`)
    )
  }

  if (isDocsDir(normalized)) {
    return like(docsEmbeddings.sourceDocument, `${escapeLikePattern(tail)}/%`)
  }

  throw new DocsSearchScopeError(
    `"${path}" is not a page or section in the docs corpus. Use glob("docs/**") to find a valid path, or omit path to search everything.`
  )
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Semantic search over the indexed docs corpus (`docs_embeddings`, rebuilt by
 * `scripts/process-docs.ts` on release). Every result carries the `docs/` path
 * it came from so the caller can `read` the full page next.
 *
 * The index lags the VFS: a page added since the last index rebuild is readable
 * but not searchable, and a deleted one can still return chunks. Results whose
 * source no longer maps to a live `docs/` path are dropped.
 */
export async function searchDocs(
  query: string,
  options?: { path?: string; topK?: number }
): Promise<DocsSearchResult[]> {
  if (!query || typeof query !== 'string') throw new Error('query is required')

  const topK = Math.min(Math.max(Math.trunc(options?.topK ?? DEFAULT_TOP_K), 1), MAX_TOP_K)
  const where = scopeCondition(options?.path)

  logger.info('Executing docs search', { query, topK, path: options?.path ?? null })

  const { embedding: queryEmbedding } = await generateSearchEmbedding(query)
  if (!queryEmbedding || queryEmbedding.length === 0) return []

  const rows = await db
    .select({
      chunkText: docsEmbeddings.chunkText,
      sourceDocument: docsEmbeddings.sourceDocument,
      sourceLink: docsEmbeddings.sourceLink,
      headerText: docsEmbeddings.headerText,
      similarity: sql<number>`1 - (${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
    })
    .from(docsEmbeddings)
    .where(where)
    .orderBy(sql`${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
    .limit(topK)

  const results: DocsSearchResult[] = []
  for (const row of rows) {
    if (row.similarity < SIMILARITY_THRESHOLD) continue
    const path = docsPathForSourceDocument(row.sourceDocument)
    if (!path) continue
    results.push({
      path,
      url: String(row.sourceLink || '#'),
      title: String(row.headerText || 'Untitled Section'),
      content: String(row.chunkText || ''),
      similarity: row.similarity,
    })
  }

  logger.info('Docs search complete', {
    count: results.length,
    dropped: rows.length - results.length,
  })
  return results
}
