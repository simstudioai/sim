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
 * execute. The cursor is persisted in DB; if this run crashes, trigger.dev
 * retries and the next attempt resumes from the persisted cursor.
 */
export const tableRunDispatcherTask = task({
  id: 'table-run-dispatcher',
  machine: 'small-1x',
  retry: { maxAttempts: 3 },
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
