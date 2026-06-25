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
  requestId?: string
}

/**
 * Copy the heavy fork content after the fork transaction has committed: table
 * rows, KB documents + embeddings (keyset-paginated), and file blobs. Best-effort
 * and idempotency-unsafe (per-row inserts use fresh ids), so it must run at most
 * once - never blindly retried.
 */
export async function runForkContentCopy(payload: ForkContentCopyPayload): Promise<void> {
  const { contentPlan, blobTasks, requestId } = payload
  await copyForkResourceContent({ contentPlan, requestId })
  await executeForkFileBlobCopies(blobTasks, requestId)
}
