import { db } from '@sim/db'
import {
  workspaceFileSearchIndex,
  workspaceFileSearchSegment,
  workspaceFiles,
} from '@sim/db/schema'
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import type { WorkspaceFileSecretProvenanceIdentity } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  FILE_SEARCH_LOCK_TIMEOUT_MS,
  FILE_SEARCH_SEGMENT_CHARS,
  FILE_SEARCH_STATEMENT_TIMEOUT_MS,
} from '@/lib/workspace-files/search/constants'
import {
  type CompiledFileSearchPattern,
  FileSearchPatternError,
} from '@/lib/workspace-files/search/pattern'
import { createFileSearchPreview } from '@/lib/workspace-files/search/text'

export interface WorkspaceFileSearchIndexStatus {
  readyFiles: number
  pendingFiles: number
  failedFiles: number
  skippedFiles: number
  partialFiles: number
}

export interface WorkspaceFileSearchSource {
  identity: WorkspaceFileSecretProvenanceIdentity
  ownerUserId: string
}

export interface WorkspaceFileSearchResult {
  results: Array<{
    fileId: string
    lineNumber: number
    text: string
  }>
  count: number
  truncated: boolean
  complete: boolean
  indexStatus: WorkspaceFileSearchIndexStatus
  sources: WorkspaceFileSearchSource[]
}

interface SearchWorkspaceFileIndexInput {
  workspaceId: string
  pattern: CompiledFileSearchPattern
  maxResults: number
  signal?: AbortSignal
}

const QUERY_CANCELED = '57014'
const INVALID_REGULAR_EXPRESSION = '2201B'

/**
 * Walks to the driver error. Drizzle wraps a failed query in a `DrizzleQueryError`
 * that carries no `code` of its own, so reading the top-level error alone finds
 * no SQLSTATE and every fault below would fall through as an unexplained one.
 */
function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error
  while (current instanceof Error) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = current.cause
  }
  return undefined
}

/**
 * Rewrites the two database faults a search pattern can cause into faults the
 * caller can act on.
 *
 * `pg_trgm` only indexes a pattern it can extract trigrams from; a
 * punctuation-only, non-ASCII, or too-general one plans as a scan across every
 * workspace's segments, so {@link FILE_SEARCH_STATEMENT_TIMEOUT_MS} is what
 * stops one search holding a pooled connection. And PostgreSQL is the last of
 * the engines a regex passes through, so a construct that slipped the pattern
 * analyzer and `RegExp` surfaces here rather than as an unexplained failure.
 */
function asFileSearchPatternFault(error: unknown): FileSearchPatternError | null {
  const sqlState = sqlStateOf(error)
  if (sqlState === QUERY_CANCELED) {
    return new FileSearchPatternError(
      'Search timed out. Narrow the search by adding more literal characters to the pattern.'
    )
  }
  if (sqlState === INVALID_REGULAR_EXPRESSION) {
    return new FileSearchPatternError('Invalid search pattern.')
  }
  return null
}

type SegmentContent = typeof workspaceFileSearchSegment.content

function buildMatchExpression(content: SegmentContent, pattern: CompiledFileSearchPattern) {
  if (pattern.mode === 'regex') {
    return pattern.caseSensitive
      ? sql`${content} ~ ${pattern.sqlPattern}`
      : sql`${content} ~* ${pattern.sqlPattern}`
  }
  return pattern.caseSensitive
    ? sql`${content} LIKE ${pattern.sqlPattern} ESCAPE '\\'`
    : sql`${content} ILIKE ${pattern.sqlPattern} ESCAPE '\\'`
}

/** How much of the logical line surrounds a literal match, in the narrower direction. */
function buildSurroundingContext(
  content: SegmentContent,
  literalText: string,
  caseSensitive: boolean
) {
  const matchPosition = caseSensitive
    ? sql<number>`strpos(${content}, ${literalText})`
    : sql<number>`strpos(lower(${content}), lower(${literalText}))`
  return sql<number>`least(
    ${matchPosition} - 1,
    char_length(${content}) - (${matchPosition} - 1) - char_length(${literalText})
  )`
}

