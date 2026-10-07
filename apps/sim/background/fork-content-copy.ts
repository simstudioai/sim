import { task } from '@trigger.dev/sdk'
import { STALE_ACTIVE_MS } from '@/ee/workspace-forking/lib/background-work/store'
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
   * Ends inside {@link STALE_ACTIVE_MS}, after which the outbox cron marks the fork's status
   * row failed, so a run never keeps copying under a status that already says it failed. The
   * five-minute margin absorbs queue wait, since the row's clock starts at fork time.
   */
  maxDuration: STALE_ACTIVE_MS / 1000 - 5 * 60,
  retry: { maxAttempts: 1 },
  queue: {
    name: 'fork-content-copy',
    concurrencyLimit: 10,
  },
  run: async (payload: ForkContentCopyPayload) => {
    await runForkContentCopy(payload)
  },
})
