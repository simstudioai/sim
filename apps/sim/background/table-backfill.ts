import { task } from '@trigger.dev/sdk'
import { runTableBackfill, type TableBackfillPayload } from '@/lib/table/backfill-runner'

/**
 * Trigger.dev wrapper around `runTableBackfill` (output-column backfill from saved execution
 * logs). Retry-safe: re-plucking the same trace spans writes the same values, and
 * `overwrite: false` passes skip already-filled cells. The `table_jobs` ownership gate stops a
 * run that lost the job within one page.
 */
export const tableBackfillTask = task({
  id: 'table-backfill',
  machine: 'small-1x',
  retry: { maxAttempts: 3 },
  queue: {
    name: 'table-backfill',
    concurrencyLimit: 10,
  },
  run: async (payload: TableBackfillPayload) => {
    await runTableBackfill(payload)
  },
})
