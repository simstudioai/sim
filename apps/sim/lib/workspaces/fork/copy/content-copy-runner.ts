import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { finishBackgroundWork } from '@/lib/workspaces/fork/background-work/store'
import { clearFailedForkResourceReferences } from '@/lib/workspaces/fork/copy/cleanup-failed'
import type { BlobCopyTask } from '@/lib/workspaces/fork/copy/copy-files'
import { executeForkFileBlobCopies } from '@/lib/workspaces/fork/copy/copy-files'
import type { ForkContentPlan, ForkFailedResource } from '@/lib/workspaces/fork/copy/copy-resources'
import { copyForkResourceContent } from '@/lib/workspaces/fork/copy/copy-resources'
import type { ForkContentRefMaps } from '@/lib/workspaces/fork/remap/remap-content-refs'

const logger = createLogger('WorkspaceForkContentCopy')

/**
 * JSON-serializable form of {@link ForkContentRefMaps} (Maps become Records) so the in-content
 * reference maps survive the Trigger.dev payload boundary. Rehydrated to Maps in the runner.
 */
export interface SerializableForkContentRefMaps {
  workspaceId?: { from: string; to: string }
  fileKeys?: Record<string, string>
  fileIds?: Record<string, string>
  workflows?: Record<string, string>
  knowledgeBases?: Record<string, string>
  tables?: Record<string, string>
  skills?: Record<string, string>
  folders?: Record<string, string>
}

/**
 * Serializable payload for the post-fork heavy-content copy. Runs either as a
 * Trigger.dev task (`background/fork-content-copy`) or inline via `runDetached`
 * when Trigger.dev is disabled - both call {@link runForkContentCopy}.
 */
export interface ForkContentCopyPayload {
  contentPlan: ForkContentPlan
  blobTasks: BlobCopyTask[]
  /** In-content reference maps for rewriting copied markdown blobs (serialized form). */
  contentRefMaps?: SerializableForkContentRefMaps
  /**
   * `background_work_status` row to finish when the copy ends, so the source workspace's
   * Manage Forks -> Activity entry resolves (completed / warning / error). Started right
   * after the fork commits so it's visible immediately.
   */
  statusId?: string
  /**
   * Target workflow ids this sync deployed (promote's deploy loop). When a copied resource's
   * fill fails, its dropped placeholder must be cleared from these workflows' DEPLOYED version
   * states too - a deployed version can reference the placeholder even when the draft no longer
   * does (edited in the fill window), so the cleanup unions these with the draft-affected set
   * rather than relying on draft divergence. Empty/omitted for fork-create (child is undeployed).
   */
  deployedTargetWorkflowIds?: string[]
  requestId?: string
}

const toRefMap = (record?: Record<string, string>): Map<string, string> | undefined =>
  record ? new Map(Object.entries(record)) : undefined

const fromRefMap = (map?: ReadonlyMap<string, string>): Record<string, string> | undefined =>
  map && map.size > 0 ? Object.fromEntries(map) : undefined

/**
 * Convert the Map-based {@link ForkContentRefMaps} to its JSON-serializable form for the
 * Trigger.dev payload. Empty maps are dropped (omitted). Single source of truth for the
 * Map->Record direction, paired with {@link deserializeContentRefMaps}.
 */
export function serializeContentRefMaps(maps: ForkContentRefMaps): SerializableForkContentRefMaps {
  return {
    workspaceId: maps.workspaceId,
    fileKeys: fromRefMap(maps.fileKeys),
    fileIds: fromRefMap(maps.fileIds),
    workflows: fromRefMap(maps.workflows),
    knowledgeBases: fromRefMap(maps.knowledgeBases),
    tables: fromRefMap(maps.tables),
    skills: fromRefMap(maps.skills),
    folders: fromRefMap(maps.folders),
  }
}

/** Rehydrate the serialized content-ref maps to the Map-based {@link ForkContentRefMaps}. */
function deserializeContentRefMaps(
  serialized?: SerializableForkContentRefMaps
): ForkContentRefMaps | undefined {
  if (!serialized) return undefined
  return {
    workspaceId: serialized.workspaceId,
    fileKeys: toRefMap(serialized.fileKeys),
    fileIds: toRefMap(serialized.fileIds),
    workflows: toRefMap(serialized.workflows),
    knowledgeBases: toRefMap(serialized.knowledgeBases),
    tables: toRefMap(serialized.tables),
    skills: toRefMap(serialized.skills),
    folders: toRefMap(serialized.folders),
  }
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
    const contentRefMaps = deserializeContentRefMaps(payload.contentRefMaps)
    const resourceCounts = await copyForkResourceContent({ contentPlan, contentRefMaps, requestId })
    const fileCounts = await executeForkFileBlobCopies(blobTasks, requestId, contentRefMaps)
    // A resource whose content fill failed leaves a dangling reference: a table/KB/doc placeholder
    // its workflows still point at, or a `file-upload` whose copied blob is missing. Clear those
    // references (draft + deployed versions) and drop the table/KB/doc placeholder so nothing
    // dangles; a failed file leaves its metadata row (re-uploadable) but has its refs cleared.
    const fileFailures: ForkFailedResource[] = fileCounts.failedTargetKeys.map((childKey) => ({
      kind: 'file',
      childKey,
    }))
    const clearedReferences = await clearFailedForkResourceReferences({
      childWorkspaceId: contentPlan.childWorkspaceId,
      failures: [...resourceCounts.failures, ...fileFailures],
      deployedTargetWorkflowIds: payload.deployedTargetWorkflowIds,
      requestId,
    })
    const copied = resourceCounts.copied + fileCounts.copied
    const failed = resourceCounts.failed + fileCounts.failed
    if (statusId) {
      await finishBackgroundWork(db, statusId, {
        status: failed > 0 ? 'completed_with_warnings' : 'completed',
        message:
          failed > 0
            ? `Copied ${copied} item${copied === 1 ? '' : 's'}; ${failed} could not be copied`
            : `Copied ${copied} item${copied === 1 ? '' : 's'}`,
        metadata: { copied, failed, clearedReferences },
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

/**
 * Schedule the post-commit heavy-content copy off the request path. Uses the Trigger.dev task
 * when enabled (so it survives an app deploy), else `runDetached` inline best-effort. Shared by
 * both fork and sync - only the `detachedLabel` (and so the inline job's name) differs. Never
 * throws: a scheduling failure is logged and, when a status row exists, marks it failed, so a
 * committed fork/sync is never turned into a 500 by a background-scheduling hiccup.
 */
export async function scheduleForkContentCopy(
  payload: ForkContentCopyPayload,
  options: { detachedLabel: string; requestId?: string }
): Promise<void> {
  const { detachedLabel, requestId = 'unknown' } = options
  try {
    if (isTriggerDevEnabled) {
      const [{ forkContentCopyTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/fork-content-copy'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof forkContentCopyTask>('fork-content-copy', payload, {
        region: await resolveTriggerRegion(),
      })
    } else {
      runDetached(detachedLabel, () => runForkContentCopy(payload))
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to schedule fork content copy`, {
      detachedLabel,
      error: getErrorMessage(error),
    })
    if (payload.statusId) {
      await finishBackgroundWork(db, payload.statusId, {
        status: 'failed',
        error: getErrorMessage(error, 'Could not start the background copy'),
      }).catch(() => {})
    }
  }
}
