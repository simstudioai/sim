import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { task, tasks } from '@trigger.dev/sdk'
import { dispatcherStep } from '@/lib/table/dispatcher'

const logger = createLogger('TableRunDispatcherTask')

export interface TableRunDispatcherPayload {
  dispatchId: string
}

/**
 * Trigger.dev wrapper around `dispatcherStep`. Each task run processes one
 * window of rows and re-enqueues itself with `concurrencyKey: dispatchId` so
 * a single dispatch can't fork. Self-re-enqueue caps each task run's
 * duration; the persisted cursor handles crash recovery.
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
    const { dispatchId } = payload
    try {
      const result = await dispatcherStep(dispatchId)
      if (result === 'continue') {
        await tasks.trigger<typeof tableRunDispatcherTask>(
          'table-run-dispatcher',
          { dispatchId },
          { concurrencyKey: dispatchId }
        )
      }
    } catch (err) {
      logger.error(`[${dispatchId}] dispatcher step failed`, { error: toError(err).message })
      throw err
    }
  },
})