export async function searchWorkspaceFileIndex({
  workspaceId,
  pattern,
  maxResults,
  signal,
}: SearchWorkspaceFileIndexInput): Promise<WorkspaceFileSearchResult> {
  signal?.throwIfAborted()

  const content = workspaceFileSearchSegment.content
  const matchExpression = buildMatchExpression(content, pattern)

  /**
   * A logical line longer than {@link FILE_SEARCH_SEGMENT_CHARS} is stored as
   * several overlapping segments, and `segmentLogicalLine` splits at exactly
   * that width — so this predicate selects the segments that are a whole line.
   */
  const segmentScope = pattern.wholeLineOnly
    ? and(
        eq(workspaceFileSearchSegment.workspaceId, workspaceId),
        lte(workspaceFileSearchSegment.lineLength, FILE_SEARCH_SEGMENT_CHARS)
      )
    : eq(workspaceFileSearchSegment.workspaceId, workspaceId)

  /**
   * Which segment of a split line best represents its match. An exact match has
   * one length, so the segment with the most text on both sides of it is the
   * most readable excerpt. A regex match has no fixed length, so the earliest
   * segment wins instead — locating each candidate match in SQL to rank them
   * would cost a second regex pass over every matched row.
   */
  const segmentPreference =
    pattern.literalText === null
      ? [workspaceFileSearchSegment.segmentNumber]
      : [
          desc(buildSurroundingContext(content, pattern.literalText, pattern.caseSensitive)),
          workspaceFileSearchSegment.segmentNumber,
        ]

  try {
    /**
     * Both statements run under one set of guards, so neither the match nor the
     * coverage count can outlive the timeout. `set_config(..., true)` is
     * transaction-local and takes bound parameters, which `SET LOCAL` cannot.
     */
    const { rows, coverageRows } = await db.transaction(async (tx) => {
      await tx.execute(sql`
        select
          set_config('statement_timeout', ${`${FILE_SEARCH_STATEMENT_TIMEOUT_MS}ms`}, true),
          set_config('lock_timeout', ${`${FILE_SEARCH_LOCK_TIMEOUT_MS}ms`}, true)
      `)

      const matchedRows = await tx
        .selectDistinctOn(
          [workspaceFiles.originalName, workspaceFiles.id, workspaceFileSearchSegment.lineNumber],
          {
            fileId: workspaceFiles.id,
            fileName: workspaceFiles.originalName,
            fileKey: workspaceFiles.key,
            ownerUserId: workspaceFiles.userId,
            contentUpdatedAt: workspaceFiles.contentUpdatedAt,
            lineNumber: workspaceFileSearchSegment.lineNumber,
            segmentNumber: workspaceFileSearchSegment.segmentNumber,
            segmentStart: workspaceFileSearchSegment.segmentStart,
            lineLength: workspaceFileSearchSegment.lineLength,
            content: workspaceFileSearchSegment.content,
          }
        )
        .from(workspaceFileSearchSegment)
        .innerJoin(
          workspaceFileSearchIndex,
          and(
            eq(workspaceFileSearchIndex.fileId, workspaceFileSearchSegment.fileId),
            eq(
              workspaceFileSearchIndex.sourceContentUpdatedAt,
              workspaceFileSearchSegment.sourceContentUpdatedAt
            ),
            eq(workspaceFileSearchIndex.status, 'ready')
          )
        )
        .innerJoin(
          workspaceFiles,
          and(
            eq(workspaceFiles.id, workspaceFileSearchSegment.fileId),
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'workspace'),
            isNull(workspaceFiles.deletedAt),
            eq(workspaceFiles.contentUpdatedAt, workspaceFileSearchSegment.sourceContentUpdatedAt)
          )
        )
        .where(and(segmentScope, matchExpression))
        .orderBy(
          workspaceFiles.originalName,
          workspaceFiles.id,
          workspaceFileSearchSegment.lineNumber,
          ...segmentPreference
        )
        .limit(maxResults + 1)

      signal?.throwIfAborted()
      const coverage = await tx
        .select({
          readyFiles: sql<number>`count(*) filter (where ${workspaceFileSearchIndex.status} = 'ready')::int`,
          pendingFiles: sql<number>`count(*) filter (where ${workspaceFileSearchIndex.status} is null or ${workspaceFileSearchIndex.status} = 'pending')::int`,
          failedFiles: sql<number>`count(*) filter (where ${workspaceFileSearchIndex.status} = 'failed')::int`,
          skippedFiles: sql<number>`count(*) filter (where ${workspaceFileSearchIndex.status} = 'skipped')::int`,
          partialFiles: sql<number>`count(*) filter (where ${workspaceFileSearchIndex.partial} is true)::int`,
        })
        .from(workspaceFiles)
        .leftJoin(
          workspaceFileSearchIndex,
          and(
            eq(workspaceFileSearchIndex.fileId, workspaceFiles.id),
            eq(workspaceFileSearchIndex.sourceContentUpdatedAt, workspaceFiles.contentUpdatedAt)
          )
        )
        .where(
          and(
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'workspace'),
            isNull(workspaceFiles.deletedAt)
          )
        )

      return { rows: matchedRows, coverageRows: coverage }
    })

    signal?.throwIfAborted()
    const resultRows = rows.slice(0, maxResults)
    const indexStatus = coverageRows[0] ?? {
      readyFiles: 0,
      pendingFiles: 0,
      failedFiles: 0,
      skippedFiles: 0,
      partialFiles: 0,
    }
    const sourcesByFileId = new Map<string, WorkspaceFileSearchSource>()
    for (const row of resultRows) {
      sourcesByFileId.set(row.fileId, {
        identity: {
          fileId: row.fileId,
          key: row.fileKey,
          context: 'workspace',
          contentUpdatedAt: row.contentUpdatedAt,
        },
        ownerUserId: row.ownerUserId,
      })
    }

    const results = resultRows.map((row) => ({
      fileId: row.fileId,
      lineNumber: row.lineNumber,
      text: createFileSearchPreview(row.content, pattern, undefined, {
        prefixOmitted: row.segmentStart > 0,
        suffixOmitted: row.segmentStart + row.content.length < row.lineLength,
      }),
    }))
    signal?.throwIfAborted()
    return {
      results,
      count: results.length,
      truncated: rows.length > maxResults,
      complete: indexStatus.pendingFiles === 0 && indexStatus.failedFiles === 0,
      indexStatus,
      sources: [...sourcesByFileId.values()],
    }
  } catch (error) {
    signal?.throwIfAborted()
    const fault = asFileSearchPatternFault(error)
    if (fault) throw fault
    throw error
  }
}
