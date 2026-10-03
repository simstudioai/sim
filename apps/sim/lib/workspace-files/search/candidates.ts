import {
  workspaceFileSearchChunk,
  workspaceFileSearchRevision,
  workspaceFiles,
} from '@sim/db/schema'
import { and, asc, eq, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import {
  FILE_SEARCH_CANDIDATE_PAGE_SIZE,
  FILE_SEARCH_CANDIDATE_PROBE_SIZE,
} from '@/lib/workspace-files/search/constants'
import type { CompiledFileSearchPattern } from '@/lib/workspace-files/search/pattern'
import { buildMatchExpression } from '@/lib/workspace-files/search/sql-pattern'

export interface FileSearchCandidate {
  fileId: string
  fileName: string
  fileKey: string
  ownerUserId: string
  contentUpdatedAt: Date
  buildId: string
  ordinal: number
  lineStart: number
  fragment: boolean
}

interface CandidateScope {
  workspaceId: string
  pattern: CompiledFileSearchPattern
  folderPredicate?: SQL
}

interface CandidateCursor {
  name: string
  id: string
  lineStart: number
}

/** Native regex on complete-line blocks; necessary literals across overlapping long-line fragments. */
function candidatePredicate(pattern: CompiledFileSearchPattern): SQL {
  const chunk = workspaceFileSearchChunk
  const fragmentMatch =
    pattern.candidatePatterns === null
      ? sql`true`
      : or(
          ...pattern.candidatePatterns.map((seed) =>
            pattern.caseSensitive
              ? sql`${chunk.content} LIKE ${seed}`
              : sql`${chunk.content} ILIKE ${seed}`
          )
        )!
  return and(
    fragmentMatch,
    or(eq(chunk.fragment, true), buildMatchExpression(chunk.content, pattern, true))
  )!
}

/** Bounded unordered probe avoids sorting all matching text for broad queries. */
export async function probeFileSearchCandidates(
  tx: DbTransaction,
  { workspaceId, pattern, folderPredicate }: CandidateScope
): Promise<FileSearchCandidate[]> {
  const probe = tx
    .select({
      fileId: workspaceFiles.id,
      fileName: workspaceFiles.originalName,
      fileKey: workspaceFiles.key,
      ownerUserId: workspaceFiles.userId,
      contentUpdatedAt: workspaceFiles.contentUpdatedAt,
      buildId: workspaceFileSearchChunk.buildId,
      ordinal: workspaceFileSearchChunk.ordinal,
      lineStart: workspaceFileSearchChunk.lineStart,
      fragment: workspaceFileSearchChunk.fragment,
    })
    .from(workspaceFileSearchChunk)
    .innerJoin(
      workspaceFileSearchRevision,
      and(
        eq(workspaceFileSearchRevision.buildId, workspaceFileSearchChunk.buildId),
        eq(workspaceFileSearchRevision.workspaceId, workspaceId),
        eq(workspaceFileSearchRevision.status, 'ready')
      )
    )
    .innerJoin(
      workspaceFiles,
      and(
        eq(workspaceFiles.id, workspaceFileSearchRevision.fileId),
        eq(workspaceFiles.contentUpdatedAt, workspaceFileSearchRevision.sourceContentUpdatedAt)
      )
    )
    .where(
      and(
        eq(workspaceFileSearchChunk.workspaceId, workspaceId),
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        folderPredicate,
        candidatePredicate(pattern)
      )
    )
    .limit(FILE_SEARCH_CANDIDATE_PROBE_SIZE + 1)
    .as('probe')
  return tx
    .select()
    .from(probe)
    .orderBy(asc(probe.fileName), asc(probe.fileId), asc(probe.lineStart), asc(probe.ordinal))
}

/** A parameterized build scan preserves file order and can stop after one candidate page. */
export async function readOrderedFileSearchCandidates(
  tx: DbTransaction,
  { workspaceId, pattern, folderPredicate }: CandidateScope,
  after?: CandidateCursor
): Promise<FileSearchCandidate[]> {
  /** OFFSET 0 preserves the ordered file input instead of flattening into a global text scan. */
  const files = tx
    .select({
      fileId: workspaceFiles.id,
      fileName: workspaceFiles.originalName,
      fileKey: workspaceFiles.key,
      ownerUserId: workspaceFiles.userId,
      contentUpdatedAt: workspaceFiles.contentUpdatedAt,
      buildId: workspaceFileSearchRevision.buildId,
    })
    .from(workspaceFiles)
    .innerJoin(
      workspaceFileSearchRevision,
      and(
        eq(workspaceFileSearchRevision.fileId, workspaceFiles.id),
        eq(workspaceFileSearchRevision.workspaceId, workspaceId),
        eq(workspaceFileSearchRevision.sourceContentUpdatedAt, workspaceFiles.contentUpdatedAt),
        eq(workspaceFileSearchRevision.status, 'ready')
      )
    )
    .where(
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        folderPredicate,
        after
          ? sql`(${workspaceFiles.originalName}, ${workspaceFiles.id}) >= (${after.name}, ${after.id})`
          : undefined
      )
    )
    .orderBy(asc(workspaceFiles.originalName), asc(workspaceFiles.id))
    .offset(0)
    .as('files')
  const chunks = tx
    .select({
      buildId: workspaceFileSearchChunk.buildId,
      ordinal: workspaceFileSearchChunk.ordinal,
      lineStart: workspaceFileSearchChunk.lineStart,
      fragment: workspaceFileSearchChunk.fragment,
    })
    .from(workspaceFileSearchChunk)
    .where(
      and(
        eq(workspaceFileSearchChunk.buildId, files.buildId),
        eq(workspaceFileSearchChunk.workspaceId, workspaceId),
        candidatePredicate(pattern),
        after
          ? sql`(${files.fileName}, ${files.fileId}, ${workspaceFileSearchChunk.lineStart}) > (${after.name}, ${after.id}, ${after.lineStart})`
          : undefined
      )
    )
    .orderBy(asc(workspaceFileSearchChunk.lineStart), asc(workspaceFileSearchChunk.ordinal))
    .limit(FILE_SEARCH_CANDIDATE_PAGE_SIZE)
    .as('chunks')
  return tx
    .select({
      fileId: files.fileId,
      fileName: files.fileName,
      fileKey: files.fileKey,
      ownerUserId: files.ownerUserId,
      contentUpdatedAt: files.contentUpdatedAt,
      buildId: chunks.buildId,
      ordinal: chunks.ordinal,
      lineStart: chunks.lineStart,
      fragment: chunks.fragment,
    })
    .from(files)
    .innerJoinLateral(chunks, sql`true`)
    .orderBy(asc(files.fileName), asc(files.fileId), asc(chunks.lineStart), asc(chunks.ordinal))
    .limit(FILE_SEARCH_CANDIDATE_PAGE_SIZE)
}
