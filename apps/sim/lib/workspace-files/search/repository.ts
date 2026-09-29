import { dbFor } from '@sim/db'
import { workspaceFileSearchRevision, workspaceFiles } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, inArray, isNull, or, type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import type { FolderIdScope } from '@/lib/folders/scope'
import type { WorkspaceFileSecretProvenanceIdentity } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { fileDiscoveryCondition } from '@/lib/workspace-files/discovery'
import { fileSearchAdmission } from '@/lib/workspace-files/search/admission'
import {
  probeFileSearchCandidates,
  readOrderedFileSearchCandidates,
  type FileSearchCandidate as SearchCandidate,
} from '@/lib/workspace-files/search/candidates'
import {
  FILE_SEARCH_CANDIDATE_PAGE_SIZE,
  FILE_SEARCH_CANDIDATE_PROBE_SIZE,
  FILE_SEARCH_MAX_PREVIEW_BYTES,
  FILE_SEARCH_MAX_RESULTS,
  FILE_SEARCH_QUERY_GLOBAL_CONCURRENCY,
  FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY,
  FILE_SEARCH_STATEMENT_TIMEOUT_MS,
} from '@/lib/workspace-files/search/constants'
import { WorkspaceFileSearchUnavailableError } from '@/lib/workspace-files/search/errors'
import {
  alignToCodePoints,
  type CompiledFileSearchPattern,
  type FileSearchMatchRange,
  FileSearchPatternError,
} from '@/lib/workspace-files/search/pattern'
import {
  buildLiteralMatchStart,
  buildMatchExpression,
} from '@/lib/workspace-files/search/sql-pattern'
import { createFileSearchPreview } from '@/lib/workspace-files/search/text'
import { configureFileSearchTransaction } from '@/lib/workspace-files/search/transaction'

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
  /** Restricts the search to one folder scope. Absent searches the workspace. */
  folderScope?: FolderIdScope
  signal?: AbortSignal
}

const QUERY_CANCELED = '57014'
const LOCK_NOT_AVAILABLE = '55P03'
const INVALID_REGULAR_EXPRESSION = '2201B'

/** Query deadlines cover expensive patterns; lock and transaction faults are retryable. */
function asFileSearchFault(error: unknown): Error | null {
  const sqlState = getPostgresErrorCode(error)
  if (sqlState === QUERY_CANCELED) {
    return new FileSearchPatternError(
      'Search timed out. Narrow the search by adding more literal characters to the pattern.'
    )
  }
  if (sqlState === INVALID_REGULAR_EXPRESSION) {
    return new FileSearchPatternError('Invalid search pattern.')
  }
  if (sqlState === LOCK_NOT_AVAILABLE || sqlState === '25P04') {
    return new WorkspaceFileSearchUnavailableError(
      'Workspace file search is briefly unavailable while its index is being updated. Try again shortly.'
    )
  }
  return null
}

/**
 * PostgreSQL locates regex matches under the request deadline. Never execute user regexes
 * in JavaScript against file content: that would put backtracking work on the event loop.
 */
function buildMatchOffsets(content: SQLWrapper, pattern: CompiledFileSearchPattern) {
  if (pattern.mode !== 'regex') {
    return { matchStart: sql<number>`0`, matchEnd: sql<number>`0` }
  }
  const flags = pattern.caseSensitive ? '' : 'i'
  return {
    matchStart: sql<number>`regexp_instr(${content}, ${pattern.sqlPattern}, 1, 1, 0, ${flags})`,
    matchEnd: sql<number>`regexp_instr(${content}, ${pattern.sqlPattern}, 1, 1, 1, ${flags})`,
  }
}

/**
 * PostgreSQL counts characters and JavaScript slices by UTF-16 unit, so an
 * astral character shifts every offset after it by one. Walking the bounded preview
 * converts between them without assuming either width.
 */
function toPreviewRange(
  content: string,
  matchStart: number,
  matchEnd: number
): FileSearchMatchRange | null {
  if (matchStart < 1 || matchEnd <= matchStart) return null
  let units = 0
  let characters = 0
  let start = -1
  while (units < content.length) {
    if (characters === matchStart - 1) start = units
    if (characters === matchEnd - 1) break
    units += (content.codePointAt(units) ?? 0) > 0xffff ? 2 : 1
    characters += 1
  }
  if (start < 0) return null
  return alignToCodePoints(content, { start, end: units })
}

/**
 * The `workspaceFiles` predicate for a resolved folder scope.
 *
 * A root scope selects the files that carry no folder id, so the two halves are
 * OR-ed rather than folded into one list. An empty scope selects nothing: it
 * means every path resolved to a folder holding no subtree, and answering it
 * with an unrestricted search would leak the whole workspace.
 */
function buildFolderPredicate(scope: FolderIdScope): SQL | undefined {
  const ids = [...scope.folderIds]
  const inScope = ids.length > 0 ? inArray(workspaceFiles.folderId, ids) : undefined
  const atRoot = scope.includeRootItems ? isNull(workspaceFiles.folderId) : undefined
  if (inScope && atRoot) return or(inScope, atRoot)
  return inScope ?? atRoot ?? sql`false`
}

