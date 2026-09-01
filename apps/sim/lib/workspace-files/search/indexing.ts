import { Buffer, isUtf8 } from 'node:buffer'
import { db } from '@sim/db'
import {
  workspaceFileSearchIndex,
  workspaceFileSearchSegment,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { isSupportedFileType, parseBuffer } from '@/lib/file-parsers'
import {
  fetchServableWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import {
  FILE_SEARCH_INSERT_BATCH_BYTES,
  FILE_SEARCH_INSERT_BATCH_ROWS,
  FILE_SEARCH_MAX_EXTRACTED_BYTES,
  FILE_SEARCH_MAX_SOURCE_BYTES,
} from '@/lib/workspace-files/search/constants'
import {
  iterateLogicalLines,
  segmentLogicalLine,
  truncateUtf8ToBytes,
} from '@/lib/workspace-files/search/text'

const logger = createLogger('WorkspaceFileSearchIndexer')

export interface WorkspaceFileSearchIndexPayload {
  workspaceId: string
  fileId: string
  sourceContentUpdatedAt: string
}

type SearchIndexStatus = 'ready' | 'skipped' | 'failed'

interface ExtractedIndexText {
  text: string
  partial: boolean
}

function sameRevision(left: Date | null | undefined, right: Date): boolean {
  return Boolean(left && left.getTime() === right.getTime())
}

async function extractIndexText(
  buffer: Buffer,
  fileName: string
): Promise<ExtractedIndexText | null> {
  if (buffer.length === 0) return { text: '', partial: false }
  const extension = getFileExtension(fileName)
  if (extension && isSupportedFileType(extension)) {
    const parsed = await parseBuffer(buffer, extension)
    if (parsed.metadata?.degraded) return null
    const content = parsed.content ?? ''
    const bounded = truncateUtf8ToBytes(content, FILE_SEARCH_MAX_EXTRACTED_BYTES)
    return {
      text: bounded,
      partial: parsed.metadata?.truncated === true || bounded.length < content.length,
    }
  }
  if (!isUtf8(buffer) || buffer.includes(0)) return null
  const content = buffer.toString('utf8')
  return {
    text: truncateUtf8ToBytes(content, FILE_SEARCH_MAX_EXTRACTED_BYTES),
    partial: buffer.length > FILE_SEARCH_MAX_EXTRACTED_BYTES,
  }
}

async function clearRevision(
  workspaceId: string,
  fileId: string,
  sourceContentUpdatedAt: Date
): Promise<void> {
  await db
    .delete(workspaceFileSearchSegment)
    .where(
      and(
        eq(workspaceFileSearchSegment.workspaceId, workspaceId),
        eq(workspaceFileSearchSegment.fileId, fileId),
        eq(workspaceFileSearchSegment.sourceContentUpdatedAt, sourceContentUpdatedAt)
      )
    )
}

async function discardObsoleteRevision(options: {
  workspaceId: string
  fileId: string
  sourceContentUpdatedAt: Date
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(workspaceFileSearchSegment)
      .where(
        and(
          eq(workspaceFileSearchSegment.workspaceId, options.workspaceId),
          eq(workspaceFileSearchSegment.fileId, options.fileId),
          eq(workspaceFileSearchSegment.sourceContentUpdatedAt, options.sourceContentUpdatedAt)
        )
      )
    await tx
      .delete(workspaceFileSearchIndex)
      .where(
        and(
          eq(workspaceFileSearchIndex.workspaceId, options.workspaceId),
          eq(workspaceFileSearchIndex.fileId, options.fileId),
          eq(workspaceFileSearchIndex.sourceContentUpdatedAt, options.sourceContentUpdatedAt)
        )
      )
  })
}

async function markTerminal(options: {
  workspaceId: string
  fileId: string
  sourceContentUpdatedAt: Date
  status: SearchIndexStatus
  partial?: boolean
  failureReason?: string
  lineCount?: number
  indexedBytes?: number
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        contentUpdatedAt: workspaceFiles.contentUpdatedAt,
        deletedAt: workspaceFiles.deletedAt,
        context: workspaceFiles.context,
        workspaceId: workspaceFiles.workspaceId,
      })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.id, options.fileId))
      .for('update')
      .limit(1)

    const isCurrent =
      current?.workspaceId === options.workspaceId &&
      current.context === 'workspace' &&
      current.deletedAt === null &&
      sameRevision(current.contentUpdatedAt, options.sourceContentUpdatedAt)
    if (!isCurrent) {
      await tx
        .delete(workspaceFileSearchSegment)
        .where(
          and(
            eq(workspaceFileSearchSegment.workspaceId, options.workspaceId),
            eq(workspaceFileSearchSegment.fileId, options.fileId),
            eq(workspaceFileSearchSegment.sourceContentUpdatedAt, options.sourceContentUpdatedAt)
          )
        )
      await tx
        .delete(workspaceFileSearchIndex)
        .where(
          and(
            eq(workspaceFileSearchIndex.workspaceId, options.workspaceId),
            eq(workspaceFileSearchIndex.fileId, options.fileId),
            eq(workspaceFileSearchIndex.sourceContentUpdatedAt, options.sourceContentUpdatedAt)
          )
        )
      return false
    }

    await tx
      .insert(workspaceFileSearchIndex)
      .values({
        fileId: options.fileId,
        workspaceId: options.workspaceId,
        sourceContentUpdatedAt: options.sourceContentUpdatedAt,
        status: options.status,
        partial: options.partial ?? false,
        failureReason: options.failureReason,
        lineCount: options.lineCount ?? 0,
        indexedBytes: options.indexedBytes ?? 0,
        dispatchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceFileSearchIndex.fileId, workspaceFileSearchIndex.sourceContentUpdatedAt],
        set: {
          status: options.status,
          partial: options.partial ?? false,
          failureReason: options.failureReason,
          lineCount: options.lineCount ?? 0,
          indexedBytes: options.indexedBytes ?? 0,
          updatedAt: new Date(),
        },
      })
    await tx
      .delete(workspaceFileSearchSegment)
      .where(
        and(
          eq(workspaceFileSearchSegment.fileId, options.fileId),
          ne(workspaceFileSearchSegment.sourceContentUpdatedAt, options.sourceContentUpdatedAt)
        )
      )
    await tx
      .delete(workspaceFileSearchIndex)
      .where(
        and(
          eq(workspaceFileSearchIndex.fileId, options.fileId),
          ne(workspaceFileSearchIndex.sourceContentUpdatedAt, options.sourceContentUpdatedAt),
          or(
            ne(workspaceFileSearchIndex.status, 'pending'),
            isNull(workspaceFileSearchIndex.dispatchedAt)
          )
        )
      )
    return true
  })
}

