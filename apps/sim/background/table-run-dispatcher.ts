import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { task } from '@trigger.dev/sdk'
import { runDispatcherToCompletion } from '@/lib/table/dispatcher'

const logger = createLogger('TableRunDispatcherTask')

export interface TableRunDispatcherPayload {
  dispatchId: string
  /** Invoker's plan-resolved window size. Absent on payloads from before the
   *  field existed → dispatcher falls back to the legacy cap. */
  concurrency?: number
}

/**
 * Trigger.dev wrapper around `dispatcherStep`. One task run holds the
 * dispatcher loop for the dispatch's entire lifetime — each iteration
 * processes a window of cells via `batchTriggerAndWait`, which checkpoints
 * the parent via CRIU during the wait so we don't pay compute while cells
 * execute. The cursor is persisted in DB, so an attempt that starts after a
 * crash resumes from it rather than replaying the dispatch.
 *
 * `maxAttempts` alone does NOT cover an OOM: Trigger.dev retries
 * `TASK_PROCESS_OOM_KILLED` only when `retry.outOfMemory.machine` names a
 * larger preset. Four runs were killed this way and every one recorded
 * `attempt_count = 1` — no retry happened, and the dispatch row was left
 * `dispatching` forever. The escalating preset is what makes the documented
 * resume actually reachable; the cleanup sweep is the backstop for a dispatch
 * whose holder dies without one.
 */
export const tableRunDispatcherTask = task({
  id: 'table-run-dispatcher',
  /**
   * Memory, not CPU. Peak RSS sits at a flat 457-464 MB plateau regardless of
   * run length (10x the duration moves it ~4 MB), and it has crept ~2% per
   * release for a month — 446 MB in late July to 545 MB, past the 512 MiB
   * `small-1x` ceiling. Meanwhile CPU utilization peaks at 0.19 and sits at
   * 0.03 for p90, so the larger preset is bought for its RAM.
   */
  machine: 'small-2x',
  retry: { maxAttempts: 3, outOfMemory: { machine: 'medium-1x' } },
  queue: {
    name: 'table-run-dispatcher',
    concurrencyLimit: 8,
  },
  run: async (payload: TableRunDispatcherPayload) => {
    const { dispatchId, concurrency } = payload
    try {
      await runDispatcherToCompletion(dispatchId, concurrency)
    } catch (err) {
      logger.error(`[${dispatchId}] dispatcher loop failed`, { error: toError(err).message })
      throw err
    }
  },
})