type SearchLine = {
  lineNumber: number
  content: string
  matchStart: number
  matchEnd: number
  prefixOmitted: boolean
  suffixOmitted: boolean
}

type SearchRow = SearchCandidate & SearchLine

/** Complete logical lines stay in PostgreSQL; only bounded previews cross the connection. */
async function readCandidateLines(
  tx: DbTransaction,
  candidates: readonly SearchCandidate[],
  pattern: CompiledFileSearchPattern,
  limit: number
): Promise<SearchRow[]> {
  const content = sql`line.content`
  const match = buildMatchExpression(content, pattern)
  const regexOffsets = buildMatchOffsets(content, pattern)
  const matchStart =
    pattern.mode === 'regex'
      ? regexOffsets.matchStart
      : buildLiteralMatchStart(content, pattern.literalText!, pattern.caseSensitive)
  const matchEnd = regexOffsets.matchEnd
  const candidate = candidates[0]
  const blocks = sql.join(
    candidates.map(
      (row, position) =>
        sql`(${position}::int, ${row.buildId}::text, ${row.ordinal}::int, ${row.lineStart}::int)`
    ),
    sql`, `
  )
  const logicalLines = candidate.fragment
    ? sql`SELECT 0::int AS candidate, ${candidate.lineStart}::int AS line_number, string_agg(substring(content FROM overlap + 1), '' ORDER BY ordinal) AS content
        FROM workspace_file_search_chunk WHERE build_id = ${candidate.buildId} AND line_start = ${candidate.lineStart} AND fragment`
    : sql`SELECT block.position AS candidate, (block.line_start + line.ordinality - 1)::int AS line_number, line.content
        FROM (VALUES ${blocks}) AS block(position, build_id, ordinal, line_start)
        INNER JOIN workspace_file_search_chunk chunk ON chunk.build_id = block.build_id AND chunk.ordinal = block.ordinal AND NOT chunk.fragment
        CROSS JOIN LATERAL string_to_table(chunk.content, E'\\n') WITH ORDINALITY line(content, ordinality)`
  const previewCharacters = Math.floor(FILE_SEARCH_MAX_PREVIEW_BYTES / 4)
  const lines = await tx.execute<SearchLine & { candidate: number }>(sql`
    WITH logical_lines AS MATERIALIZED (${logicalLines}), matched AS MATERIALIZED (
      SELECT line.candidate, line.content, line.line_number, ${matchStart} AS match_start, ${matchEnd} AS match_end
      FROM logical_lines line WHERE ${match} ORDER BY line.candidate, line.line_number LIMIT ${limit}
    ), preview AS (
      SELECT *, greatest(1, match_start - ${Math.floor(previewCharacters / 4)}) AS preview_start FROM matched
    )
    SELECT candidate, line_number AS "lineNumber", substring(content FROM preview_start FOR ${previewCharacters}) AS content,
      (match_start - preview_start + 1)::int AS "matchStart",
      least(match_end - preview_start + 1, ${previewCharacters + 1})::int AS "matchEnd",
      preview_start > 1 AS "prefixOmitted", preview_start + ${previewCharacters} <= char_length(content) AS "suffixOmitted"
    FROM preview ORDER BY candidate, line_number`)
  return lines.map((line) => ({ ...candidates[line.candidate], ...line }))
}

