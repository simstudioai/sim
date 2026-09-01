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
 * execute. The cursor is persisted in DB between windows.
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
