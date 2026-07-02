import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { incrementStorageUsage } from '@/lib/billing/storage'
import type { DbOrTx } from '@/lib/db/types'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFile, headObject, uploadFile } from '@/lib/uploads/core/storage-service'
import type { StorageContext } from '@/lib/uploads/shared/types'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import {
  type ForkContentRefMaps,
  rewriteForkContentRefs,
} from '@/lib/workspaces/fork/remap/remap-content-refs'

const logger = createLogger('WorkspaceForkCopyFiles')

const MARKDOWN_CONTENT_TYPES = new Set(['text/markdown', 'text/x-markdown'])

/** Whether a copied blob is markdown text whose in-content references should be rewritten. */
function isMarkdownBlob(task: Pick<BlobCopyTask, 'contentType' | 'fileName'>): boolean {
  if (MARKDOWN_CONTENT_TYPES.has(task.contentType)) return true
  const name = task.fileName.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.mdx') || name.endsWith('.markdown')
}

export interface BlobCopyTask {
  sourceKey: string
  targetKey: string
  context: StorageContext
  fileName: string
  contentType: string
  /**
   * Byte size from the source metadata row - the child `workspace_files` row was inserted
   * with this same size, so the storage-usage increment after a successful blob copy
   * charges exactly the bytes the row advertises (matching the upload path, where the
   * incremented bytes always equal the row's `size`).
   */
  size: number
  userId: string
  workspaceId: string
}

export interface PlanForkFileCopiesResult {
  /**
   * source storage key -> child storage key. `file-upload` subblocks reference
   * files by storage key (not `workspace_files.id`), so the fork remap keys on the
   * storage key. At sync time this map is persisted in the fork resource map
   * (`resourceType: 'file'`, keyed by storage key) so a re-sync resolves the copy
   * instead of re-copying; at create-fork time it is not (the child is brand new).
   */
  keyMap: Map<string, string>
  /**
   * source `workspace_files.id` -> child id. Used to rewrite in-content file references
   * that key on the file id (`sim:file/<id>`, `/api/files/view/<id>`, the in-app files
   * path) inside copied skill/markdown content; not persisted in the fork resource map.
   */
  idMap: Map<string, string>
  /** Blob duplications to run after the fork transaction commits. */
  blobTasks: BlobCopyTask[]
}

/**
 * Insert child `workspace_files` metadata rows for the selected files (new id +
 * new storage key) and return the source→child storage-key map plus the blob
 * copies to run post-commit. The metadata row must exist before the blob upload
 * (its idempotent metadata insert reuses the row), and both must run after the
 * child workspace row exists (FK). Runs in the fork transaction; blob I/O is
 * deferred to {@link executeForkFileBlobCopies}.
 *
 * Files are selected EITHER by `workspace_files.id` (the fork modal's picker lists files
 * by id) OR by storage `key` (sync references key files by their storage key, not id). At
 * least one of the two must be non-empty; both may be supplied (their matched rows union).
 */
export async function planForkFileCopies(params: {
  tx: DbOrTx
  sourceWorkspaceId: string
  childWorkspaceId: string
  userId: string
  fileIds?: string[]
  fileKeys?: string[]
  now: Date
}): Promise<PlanForkFileCopiesResult> {
  const { tx, sourceWorkspaceId, childWorkspaceId, userId, now } = params
  const fileIds = params.fileIds ?? []
  const fileKeys = params.fileKeys ?? []
  const keyMap = new Map<string, string>()
  const idMap = new Map<string, string>()
  const blobTasks: BlobCopyTask[] = []
  if (fileIds.length === 0 && fileKeys.length === 0) return { keyMap, idMap, blobTasks }

  // Match by id and/or storage key (OR'd) so either selection shape resolves to the same
  // source rows. Batch the metadata read (one query for all selected files): non-deleted,
  // scoped to the source workspace, and restricted to durable `workspace` files. Only
  // workspace files are forkable - chat/copilot/mothership uploads are session-scoped and
  // their chat-bound unique index can't be duplicated - so any non-workspace id/key passed
  // here is ignored rather than copied.
  const selectors = [
    fileIds.length > 0 ? inArray(workspaceFiles.id, fileIds) : undefined,
    fileKeys.length > 0 ? inArray(workspaceFiles.key, fileKeys) : undefined,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined)
  const metas = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        selectors.length === 1 ? selectors[0] : or(...selectors),
        eq(workspaceFiles.workspaceId, sourceWorkspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )

  for (const meta of metas) {
    const childFileId = generateId()
    // Use the canonical workspace-file key (`workspace/{id}/...`) so the file-serve
    // API can infer the storage context; a bare `{id}/...` key has no context prefix.
    const targetKey = generateWorkspaceFileKey(childWorkspaceId, meta.originalName)
    await tx.insert(workspaceFiles).values({
      ...meta,
      id: childFileId,
      key: targetKey,
      workspaceId: childWorkspaceId,
      userId,
      folderId: null,
      deletedAt: null,
      uploadedAt: now,
    })
    keyMap.set(meta.key, targetKey)
    idMap.set(meta.id, childFileId)
    blobTasks.push({
      sourceKey: meta.key,
      targetKey,
      context: meta.context as StorageContext,
      fileName: meta.originalName,
      contentType: meta.contentType,
      size: meta.size,
      userId,
      workspaceId: childWorkspaceId,
    })
  }

  return { keyMap, idMap, blobTasks }
}