export async function searchWorkspaceFileIndex({
  workspaceId,
  pattern,
  maxResults,
  folderScope,
  signal,
}: SearchWorkspaceFileIndexInput): Promise<WorkspaceFileSearchResult> {
  signal?.throwIfAborted()
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > FILE_SEARCH_MAX_RESULTS) {
    throw new FileSearchPatternError(
      `Search result limit must be between 1 and ${FILE_SEARCH_MAX_RESULTS}`
    )
  }

  /**
   * The chunk table carries no folder id, so a scope has to travel through
   * the `workspaceFiles` join both queries already make. A scope that resolved
   * to nothing must match nothing: `inArray` with an empty list would be a
   * SQL error, and omitting the predicate would silently search everything,
   * which for a per-user folder tree is a cross-user read.
   */
  const folderPredicate = folderScope ? buildFolderPredicate(folderScope) : undefined

  return fileSearchAdmission.run(
    workspaceId,
    async (signal, deadlineAt) => {
      try {
        signal.throwIfAborted()
        /** Metadata pages and line reads share one deadline and a consistent revision snapshot. */
        const { rows, coverageRows } = await dbFor('search').transaction(
          async (tx) => {
            signal?.throwIfAborted()
            const deadline = Math.min(deadlineAt, Date.now() + FILE_SEARCH_STATEMENT_TIMEOUT_MS)
            const remainingMs = deadline - Date.now()
            if (remainingMs <= 0) {
              throw new WorkspaceFileSearchUnavailableError(
                'Workspace file search timed out. Retry shortly.'
              )
            }
            await configureFileSearchTransaction(tx, { statementTimeout: remainingMs })

            /** Transaction-owned slots release on completion, cancellation, or connection loss. */
            for (const [scope, capacity] of [
              [`workspace:${workspaceId}`, FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY],
              ['global', FILE_SEARCH_QUERY_GLOBAL_CONCURRENCY],
            ] as const) {
              const slots =
                await tx.execute(sql`SELECT slot FROM generate_series(1, ${capacity}) slot
            WHERE pg_try_advisory_xact_lock(hashtextextended('workspace-file-search-read:' || ${scope} || ':' || slot::text, 0)) LIMIT 1`)
              if (!slots.length)
                throw new WorkspaceFileSearchUnavailableError(
                  'Workspace file search is busy. Retry shortly.'
                )
            }

            const guardRemainingTime = async () => {
              signal?.throwIfAborted()
              const remaining = deadline - Date.now()
              if (remaining <= 0)
                throw new WorkspaceFileSearchUnavailableError(
                  'Search timed out. Narrow the query or folder scope.'
                )
              await tx.execute(
                sql`SELECT set_config('statement_timeout', ${`${remaining}ms`}, true)`
              )
            }
            await guardRemainingTime()
            /** Probe without a global sort. Rare queries finish here; broad queries scan files in order. */
            const probed = await probeFileSearchCandidates(tx, {
              workspaceId,
              pattern,
              folderPredicate,
            })
            const broad = probed.length > FILE_SEARCH_CANDIDATE_PROBE_SIZE
            const matchedRows: SearchRow[] = []
            let after: { name: string; id: string; lineStart: number } | undefined
            while (matchedRows.length <= maxResults) {
              await guardRemainingTime()
              let candidates = probed
              if (broad) {
                candidates = await readOrderedFileSearchCandidates(
                  tx,
                  { workspaceId, pattern, folderPredicate },
                  after
                )
              }
              for (
                let position = 0;
                position < candidates.length && matchedRows.length <= maxResults;
              ) {
                const first = candidates[position++]
                const batch = [first]
                if (first.fragment) {
                  while (
                    position < candidates.length &&
                    candidates[position].buildId === first.buildId &&
                    candidates[position].lineStart === first.lineStart
                  )
                    position++
                } else {
                  while (
                    position < candidates.length &&
                    batch.length < FILE_SEARCH_CANDIDATE_PAGE_SIZE &&
                    !candidates[position].fragment
                  )
                    batch.push(candidates[position++])
                }
                await guardRemainingTime()
                matchedRows.push(
                  ...(await readCandidateLines(
                    tx,
                    batch,
                    pattern,
                    maxResults + 1 - matchedRows.length
                  ))
                )
              }
              if (!broad || candidates.length < FILE_SEARCH_CANDIDATE_PAGE_SIZE) break
              const last = candidates.at(-1)!
              after = { name: last.fileName, id: last.fileId, lineStart: last.lineStart }
            }
            await guardRemainingTime()
            signal?.throwIfAborted()
            const coverage = await tx
              .select({
                readyFiles: sql<number>`count(*) filter (where ${workspaceFileSearchRevision.status} = 'ready' AND ${workspaceFileSearchRevision.buildId} IS NOT NULL)::int`,
                pendingFiles: sql<number>`count(*) filter (where ${workspaceFileSearchRevision.status} is null or ${workspaceFileSearchRevision.status} = 'pending' or (${workspaceFileSearchRevision.status} = 'ready' AND ${workspaceFileSearchRevision.buildId} IS NULL))::int`,
                failedFiles: sql<number>`count(*) filter (where ${workspaceFileSearchRevision.status} = 'failed')::int`,
                skippedFiles: sql<number>`count(*) filter (where ${workspaceFileSearchRevision.status} = 'skipped')::int`,
                partialFiles: sql<number>`0::int`,
              })
              .from(workspaceFiles)
              .leftJoin(
                workspaceFileSearchRevision,
                and(
                  eq(workspaceFileSearchRevision.fileId, workspaceFiles.id),
                  eq(
                    workspaceFileSearchRevision.sourceContentUpdatedAt,
                    workspaceFiles.contentUpdatedAt
                  )
                )
              )
              .where(
                and(
                  eq(workspaceFiles.workspaceId, workspaceId),
                  eq(workspaceFiles.context, 'workspace'),
                  fileDiscoveryCondition(),
                  isNull(workspaceFiles.deletedAt),
                  folderPredicate
                )
              )

            return { rows: matchedRows, coverageRows: coverage }
          },
          { isolationLevel: 'repeatable read', accessMode: 'read only' }
        )

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
            prefixOmitted: row.prefixOmitted,
            suffixOmitted: row.suffixOmitted,
            matchRange:
              pattern.mode === 'regex'
                ? toPreviewRange(row.content, row.matchStart, row.matchEnd)
                : undefined,
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
        const fault = asFileSearchFault(error)
        if (fault) throw fault
        throw error
      }
    },
    signal
  )
}
