import { Buffer } from 'node:buffer'
import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { redactDatabaseQueryError } from '@/lib/core/errors/database-query-error'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import {
  FILE_SEARCH_MAX_SOURCE_BYTES,
  FILE_SEARCH_SLOW_INSERT_BATCH_MS,
} from '@/lib/workspace-files/search/constants'
import { extractIndexText, loadIndexableBytes } from '@/lib/workspace-files/search/extract'
import { iterateFileSearchBatches } from '@/lib/workspace-files/search/index-batches'
import {
  estimateTrigramKeys,
  type FileSearchChunk,
  FileSearchExclusionError,
  iterateFileSearchChunks,
  planFileSearchIndex,
} from '@/lib/workspace-files/search/index-plan'
import {
  appendFileSearchChunks,
  beginFileSearchBuild,
  type FileSearchBuild,
  type FileSearchRevision,
  failFileSearchRevision,
  publishFileSearchBuild,
} from '@/lib/workspace-files/search/index-state'

const logger = createLogger('WorkspaceFileSearchIndexer')

export interface WorkspaceFileSearchIndexPayload {
  workspaceId: string
  fileId: string
  sourceContentUpdatedAt: string
  /** Identifies the dispatch claim so stale callbacks cannot change a newer run. */
  dispatchToken?: string
}

function parseRevision(payload: WorkspaceFileSearchIndexPayload): FileSearchRevision {
  const sourceContentUpdatedAt = new Date(payload.sourceContentUpdatedAt)
  if (Number.isNaN(sourceContentUpdatedAt.getTime()))
    throw new Error('Invalid workspace file search revision')
  return { workspaceId: payload.workspaceId, fileId: payload.fileId, sourceContentUpdatedAt }
}

/**
 * Appends one batch and records slow ones, including a batch a statement timeout cancels, with the
 * trigram key load that drives direct GIN insert cost. Logging never includes the indexed text.
 */
async function appendTimedBatch(
  build: FileSearchBuild,
  batch: FileSearchChunk[],
  batchBytes: number,
  signal: AbortSignal
): Promise<boolean> {
  const startedAt = Date.now()
  try {
    return await appendFileSearchChunks(build, batch, signal)
  } finally {
    const durationMs = Date.now() - startedAt
    if (durationMs >= FILE_SEARCH_SLOW_INSERT_BATCH_MS) {
      logger.warn('Workspace file search insert batch was slow', {
        workspaceId: build.workspaceId,
        fileId: build.fileId,
        buildId: build.id,
        firstOrdinal: batch[0]?.ordinal,
        rows: batch.length,
        bytes: batchBytes,
        estimatedTrigramKeys: batch.reduce((sum, c) => sum + estimateTrigramKeys(c.content), 0),
        durationMs,
      })
    }
  }
}

export async function indexWorkspaceFileForSearch(
  payload: WorkspaceFileSearchIndexPayload,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  if (!payload.dispatchToken) return
  const revision = parseRevision(payload)
  const build = await beginFileSearchBuild(revision, payload.dispatchToken)
  if (!build) return
  const startedAt = Date.now()
  try {
    const file = await getWorkspaceFile(payload.workspaceId, payload.fileId, { throwOnError: true })
    if (!file || file.contentUpdatedAt?.getTime() !== revision.sourceContentUpdatedAt.getTime())
      return
    if (file.size > FILE_SEARCH_MAX_SOURCE_BYTES) {
      await publishFileSearchBuild(
        build,
        { status: 'skipped', failureReason: 'source_too_large' },
        signal
      )
      return
    }
    const bytes = await loadIndexableBytes(file, signal)
    const extracted = await extractIndexText(bytes, file.name, signal)
    if (!extracted) {
      await publishFileSearchBuild(
        build,
        { status: 'skipped', failureReason: 'binary_or_degraded' },
        signal
      )
      return
    }
    const plan = planFileSearchIndex(extracted, signal)
    let chunkCount = 0
    for (const batch of iterateFileSearchBatches(iterateFileSearchChunks(plan, signal), signal)) {
      const batchBytes = batch.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.content), 0)
      if (!(await appendTimedBatch(build, batch, batchBytes, signal))) return
      chunkCount += batch.length
    }
    const published = await publishFileSearchBuild(
      build,
      { status: 'ready', chunkCount, lineCount: plan.lineCount, indexedBytes: plan.indexedBytes },
      signal
    )
    logger.info('Workspace file search build completed', {
      ...payload,
      buildId: build.id,
      published,
      sourceBytes: bytes.buffer.length,
      indexedBytes: plan.indexedBytes,
      chunkCount,
      lineCount: plan.lineCount,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    signal.throwIfAborted()
    if (isPayloadSizeLimitError(error) || error instanceof FileSearchExclusionError) {
      const failureReason =
        error instanceof FileSearchExclusionError ? error.reason : 'source_too_large'
      await publishFileSearchBuild(build, { status: 'skipped', failureReason }, signal)
      logger.info('Workspace file excluded from search', { ...payload, reason: failureReason })
      return
    }
    logger.error('Workspace file search indexing failed', {
      ...payload,
      error: describeError(error),
      durationMs: Date.now() - startedAt,
    })
    /** Trigger records the thrown message verbatim; Drizzle's carries the bound file text. */
    throw redactDatabaseQueryError(error, 'Workspace file search database query')
  }
}

/** Called only after the task exhausts its retries. */
export async function markWorkspaceFileSearchIndexFailed(
  payload: WorkspaceFileSearchIndexPayload
): Promise<void> {
  if (!payload.dispatchToken || Number.isNaN(new Date(payload.sourceContentUpdatedAt).getTime()))
    return
  await failFileSearchRevision(parseRevision(payload), payload.dispatchToken)
}
