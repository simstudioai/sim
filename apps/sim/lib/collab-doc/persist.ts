import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import * as Y from 'yjs'
import {
  ContentVersionConflictError,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent,
} from '@/lib/uploads/contexts/workspace'
import { hashMarkdown, saveCollabDocState } from './collab-state'
import { yDocToFileMarkdown } from './converter'

const logger = createLogger('FileDocPersist')

/**
 * Outcome of a persist attempt:
 * - `persisted` — the live doc was projected to markdown and written; `version` is the new durable
 *   `updatedAt` (epoch ms) the relay records as the version its live doc is now synced to.
 * - `missing` — the file is gone (deleted); nothing to write.
 * - `conflict` — the file changed out-of-band since the relay's live doc last synced, so writing the
 *   projection would clobber that change (RFC 7232 `If-Match` failure). NOT written. `markdown` +
 *   `version` are the current durable content + version so the relay can merge them into its live doc
 *   and re-persist the reconciled result.
 */
export type PersistFileDocResult =
  | { status: 'persisted'; version: number }
  | { status: 'missing' }
  | { status: 'conflict'; markdown: string; version: number }

/**
 * Project a live collaborative document back to durable markdown and write it to the file. The realtime
 * relay owns the live Yjs doc but not the conversion engine or blob/DB access, so it ships the doc state
 * here and the app persists it — the server-authoritative durable path that replaces the editor's
 * client-side autosave.
 *
 * `expectedVersion` (the durable `updatedAt`, epoch ms, that the relay's live doc last synced from) is
 * the optimistic-concurrency guard: the write commits only if the file is still at that version, so a
 * projection built from a stale live doc can never silently overwrite an out-of-band edit. On a version
 * mismatch this returns `conflict` (with the current durable content) instead of writing — the relay
 * reconciles and retries. Omit `expectedVersion` to write unconditionally (e.g. the first persist,
 * before any synced version exists).
 *
 * `userId` is attribution only (blob metadata); the caller is already trusted via the `x-api-key` gate.
 */
export async function persistFileDoc(
  workspaceId: string,
  fileId: string,
  userId: string,
  docState: Uint8Array,
  expectedVersion?: number
): Promise<PersistFileDocResult> {
  const record = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
  if (!record) return { status: 'missing' }

  const ydoc = new Y.Doc()
  let markdownBuffer: Buffer
  try {
    Y.applyUpdate(ydoc, docState)
    markdownBuffer = Buffer.from(yDocToFileMarkdown(ydoc), 'utf-8')
  } finally {
    ydoc.destroy()
  }

  try {
    const updated = await updateWorkspaceFileContent(
      workspaceId,
      fileId,
      userId,
      markdownBuffer,
      undefined,
      {
        // This write IS the projection of the live doc, so re-merging it into that same doc would loop.
        syncLiveDoc: false,
        // If-Match: only if the durable file is still at the version the live doc synced from.
        expectedUpdatedAt: expectedVersion !== undefined ? new Date(expectedVersion) : undefined,
      }
    )

    // Cache the Yjs binary (tagged with the exact markdown just written) so a later cold room open loads
    // it directly instead of re-converting. Best-effort — the markdown is the durable source of truth.
    try {
      await saveCollabDocState(fileId, docState, hashMarkdown(markdownBuffer))
    } catch (error) {
      logger.warn(`Failed to cache collab doc state for file ${fileId}`, {
        error: getErrorMessage(error),
      })
    }

    logger.info(
      `Persisted live collaborative document to file ${fileId} (workspace ${workspaceId})`
    )
    return { status: 'persisted', version: updated.updatedAt.getTime() }
  } catch (error) {
    if (!(error instanceof ContentVersionConflictError)) throw error
    // Out-of-band edit since the live doc last synced — DON'T clobber. Return the current durable
    // content + version so the relay merges it into the live doc and re-persists the reconciled result.
    const current = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
    if (!current) return { status: 'missing' }
    const currentBuffer = await fetchWorkspaceFileBuffer(current)
    logger.warn(`Persist conflict for file ${fileId}; returning current durable state to reconcile`)
    return {
      status: 'conflict',
      markdown: currentBuffer.toString('utf-8'),
      version: current.updatedAt.getTime(),
    }
  }
}
