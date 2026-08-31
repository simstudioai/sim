import { db } from '@sim/db'
import {
  workspaceFileSearchIndex,
  workspaceFileSearchSegment,
  workspaceFiles,
} from '@sim/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { WorkspaceFileSecretProvenanceIdentity } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  createFileSearchPreview,
  escapeFileSearchLikePattern,
} from '@/lib/workspace-files/search/text'

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
  query: string
  maxResults: number
  caseSensitive: boolean
  signal?: AbortSignal
}

export async function searchWorkspaceFileIndex({
  workspaceId,
  query,
  maxResults,
  caseSensitive,
  signal,
}: SearchWorkspaceFileIndexInput): Promise<WorkspaceFileSearchResult> {
  signal?.throwIfAborted()
  const escapedPattern = `%${escapeFileSearchLikePattern(query)}%`
  const matchExpression = caseSensitive
    ? sql`${workspaceFileSearchSegment.content} LIKE ${escapedPattern} ESCAPE '\\'`
    : sql`${workspaceFileSearchSegment.content} ILIKE ${escapedPattern} ESCAPE '\\'`
  const matchPosition = caseSensitive
    ? sql<number>`strpos(${workspaceFileSearchSegment.content}, ${query})`
    : sql<number>`strpos(lower(${workspaceFileSearchSegment.content}), lower(${query}))`
  const surroundingContext = sql<number>`least(
    ${matchPosition} - 1,
    char_length(${workspaceFileSearchSegment.content}) - (${matchPosition} - 1) - char_length(${query})
  )`

  const rows = await db
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
    .where(and(eq(workspaceFileSearchSegment.workspaceId, workspaceId), matchExpression))
    .orderBy(
      workspaceFiles.originalName,
      workspaceFiles.id,
      workspaceFileSearchSegment.lineNumber,
      desc(surroundingContext),
      workspaceFileSearchSegment.segmentNumber
    )
    .limit(maxResults + 1)

  signal?.throwIfAborted()
  const coverageRows = await db
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
    text: createFileSearchPreview(row.content, query, caseSensitive, undefined, {
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
}