async function insertSearchSegments(options: {
  workspaceId: string
  fileId: string
  sourceContentUpdatedAt: Date
  text: string
  signal: AbortSignal
}): Promise<number> {
  type SegmentInsert = typeof workspaceFileSearchSegment.$inferInsert
  let batch: SegmentInsert[] = []
  let batchBytes = 0
  let lineCount = 0

  const flush = async () => {
    if (batch.length === 0) return
    options.signal.throwIfAborted()
    await db.insert(workspaceFileSearchSegment).values(batch)
    batch = []
    batchBytes = 0
  }

  for (const line of iterateLogicalLines(options.text)) {
    lineCount = line.lineNumber
    for (const segment of segmentLogicalLine(line)) {
      const segmentBytes = Buffer.byteLength(segment.content, 'utf8')
      if (
        batch.length >= FILE_SEARCH_INSERT_BATCH_ROWS ||
        (batch.length > 0 && batchBytes + segmentBytes > FILE_SEARCH_INSERT_BATCH_BYTES)
      ) {
        await flush()
      }
      batch.push({
        workspaceId: options.workspaceId,
        fileId: options.fileId,
        sourceContentUpdatedAt: options.sourceContentUpdatedAt,
        ...segment,
      })
      batchBytes += segmentBytes
    }
  }
  await flush()
  return lineCount
}