/**
 * Duplicate each planned file blob to its new key. `uploadFile`'s metadata insert
 * is idempotent on the key (the row was already created in the transaction), so
 * this only copies bytes. Markdown blobs additionally have their in-content references
 * (`sim:` links, embedded file/image URLs) rewritten through `contentRefMaps` so they
 * point at the copied resources (unmapped targets are left as graceful broken links).
 * Best-effort: a content-rewrite failure falls back to copying the raw bytes. A failed
 * blob's child storage key is returned in `failedTargetKeys` so the caller can clear the
 * `file-upload` references pointing at the now-missing object (the metadata row is left in
 * place, so the user can still re-upload the blob).
 *
 * Storage accounting: each blob that actually lands increments the initiating user's
 * storage usage by the metadata row's size - the copied bytes are charged exactly as if
 * the file had been uploaded to the target workspace. The increment cannot double-count:
 * the content-copy job is at-most-once by config (`maxAttempts: 1`), each task increments
 * only after its own successful upload, and the target-existence skip below means a
 * manually replayed run neither re-copies nor re-charges a blob a prior attempt landed.
 * Like the upload path, a tracking failure is logged and never fails the copy - and is
 * never retried, so a landed blob whose increment failed stays uncounted (a manual replay
 * skips it without charging). Accepted trade-off, matching the platform's upload paths:
 * storage may undercount, but a user is never charged twice or for bytes that didn't land.
 */
export async function executeForkFileBlobCopies(
  blobTasks: BlobCopyTask[],
  requestId = 'unknown',
  contentRefMaps?: ForkContentRefMaps
): Promise<{ copied: number; failed: number; failedTargetKeys: string[] }> {
  let copied = 0
  const failedTargetKeys: string[] = []
  for (const task of blobTasks) {
    try {
      // Replay guard: target keys are freshly generated per fork/sync, so an existing
      // object can only mean an earlier attempt already landed this exact copy. Skip
      // without incrementing - a replay must never double-charge, so if the prior
      // attempt's best-effort increment failed those bytes stay uncounted (the same
      // accepted undercount as a tracking failure on the upload path). `headObject`
      // returns null on local storage, where the copy is simply repeated (same bytes
      // to the same key).
      const existing = await headObject(task.targetKey, task.context)
      if (existing) {
        copied += 1
        continue
      }
      const buffer = await downloadFile({
        key: task.sourceKey,
        context: task.context,
        maxBytes: MAX_FILE_SIZE,
      })
      let body: Buffer = buffer
      if (contentRefMaps && isMarkdownBlob(task)) {
        try {
          const text = buffer.toString('utf8')
          const rewritten = rewriteForkContentRefs(text, contentRefMaps)
          if (rewritten !== text) body = Buffer.from(rewritten, 'utf8')
        } catch (error) {
          logger.warn(`[${requestId}] Failed to rewrite markdown blob content; copying raw bytes`, {
            targetKey: task.targetKey,
            error: getErrorMessage(error),
          })
        }
      }
      await uploadFile({
        file: body,
        fileName: task.fileName,
        contentType: task.contentType,
        context: task.context,
        customKey: task.targetKey,
        preserveKey: true,
        metadata: {
          userId: task.userId,
          workspaceId: task.workspaceId,
          originalName: task.fileName,
        },
      })
      copied += 1
      // The typeof guard covers payloads enqueued before `size` existed (rolling deploy).
      if (typeof task.size === 'number' && task.size > 0) {
        try {
          await incrementStorageUsage(task.userId, task.size, task.workspaceId)
        } catch (storageError) {
          logger.error(`[${requestId}] Failed to update storage tracking for copied file blob`, {
            targetKey: task.targetKey,
            error: getErrorMessage(storageError),
          })
        }
      }
    } catch (error) {
      failedTargetKeys.push(task.targetKey)
      logger.warn(`[${requestId}] Failed to copy file blob during fork`, {
        targetKey: task.targetKey,
        error: getErrorMessage(error),
      })
    }
  }
  return { copied, failed: failedTargetKeys.length, failedTargetKeys }
}
