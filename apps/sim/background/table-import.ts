import { task } from '@trigger.dev/sdk'
import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'

/**
 * Trigger.dev wrapper around `runTableImport`. The job's lifecycle (claim, progress heartbeat,
 * cancel, terminal state) lives in the `table_jobs` state machine, so the task is a thin shell:
 * the worker's per-batch ownership gate stops it on cancel/supersede regardless of where it runs.
 *
 * `maxAttempts: 1` — a blind re-run would re-insert batches the failed attempt already committed
 * (imports commit per batch with no rollback). A crashed import marks failed via the worker's own
 * catch, or the stale-job janitor if the process died; the user retries the upload.
 */
export const tableImportTask = task({
  id: 'table-import',
  machine: 'small-1x',
  retry: { maxAttempts: 1 },
  queue: {
    name: 'table-import',
    concurrencyLimit: 10,
  },
  run: async (payload: TableImportPayload) => {
    await runTableImport(payload)
  },
})
