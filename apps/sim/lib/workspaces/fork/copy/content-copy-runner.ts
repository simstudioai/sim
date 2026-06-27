import { db } from '@sim/db'
import { getErrorMessage } from '@sim/utils/errors'
import { finishBackgroundWork } from '@/lib/workspaces/fork/background-work/store'
import type { BlobCopyTask } from '@/lib/workspaces/fork/copy/copy-files'
import { executeForkFileBlobCopies } from '@/lib/workspaces/fork/copy/copy-files'
import type { ForkContentPlan } from '@/lib/workspaces/fork/copy/copy-resources'
import { copyForkResourceContent } from '@/lib/workspaces/fork/copy/copy-resources'

/**
 * Serializable payload for the post-fork heavy-content copy. Runs either as a
 * Trigger.dev task (`background/fork-content-copy`) or inline via `runDetached`
 * when Trigger.dev is disabled - both call {@link runForkContentCopy}.
 */
export interface ForkContentCopyPayload {
  contentPlan: ForkContentPlan
  blobTasks: BlobCopyTask[]
  /**
   * `background_work_status` row to finish when the copy ends, so the child
   * workspace's "copying in the background" banner clears (or shows a warning/error).
   * Started in the fork transaction so it's visible the moment the user opens the fork.
   */
  statusId?: string
  requestId?: string
}

/**
 * Copy the heavy fork content after the fork transaction has committed: table
 * rows, KB documents + embeddings (keyset-paginated), and file blobs. Best-effort
 * and idempotency-unsafe (per-row inserts use fresh ids), so it must run at most
 * once - never blindly retried. Per-resource failures are counted (not thrown), so
 * the run finishes `completed_with_warnings` rather than failing the whole copy.
 */
export async function runForkContentCopy(payload: ForkContentCopyPayload): Promise<void> {
  const { contentPlan, blobTasks, statusId, requestId } = payload
  try {
    const resourceCounts = await copyForkResourceContent({ contentPlan, requestId })
    const fileCounts = await executeForkFileBlobCopies(blobTasks, requestId)
    const copied = resourceCounts.copied + fileCounts.copied
    const failed = resourceCounts.failed + fileCounts.failed
    if (statusId) {
      await finishBackgroundWork(db, statusId, {
        status: failed > 0 ? 'completed_with_warnings' : 'completed',
        message:
          failed > 0
            ? `Copied ${copied} item${copied === 1 ? '' : 's'}; ${failed} could not be copied`
            : `Copied ${copied} item${copied === 1 ? '' : 's'}`,
        metadata: { copied, failed },
      })
    }
  } catch (error) {
    if (statusId) {
      await finishBackgroundWork(db, statusId, {
        status: 'failed',
        error: getErrorMessage(error, 'Background resource copy failed'),
      }).catch(() => {})
    }
    throw error
  }
}
