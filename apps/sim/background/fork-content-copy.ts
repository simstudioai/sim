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
 */
export const forkContentCopyTask = task({
  id: 'fork-content-copy',
  retry: { maxAttempts: 1 },
  queue: {
    name: 'fork-content-copy',
    concurrencyLimit: 10,
  },
  run: async (payload: ForkContentCopyPayload) => {
    await runForkContentCopy(payload)
  },
})
