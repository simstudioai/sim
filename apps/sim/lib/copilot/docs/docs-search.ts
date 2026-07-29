import { db } from '@sim/db'
import { docsEmbeddings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, like, notLike, or, sql } from 'drizzle-orm'
import { docsPathForSourceDocument, isDocsDir, isDocsPage } from '@/lib/copilot/docs/docs-corpus'
import { docsSourceCandidates, UNMOUNTED_DOCS_SECTIONS } from '@/lib/copilot/docs/docs-path'
import { generateSearchEmbedding } from '@/lib/knowledge/embeddings'

const logger = createLogger('DocsSearch')

const SIMILARITY_THRESHOLD = 0.3
const DEFAULT_TOP_K = 5
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
 * A search result set plus why it may be shorter than `topK`. The SQL LIMIT is
 * applied before the threshold and liveness filters, so these counts are what
 * distinguishes "nothing matched" from "matches were filtered out".
 */
export interface DocsSearchOutcome {
  results: DocsSearchResult[]
  /** Rows the vector search returned before filtering. */
  candidatesConsidered: number
  /** Candidates dropped for scoring below the similarity threshold. */
  droppedBelowThreshold: number
  /** Candidates dropped because their page is no longer in the docs manifest. */
  droppedStale: number
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
 * the whole subtree plus the overview in either layout.
 *
 * An unscoped search excludes every {@link UNMOUNTED_DOCS_SECTIONS} section:
 * they are indexed but not mounted in the VFS, so a hit there would be a chunk
 * the agent cannot then read.
 */
function scopeCondition(path?: string) {
  const normalized = (path ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (normalized === '' || normalized === 'docs') {
    return and(
      ...UNMOUNTED_DOCS_SECTIONS.map((section) =>
        notLike(docsEmbeddings.sourceDocument, `${section}/%`)
      )
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
    const [pageFile, indexFile] = docsSourceCandidates(tail)
    return or(
      eq(docsEmbeddings.sourceDocument, pageFile),
      eq(docsEmbeddings.sourceDocument, indexFile)
    )
  }

  if (isDocsDir(normalized)) {
    // Everything under the directory, PLUS a sibling `<tail>.mdx`. Fumadocs
    // accepts either layout for a section overview and only `<tail>/index.mdx`
    // is inside the subtree, so matching the prefix alone would silently omit
    // the overview for the sibling layout — page scope already covers both.
    return or(
      like(docsEmbeddings.sourceDocument, `${escapeLikePattern(tail)}/%`),
      eq(docsEmbeddings.sourceDocument, `${tail}.mdx`)
    )
  }

  throw new DocsSearchScopeError(
    `"${path}" is not a page or section in the docs corpus. Use glob("docs/**") to find a valid path, or omit path to search everything.`
  )
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Clamp a caller-supplied result count into [1, {@link MAX_TOP_K}].
 *
 * Guards magnitude AND type: `Math.min`/`Math.max` propagate NaN, so a
 * non-numeric value would otherwise reach the query as `.limit(NaN)`. The
 * generated tool schema rejects a non-number upstream today, but this function
 * is also called directly, so it does not rely on that.
 */
function clampTopK(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_TOP_K
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_TOP_K)
}

/**
 * Semantic search over the indexed docs corpus (`docs_embeddings`, rebuilt by
 * `scripts/process-docs.ts` on release). Every result carries the `docs/` path
 * it came from so the caller can `read` the full page next.
 *
 * The index lags the VFS: a page added since the last index rebuild is readable
 * but not searchable, and a deleted one can still return chunks. Results whose
 * source no longer maps to a live `docs/` path are dropped.
 *
 * Because those drops happen after the SQL LIMIT, a caller can get fewer hits
 * than it asked for — or none at all when every candidate was filtered. The
 * returned {@link DocsSearchOutcome} reports that explicitly so an empty result
 * is never mistaken for "the documentation does not cover this".
 */
export async function searchDocs(
  query: string,
  options?: { path?: string; topK?: number }
): Promise<DocsSearchOutcome> {
  if (!query || typeof query !== 'string') throw new Error('query is required')

  const topK = clampTopK(options?.topK)
  const where = scopeCondition(options?.path)

  logger.info('Executing docs search', { query, topK, path: options?.path ?? null })

  const { embedding: queryEmbedding } = await generateSearchEmbedding(query)
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return { results: [], candidatesConsidered: 0, droppedBelowThreshold: 0, droppedStale: 0 }
  }

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
  let droppedBelowThreshold = 0
  let droppedStale = 0
  for (const row of rows) {
    if (row.similarity < SIMILARITY_THRESHOLD) {
      droppedBelowThreshold++
      continue
    }
    const path = docsPathForSourceDocument(row.sourceDocument)
    if (!path) {
      droppedStale++
      continue
    }
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
    droppedBelowThreshold,
    droppedStale,
  })
  return {
    results,
    candidatesConsidered: rows.length,
    droppedBelowThreshold,
    droppedStale,
  }
}
