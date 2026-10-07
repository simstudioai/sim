import { task } from '@trigger.dev/sdk'
import {
  type ForkContentCopyPayload,
  runForkContentCopy,
} from '@/ee/workspace-forking/lib/copy/content-copy-runner'

/**
 * Trigger.dev wrapper for the post-fork heavy-content copy (table rows, KB
 * documents + embeddings, file blobs). Backgrounding keeps the fork request fast
 * and lets the copy survive app deploys. `maxAttempts: 1` — the copy is
 * non-transactional best-effort (per-row inserts with fresh ids), so a blind
 * re-run would duplicate rows; a partial failure simply leaves the fork's content
 * incomplete (the workflows themselves committed synchronously).
 *
 * Runs on `large-2x` (8 vCPU / 16 GB), matching `knowledge-connector-sync`: the
 * copy materializes table rows, KB chunks and their embedding vectors, and file
 * blobs in memory, and `maxAttempts: 1` means an OOM is unrecoverable — a
 * half-copied fork with no retry.
 */
export const forkContentCopyTask = task({
  id: 'fork-content-copy',
  machine: 'large-2x',
  /**
   * Inside `STALE_ACTIVE_MS` (30 minutes, in the background-work store), after
   * which the outbox cron marks the fork's status row failed. A run outliving
   * that would keep copying under a status that already says it failed; the
   * remaining five minutes absorb queue wait, since the row starts its clock at
   * fork time.
   */
  maxDuration: 1500,
  retry: { maxAttempts: 1 },
  queue: {
    name: 'fork-content-copy',
    concurrencyLimit: 10,
  },
  run: async (payload: ForkContentCopyPayload) => {
    await runForkContentCopy(payload)
  },
})