export async function indexWorkspaceFileForSearch(
  payload: WorkspaceFileSearchIndexPayload,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  const sourceContentUpdatedAt = new Date(payload.sourceContentUpdatedAt)
  if (Number.isNaN(sourceContentUpdatedAt.getTime())) {
    throw new Error('Workspace file search index payload has an invalid source revision')
  }

  const file = await getWorkspaceFile(payload.workspaceId, payload.fileId, {
    throwOnError: true,
  })
  if (!file || !sameRevision(file.contentUpdatedAt, sourceContentUpdatedAt)) {
    await discardObsoleteRevision({ ...payload, sourceContentUpdatedAt })
    return
  }

  const [state] = await db
    .select({
      status: workspaceFileSearchIndex.status,
      workspaceId: workspaceFileSearchIndex.workspaceId,
    })
    .from(workspaceFileSearchIndex)
    .where(
      and(
        eq(workspaceFileSearchIndex.fileId, payload.fileId),
        eq(workspaceFileSearchIndex.sourceContentUpdatedAt, sourceContentUpdatedAt)
      )
    )
    .limit(1)
  if (state && state.workspaceId !== payload.workspaceId) {
    await discardObsoleteRevision({ ...payload, sourceContentUpdatedAt })
    return
  }
  if (state?.status === 'ready' || state?.status === 'skipped') return

  await db
    .insert(workspaceFileSearchIndex)
    .values({
      fileId: payload.fileId,
      workspaceId: payload.workspaceId,
      sourceContentUpdatedAt,
      status: 'pending',
      dispatchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [workspaceFileSearchIndex.fileId, workspaceFileSearchIndex.sourceContentUpdatedAt],
      set: {
        status: 'pending',
        failureReason: null,
        partial: false,
        lineCount: 0,
        indexedBytes: 0,
        updatedAt: new Date(),
      },
    })
  await clearRevision(payload.workspaceId, payload.fileId, sourceContentUpdatedAt)

  if (file.size > FILE_SEARCH_MAX_SOURCE_BYTES) {
    await markTerminal({
      ...payload,
      sourceContentUpdatedAt,
      status: 'skipped',
      failureReason: 'source_too_large',
    })
    return
  }

  try {
    const { buffer } = await fetchServableWorkspaceFileBuffer(file, {
      maxBytes: FILE_SEARCH_MAX_SOURCE_BYTES,
      signal,
    })
    signal.throwIfAborted()
    const extracted = await extractIndexText(buffer, file.name)
    if (!extracted) {
      await markTerminal({
        ...payload,
        sourceContentUpdatedAt,
        status: 'skipped',
        failureReason: 'binary_or_degraded',
      })
      return
    }
    const lineCount = await insertSearchSegments({
      ...payload,
      sourceContentUpdatedAt,
      text: extracted.text,
      signal,
    })
    await markTerminal({
      ...payload,
      sourceContentUpdatedAt,
      status: 'ready',
      partial: extracted.partial,
      lineCount,
      indexedBytes: Buffer.byteLength(extracted.text, 'utf8'),
    })
  } catch (error) {
    if (signal.aborted) throw error
    if (isPayloadSizeLimitError(error)) {
      await clearRevision(payload.workspaceId, payload.fileId, sourceContentUpdatedAt)
      await markTerminal({
        ...payload,
        sourceContentUpdatedAt,
        status: 'skipped',
        failureReason: 'source_too_large',
      })
      return
    }
    await clearRevision(payload.workspaceId, payload.fileId, sourceContentUpdatedAt)
    logger.error('Workspace file search indexing failed', {
      workspaceId: payload.workspaceId,
      fileId: payload.fileId,
      errorType: toError(error).name,
    })
    throw error
  }
}

/** Marks a revision failed only after Trigger.dev has exhausted every retry attempt. */
export async function markWorkspaceFileSearchIndexFailed(
  payload: WorkspaceFileSearchIndexPayload
): Promise<void> {
  const sourceContentUpdatedAt = new Date(payload.sourceContentUpdatedAt)
  if (Number.isNaN(sourceContentUpdatedAt.getTime())) return
  await clearRevision(payload.workspaceId, payload.fileId, sourceContentUpdatedAt)
  await markTerminal({
    ...payload,
    sourceContentUpdatedAt,
    status: 'failed',
    failureReason: 'indexing_error',
  })
}
